
# syncWXremix — NWS Migration Addendum

This addendum documents how to run syncWXremix using the National Weather Service API (api.weather.gov).

## What changes
- New provider module: `xtrn/syncWXremix/providers/nws.js`
- Config now supports `provider=nws` and latitude/longitude instead of WU key.
- NWS requires a **User-Agent** header (include contact email/URL). No API key.

## modopts.ini
```
[syncWXremix]
provider = nws
latitude = 41.8781
longitude = -87.6298
units = us
station =          ; optional (e.g., KORD); leave blank to auto-select nearest
user_agent = Retro Mafia BBS syncWXremix (sysop: patrick@example.com)
```

## Wiring (summary)
1. Copy `xtrn/syncWXremix/providers/nws.js` into your BBS tree.
2. In `xtrn/syncWXremix/weather.js`:
   - Read `provider`, `latitude`, `longitude`, `user_agent`, `station` from modopts.
   - If `provider === "nws"`, call `NWSProvider.load(lat, lon, ua, station)`.
   - Map the returned object to your existing panels (see `convertNWS()` below).

### Example converter (drop into your weather.js)
```
function convertNWS(nws) {
  var panels = {};
  if (nws.current) {
    panels.current = {
      location: nws.location,
      tempF: nws.current.tempF,
      text: nws.current.text,
      wind: (nws.current.windDirDeg != null ? nws.current.windDirDeg + "° " : "") +
            (nws.current.windMph != null ? nws.current.windMph + " mph" : ""),
      gust: nws.current.gustMph != null ? nws.current.gustMph + " mph" : "",
      rh: nws.current.rh != null ? nws.current.rh + "%" : "",
      pressure: nws.current.pressureIn != null ? nws.current.pressureIn + " inHg" : "",
      vis: nws.current.visMi != null ? nws.current.visMi + " mi" : ""
    };
  }
  panels.periods = (nws.forecast || []).slice(0, 8).map(p => ({
    name: p.name, tempF: p.tempF != null ? Math.round(p.tempF) : null,
    pop: p.pop, short: p.short, detailed: p.detailed,
    iconKey: p.iconKey, isDay: p.isDay
  }));
  panels.alerts = (nws.alerts || []).map(a => ({
    id: a.id, headline: a.headline, event: a.event,
    severity: a.severity, urgency: a.urgency, area: a.area,
    effective: a.effective, expires: a.expires, instruction: a.instruction
  }));
  panels.meta = { provider: "National Weather Service", zone: nws.zoneId, county: nws.countyId, station: nws.stationId };
  return panels;
}
```

## Notes
- The NWS icon endpoints are deprecated; keep using your ANSI/ASCII iconset and map `shortForecast` text to your keys (see `mapShortForecastToIcon()` in `providers/nws.js`).
- Astronomy panel (sunrise/sunset) is not available via NWS; either omit for now or compute locally later.
- This provider is synchronous in Synchronet (uses `HTTPRequest`). If you run it outside sbbs, ensure your runtime supports `fetch()` and adjust accordingly.
