//syncWXremix by KenDB3 - http://bbs.kd3.us
//NWS provider migration by D2SK http://pwbass.com
//Code for Error Handling by Kirkman - http://breakintochat.com & https://github.com/Kirkman
//Code for detection of a Web Socket client's Real IP address by echicken - http://bbs.electronicchicken.com/ & https://github.com/echicken
//Original syncWX by nolageek - http://www.capitolshrill.com/ & https://gist.github.com/nolageek/4168edf17fae3f834e30
//Weather Icon designs done in Ctrl-A colored ASCII (Synchronet Formatting) by KenDB3
//Weather Icons inspired by wego (Weather Client for Terminals), created by Markus Teich <teichm@in.tum.de> - https://github.com/schachmat/wego
//See License file packaged with the icons for ISC License

// ---------------------------
// CONFIG & LIBS
// ---------------------------

log(user.ip_address);

// Load modopts.ini info early so we can detect if the section exists for [SyncWX]
var opts = load({}, "modopts.js", "SyncWX");
if (opts === null) {
    log("ERROR in weather.js: opts is null.");
    log("ERROR in weather.js: Are you sure you have a section in modopts.ini labeled [SyncWX]? See sysop.txt for instructions.");
    exit();
}

// Expected new options (add to [SyncWX] in modopts.ini):
// latitude=41.8781
// longitude=-87.6298
// user_agent=Retro Mafia BBS syncWXremix (sysop: patrick@example.com)
// station=   (optional e.g. KORD)
// provider=nws
var LAT = parseFloat(opts.latitude);
var LON = parseFloat(opts.longitude);
var UA  = opts.user_agent || "Retro Mafia BBS syncWXremix (sysop: sysop@example.com)";
var STATION_OVERRIDE = opts.station;
var PROVIDER = (opts.provider || "nws").toLowerCase();

load("http.js");       // HTTPRequest
load("sbbsdefs.js");   // constants
load(js.exec_dir + "websocket-helpers.js");

// Try to load new wxlanguage.js file, but default to English if it is missing
try {
    load(js.exec_dir + "wxlanguage.js");
} catch (err) {
    log("INFO in weather.js: wxlanguage.js not found; defaulting to English strings.");
} finally {
    WXlang = ""; // not used by NWS, kept for compatibility with existing strings
    LocationHeader   = "Your Location: ";
    ConditionsHeader = "Current Conditions: ";
    TempHeader       = "Temp: ";
    SunHeader        = "Sunrise/Sunset: ";  // NWS doesn’t provide astronomy; line kept but not used
    LunarHeader      = "Lunar Phase: ";     // NWS doesn’t provide astronomy; line kept but not used
    WindHeader       = "Wind: ";
    UVHeader         = "UV Index: ";        // NWS doesn’t provide UV; line kept but not used
    AlertExpires     = "Expires ";
    ReadAlert        = "Read the Full Alert";
    degreeSymbol     = "\370"; // ANSI/CP437 Degree Symbol
}

var weathericon_ext = opts.weathericon_ext || ".ans"; // Now defined in /sbbs/ctrl/modopts.ini
var fallback_type = opts.fallback_type;
var fallback = opts.fallback;
var dialup = (parseInt(user.connection) > 0); // detect dial-up

// If a user connects through HTMLterm (proxy), try to infer real IP when needed.
// (kept from original for compatibility; NWS path uses fixed lat/lon instead of GeoIP.)
function getBackupSuffix() {
    var bs;
    var ip = resolve_ip(system.inet_addr);
    if (dialup) {
        bs = ip;
    } else if (user.ip_address.search(
        /(^127\.)|(^192\.168\.)|(^10\.)|(^172\.1[6-9]\.)|(^172\.2[0-9]\.)|(^172\.3[0-1]\.)|(^169\.254\.)|(^::1$)|(^[fF][cCdD])/
    ) > -1 || user.ip_address === ip) {
        if (client.protocol === "Telnet") {
            bs = wstsGetIPAddress();
        } else if (bbs.sys_status & SS_RLOGIN) {
            bs = wsrsGetIPAddress();
        }
        if (typeof bs === "undefined") bs = ip;
    } else {
        bs = user.ip_address;
    }
    return bs;
}
var backupQuery = getBackupSuffix();

