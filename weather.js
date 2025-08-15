//
// syncWx-NWS-Remix v2.1 (c) 2025 Patrick Bass <patrick@pwbass.com>
//
// RetroMafia BBS (retromafia.retrogoldbbs.com:8023)
//       Respect the Legacy - Honor the Code
//
load("sbbsdefs.js");
load("http.js");

// --- Defaults (overridden by ctrl/modopts.ini [SyncWX]) ---
var DEFAULT_USER_AGENT = "RetroMafia BBS (hello@retrogoldbbs.com)";
var DEFAULT_ICON_EXT   = ".asc";

// --- Language (fallback to English) ---
var WXlang, LocationHeader, ConditionsHeader, TempHeader, SunHeader, LunarHeader, WindHeader, AlertExpires, ReadAlert, degreeSymbol;
try { load(js.exec_dir + "wxlanguage.js"); } catch(e) {
  WXlang = "";
  LocationHeader   = "Your Location: ";
  ConditionsHeader = "Current Conditions: ";
  TempHeader       = "Temp: ";
  SunHeader        = "Sunrise/Sunset: ";
  LunarHeader      = "Lunar Phase: ";
  WindHeader       = "Wind: ";
  AlertExpires     = "Expires ";
  ReadAlert        = "Read the Full Alert";
  degreeSymbol     = "\370"; // CP437 degree for Sync ANSI
}

// --- Modopts ---
var opts = load({}, "modopts.js", "SyncWX") || {};
var userAgent   = opts.user_agent || DEFAULT_USER_AGENT;
var geo_email   = opts.email || "hello@retrogoldbbs.com";
var iconExt     = opts.weathericon_ext || DEFAULT_ICON_EXT;

// --- Helpers ---
function safePause(){ try{ if (console && console.pause) console.pause(); }catch(_){ } }
function header(){ try{ console.clear(); }catch(_){ } print("\r\nRetroMafia BBS - Local Weather Report\r\n\r\n\n"); }
function showFail(title, reason, url){
  header();
  if (title)  print("ERROR: " + title + "\r\n");
  if (reason) print("(" + reason + ")\r\n");
  if (url)    print("URL:    " + url + "\r\n");
  safePause();
}
function toFixed(n,p){ return Math.round(n*Math.pow(10,p))/Math.pow(10,p); }
function hasANSI(){ try{ return console.term_supports && console.term_supports(USER_ANSI);}catch(_){ return false; } }
function put(s){ try{ console.putmsg(s);}catch(_){ print(s);} }

// Wind: degrees -> compass text
function degToCompass(deg){
  if (deg==null || isNaN(deg)) return null;
  var dirs=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  var idx=(Math.round(deg/22.5)%16+16)%16;
  return dirs[idx];
}

// HTTP request helpers
function newReq(accept){
  var r=new HTTPRequest();
  r.max_redirects=3; r.timeout=30;
  r.RequestHeaders=[
    "User-Agent: " + userAgent,
    "Accept: " + (accept||"application/geo+json"),
    "Cache-Control: no-cache"
  ];
  return r;
}
function getJSON(url, accept){
  var req=newReq(accept||"application/geo+json");
  var raw=req.Get(url);
  var code=req.response_code;
  if (!raw || code!==200){
    var prob=null; try{ prob=JSON.parse(raw);}catch(e){}
    return { __transport_error:"http "+code, __code:code, __url:url,
             __problem: prob&&prob.title ? prob.title+(prob.detail?": "+prob.detail:"") : null };
  }
  if (/^\s*</.test(raw)) return { __transport_error:"non-json body", __code:code, __url:url };
  try{ return JSON.parse(raw);}catch(e){ return { __transport_error:String(e), __code:code, __url:url }; }
}

// --- Geocode City, ST via Nominatim ---
function geocodeCityState(loc){
  if (!loc || typeof loc!=="string") return null;
  var q=encodeURIComponent(loc);
  var url="https://nominatim.openstreetmap.org/search?format=json&limit=1&q="+q;
  var req=new HTTPRequest();
  req.max_redirects=3; req.timeout=30;
  req.RequestHeaders=[
    "User-Agent: " + userAgent + " (" + geo_email + ")",
    "Accept: application/json"
  ];
  var raw=req.Get(url);
  if (!raw || req.response_code!==200) return { __err:"http "+req.response_code, __url:url };
  try{
    var arr=JSON.parse(raw);
    if (!arr || !arr.length) return { __err:"no results", __url:url };
    return { lat:parseFloat(arr[0].lat), lon:parseFloat(arr[0].lon), display:arr[0].display_name };
  }catch(e){ return { __err:String(e), __url:url }; }
}

