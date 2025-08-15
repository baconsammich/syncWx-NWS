// providers/nws.js — NWSProvider
// Returns structured {error:{...}} instead of throwing so callers can show useful diagnostics.

var NWSProvider = (function () {

    function safeGet(o, path) {
        try {
            var parts = path.split(".");
            var cur = o;
            for (var i = 0; i < parts.length; i++) {
                if (cur == null) return null;
                cur = cur[parts[i]];
            }
            return cur;
        } catch (e) { return null; }
    }

    function getPoint(http, lat, lon) {
        return http.getJSON(
            "https://api.weather.gov/points/" + String(lat) + "," + String(lon),
            "application/ld+json, application/geo+json, application/json"
        );
    }
    function getForecast(http, url) {
        if (!url) return null;
        return http.getJSON(url, "application/ld+json, application/geo+json, application/json");
    }
    function getObservation(http, stationId) {
        if (!stationId) return null;
        return http.getJSON(
            "https://api.weather.gov/stations/" + stationId + "/observations/latest?require_qc=false",
            "application/geo+json, application/json"
        );
    }
    function getAlertsForState(http, stateCode) {
        if (!stateCode) return null;
        return http.getJSON(
            "https://api.weather.gov/alerts/active?area=" + encodeURIComponent(stateCode),
            "application/geo+json, application/ld+json, application/json"
        );
    }
    function pickFirstStation(http, stationsUrl) {
        if (!stationsUrl) return null;
        var json = http.getJSON(
            stationsUrl + (stationsUrl.indexOf("?") > 0 ? "&" : "?") + "limit=1",
            "application/geo+json, application/json"
        );
        try {
            if (json && json.features && json.features.length) {
                var p = json.features[0].properties;
                return p && p.stationIdentifier ? p.stationIdentifier : null;
            }
        } catch (e) {}
        return null;
    }
    function inferStateFromPoint(point) {
        try {
            var countyUrl = safeGet(point, "properties.county");
            if (!countyUrl) return null;
            var id = countyUrl.split("/").pop(); // e.g., KSZ091
            var state2 = id.substring(0, 2);     // KS
            return /^[A-Z]{2}$/.test(state2) ? state2 : null;
        } catch (e) { return null; }
    }

    function load(ctx) {
        if (!ctx || !ctx.http || typeof ctx.http.getJSON !== "function")
            return { error: { stage: "init", message: "invalid http context" } };

        var http = ctx.http, lat = ctx.latitude, lon = ctx.longitude;

        var pin = getPoint(http, lat, lon);
        // If the door context failed to attach UA, we’ll see __transport_error or no properties.
        if (!pin || pin.__transport_error || !pin.properties) {
            return {
                error: {
                    stage: "points",
                    message: "points lookup failed",
                    transport: pin ? pin.__transport_error : "no-response",
                    url: pin && pin.__url ? pin.__url : ("https://api.weather.gov/points/" + lat + "," + lon),
                    sample: pin && pin.__raw ? pin.__raw : null
                },
                point: pin
            };
        }

        var forecastUrl = safeGet(pin, "properties.forecast");
        var hourlyUrl   = safeGet(pin, "properties.forecastHourly");
        var forecast    = getForecast(http, forecastUrl);
        var hourly      = getForecast(http, hourlyUrl);

        var stationId   = ctx.station || pickFirstStation(http, safeGet(pin, "properties.observationStations"));
        var observation = getObservation(http, stationId);

        var st = inferStateFromPoint(pin);
        var alerts = st ? getAlertsForState(http, st) : null;

        return {
            point: pin,
            forecast: forecast,
            hourly: hourly,
            observation: observation,
            stationId: stationId || null,
            alerts: alerts
        };
    }

    function iconKeyFromShortForecast(sf, isDay) {
        if (!sf) return "unknown";
        var s = String(sf).toLowerCase();
        if (s.indexOf("thunder")>=0) return isDay ? "tstorms" : "nt_tstorms";
        if (s.indexOf("snow")>=0 || s.indexOf("flurr")>=0) return isDay ? "snow" : "nt_snow";
        if (s.indexOf("sleet")>=0 || s.indexOf("freezing")>=0 || s.indexOf("ice")>=0) return isDay ? "sleet" : "nt_sleet";
        if (s.indexOf("rain")>=0 || s.indexOf("showers")>=0 || s.indexOf("drizzle")>=0) return isDay ? "rain" : "nt_rain";
        if (s.indexOf("cloud")>=0 || s.indexOf("overcast")>=0) return isDay ? "cloudy" : "nt_cloudy";
        if (s.indexOf("partly")>=0 || s.indexOf("mostly")>=0) return isDay ? "partlycloudy" : "nt_partlycloudy";
        if (s.indexOf("clear")>=0 || s.indexOf("sunny")>=0) return isDay ? "clear" : "nt_clear";
        return isDay ? "cloudy" : "nt_cloudy";
    }

    function convert(data) {
        var out = {
            location_full: null,
            conditions: null,
            temp_string: null,
            sunrise: null,
            sunset: null,
            moon_phase: null,
            wind_string: null,
            forecast: [],
            icon_key_daynight: null,
            icon_key_day: null,
            alert: null
        };

        try {
            var rl = safeGet(data, "point.properties.relativeLocation.properties");
            if (rl && rl.city) out.location_full = rl.city + (rl.state ? ", " + rl.state : "");
        } catch (e) {}

        try {
            var p0 = safeGet(data, "forecast.properties.periods.0");
            if (p0) {
                out.icon_key_daynight = iconKeyFromShortForecast(p0.shortForecast, !!p0.isDaytime);
                out.icon_key_day = iconKeyFromShortForecast(p0.shortForecast, true);
            }
        } catch (e) {}

        try {
            var periods = safeGet(data, "forecast.properties.periods") || [];
            var unitLbl;
            for (var i = 0; i < periods.length && out.forecast.length < 4; i++) {
                var p = periods[i]; if (!p) continue;
                var isDay = !!p.isDaytime;
                var low=null, high=null;
                unitLbl = p.temperatureUnit === "C" ? "°C" : "°F";
                if (typeof p.temperature === 'number') {
                    if (isDay) high = p.temperature; else low = p.temperature;
                }
                out.forecast.push({
                    weekday: p.name || "",
                    cond_short: p.shortForecast || "",
                    low_label: low  !== null ? "Low  " : "",
                    high_label: high !== null ? "High " : "",
                    low:  low  !== null ? String(low)  : "",
                    high: high !== null ? String(high) : "",
                    unit: unitLbl
                });
            }
        } catch (e) {}

        try {
            var a = data.alerts;
            if (a) {
                var alertObj = null;
                if (a.features && a.features.length) alertObj = a.features[0].properties;
                else if (a["@graph"] && a["@graph"].length) alertObj = a["@graph"][0];
                if (alertObj) {
                    out.alert = {
                        event:   alertObj.event || null,
                        title:   alertObj.headline || alertObj.event || null,
                        sent:    alertObj.sent || null,
                        expires: alertObj.expires || null,
                        ends:    alertObj.ends || null,
                        area:    alertObj.areaDesc || null
                    };
                }
            }
        } catch (e) {}

        return out;
    }

    return { load: load, convert: convert };
})();