// ---------------------------
// NWS HELPERS
// ---------------------------

var NWS_BASE = "https://api.weather.gov";

function httpJSON(url) {
    var req = new HTTPRequest();
    req.AddHeader("User-Agent", UA);
    req.AddHeader("Accept", "application/geo+json");
    var body = req.Get(url);
    if (req.response_code < 200 || req.response_code >= 300) {
        throw new Error("NWS " + req.response_code + " " + req.response_reason + " for " + url);
    }
    return JSON.parse(body);
}

function qvTo(valueObj, target) {
    if (!valueObj || valueObj.value == null) return null;
    var v = valueObj.value;
    var u = (valueObj.unitCode || "").toLowerCase();
    switch (target) {
        case "F":
            if (u.indexOf("degc") >= 0) return (v * 9/5) + 32;
            if (u.indexOf("degf") >= 0) return v;
            return v;
        case "mph":
            if (u.indexOf("m_s-1") >= 0) return v * 2.23693629;
            if (u.indexOf("km_h-1") >= 0) return v * 0.621371;
            if (u.indexOf("kn") >= 0) return v * 1.15078;
            return v;
        case "inHg":
            if (u.indexOf("pa") >= 0)  return v / 3386.389;
            if (u.indexOf("hpa") >= 0) return v / 33.86389;
            return v;
        case "mi":
            if (u.indexOf("m") >= 0)   return v / 1609.344;
            return v;
        case "%":
            return v;
        default:
            return v;
    }
}

function degToCompass(deg) {
    if (deg == null || isNaN(deg)) return "";
    var dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    var idx = Math.round((deg % 360) / 22.5) % 16;
    return dirs[idx];
}

function mapShortForecastToIcon(shortText) {
    if (!shortText) return "unknown";
    var s = shortText.toLowerCase();
    if (s.indexOf("thunder") >= 0) return "tsra";
    if (s.indexOf("snow") >= 0) return "snow";
    if (s.indexOf("sleet") >= 0 || s.indexOf("wintry") >= 0) return "sleet";
    if (s.indexOf("freezing") >= 0) return "fzra";
    if (s.indexOf("rain") >= 0 || s.indexOf("showers") >= 0 || s.indexOf("drizzle") >= 0) return "rain";
    if (s.indexOf("hail") >= 0) return "hail";
    if (s.indexOf("fog") >= 0 || s.indexOf("mist") >= 0) return "fog";
    if (s.indexOf("haze") >= 0 || s.indexOf("smoke") >= 0) return "haze";
    if (s.indexOf("wind") >= 0) return "wind";
    if (s.indexOf("cloudy") >= 0) return "ovc";
    if (s.indexOf("partly") >= 0) return "sct";
    if (s.indexOf("mostly") >= 0) return "bkn";
    if (s.indexOf("sunny") >= 0 || s.indexOf("clear") >= 0) return "skc";
    return "ovc";
}

// Make some CP437/ANSI arrows for wind direction (same as original)
var windArrowDirN   = "\001h\001y\031";
var windArrowDirNNE = "\001h\001y\031\031\021";
var windArrowDirNE  = "\001h\001y\031\021";
var windArrowDirENE = "\001h\001y\021\031\021";
var windArrowDirE   = "\001h\001y\021";
var windArrowDirESE = "\001h\001y\021\030\021";
var windArrowDirSE  = "\001h\001y\030\021";
var windArrowDirSSE = "\001h\001y\030\030\021";
var windArrowDirS   = "\001h\001y\030";
var windArrowDirSSW = "\001h\001y\030\030\020";
var windArrowDirSW  = "\001h\001y\030\020";
var windArrowDirWSW = "\001h\001y\020\030\020";
var windArrowDirW   = "\001h\001y\020";
var windArrowDirWNW = "\001h\001y\020\031\020";
var windArrowDirNW  = "\001h\001y\031\020";
var windArrowDirNNW = "\001h\001y\031\031\020";