// --- /points (strict Accept) with retry on rounded coords ---
function fetchPoints(lat,lon){
  function u(a,b){ return "https://api.weather.gov/points/"+a+","+b; }
  var u1=u(lat,lon), j1=getJSON(u1,"application/geo+json");
  if (!j1.__transport_error && j1.properties) return {ok:true,json:j1,url:u1};
  var u2=u(toFixed(lat,4), toFixed(lon,4)), j2=getJSON(u2,"application/geo+json");
  if (!j2.__transport_error && j2.properties) return {ok:true,json:j2,url:u2};
  var f=j1.__transport_error ? {url:u1,err:(j1.__problem||j1.__transport_error),code:j1.__code}
        : j2.__transport_error ? {url:u2,err:(j2.__problem||j2.__transport_error),code:j2.__code}
        : {url:u1,err:"unknown"};
  return {ok:false,failure:f};
}

// --- Simple astronomy (local) ---
function rad(d){return d*Math.PI/180;}
function julian(y,m,d){ if(m<=2){y--;m+=12;} var A=Math.floor(y/100),B=2-A+Math.floor(A/4);
  return Math.floor(365.25*(y+4716))+Math.floor(30.6001*(m+1))+d+B-1524.5; }
function sunTimes(lat,lon,date){
  try{
    function fromJulian(J){ return new Date((J-2440587.5)*86400000); }
    function pad(n){return (n<10?"0":"")+n;}
    function hhmm(dt){ return pad(dt.getHours())+":"+pad(dt.getMinutes()); }

    var y=date.getUTCFullYear(), m=date.getUTCMonth()+1, d=date.getUTCDate();
    var J=julian(y,m,d), n=(J-2451545.0)-lon/360;
    var M=(357.5291+0.98560028*n)%360;
    var C=1.9148*Math.sin(rad(M))+0.02*Math.sin(rad(2*M))+0.0003*Math.sin(rad(3*M));
    var L=(M+102.9372+C+180)%360;
    var Jt=2451545.5+n+0.0053*Math.sin(rad(M))-0.0069*Math.sin(rad(2*L));
    var dec=Math.asin(Math.sin(rad(L))*Math.sin(rad(23.44)));
    var latr=rad(lat);
    var H0=Math.acos((Math.sin(rad(-0.83))-Math.sin(latr)*Math.sin(dec))/(Math.cos(latr)*Math.cos(dec)));
    var Jr=Jt-H0/(2*Math.PI), Js=Jt+H0/(2*Math.PI);
    var off=(new Date().getTimezoneOffset()*-60000);
    var rise=new Date(fromJulian(Jr).getTime()+off), set=new Date(fromJulian(Js).getTime()+off);
    var syn=29.530588861, ref=Date.UTC(2000,0,6,18,14,0), age=((date.getTime()-ref)/86400000)%syn; if(age<0) age+=syn;
    var phase="New Moon";
    if (age<1.84566) phase="New Moon";
    else if (age<5.53699) phase="Waxing Crescent";
    else if (age<9.22831) phase="First Quarter";
    else if (age<12.91963) phase="Waxing Gibbous";
    else if (age<16.61096) phase="Full Moon";
    else if (age<20.30228) phase="Waning Gibbous";
    else if (age<23.99361) phase="Last Quarter";
    else if (age<27.68493) phase="Waning Crescent";
    return {sr:hhmm(rise), ss:hhmm(set), phase:phase};
  }catch(e){ return {sr:"--:--", ss:"--:--", phase:"N/A"}; }
}

