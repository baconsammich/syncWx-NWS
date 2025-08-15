// websocket-helpers.js (hardened)
// Keeps the same public API: wstsGetIPAddress(), wsrsGetIPAddress()

load('sbbsdefs.js');

/**
 * Try to get the real client IP from a WebSocket Telnet session using RFC 1079 TTYLOC.
 * Returns a dotted-quad string (e.g., "203.0.113.42") or undefined on failure.
 *
 * Notes:
 * - Only makes sense for Telnet-over-WebSocket proxies that honor TTYLOC.
 * - We never leave console input locked if anything throws.
 * - Parsing is defensive; we ignore garbage and only accept a well-formed SB/SE reply.
 */
function wstsGetIPAddress(timeoutSeconds) {
    var ip = [];
    var data = [];
    var tmo = (typeof timeoutSeconds === 'number' && timeoutSeconds > 0) ? timeoutSeconds : 1.0;

    // Quick sanity checks so we don't explode if called in the wrong context.
    if (typeof client === 'undefined'
        || !client
        || client.protocol !== 'Telnet'
        || !client.socket
        || typeof client.socket.data_waiting === 'undefined'
        || typeof client.socket.recvBin !== 'function'
        || typeof console.telnet_cmd !== 'function') {
        // Not a Telnet session with a socket; nothing to do.
        return;
    }

    try {
        console.lock_input(true);

        // IAC DO TTYLOC
        // 255 = IAC, 253 = DO, 28 = TTYLOC
        console.telnet_cmd(253, 28);

        var start = system.timer;
        // Collect bytes until we see IAC SE (255, 240) or hit timeout.
        while (system.timer - start < tmo) {
            if (!client.socket.data_waiting) {
                /* yield */ continue;
            }
            var b = client.socket.recvBin(1);
            if (typeof b === 'number') data.push(b);

            // Look for end of subnegotiation: IAC SE
            if (data.length >= 2 && data[data.length - 2] === 255 && data[data.length - 1] === 240) {
                break;
            }
        }

        // Validate minimal structure: IAC SB TTYLOC ... IAC SE
        if (data.length < 14                // far less than any sane TTYLOC reply
            || data[0] !== 255              // IAC
            || data[1] !== 250              // SB
            || data[2] !== 28               // TTYLOC
            || data[3] !== 0                // FORMAT (0 = binary)
            || data[data.length - 2] !== 255// IAC
            || data[data.length - 1] !== 240) { // SE
            throw "Invalid reply to TTYLOC command.";
        }

        // Un-stuff doubled IAC bytes per Telnet spec and extract payload after FORMAT (index 4..len-2)
        for (var i = 4; i < data.length - 2; i++) {
            var v = data[i];
            ip.push(v);
            if (v === 255) { // IAC byte stuffing
                i++; // skip the duplicate
            }
        }

        // Expected 8 bytes: 4 local + 4 remote (we want the remote first 4 per typical proxies)
        // Some proxies put remote first; others put local first. Prefer the sequence that yields a public-ish IP.
        if (ip.length !== 8) throw "Invalid TTYLOC payload length.";

        var a = ip.slice(0, 4); // candidate #1
        var b = ip.slice(4, 8); // candidate #2

        function bytesToIP(arr) { return arr.join('.'); }
        function looksPublic(q) {
            // quick-and-dirty private/address-space check
            var s = bytesToIP(q);
            return !(/^10\./.test(s) ||
                     /^192\.168\./.test(s) ||
                     /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(s) ||
                     /^127\./.test(s) ||
                     /^169\.254\./.test(s));
        }

        var remote = looksPublic(a) ? a : (looksPublic(b) ? b : a);
        return bytesToIP(remote);

    } catch (err) {
        log(LOG_DEBUG, err);
        return;

    } finally {
        // Always release the lock, even if we bailed out above.
        try { console.lock_input(false); } catch (e) {}
    }
}

/**
 * Try to read the last-known client IP captured by the V4 web UI/RLogin bridge.
 * Returns an IP string or undefined if not available.
 */
function wsrsGetIPAddress() {
    var fn = format('%suser/%04d.web', system.data_dir, user.number);
    if (!file_exists(fn)) return;
    var f = new File(fn);
    if (!f.open('r')) return;
    var session;
    try {
        session = f.iniGetObject();
    } finally {
        f.close();
    }
    if (!session || typeof session.ip_address === 'undefined') return;
    return session.ip_address;
}