function windArrowFromCompass(dir) {
    switch (dir) {
        case "N":   return " " + windArrowDirN;
        case "NNE": return " " + windArrowDirNNE;
        case "NE":  return " " + windArrowDirNE;
        case "ENE": return " " + windArrowDirENE;
        case "E":   return " " + windArrowDirE;
        case "ESE": return " " + windArrowDirESE;
        case "SE":  return " " + windArrowDirSE;
        case "SSE": return " " + windArrowDirSSE;
        case "S":   return " " + windArrowDirS;
        case "SSW": return " " + windArrowDirSSW;
        case "SW":  return " " + windArrowDirSW;
        case "WSW": return " " + windArrowDirWSW;
        case "W":   return " " + windArrowDirW;
        case "WNW": return " " + windArrowDirWNW;
        case "NW":  return " " + windArrowDirNW;
        case "NNW": return " " + windArrowDirNNW;
        default:    return "";
    }
}

// ---------------------------
// NWS FETCH & NORMALIZE
// ---------------------------

function getNWSData(lat, lon, stationOverride) {
    // 1) Resolve point → links
    var pt = httpJSON(NWS_BASE + "/points/" + lat + "," + lon);
    var props = pt.properties || {};

    var forecastURL = props.forecast;            // 12h periods (text)
    var stationsURL = props.observationStations; // list for area
    var zoneId   = (props.forecastZone || "").split("/").pop();
    var countyId = (props.county || "").split("/").pop();
    var relLoc   = (props.relativeLocation && props.relativeLocation.properties)
                    ? (props.relativeLocation.properties.city + ", " + props.relativeLocation.properties.state)
                    : ("Lat " + lat + ", Lon " + lon);

    // 2) Forecast periods
    var f = httpJSON(forecastURL + "?units=us");
    var periods = (f.properties && f.properties.periods) ? f.properties.periods : [];

    // 3) Observation station (pick nearest if not provided)
    var stationId = stationOverride;
    if (!stationId) {
        var st = httpJSON(stationsURL);
        if (st && st.observationStations && st.observationStations.length) {
            stationId = st.observationStations[0].split("/").pop();
        }
    }

    // 4) Latest observation
    var obs = null;
    if (stationId) {
        var latest = httpJSON(NWS_BASE + "/stations/" + stationId + "/observations/latest?require_qc=true");
        var P = latest.properties || {};
        obs = {
            when:   P.timestamp,
            text:   P.textDescription || "",
            tempF:  (P.temperature && P.temperature.value != null) ? Math.round(qvTo(P.temperature, "F")) : null,
            dewF:   (P.dewpoint   && P.dewpoint.value   != null) ? Math.round(qvTo(P.dewpoint,   "F")) : null,
            rh:     (P.relativeHumidity && P.relativeHumidity.value != null) ? Math.round(qvTo(P.relativeHumidity, "%")) : null,
            windDirDeg: (P.windDirection && P.windDirection.value != null) ? Math.round(P.windDirection.value) : null,
            windMph: (P.windSpeed && P.windSpeed.value != null) ? Math.round(qvTo(P.windSpeed, "mph")) : null,
            gustMph: (P.windGust && P.windGust.value != null) ? Math.round(qvTo(P.windGust, "mph")) : null,
            visMi:  (P.visibility && P.visibility.value != null) ? (qvTo(P.visibility, "mi")).toFixed(1) : null,
            pressureIn: (P.barometricPressure && P.barometricPressure.value != null) ? (qvTo(P.barometricPressure, "inHg")).toFixed(2) : null
        };
    }

    // 5) Alerts by point
    var alertsRaw = httpJSON(NWS_BASE + "/alerts/active?point=" + lat + "," + lon);
    var alerts = [];
    if (alertsRaw && alertsRaw.features && alertsRaw.features.length) {
        for (var i = 0; i < alertsRaw.features.length; i++) {
            var a = alertsRaw.features[i].properties || {};
            alerts.push({
                id: a.id,
                headline: a.headline || a.event,
                event: a.event,
                effective: a.effective,
                expires: a.expires,
                severity: a.severity,
                urgency: a.urgency,
                area: a.areaDesc,
                instruction: a.instruction || ""
            });
        }
    }

    return {
        location: relLoc,
        zoneId: zoneId,
        countyId: countyId,
        stationId: stationId,
        periods: periods,
        current: obs,
        alerts: alerts
    };
}

// ---------------------------
// RENDERING (keeps your layout)
// ---------------------------

