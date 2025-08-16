// providers/nws.js - Enhanced NWS Weather Provider
// Improved error handling, resilience, and data extraction

const NWSProvider = (function() {
  
  // Configuration
  const config = {
    maxRetries: 3,
    retryDelay: 1000,
    cacheMinutes: 10,
    enableFallback: true,
    validateResponses: true
  };
  
  // Known NWS API endpoints
  const endpoints = {
    points: "https://api.weather.gov/points/",
    stations: "https://api.weather.gov/stations/",
    alerts: "https://api.weather.gov/alerts/active",
    gridpoint: "https://api.weather.gov/gridpoints/"
  };
  
  // Accept headers for maximum compatibility
  const acceptHeaders = [
    "application/ld+json",
    "application/geo+json", 
    "application/json",
    "text/json"
  ].join(", ");
  
  /**
   * Safe property accessor with deep path support
   */
  function safeGet(obj, path, defaultValue) {
    if (!obj || !path) return defaultValue !== undefined ? defaultValue : null;
    
    try {
      const parts = path.split(".");
      let current = obj;
      
      for (let i = 0; i < parts.length; i++) {
        // Handle array indices like "periods[0]" or "periods.0"
        const part = parts[i];
        const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
        
        if (arrayMatch) {
          current = current[arrayMatch[1]];
          if (!Array.isArray(current)) return defaultValue !== undefined ? defaultValue : null;
          current = current[parseInt(arrayMatch[2], 10)];
        } else if (/^\d+$/.test(part) && Array.isArray(current)) {
          current = current[parseInt(part, 10)];
        } else {
          current = current[part];
        }
        
        if (current == null) {
          return defaultValue !== undefined ? defaultValue : null;
        }
      }
      
      return current;
    } catch (e) {
      return defaultValue !== undefined ? defaultValue : null;
    }
  }
  
  /**
   * Validate NWS API response structure
   */
  function validateResponse(response, expectedType) {
    if (!response || typeof response !== 'object') return false;
    
    // Check for error indicators
    if (response.status === 'error' || response.error || response.__transport_error) {
      return false;
    }
    
    // Type-specific validation
    switch (expectedType) {
      case 'point':
        return !!(response.properties && response.properties.forecast);
        
      case 'forecast':
        return !!(response.properties && response.properties.periods && 
                  Array.isArray(response.properties.periods));
        
      case 'observation':
        return !!(response.properties && response.properties.timestamp);
        
      case 'stations':
        return !!(response.features && Array.isArray(response.features));
        
      case 'alerts':
        return !!(response.features !== undefined || response["@graph"] !== undefined);
        
      default:
        return true;
    }
  }
  
  /**
   * Enhanced HTTP request with retries
   */
  function robustRequest(http, url, expectedType) {
    let lastError = null;
    
    for (let attempt = 0; attempt < config.maxRetries; attempt++) {
      if (attempt > 0) {
        mswait(config.retryDelay * attempt); // Exponential backoff
      }
      
      const response = http.getJSON(url, acceptHeaders);
      
      // Check for transport errors
      if (response && response.__transport_error) {
        lastError = response;
        
        // Check if error is retryable
        const code = response.__code || 0;
        if (code === 404 || code === 400 || code === 401 || code === 403) {
          break; // Don't retry client errors
        }
        
        continue;
      }
      
      // Validate response if enabled
      if (config.validateResponses && !validateResponse(response, expectedType)) {
        lastError = {
          __transport_error: "Invalid response structure",
          __url: url,
          __response: response
        };
        continue;
      }
      
      return response; // Success
    }
    
    return lastError || {
      __transport_error: "Failed after " + config.maxRetries + " attempts",
      __url: url
    };
  }
  
  /**
   * Get weather grid point with fallback coordinates
   */
  function getPoint(http, lat, lon) {
    // Try exact coordinates
    let point = robustRequest(http, endpoints.points + lat + "," + lon, 'point');
    
    if (!point.__transport_error) return point;
    
    // Try with reduced precision (NWS can be picky about coordinate precision)
    const roundedLat = Math.round(lat * 10000) / 10000;
    const roundedLon = Math.round(lon * 10000) / 10000;
    
    if (roundedLat !== lat || roundedLon !== lon) {
      point = robustRequest(http, endpoints.points + roundedLat + "," + roundedLon, 'point');
    }
    
    return point;
  }
  
  /**
   * Get forecast with proper error handling
   */
  function getForecast(http, url) {
    if (!url) return null;
    return robustRequest(http, url, 'forecast');
  }
  
  /**
   * Get latest observation from station
   */
  function getObservation(http, stationId) {
    if (!stationId) return null;
    
    const url = endpoints.stations + stationId + "/observations/latest?require_qc=false";
    return robustRequest(http, url, 'observation');
  }
  
  /**
   * Get active alerts for state
   */
  function getAlertsForState(http, stateCode) {
    if (!stateCode) return null;
    
    const url = endpoints.alerts + "?area=" + encodeURIComponent(stateCode);
    return robustRequest(http, url, 'alerts');
  }
  
  /**
   * Get alerts for specific point
   */
  function getAlertsForPoint(http, lat, lon) {
    const url = endpoints.alerts + "?point=" + lat + "," + lon;
    return robustRequest(http, url, 'alerts');
  }
  
  /**
   * Pick best station from list
   */
  function pickBestStation(http, stationsUrl, preferredStation) {
    if (!stationsUrl) return null;
    
    // If preferred station specified, validate it exists
    if (preferredStation) {
      const stations = robustRequest(http, stationsUrl, 'stations');
      if (stations && stations.features) {
        for (let feature of stations.features) {
          if (safeGet(feature, 'properties.stationIdentifier') === preferredStation) {
            return preferredStation;
          }
        }
      }
    }
    
    // Get stations with limit
    const url = stationsUrl + (stationsUrl.indexOf("?") > 0 ? "&" : "?") + "limit=5";
    const json = robustRequest(http, url, 'stations');
    
    if (!json || !json.features || !json.features.length) return null;
    
    // Try to find best station (prefer those with recent observations)
    let bestStation = null;
    let bestTime = 0;
    
    for (let feature of json.features) {
      const stationId = safeGet(feature, 'properties.stationIdentifier');
      if (!stationId) continue;
      
      // Quick check if station has recent data
      const obsUrl = endpoints.stations + stationId + "/observations/latest";
      const obs = http.getJSON(obsUrl, acceptHeaders);
      
      if (obs && obs.properties && obs.properties.timestamp) {
        const timestamp = new Date(obs.properties.timestamp).getTime();
        if (timestamp > bestTime) {
          bestTime = timestamp;
          bestStation = stationId;
        }
      }
      
      // Return first working station if we found one
      if (bestStation) return bestStation;
    }
    
    // Fallback to first station
    return safeGet(json.features[0], 'properties.stationIdentifier');
  }
  
  /**
   * Infer state code from point data
   */
  function inferStateFromPoint(point) {
    // Try multiple methods to get state
    
    // Method 1: From county URL
    try {
      const countyUrl = safeGet(point, "properties.county");
      if (countyUrl) {
        const id = countyUrl.split("/").pop(); // e.g., "KSZ091"
        const state = id.substring(0, 2);
        if (/^[A-Z]{2}$/.test(state)) return state;
      }
    } catch (e) {}
    
    // Method 2: From forecast zone
    try {
      const zoneUrl = safeGet(point, "properties.forecastZone");
      if (zoneUrl) {
        const parts = zoneUrl.split("/");
        const zone = parts[parts.length - 1]; // e.g., "FLZ050"
        const state = zone.substring(0, 2);
        if (/^[A-Z]{2}$/.test(state)) return state;
      }
    } catch (e) {}
    
    // Method 3: From relative location
    try {
      const state = safeGet(point, "properties.relativeLocation.properties.state");
      if (state && state.length === 2) return state.toUpperCase();
    } catch (e) {}
    
    return null;
  }
  
  /**
   * Main load function with comprehensive data fetching
   */
  function load(ctx) {
    // Validate context
    if (!ctx || !ctx.http || typeof ctx.http.getJSON !== "function") {
      return {
        error: {
          stage: "init",
          message: "Invalid HTTP context",
          detail: "HTTP client not properly initialized"
        }
      };
    }
    
    const http = ctx.http;
    const lat = parseFloat(ctx.latitude);
    const lon = parseFloat(ctx.longitude);
    
    // Validate coordinates
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return {
        error: {
          stage: "validation",
          message: "Invalid coordinates",
          detail: "Latitude: " + ctx.latitude + ", Longitude: " + ctx.longitude
        }
      };
    }
    
    // Get grid point
    const point = getPoint(http, lat, lon);
    
    if (!point || point.__transport_error || !point.properties) {
      return {
        error: {
          stage: "points",
          message: "Failed to get weather grid point",
          transport: point ? point.__transport_error : "no-response",
          url: point && point.__url ? point.__url : endpoints.points + lat + "," + lon,
          detail: "The NWS API may be unavailable or the coordinates may be outside coverage area",
          fallback: config.enableFallback ? "Consider using fallback weather provider" : null
        },
        point: point
      };
    }
    
    // Extract all URLs
    const forecastUrl = safeGet(point, "properties.forecast");
    const hourlyUrl = safeGet(point, "properties.forecastHourly");
    const stationsUrl = safeGet(point, "properties.observationStations");
    const gridId = safeGet(point, "properties.gridId");
    const gridX = safeGet(point, "properties.gridX");
    const gridY = safeGet(point, "properties.gridY");
    
    // Fetch forecast data
    const forecast = getForecast(http, forecastUrl);
    const hourly = getForecast(http, hourlyUrl);
    
    // Get best station and observation
    const stationId = ctx.station || pickBestStation(http, stationsUrl, ctx.preferredStation);
    const observation = getObservation(http, stationId);
    
    // Get alerts (try both point-based and state-based)
    let alerts = null;
    
    // First try point-based alerts (more specific)
    alerts = getAlertsForPoint(http, lat, lon);
    
    // If that fails, try state-based
    if (!alerts || alerts.__transport_error) {
      const stateCode = inferStateFromPoint(point);
      if (stateCode) {
        alerts = getAlertsForState(http, stateCode);
      }
    }
    
    // Build response
    const response = {
      point: point,
      forecast: forecast,
      hourly: hourly,
      observation: observation,
      stationId: stationId,
      alerts: alerts,
      metadata: {
        gridId: gridId,
        gridX: gridX,
        gridY: gridY,
        state: inferStateFromPoint(point)
      }
    };
    
    // Check for partial failures
    const failures = [];
    if (forecast && forecast.__transport_error) {
      failures.push("forecast: " + forecast.__transport_error);
    }
    if (hourly && hourly.__transport_error) {
      failures.push("hourly: " + hourly.__transport_error);
    }
    if (observation && observation.__transport_error) {
      failures.push("observation: " + observation.__transport_error);
    }
    if (alerts && alerts.__transport_error) {
      failures.push("alerts: " + alerts.__transport_error);
    }
    
    if (failures.length > 0) {
      response.warnings = failures;
    }
    
    return response;
  }
  
  /**
   * Enhanced icon detection from various data sources
   */
  function iconKeyFromData(data) {
    // Try multiple sources for icon determination
    
    // 1. From forecast short description
    const shortForecast = safeGet(data, "forecast.properties.periods.0.shortForecast");
    if (shortForecast) {
      const isDaytime = safeGet(data, "forecast.properties.periods.0.isDaytime", true);
      return iconKeyFromShortForecast(shortForecast, isDaytime);
    }
    
    // 2. From current observation
    const obsIcon = safeGet(data, "observation.properties.icon");
    if (obsIcon) {
      return iconKeyFromNWSIcon(obsIcon);
    }
    
    // 3. From text description
    const textDesc = safeGet(data, "observation.properties.textDescription");
    if (textDesc) {
      return iconKeyFromText(textDesc, true);
    }
    
    return "unknown";
  }
  
  /**
   * Convert NWS icon URL to icon key
   */
  function iconKeyFromNWSIcon(iconUrl) {
    if (!iconUrl) return "unknown";
    
    try {
      // Extract icon name from URL like:
      // https://api.weather.gov/icons/land/day/sct?size=medium
      const match = iconUrl.match(/\/([^/]+)\/([^/?]+)/);
      if (match) {
        const timeOfDay = match[1]; // "day" or "night"
        const condition = match[2].split(",")[0]; // Take first condition
        const isNight = timeOfDay === "night";
        
        return mapNWSIconCode(condition, isNight);
      }
    } catch (e) {}
    
    return "unknown";
  }
  
  /**
   * Map NWS icon codes to local icon keys
   */
  function mapNWSIconCode(code, isNight) {
    const iconMap = {
      // Clear
      "skc": "clear",
      "few": "mostlysunny",
      "sct": "partlycloudy",
      "bkn": "mostlycloudy",
      "ovc": "cloudy",
      
      // Precipitation
      "rain": "rain",
      "rain_showers": "rain",
      "tsra": "tstorms",
      "snow": "snow",
      "snow_showers": "snow",
      "sleet": "sleet",
      "fzra": "sleet",
      "rain_snow": "sleet",
      
      // Visibility
      "fog": "fog",
      "haze": "hazy",
      "smoke": "hazy",
      "dust": "hazy",
      
      // Wind
      "wind_skc": "clear",
      "wind_few": "mostlysunny",
      "wind_sct": "partlycloudy",
      "wind_bkn": "mostlycloudy",
      "wind_ovc": "cloudy",
      
      // Other
      "hot": "clear",
      "cold": "cloudy"
    };
    
    let base = iconMap[code] || code;
    
    // Add night prefix if needed
    if (isNight && !base.startsWith("nt_")) {
      base = "nt_" + base;
    }
    
    return base;
  }
  
  /**
   * Determine icon from short forecast text
   */
  function iconKeyFromShortForecast(sf, isDay) {
    if (!sf) return "unknown";
    
    const s = String(sf).toLowerCase();
    
    // Check for specific conditions in priority order
    const conditions = [
      { pattern: /thunder|t-?storm/i, day: "tstorms", night: "nt_tstorms" },
      { pattern: /tornado/i, day: "tstorms", night: "nt_tstorms" },
      { pattern: /snow|flurr/i, day: "snow", night: "nt_snow" },
      { pattern: /sleet|freezing|ice/i, day: "sleet", night: "nt_sleet" },
      { pattern: /rain|shower|drizzle/i, day: "rain", night: "nt_rain" },
      { pattern: /fog|mist/i, day: "fog", night: "nt_fog" },
      { pattern: /haz[ey]|smoke|dust/i, day: "hazy", night: "nt_hazy" },
      { pattern: /overcast|cloudy/i, day: "cloudy", night: "nt_cloudy" },
      { pattern: /mostly cloudy/i, day: "mostlycloudy", night: "nt_mostlycloudy" },
      { pattern: /partly cloudy|partly sunny/i, day: "partlycloudy", night: "nt_partlycloudy" },
      { pattern: /mostly sunny|mostly clear/i, day: "mostlysunny", night: "nt_mostlysunny" },
      { pattern: /clear|sunny|fair/i, day: "clear", night: "nt_clear" }
    ];
    
    for (let cond of conditions) {
      if (cond.pattern.test(s)) {
        return isDay ? cond.day : cond.night;
      }
    }
    
    // Default
    return isDay ? "cloudy" : "nt_cloudy";
  }
  
  /**
   * Determine icon from text description
   */
  function iconKeyFromText(text, isDay) {
    return iconKeyFromShortForecast(text, isDay);
  }
  
  /**
   * Enhanced data conversion with better error handling
   */
  function convert(data) {
    const out = {
      location_full: null,
      conditions: null,
      temp_string: null,
      temp_value: null,
      temp_unit: null,
      feels_like: null,
      humidity: null,
      dewpoint: null,
      pressure: null,
      visibility: null,
      sunrise: null,
      sunset: null,
      moon_phase: null,
      wind_string: null,
      wind_speed: null,
      wind_direction: null,
      wind_gust: null,
      forecast: [],
      hourly: [],
      icon_key_daynight: null,
      icon_key_day: null,
      alert: null,
      alerts: [],
      metadata: data.metadata || {}
    };
    
    // Location
    try {
      const rl = safeGet(data, "point.properties.relativeLocation.properties");
      if (rl) {
        out.location_full = [rl.city, rl.state].filter(Boolean).join(", ");
      }
    } catch (e) {}
    
    // Current observation data
    try {
      const obs = safeGet(data, "observation.properties");
      if (obs) {
        // Temperature
        if (obs.temperature && typeof obs.temperature.value === 'number') {
          const celsius = obs.temperature.value;
          const fahrenheit = (celsius * 9/5) + 32;
          
          out.temp_value = Math.round(fahrenheit);
          out.temp_unit = "°F";
          out.temp_string = out.temp_value + out.temp_unit;
        }
        
        // Conditions
        out.conditions = obs.textDescription || null;
        
        // Humidity
        if (obs.relativeHumidity && typeof obs.relativeHumidity.value === 'number') {
          out.humidity = Math.round(obs.relativeHumidity.value) + "%";
        }
        
        // Dewpoint
        if (obs.dewpoint && typeof obs.dewpoint.value === 'number') {
          const dewC = obs.dewpoint.value;
          const dewF = (dewC * 9/5) + 32;
          out.dewpoint = Math.round(dewF) + "°F";
        }
        
        // Wind
        if (obs.windSpeed && typeof obs.windSpeed.value === 'number') {
          const mps = obs.windSpeed.value;
          const mph = Math.round(mps * 2.23694);
          
          let windStr = mph + " mph";
          
          if (obs.windDirection && typeof obs.windDirection.value === 'number') {
            const dir = compassDirection(obs.windDirection.value);
            windStr = dir + " " + windStr;
          }
          
          out.wind_string = windStr;
          out.wind_speed = mph;
          out.wind_direction = obs.windDirection ? obs.windDirection.value : null;
        }
        
        // Wind gust
        if (obs.windGust && typeof obs.windGust.value === 'number') {
          const gustMps = obs.windGust.value;
          out.wind_gust = Math.round(gustMps * 2.23694);
        }
        
        // Pressure
        if (obs.barometricPressure && typeof obs.barometricPressure.value === 'number') {
          const pa = obs.barometricPressure.value;
          const inHg = pa * 0.0002953;
          out.pressure = inHg.toFixed(2) + " in";
        }
        
        // Visibility
        if (obs.visibility && typeof obs.visibility.value === 'number') {
          const meters = obs.visibility.value;
          const miles = meters * 0.000621371;
          out.visibility = miles.toFixed(1) + " mi";
        }
      }
    } catch (e) {}
    
    // Icon determination
    try {
      const p0 = safeGet(data, "forecast.properties.periods.0");
      if (p0) {
        out.icon_key_daynight = iconKeyFromShortForecast(p0.shortForecast, !!p0.isDaytime);
        out.icon_key_day = iconKeyFromShortForecast(p0.shortForecast, true);
      } else {
        // Fallback to observation-based icon
        out.icon_key_daynight = iconKeyFromData(data);
        out.icon_key_day = out.icon_key_daynight;
      }
    } catch (e) {}
    
    // Forecast periods
    try {
      const periods = safeGet(data, "forecast.properties.periods", []);
      const maxPeriods = 8; // Limit to reasonable number
      
      for (let i = 0; i < Math.min(periods.length, maxPeriods); i++) {
        const p = periods[i];
        if (!p) continue;
        
        const isDay = !!p.isDaytime;
        const unitLabel = p.temperatureUnit === "C" ? "°C" : "°F";
        
        out.forecast.push({
          number: p.number,
          name: p.name || "",
          weekday: p.name || "",
          startTime: p.startTime || "",
          endTime: p.endTime || "",
          isDaytime: isDay,
          temperature: p.temperature,
          temperatureUnit: unitLabel,
          temperatureTrend: p.temperatureTrend || null,
          windSpeed: p.windSpeed || "",
          windDirection: p.windDirection || "",
          shortForecast: p.shortForecast || "",
          detailedForecast: p.detailedForecast || "",
          icon: iconKeyFromShortForecast(p.shortForecast, isDay),
          low_label: !isDay ? "Low  " : "",
          high_label: isDay ? "High " : "",
          low: !isDay && typeof p.temperature === 'number' ? String(p.temperature) : "",
          high: isDay && typeof p.temperature === 'number' ? String(p.temperature) : "",
          unit: unitLabel
        });
      }
    } catch (e) {}
    
    // Hourly forecast (first 24 hours)
    try {
      const hourly = safeGet(data, "hourly.properties.periods", []);
      const maxHours = 24;
      
      for (let i = 0; i < Math.min(hourly.length, maxHours); i++) {
        const h = hourly[i];
        if (!h) continue;
        
        out.hourly.push({
          number: h.number,
          startTime: h.startTime || "",
          temperature: h.temperature,
          temperatureUnit: h.temperatureUnit === "C" ? "°C" : "°F",
          windSpeed: h.windSpeed || "",
          windDirection: h.windDirection || "",
          shortForecast: h.shortForecast || "",
          icon: iconKeyFromShortForecast(h.shortForecast, h.isDaytime !== false)
        });
      }
    } catch (e) {}
    
    // Alerts processing
    try {
      let alertFeatures = [];
      
      // Handle both GeoJSON and JSON-LD formats
      if (data.alerts) {
        if (data.alerts.features && Array.isArray(data.alerts.features)) {
          alertFeatures = data.alerts.features;
        } else if (data.alerts["@graph"] && Array.isArray(data.alerts["@graph"])) {
          // Convert JSON-LD to GeoJSON-like format
          alertFeatures = data.alerts["@graph"].map(a => ({ properties: a }));
        }
      }
      
      // Process each alert
      for (let feature of alertFeatures) {
        const props = feature.properties || feature;
        
        const alert = {
          id: props.id || null,
          event: props.event || "Alert",
          headline: props.headline || props.event || "Weather Alert",
          severity: props.severity || "Unknown",
          urgency: props.urgency || "Unknown",
          certainty: props.certainty || "Unknown",
          onset: props.onset || props.effective || null,
          expires: props.expires || props.ends || null,
          area: props.areaDesc || null,
          description: props.description || null,
          instruction: props.instruction || null
        };
        
        out.alerts.push(alert);
        
        // Set primary alert (first or highest severity)
        if (!out.alert || severityRank(alert.severity) < severityRank(out.alert.severity)) {
          out.alert = alert;
        }
      }
    } catch (e) {}
    
    return out;
  }
  
  /**
   * Convert degrees to compass direction
   */
  function compassDirection(degrees) {
    if (degrees == null || isNaN(degrees)) return "";
    
    const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                       "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    
    const index = Math.round(degrees / 22.5) % 16;
    return directions[index];
  }
  
  /**
   * Rank severity for sorting
   */
  function severityRank(severity) {
    const ranks = {
      "Extreme": 0,
      "Severe": 1,
      "Moderate": 2,
      "Minor": 3,
      "Unknown": 4
    };
    
    return ranks[severity] !== undefined ? ranks[severity] : 5;
  }
  
  /**
   * Configure the provider
   */
  function configure(options) {
    Object.assign(config, options);
  }
  
  // Public API
  return {
    load: load,
    convert: convert,
    configure: configure,
    
    // Utility exports
    utils: {
      safeGet: safeGet,
      validateResponse: validateResponse,
      iconKeyFromShortForecast: iconKeyFromShortForecast,
      compassDirection: compassDirection
    }
  };
})();