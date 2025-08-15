# syncWC-NWS-Remix

**syncWC-NWS-Remix** is a JavaScript weather application designed to run on a [Synchronet Bulletin Board System](http://www.synchro.net).  
It is a fork of **syncWXremix** by [KenDB3](http://bbs.kd3.us), updated by **Patrick Bass (D2SK)** of [Retro Mafia BBS](telnet://retromafia.retrogoldbbs.com:8023) to use the [National Weather Service API](https://api.weather.gov).

The icon files use Synchronet **Ctrl-A** color codes for styling (similar to ANSI), allowing ASCII graphics to render correctly on both ANSI and plain ASCII terminals.  
Reference for Synchronet Ctrl-A codes can be found [here](http://wiki.synchro.net/custom:ctrl-a_codes).

The icon designs were inspired by the [wego](https://github.com/schachmat/wego) weather app by Markus Teich. His contribution/inspiration is acknowledged in the ISC license included in the `icons` folder.

---

## Screenshots

Regular View:  
![Regular View](http://bbs.kd3.us/screenshots/syncWX-screenshot-RI-01.png)

With weather alert:  
![Weather Alert 01](http://bbs.kd3.us/screenshots/syncWX-screenshot-RI-Alert-New-01.png)  
![Weather Alert 02](http://bbs.kd3.us/screenshots/syncWX-screenshot-RI-Alert-New-02.png)  
![Weather Alert 03](http://bbs.kd3.us/screenshots/syncWX-screenshot-RI-Alert-New-03.png)

Non-US location (Celsius):  
![Non-US Locale](http://bbs.kd3.us/screenshots/syncWX-screenshot-IT-Rome-Airport-01.png)

TTY (Mono) ASCII mode with alert:  
![TTY Mono ASCII](http://bbs.kd3.us/screenshots/TTY-Mono-ASCII-Only.png)

[Full Color and Monochrome versions of the ASCII Icon Set](http://bbs.kd3.us/screenshots/syncWX-icon-set.png)

---

## Code Example (NWS)

The NWS API uses separate endpoints for forecast, conditions, and alerts. This fork includes an `NWSProvider` module that handles:

- Station or lat/lon lookup
- Current observations
- Forecast periods
- Alerts

Example usage in `weather.js`:

```javascript
load("providers/nws.js");

var cfg = loadModOpts("syncWX") || {};
var lat = parseFloat(cfg.latitude);
var lon = parseFloat(cfg.longitude);
var ua  = cfg.user_agent || "RetroMafia BBS (sysop: hello@retrogoldbbs.com)";
var station = cfg.station; // optional

var data = NWSProvider.load(lat, lon, ua, station);
var panels = convertNWS(data); // shape into format used by display code
