// crc32.js
// Tiny CRC-32 (IEEE 802.3, polynomial 0xEDB88320) for Synchronet JS
// Exposes: crc32_calc(input) -> unsigned 32-bit integer
// Accepts a JavaScript string (processed as bytes, charCode & 0xFF) or an array of byte values.

// Build CRC table once (no ES6, no trailing commas)
var CRC32_TABLE = (function () {
    var table = new Array(256);
    var i, j, c;
    for (i = 0; i < 256; i++) {
        c = i;
        for (j = 0; j < 8; j++) {
            if ((c & 1) !== 0)
                c = (c >>> 1) ^ 0xEDB88320;
            else
                c = c >>> 1;
        }
        table[i] = c >>> 0; // ensure unsigned
    }
    return table;
})();

/**
 * Calculate CRC-32 of a string or byte array.
 * @param {String|Array} input
 * @returns {Number} Unsigned 32-bit CRC
 */
function crc32_calc(input) {
    var crc = 0xFFFFFFFF;
    var i, b, len;

    if (input == null) return (crc ^ 0xFFFFFFFF) >>> 0;

    if (typeof input === "string") {
        len = input.length;
        for (i = 0; i < len; i++) {
            b = input.charCodeAt(i) & 0xFF;
            crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ b) & 0xFF];
        }
    } else if (typeof input.length === "number") {
        len = input.length;
        for (i = 0; i < len; i++) {
            b = input[i] & 0xFF;
            crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ b) & 0xFF];
        }
    } else {
        // Fallback: coerce to string
        var s = String(input);
        len = s.length;
        for (i = 0; i < len; i++) {
            b = s.charCodeAt(i) & 0xFF;
            crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ b) & 0xFF];
        }
    }

    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Optional helpers (safe to ignore)
// Convert CRC number to 8-hex (uppercase) if you ever need it directly:
// function crc32_hex(n) { return ("00000000" + (n >>> 0).toString(16)).slice(-8).toUpperCase(); }
