// xtrn/syncWXremix/providers/nws.js
// National Weather Service provider for syncWXremix
// Requires: Synchronet HTTPRequest (preferred). Falls back to fetch if available.
(function(global) {
  const BASE = "https://api.weather.gov";

  function httpJSON(url, ua) {
    if (typeof HTTPRequest === "function") {
      var req = new HTTPRequest();
      req.AddHeader("User-Agent", ua);
      req.AddHeader("Accept", "application/geo+json");
      var body = req.Get(url);
      if (req.response_code < 200 || req.response_code >= 300)
        throw new Error("NWS " + req.response_code + " " + req.response_reason + " for " + url);
      return JSON.parse(body);
    }
    if (typeof fetch === "function") {
      return fetch(url, {
        headers: { "User-Agent": ua, "Accept": "application/geo+json" }
      }).then(res => {
        if (!res.ok) throw new Error("NWS " + res.status + " " + res.statusText + " for " + url);
        return res.json();
      });
    }
    throw new Error("No HTTP client available (HTTPRequest or fetch).");
  }

  function pickNearestStation(stationsLD) {
    if (stationsLD && stationsLD.observationStations && stationsLD.observationStations.length)
      return stationsLD.observationStations[0].split("/").pop();
    if (stationsLD && stationsLD["@graph"] && stationsLD["@graph"].length)
      return stationsLD["@graph"][0].stationIdentifier;
    return null;
  }

  function qvTo(valueObj, target) {
    if (!valueObj || valueObj.value == null) return null;
    const v = valueObj.value;
    const u = (valueObj.unitCode || "").toLowerCase();
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
        if (u.indexOf("pa") >= 0) return v / 3386.389;
        if (u.indexOf("hpa") >= 0) return v / 33.86389;
        return v;
      case "mi":
        if (u.indexOf("m") >= 0) return v / 1609.344;
        return v;
      case "%":
        return v;
      default:
        return v;
    }
  }

  function mapShortForecastToIcon(shortText) {
    if (!shortText) return "na";
    const s = shortText.toLowerCase();
    if (s.includes("thunder")) return "tsra";
    if (s.includes("snow")) return "snow";
    if (s.includes("sleet") || s.includes("wintry")) return "sleet";
    if (s.includes("freezing")) return "fzra";
    if (s.includes("rain") || s.includes("showers")) return "rain";
    if (s.includes("drizzle")) return "rain";
    if (s.includes("hail")) return "hail";
    if (s.includes("fog") || s.includes("mist")) return "fog";
    if (s.includes("haze") || s.includes("smoke")) return "haze";
    if (s.includes("wind")) return "wind";
    if (s.includes("cloudy")) return "ovc";
    if (s.includes("partly")) return "sct";
    if (s.includes("mostly")) return "bkn";
    if (s.includes("sunny") || s.includes("clear")) return "skc";
    return "ovc";
  }

  function normalizeForecastPeriods(periods) {
    return periods.map(p => ({
      name: p.name || "",
      start: p.startTime,
      end: p.endTime,
      isDay: !!p.isDaytime,
      tempF: typeof p.temperature === "object" ? qvTo(p.temperature, "F") : (p.temperatureUnit === "C" ? (p.temperature * 9/5 + 32) : p.temperature),
      windDir: p.windDirection || "",
      wind: (typeof p.windSpeed === "string") ? p.windSpeed : (p.windSpeed ? Math.round(qvTo(p.windSpeed, "mph")) + " mph" : ""),
      gust: (typeof p.windGust === "string") ? p.windGust : (p.windGust ? Math.round(qvTo(p.windGust, "mph")) + " mph" : ""),
      pop: p.probabilityOfPrecipitation ? Math.round((p.probabilityOfPrecipitation.value || 0)) : null,
      short: p.shortForecast || "",
      detailed: p.detailedForecast || "",
      iconKey: mapShortForecastToIcon(p.shortForecast || "")
    }));
  }

  function normalizeObservation(obs) {
    const P = obs.properties;
    return {
      when: P.timestamp,
      text: P.textDescription || "",
      tempF: P.temperature && P.temperature.value != null ? Math.round(qvTo(P.temperature, "F")) : null,
      dewF: P.dewpoint && P.dewpoint.value != null ? Math.round(qvTo(P.dewpoint, "F")) : null,
      rh: P.relativeHumidity && P.relativeHumidity.value != null ? Math.round(qvTo(P.relativeHumidity, "%")) : null,
      windDirDeg: P.windDirection && P.windDirection.value != null ? Math.round(P.windDirection.value) : null,
      windMph: P.windSpeed && P.windSpeed.value != null ? Math.round(qvTo(P.windSpeed, "mph")) : null,
      gustMph: P.windGust && P.windGust.value != null ? Math.round(qvTo(P.windGust, "mph")) : null,
      visMi: P.visibility && P.visibility.value != null ? (qvTo(P.visibility, "mi")).toFixed(1) : null,
      pressureIn: P.barometricPressure && P.barometricPressure.value != null ? (qvTo(P.barometricPressure, "inHg")).toFixed(2) : null
    };
  }

  function normalizeAlerts(collection) {
    const feats = collection.features || [];
    return feats.map(f => {
      const a = f.properties;
      return {
        id: a.id,
        event: a.event,
        headline: a.headline || a.event,
        severity: a.severity,
        urgency: a.urgency,
        certainty: a.certainty,
        effective: a.effective,
        expires: a.expires,
        area: a.areaDesc,
        instruction: a.instruction || "",
      };
    });
  }

  function getRelLoc(props) {
    if (props && props.relativeLocation && props.relativeLocation.properties) {
      var rl = props.relativeLocation.properties;
      var city = rl.city || "";
      var state = rl.state || "";
      if (city && state) return city + ", " + state;
      if (city) return city;
      if (state) return state;
    }
    return null;
  }

  function syncOrPromise(v) {
    // In Synchronet, httpJSON returns sync object; in browsers it returns Promise.
    if (v && typeof v.then === "function") {
      // Not ideal for true async, but we expect sbbs path.
      throw new Error("Asynchronous fetch not supported in this runtime.");
    }
    return v;
  }

  function loadNWS(lat, lon, ua, preferredStationId) {
    var pt = syncOrPromise(httpJSON(BASE + "/points/" + lat + "," + lon, ua));
    var props = pt.properties;
    var forecastURL = props.forecast;
    var stationsURL = props.observationStations;
    var zoneId = (props.forecastZone || "").split("/").pop();
    var countyId = (props.county || "").split("/").pop();

    var f = syncOrPromise(httpJSON(forecastURL + "?units=us", ua));
    var periods = normalizeForecastPeriods(f.properties.periods || []);

    var stationId = preferredStationId;
    if (!stationId) {
      var st = syncOrPromise(httpJSON(stationsURL, ua));
      stationId = pickNearestStation(st);
    }
    var current = null;
    if (stationId) {
      var latest = syncOrPromise(httpJSON(BASE + "/stations/" + stationId + "/observations/latest?require_qc=true", ua));
      current = normalizeObservation(latest);
    }

    var alerts = syncOrPromise(httpJSON(BASE + "/alerts/active?point=" + lat + "," + lon, ua));

    return {
      location: getRelLoc(props) || ("Lat " + lat + ", Lon " + lon),
      zoneId: zoneId,
      countyId: countyId,
      stationId: stationId,
      forecast: periods,
      current: current,
      alerts: normalizeAlerts(alerts)
    };
  }

  global.NWSProvider = { load: loadNWS };
})(this);