function firstIconKeyFromPeriods(periods) {
    if (!periods || !periods.length) return "unknown";
    // Prefer the first *current/near-term* period (index 0)
    var p = periods[0];
    return mapShortForecastToIcon(p.shortForecast || p.detailedForecast || "");
}

function safeLen(s) { return (s && s.length) ? s.length : 0; }

function drawANSI(nws) {
    // Colors (same palette as original)
    var gy    = "\1n\001w"; // normal white (gray)
    var wh    = "\001w\1h"; // bright white
    var drkyl = "\001n\001y";
    var yl    = "\001y\1h";
    var drkbl = "\001n\001b";
    var bl    = "\001b\1h";
    var drkrd = "\001n\001r";
    var rd    = "\001r\1h";
    var drkcy = "\001n\001c";
    var cy    = "\001c\1h";

    console.clear();

    // ICON
    var iconKey = firstIconKeyFromPeriods(nws.periods);
    if (!file_exists(js.exec_dir + "icons/" + iconKey + weathericon_ext)) {
        iconKey = "unknown";
    }

    // Prefer file with configured extension; fallback to .asc for non-ANSI later
    console.printfile(js.exec_dir + "icons/" + iconKey + weathericon_ext);

    // TEXT BLOCK (right side)
    console.gotoxy(20,2);
    console.putmsg(wh + LocationHeader + yl + nws.location);

    var currentText = (nws.current && nws.current.text) ? nws.current.text : (nws.periods[0] ? (nws.periods[0].shortForecast || "") : "");
    console.gotoxy(20,3);
    console.putmsg(wh + ConditionsHeader + yl + currentText);

    // Temperature: from obs (preferred) or period 0 temp if available
    var tempF = (nws.current && nws.current.tempF != null)
        ? nws.current.tempF
        : (nws.periods[0] && typeof nws.periods[0].temperature === "number" ? nws.periods[0].temperature : null);

    console.gotoxy(20,4);
    if (tempF != null) {
        console.putmsg(wh + TempHeader + yl + tempF + " " + degreeSymbol + "F");
    } else {
        console.putmsg(wh + TempHeader + yl + "N/A");
    }

    // Wind
    var wdir = (nws.current && nws.current.windDirDeg != null) ? degToCompass(nws.current.windDirDeg) : "";
    var wspd = (nws.current && nws.current.windMph != null) ? nws.current.windMph + " mph" : "calm";
    console.gotoxy(20,5);
    console.putmsg(wh + WindHeader + yl + (wdir ? (wdir + " ") : "") + wspd + windArrowFromCompass(wdir));

    // UV & Astronomy not available from NWS → omit lines 6-8 in ANSI (keep spacing clean)
    // You can add your own sunrise/sunset calc later if desired.

    // Forecast summary rows (use first 4 periods to mimic original footprint)
    var max = Math.min(4, nws.periods.length);
    for (var i = 0; i < max; i++) {
        var p = nws.periods[i];
        var x = 4 + i*19;
        console.gotoxy(x,11);
        console.putmsg(wh + (p.name || (p.isDaytime ? "Day" : "Night")));
        console.gotoxy(x,12);

        var cond = p.shortForecast || (p.detailedForecast || "");
        var condLen = safeLen(cond);
        if (condLen > 18) cond = cond.slice(0,18);
        console.putmsg(yl + cond);

        // Build a Low/High line if we have a day/night pair; otherwise print temp for period
        console.gotoxy(x,13);
        var line13 = "";
        var line14 = "";

        if (p.temperature != null) {
            // For a single period, just show the one temp
            line13 = bl + "Temp ";
            line14 = bl + p.temperature + gy + " " + degreeSymbol + "F";
            // Try to show PoP if present
            if (p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value != null) {
                line13 += wh + "  PoP " + rd + Math.round(p.probabilityOfPrecipitation.value) + "%";
            }
        } else {
            line13 = gy + "";
            line14 = gy + "";
        }
        console.putmsg(line13);
        console.gotoxy(x,14);
        console.putmsg(line14);
    }

    // Alerts (show first if any)
    if (nws.alerts && nws.alerts.length) {
        var a0 = nws.alerts[0];
        console.gotoxy(20,16);
        console.putmsg("\007"); // bell
        console.gotoxy(20,17);
        console.putmsg(drkrd + (a0.headline || a0.event));
        console.gotoxy(20,18);
        console.putmsg(rd + (a0.effective || ""));
        console.gotoxy(20,19);
        console.putmsg(rd + AlertExpires + (a0.expires || ""));
        console.gotoxy(20,20);
        if (console.noyes(ReadAlert) === false) {
            console.putmsg(rd + (a0.instruction || ""));
        }
    }

    console.crlf();
    console.putmsg(gy + " syncWXremix." + drkcy + "KenDB3     " + gy + "icons." + drkcy + "KenDB3      " + gy + "data." + drkbl + "api.weather.gov");
    console.crlf();
}