// --- Icon printing ---
// Print NWS-based icon at (x,y) if possible; fallback to unknown.
function printIconFromNWSIconURL(iconURL, x, y){
  if (!iconURL || !hasANSI()) return false;
  try {
    var path = iconURL.replace(/^https?:\/\/[^/]+\/icons\//, ""); // e.g., "land/day/few?size=medium"
    var parts = path.split("/");
    var tod = (parts.indexOf("day")>=0) ? "day" : (parts.indexOf("night")>=0 ? "night" : "");
    var tokenRaw = path.split(tod + "/")[1] || "";
    tokenRaw = tokenRaw.split("/")[0] || "";
    tokenRaw = tokenRaw.split("?")[0] || "";
    var token = tokenRaw.split(",")[0];

    var map = {
      skc:"clear", few:"mostlysunny", sct:"partlycloudy", bkn:"mostlycloudy", ovc:"cloudy",
      rain:"rain", tsra:"tstorms", snow:"snow", sleet:"sleet", fog:"fog", wind_skc:"wind",
      haze:"hazy", hot:"hot", cold:"cold", dust:"dust", smoke:"smoke", fzra:"fzra"
    };
    var candidates=[];
    if (token){ candidates.push(token); if (tod) candidates.push(tod+"_"+token); if (map[token]){candidates.push(map[token]); if (tod) candidates.push(tod+"_"+map[token]);}}
    if (tod && !token) candidates.push(tod+"_clear");

    function tryPrint(name){
      var f=js.exec_dir+"icons/"+name+iconExt;
      if (file_exists(f)){ console.gotoxy(x,y); console.printfile(f); return true; }
      return false;
    }
    for (var i=0;i<candidates.length;i++){ if (tryPrint(candidates[i])) return true; }
    if (tryPrint("unknown")) return true;
  } catch(e) { }
  return false;
}

// --- Main ---
(function main(){
  try{
    // Current user and location string (e.g., "City, ST")
    var curUserNum = (bbs && bbs.node_num) ? system.node_list[bbs.node_num-1].useron
                     : (user && user.number ? user.number : 1);
    var u = new User(curUserNum);
    var loc = u && u.location ? u.location : "";

    header();

    // Coordinates (from modopts or geocode)
    var lat=null, lon=null, locLabel="Unknown";
    if (opts.latitude && opts.longitude){
      lat=parseFloat(opts.latitude); lon=parseFloat(opts.longitude);
      locLabel = opts.location_name || "Configured Location";
    } else if (loc && loc.trim()!==""){
      var g = geocodeCityState(loc);
      if (g && !g.__err){ lat=g.lat; lon=g.lon; var parts=String(loc).split(","); locLabel=(parts.length>=2)?(parts[0].trim()+", "+parts[1].trim()):loc; }
      else { showFail("/geocode failed.", g?g.__err:"unknown", g?g.__url:""); return; }
    } else { showFail("No user location", "User.location empty. Set City/State or configure latitude/longitude in modopts.ini."); return; }

    // /points
    var points = fetchPoints(lat,lon);
    if (!points.ok){ showFail("/points request failed.", points.failure.err, points.failure.url); return; }
    var props = points.json.properties;
    var forecastURL       = props.forecast;
    var forecastHourlyURL = props.forecastHourly;
    var obsStationsURL    = props.observationStations;

    // forecasts
    var fc = getJSON(forecastURL, "application/geo+json");
    var fh = getJSON(forecastHourlyURL, "application/geo+json");

    // station & latest observation
    var st = getJSON(obsStationsURL, "application/geo+json");
    var latest = null;
    if (!st.__transport_error && st.features && st.features.length){
      var sid = st.features[0].properties.stationIdentifier || null;
      if (sid){
        latest = getJSON("https://api.weather.gov/stations/"+sid+"/observations/latest", "application/geo+json");
      }
    }

    // Astronomy
    var astro = sunTimes(lat, lon, new Date());

    // Layout positions (ANSI)
    var rightX = 22; // text starts to the right of icon
    var topY   = 3;  // first line row

    // Icon at left (ANSI only)
    if (hasANSI() && !fc.__transport_error && fc.properties && fc.properties.periods && fc.properties.periods.length) {
      try { var iconURL = fc.properties.periods[0].icon || null; printIconFromNWSIconURL(iconURL, 2, topY); } catch(e){}
    } else if (hasANSI()) {
      var fb = js.exec_dir + "icons/unknown" + iconExt;
      if (file_exists(fb)) { console.gotoxy(2, topY); console.printfile(fb); }
    }

    // Gather values
    var cond="N/A", tempF=null, tempC=null, windTxt="N/A";
    if (latest && !latest.__transport_error){
      try{
        cond = latest.properties.textDescription || "N/A";
        var t = latest.properties.temperature;
        if (t && typeof t.value==="number") { tempC = Math.round(t.value); tempF = Math.round((t.value*9/5)+32); }
        var wdir=latest.properties.windDirection, wspd=latest.properties.windSpeed;
        var dirdeg = (wdir && typeof wdir.value==="number") ? Math.round(wdir.value) : null;
        var dirTxt = degToCompass(dirdeg);
        var spdmps = (wspd && typeof wspd.value==="number") ? wspd.value : null;
        var spdmph = (spdmps!==null) ? Math.round(spdmps*2.23694) : null;
        windTxt = (dirTxt && spdmph!=null) ? (dirTxt + " @ " + spdmph + " mph") : "N/A";
      }catch(e){}
    }

    // Colors
    var gy="\1n\1w", wh="\1h\1w", yl="\1h\1y";

    // ANSI aligned output
    if (hasANSI()) {
      function line(y, label, value){ console.gotoxy(rightX, y); put(wh + label + yl + value); }
      line(topY,   LocationHeader,   locLabel);
      line(topY+1, ConditionsHeader, cond);
      if (tempF!==null && tempC!==null) line(topY+2, TempHeader, tempF + degreeSymbol + " F (" + tempC + degreeSymbol + " C)");
      else                               line(topY+2, TempHeader, "N/A");
      line(topY+3, SunHeader, astro.sr + gy + " / " + yl + astro.ss);
      line(topY+4, LunarHeader, astro.phase);
      line(topY+5, WindHeader,  windTxt);

      // Forecast (first 3 periods to fit nicely)
      var y = topY + 7;
      if (!fc.__transport_error && fc.properties && fc.properties.periods && fc.properties.periods.length){
        var maxShow=Math.min(3, fc.properties.periods.length);
        for (var i=0;i<maxShow;i++){
          var p=fc.properties.periods[i];
          var name=p.name || ("Period "+p.number);
          var short=p.shortForecast || "";
          console.gotoxy(2, y+(i*3));
          put(yl + name + gy + ": " + wh + short + "\r\n");
          console.gotoxy(2, y+(i*3)+1);
          if (p.temperature) {
            var hiLo = p.isDaytime ? "Hi " : "Lo ";
            put(wh + hiLo + p.temperature + " " + (p.temperatureUnit||"") + "\r\n");
          }
        }
      }
      console.gotoxy(2, y + 3 + 3); // push cursor down a bit
      put("\r\n" + gy + "syncWC-NWS-Remix (data: weather.gov)\r\n");
      safePause();
    } else {
      // Non-ANSI fallback
      put(LocationHeader + locLabel + "\r\n");
      put(ConditionsHeader + cond + "\r\n");
      if (tempF!==null && tempC!==null) put(TempHeader + tempF + " F (" + tempC + " C)\r\n");
      else put(TempHeader + "N/A\r\n");
      put(SunHeader + astro.sr + " / " + astro.ss + "\r\n");
      put(LunarHeader + astro.phase + "\r\n");
      put(WindHeader + windTxt + "\r\n\r\n");
      if (!fc.__transport_error && fc.properties && fc.properties.periods && fc.properties.periods.length){
        var maxShow=Math.min(3, fc.properties.periods.length);
        for (var i=0;i<maxShow;i++){
          var p=fc.properties.periods[i];
          var name=p.name || ("Period "+p.number);
          var short=p.shortForecast || "";
          put(name + ": " + short + "\r\n");
          if (p.temperature) {
            var hiLo = p.isDaytime ? "Hi " : "Lo ";
            put(hiLo + p.temperature + " " + (p.temperatureUnit||"") + "\r\n\r\n");
          }
        }
      }
      put("RetroMafia BBS (retromafia.retrogoldbbs.com:8023) | syncWx-NWS-Remix v2.1 | Data source: weather.gov\r\n");
      safePause();
    }

  }catch(err){
    log("ERROR weather.js outer: " + err);
    showFail("Unexpected error", String(err), "");
  }
})();