function drawTTY(nws) {
    // Non-ANSI: text-only; print icon as .asc if available else unknown.asc
    var iconKey = firstIconKeyFromPeriods(nws.periods);
    if (!file_exists(js.exec_dir + "icons/" + iconKey + ".asc")) {
        iconKey = "unknown";
    }
    console.printfile(js.exec_dir + "icons/" + iconKey + ".asc");

    write("\r\n                   " + LocationHeader + (nws.location || "") + "\r\n");
    var currentText = (nws.current && nws.current.text) ? nws.current.text : (nws.periods[0] ? (nws.periods[0].shortForecast || "") : "");
    write("                   " + ConditionsHeader + currentText + "\r\n");

    var tempF = (nws.current && nws.current.tempF != null)
        ? nws.current.tempF
        : (nws.periods[0] && typeof nws.periods[0].temperature === "number" ? nws.periods[0].temperature : null);
    write("                   " + TempHeader + (tempF != null ? (tempF + " F") : "N/A") + "\r\n");

    var wdir = (nws.current && nws.current.windDirDeg != null) ? degToCompass(nws.current.windDirDeg) : "";
    var wspd = (nws.current && nws.current.windMph != null) ? (nws.current.windMph + " mph") : "calm";
    write("                   " + WindHeader + (wdir ? (wdir + " ") : "") + wspd + "\r\n\r\n");

    var max = Math.min(4, nws.periods.length);
    for (var i = 0; i < max; i++) {
        var p = nws.periods[i];
        var cond = p.shortForecast || (p.detailedForecast || "");
        if (safeLen(cond) > 26) cond = cond.slice(0,26);
        write("         " + (p.name || (p.isDaytime ? "Day" : "Night")) + ": " + cond + " | ");
        if (p.temperature != null) {
            write("Temp " + p.temperature + " F\r\n");
        } else {
            write("Temp N/A\r\n");
        }
    }
    console.crlf();

    if (nws.alerts && nws.alerts.length) {
        var a0 = nws.alerts[0];
        console.beep();
        write("                   " + (a0.headline || a0.event) + "\r\n");
        if (a0.effective) write("                   " + a0.effective + "\r\n");
        if (a0.expires)   write("                   " + AlertExpires + a0.expires + "\r\n");
        write("               ");
        if (console.noyes(ReadAlert) === false)
            console.putmsg((a0.instruction || "") + "\r\n");
        console.crlf();
    } else {
        console.crlf(); console.crlf(); console.crlf();
    }

    write(" syncWXremix.KenDB3     icons.KenDB3      data.api.weather.gov\r\n");
}

// ---------------------------
// MAIN
// ---------------------------

function forecastNWS() {
    // Validate coordinates
    if (isNaN(LAT) || isNaN(LON)) {
        log("ERROR in weather.js: latitude/longitude missing or invalid in [SyncWX] modopts.ini.");
        exit();
    }

    var nws = getNWSData(LAT, LON, STATION_OVERRIDE);

    if (console.term_supports(USER_ANSI)) {
        drawANSI(nws);
    } else {
        drawTTY(nws);
    }
}

try {
    if (PROVIDER !== "nws") {
        log("INFO in weather.js: provider in modopts.ini is not 'nws'. Using NWS anyway (WU path removed).");
    }
    forecastNWS();
    console.pause();
    console.clear();
    console.aborted = false;

} catch (err) {
    log("ERROR in weather.js. " + err);
    log(LOG_DEBUG,"DEBUG in weather.js. NWS endpoints used with lat=" + LAT + " lon=" + LON + " station=" + (STATION_OVERRIDE || "auto"));
} finally {
    exit();
}

exit();
