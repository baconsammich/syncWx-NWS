//
// syncWx-NWS v2.6 (c) 2025 Patrick Bass <patrick@pwbass.com>
// RetroMafia BBS (retromafia.retrogoldbbs.com:8023)
//       Respect the Legacy - Honor the Code
//
load("sbbsdefs.js");
load("http.js");
load(js.exec_dir + "crc32.js", "C:\\sbbs\\xtrn\\syncWx-NWS\\crc32.js");

/*
  --- modopts.ini (ctrl/modopts.ini) -----------------------------------------
  [SyncWX]
  ; Identity / transport
  user_agent = RetroMafia BBS (sysop: hello@retrogoldbbs.com)
  email = hello@retrogoldbbs.com
  timeout_sec = 10
  retries = 2
  cache_minutes = 10

  ; Units / terminal
  units = imperial             ; imperial|metric
  weathericon_ext = .asc       ; icon file extension under xtrn/syncWx-NWS/icons
  ansi =                      ; true|false (force ANSI even if not detected)

  ; Location (fallback if user City,ST is blank)
  latitude =
  longitude =
  location_name =
  use_user_location = true
  country = US

  ; Title (optional tdfiglet header when ANSI present)
  tdfiglet_font = tdf/roman.tdf   ; path under exec/ (blank to disable)
  tdfiglet_width = 78
  tdfiglet_align = center         ; left|center|right

  ; Alerts row
  alerts_show = 2                 ; 0 to hide, 1-3 sensible
  alerts_beep = true              ; beep once when Alerts prints if any active
  ----------------------------------------------------------------------------
*/

/* =============================== Defaults =============================== */
var DEFAULT_USER_AGENT = "RetroMafia BBS (hello@retrogoldbbs.com)";
var DEFAULT_ICON_EXT   = ".asc";

/* =============================== Language =============================== */
var WXlang, LocationHeader, ConditionsHeader, TempHeader, SunHeader, LunarHeader, WindHeader, AlertsHeader, AlertExpires, ReadAlert, degreeSymbol;
try { load(js.exec_dir + "wxlanguage.js"); } catch(e) {
  WXlang = "";
  LocationHeader   = "Your Location: ";
  ConditionsHeader = "Current Conditions: ";
  TempHeader       = "Temp: ";
  SunHeader        = "Sunrise/Sunset: ";
  LunarHeader      = "Lunar Phase: ";
  WindHeader       = "Wind: ";
  AlertsHeader     = "Alerts: ";
  AlertExpires     = "Expires ";
  ReadAlert        = "Read the Full Alert";
  degreeSymbol     = "\370";
}
if (typeof AlertsHeader === "undefined" || !AlertsHeader) AlertsHeader = "Alerts: ";

/* =============================== Options ================================ */
var opts        = load({}, "modopts.js", "SyncWX") || {};
var userAgent   = opts.user_agent || DEFAULT_USER_AGENT;
var geo_email   = opts.email || "hello@retrogoldbbs.com";
var iconExt     = opts.weathericon_ext || DEFAULT_ICON_EXT;
var TIMEOUT_S   = parseInt(opts.timeout_sec, 10) > 0 ? parseInt(opts.timeout_sec, 10) : 10;
var RETRIES     = parseInt(opts.retries, 10) >= 0 ? parseInt(opts.retries, 10) : 2;
var CACHE_MIN   = parseInt(opts.cache_minutes, 10) >= 0 ? parseInt(opts.cache_minutes, 10) : 10;
var PREF_UNITS  = (opts.units || "imperial").toLowerCase();
var FORCE_ANSI  = (String(opts.ansi||"").toLowerCase() === "true");

var TDF_FONT    = String(opts.tdfiglet_font||"").trim();
var TDF_WIDTH   = parseInt(opts.tdfiglet_width||78,10);
var TDF_ALIGN   = (String(opts.tdfiglet_align||"center").toLowerCase());
var ALERTS_MAX  = Math.max(0, Math.min(3, parseInt(opts.alerts_show||2,10)));
var ALERTS_BEEP = String(opts.alerts_beep||"true").toLowerCase() === "true";

/* =============================== Helpers ================================ */
function safePause(){ try{ if (console && console.pause) console.pause(); }catch(_){ } }
function toFixed(n,p){ return Math.round(n*Math.pow(10,p))/Math.pow(10,p); }
function termHasANSI(){
  if (FORCE_ANSI) return true;
  try{ return console.term_supports && console.term_supports(USER_ANSI);}catch(_){ return false; }
}
function put(s){ try{ console.putmsg(s);}catch(_){ print(s);} }

/* --------- Text Sanitation (fixes “gibberish” and non-CP437 chars) -------- */
function asciiFold(s){
  if (!s) return "";
  // normalize common Unicode punctuation/symbols to plain ASCII
  s = s.replace(/[\u2018\u2019\u2032]/g,"'");          // ‘ ’ ′
  s = s.replace(/[\u201C\u201D\u2033]/g,'"');          // “ ” ″
  s = s.replace(/[\u2013\u2014\u2212]/g,"-");          // – — −
  s = s.replace(/\u2026/g,"...");                      // …
  s = s.replace(/\u00A0/g," ");                        // nbsp
  s = s.replace(/\u00B0/g, degreeSymbol || "°");       // °
  s = s.replace(/\u2122/g,"(TM)");                     // ™
  s = s.replace(/\u00AE/g,"(R)");                      // ®
  s = s.replace(/\u00A9/g,"(C)");                      // ©
  return s;
}
function stripNonAscii(s){
  if (!s) return "";
  // Keep basic printable ASCII range only
  return s.replace(/[^\x20-\x7E]/g,"");
}
function cleanText(s){
  return stripNonAscii(asciiFold(String(s||"")));
}

/* Colors */
var C_RESET = "\x01n\x01w";
var C_HDR   = "\x01h\x01c"; // bright cyan for header
var C_INFO  = "\x01h\x01g"; // info/statement
var C_WATCH = "\x01h\x01y"; // watch
var C_WARN  = "\x01h\x01r"; // warning
var C_ADV   = "\x01h\x01c"; // advisory (light blue)

/* Compass */
function degToCompass(deg){
  if (deg==null || isNaN(deg)) return null;
  var dirs=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  var idx=(Math.round(deg/22.5)%16+16)%16;
  return dirs[idx];
}

/* ============================== File Cache ============================== */
var CACHE_DIR = backslash(js.exec_dir) + "cache";
function ensureDir(p){ if (!file_isdir(p)) directory_make(p); }
function cacheKey(url){ return format("%08lx", crc32_calc(url)); }
function cachePath(url){ ensureDir(CACHE_DIR); return backslash(CACHE_DIR) + cacheKey(url) + ".json"; }
function readCache(url, maxAgeMin){
  try{
    var fp=cachePath(url);
    if (!file_exists(fp)) return null;
    var ageMs = (time()*1000) - (file_date(fp)*1000);
    if (ageMs > maxAgeMin*60*1000) return null;
    var f=new File(fp);
    if (!f.open("r")) return null;
    var txt=f.readAll().join("\n"); f.close();
    return JSON.parse(txt);
  }catch(e){ return null; }
}
function writeCache(url, obj){
  try{
    var fp=cachePath(url);
    var f=new File(fp);
    if (f.open("w+")){
      f.write(JSON.stringify(obj));
      f.close();
    }
  }catch(e){}
}

/* ============================== HTTP Utils ============================== */
function newReq(accept){
  var r=new HTTPRequest();
  r.max_redirects=3; r.timeout=TIMEOUT_S;
  r.RequestHeaders=[
    "User-Agent: " + userAgent,
    "Accept: " + (accept||"application/geo+json"),
    "Cache-Control: no-cache"
  ];
  return r;
}
function getJSONOnce(url, accept){
  var req=newReq(accept||"application/geo+json");
  var raw=req.Get(url);
  var code=req.response_code;
  if (!raw || code<200 || code>=300){
    var prob=null; try{ prob=JSON.parse(raw);}catch(e){}
    return { __transport_error:"http "+(code||"0"), __code:code, __url:url,
             __problem: prob&&prob.title ? prob.title+(prob.detail?": "+prob.detail:"") : null };
  }
  if (/^\s*</.test(raw)) return { __transport_error:"non-json body", __code:code, __url:url };
  try{ return JSON.parse(raw);}catch(e){ return { __transport_error:String(e), __code:code, __url:url }; }
}
function getJSON(url, accept){
  var cached = CACHE_MIN>0 ? readCache(url, CACHE_MIN) : null;
  if (cached) return cached;

  var lastErr=null, delay=250;
  for (var attempt=0; attempt<=RETRIES; attempt++){
    var j=getJSONOnce(url, accept);
    if (!j.__transport_error){
      if (CACHE_MIN>0) writeCache(url, j);
      return j;
    }
    lastErr=j;
    var c=j.__code||0;
    var retryable = (c===429) || (c>=500 && c<600) || j.__transport_error.indexOf("non-json")>=0;
    if (!retryable) break;
    mswait(delay); delay = Math.min(2000, delay*2);
  }
  var stale = readCache(url, 999999);
  if (stale) { stale.__stale = true; return stale; }
  return lastErr || { __transport_error:"unknown", __url:url };
}

/* ============================== Geocoding ================================ */
function geocodeCityState(loc){
  if (!loc || typeof loc!=="string") return null;
  var q=encodeURIComponent(loc);
  var url="https://nominatim.openstreetmap.org/search?format=json&limit=1&q="+q;
  var req=new HTTPRequest();
  req.max_redirects=3; req.timeout=TIMEOUT_S;
  req.RequestHeaders=[
    "User-Agent: " + userAgent + " (" + geo_email + ")",
    "Accept: application/json"
  ];
  var cached = CACHE_MIN>0 ? readCache(url, CACHE_MIN) : null;
  if (cached) return cached;

  var raw=req.Get(url);
  if (!raw || req.response_code!==200) return { __err:"http "+req.response_code, __url:url };
  try{
    var arr=JSON.parse(raw);
    if (!arr || !arr.length) return { __err:"no results", __url:url };
    var out = { lat:parseFloat(arr[0].lat), lon:parseFloat(arr[0].lon), display:arr[0].display_name };
    if (CACHE_MIN>0) writeCache(url, out);
    return out;
  }catch(e){ return { __err:String(e), __url:url }; }
}

/* ============================== /points ================================= */
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

/* ============================ Astronomy/Time ============================= */
function isUSDST(d){
  var y=d.getUTCFullYear();
  function nthDow(month, n, dow){
    var dt=new Date(Date.UTC(y, month, 1, 2, 0, 0));
    var add=(7 + dow - dt.getUTCDay())%7 + 7*(n-1);
    dt.setUTCDate(1+add);
    return dt;
  }
  var dstStart=nthDow(2,2,0);   // March, 2nd Sun
  var dstEnd  =nthDow(10,1,0);  // Nov, 1st Sun
  return d>=dstStart && d<dstEnd;
}
function tzOffsetMinutesUS(tzName, d){
  var dst=isUSDST(d);
  if (!tzName) return (new Date()).getTimezoneOffset()*-1;
  var n=tzName.toLowerCase();
  if (n.indexOf("pacific")>=0)  return (dst?-420:-480);
  if (n.indexOf("mountain")>=0) return (dst?-360:-420);
  if (n.indexOf("central")>=0)  return (dst?-300:-360);
  if (n.indexOf("eastern")>=0)  return (dst?-240:-300);
  if (n.indexOf("alaska")>=0)   return (dst?-480:-540);
  if (n.indexOf("hawaii")>=0)   return -600;
  return (new Date()).getTimezoneOffset()*-1;
}
function rad(d){return d*Math.PI/180;}
function julian(y,m,d){ if(m<=2){y--;m+=12;} var A=Math.floor(y/100),B=2-A+Math.floor(A/4);
  return Math.floor(365.25*(y+4716))+Math.floor(30.6001*(m+1))+d+B-1524.5; }
function sunTimes(lat,lon,date, tzName){
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

    var offMin = tzOffsetMinutesUS(String(tzName||""), date);
    var offMs  = offMin*60000;

    var rise=new Date(fromJulian(Jr).getTime()+offMs);
    var set =new Date(fromJulian(Js).getTime()+offMs);

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

/* ============================== Icons ===================================== */
function normalizeNwsIconToken(iconURL){
  try{
    var path = iconURL.replace(/^https?:\/\/[^/]+\/icons\//, "");
    var parts = path.split("/");
    var tod = (parts.indexOf("day")>=0) ? "day" : (parts.indexOf("night")>=0 ? "night" : "");
    var after = path.split(tod + "/")[1] || "";
    after = after.split("?")[0] || "";
    var token = (after.split(",")[0] || "").toLowerCase();
    return {tod:tod, token:token};
  }catch(_){ return {tod:"", token:""}; }
}
function chooseOverrideIconToken(currentCond, astro){
  if (!currentCond || !astro) return null;
  var cond = String(currentCond).toLowerCase();
  function isDay(){
    try{
      var now = new Date();
      function toMin(s){ var a=s.split(":"); return parseInt(a[0],10)*60+parseInt(a[1],10); }
      var nowMin = now.getHours()*60 + now.getMinutes();
      var sr=toMin(astro.sr), ss=toMin(astro.ss);
      if (ss > sr) return nowMin >= sr && nowMin < ss;
      return nowMin >= sr || nowMin < ss;
    }catch(_){ return true; }
  }
  var day = isDay();
  if (/\bclear\b/.test(cond)) return day ? "sunny" : "nt_clear";
  if (/mostly sunny/.test(cond)) return day ? "mostlysunny" : "nt_mostlysunny";
  if (/mostly clear/.test(cond)) return day ? "mostlysunny" : "nt_mostlysunny";
  if (/partly cloudy/.test(cond)) return day ? "partlycloudy" : "nt_partlycloudy";
  return null;
}
function printIconFromNWSIconURL(iconURL, x, y, overrideName, todHint){
  if ((!iconURL && !overrideName) || !termHasANSI()) return false;
  try {
    var tod="", token="";
    if (iconURL){
      var nt = normalizeNwsIconToken(iconURL);
      tod = nt.tod; token = nt.token;
    }
    if (!tod && todHint) tod=todHint;

    var map = {
      "skc":"sunny", "few":"mostlysunny", "sct":"partlycloudy", "bkn":"mostlycloudy", "ovc":"cloudy",
      "wind_skc":"cloudy", "wind_few":"mostlysunny", "wind_sct":"partlycloudy", "wind_bkn":"mostlycloudy", "wind_ovc":"cloudy",
      "rain":"rain", "ra":"rain", "rain_showers":"rain", "rain_showers_hi":"rain", "drizzle":"rain",
      "tsra":"tstorms", "tsra_sct":"tstorms", "tsra_hi":"tstorms",
      "snow":"snow", "blizzard":"snow",
      "sleet":"sleet", "fzra":"sleet", "rain_fzra":"sleet",
      "fog":"fog", "haze":"hazy", "dust":"hazy", "smoke":"hazy",
      "hot":"sunny", "cold":"cloudy"
    };

    function nightify(name){
      var nmap = {
        "sunny":"nt_sunny", "clear":"nt_clear", "mostlysunny":"nt_mostlysunny",
        "partlycloudy":"nt_partlycloudy", "mostlycloudy":"nt_mostlycloudy",
        "cloudy":"nt_cloudy", "rain":"nt_rain", "tstorms":"nt_tstorms",
        "snow":"nt_snow", "sleet":"nt_sleet", "fog":"nt_fog", "hazy":"nt_hazy",
        "partlysunny":"nt_partlysunny"
      };
      return nmap[name] || name;
    }

    var candidates=[];
    function push(name){ if (name) candidates.push(name); }

    if (overrideName){
      push(overrideName);
      if (overrideName.indexOf("nt_")!==0 && tod==="night") push(nightify(overrideName));
    }

    var base = map[token] || token;
    if (tod==="night") base = nightify(base);
    push(base);

    if (tod==="night" && base==="sunny") push("nt_sunny");
    if (tod==="night" && base==="clear") push("nt_clear");

    function tryPrint(name){
      if (!name) return false;
      var f=js.exec_dir+"icons/"+name+iconExt;
      if (file_exists(f)){ console.gotoxy(x,y); console.printfile(f); return true; }
      return false;
    }
    var i;
    for (i=0;i<candidates.length;i++){ if (tryPrint(candidates[i])) return true; }
    if (tryPrint("unknown")) return true;
  } catch(e) { }
  return false;
}

/* ============================ Unit Helpers =============================== */
function asTemp(valC){
  if (valC==null || isNaN(valC)) return {f:null,c:null};
  var c = Math.round(valC);
  var f = Math.round((valC*9/5)+32);
  return {f:f,c:c};
}
function mphFromMps(v){ if (v==null || isNaN(v)) return null; return Math.round(v*2.23694); }
function kphFromMps(v){ if (v==null || isNaN(v)) return null; return Math.round(v*3.6); }
function fmtTempPair(t){
  if (!t || (t.f==null && t.c==null)) return "N/A";
  if (PREF_UNITS==="metric") return t.c + degreeSymbol + " C";
  return t.f + degreeSymbol + " F";
}

/* ============================== Alerts =================================== */
function isoLocalDate(iso){
  if (!iso) return "";
  try{
    var d=new Date(iso);
    var mm=(d.getMonth()+1); var dd=d.getDate(); var h=d.getHours(); var m=d.getMinutes();
    function pad(n){ return (n<10?"0":"")+n; }
    return pad(mm)+"/"+pad(dd)+" "+pad(h)+":"+pad(m);
  }catch(_){ return ""; }
}
function summarizeAlert(a){
  try{
    var name = a.properties && a.properties.event ? a.properties.event : "Alert";
    var until = a.properties && (a.properties.ends || a.properties.expires);
    var when = isoLocalDate(until);
    // sanitize parts
    name = cleanText(name);
    return name + (when ? (" (until " + when + ")") : "");
  }catch(_){ return "Alert"; }
}
function alertColor(a){
  try{
    var e = (a.properties && a.properties.event) ? String(a.properties.event).toLowerCase() : "";
    var sev = (a.properties && a.properties.severity) ? String(a.properties.severity).toLowerCase() : "";
    if (/warning/.test(e) || sev==="extreme" || sev==="severe") return C_WARN;
    if (/watch/.test(e)) return C_WATCH;
    if (/advisory/.test(e)) return C_ADV;
    return C_INFO;
  }catch(_){ return C_INFO; }
}

/* ============================== Title ==================================== */
function printTitle(){
  if (termHasANSI() && TDF_FONT){
    try{
      var fontPath = js.exec_dir + TDF_FONT;
      if (file_exists(fontPath)){
        var jexec = "?tdfiglet";
        var jalign = (TDF_ALIGN==="left")?"l":(TDF_ALIGN==="right")?"r":"c";
        var cmd = jexec + " -f " + TDF_FONT + " -j " + jalign + " -w " + TDF_WIDTH + " Local Weather Report";
        if (bbs && bbs.exec) bbs.exec(cmd);
        else print("Local Weather Report\r\n");
        print("\r\n"); // blank line after title
        return;
      }
    }catch(_){}
  }
  try{ console.clear(); }catch(_){ }
  put(C_HDR + "SyncWx-NWS by RetroMafia - Local Weather Report" + C_RESET + "\r\n\r\n");
}

/* =============================== Main ==================================== */
(function main(){
  try{
    // User & location
    var curUserNum = (bbs && bbs.node_num) ? system.node_list[bbs.node_num-1].useron
                     : (user && user.number ? user.number : 1);
    var u = new User(curUserNum);
    var loc = u && u.location ? cleanText(u.location) : "";

    printTitle();

    // Coordinates
    var lat=null, lon=null, locLabel="Unknown";
    if (opts.latitude && opts.longitude){
      lat=parseFloat(opts.latitude); lon=parseFloat(opts.longitude);
      locLabel = cleanText(opts.location_name || "Configured Location");
    } else if (loc && loc.trim()!==""){
      var g = geocodeCityState(loc);
      if (g && !g.__err){ lat=g.lat; lon=g.lon; var parts=String(loc).split(","); locLabel=(parts.length>=2)?(cleanText(parts[0].trim()+", "+parts[1].trim())):cleanText(loc); }
      else { print("Geocode failed ("+(g?g.__err:"unknown")+")\r\n"); safePause(); return; }
    } else { print("No user location (set City/State or configure lat/lon in modopts.ini)\r\n"); safePause(); return; }

    // /points
    var points = fetchPoints(lat,lon);
    if (!points.ok){ print("/points request failed: "+points.failure.err+"\r\n"); safePause(); return; }
    var props = points.json.properties;
    var forecastURL       = props.forecast;
    var forecastHourlyURL = props.forecastHourly;
    var obsStationsURL    = props.observationStations;
    var POINT_TZ          = props.timeZone || "";

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

    // Alerts
    var alertsURL = "https://api.weather.gov/alerts/active?point="+lat+","+lon;
    var alerts = (ALERTS_MAX>0) ? getJSON(alertsURL, "application/geo+json") : {features:[]};

    // Astronomy
    var astro = sunTimes(lat, lon, new Date(), POINT_TZ);

    // Layout
    var rightX = 22;
    var topY   = 3;

    // Current obs & values
    var cond="N/A", tempPair={f:null,c:null}, windTxt="N/A", rhTxt="", dpTxt="";
    var iconOverride=null, todHint="";
    if (latest && !latest.__transport_error){
      try{
        cond = cleanText(latest.properties.textDescription || "N/A");
        iconOverride = chooseOverrideIconToken(cond, astro);

        (function(){
          function toMin(s){ var a=s.split(":"); return parseInt(a[0],10)*60+parseInt(a[1],10); }
          var now = new Date(); var nowMin = now.getHours()*60 + now.getMinutes();
          var sr=toMin(astro.sr), ss=toMin(astro.ss);
          var isDay = (ss>sr) ? (nowMin>=sr && nowMin<ss) : (nowMin>=sr || nowMin<ss);
          todHint = isDay ? "day" : "night";
        })();

        var t = latest.properties.temperature;
        if (t && typeof t.value==="number") { tempPair = asTemp(t.value); }

        var rh = latest.properties.relativeHumidity;
        if (rh && typeof rh.value==="number") rhTxt = "  RH " + Math.round(rh.value) + "%";

        var dp = latest.properties.dewpoint;
        if (dp && typeof dp.value==="number"){
          var dpPair = asTemp(dp.value);
          dpTxt = "  Dew " + (PREF_UNITS==="metric" ? (dpPair.c + degreeSymbol + " C") : (dpPair.f + degreeSymbol + " F"));
        }

        var wdir=latest.properties.windDirection, wspd=latest.properties.windSpeed;
        var dirdeg = (wdir && typeof wdir.value==="number") ? Math.round(wdir.value) : null;
        var dirTxt = degToCompass(dirdeg);
        var spdmps = (wspd && typeof wspd.value==="number") ? wspd.value : null;
        var spd = (PREF_UNITS==="metric") ? kphFromMps(spdmps) : mphFromMps(spdmps);
        var unit = (PREF_UNITS==="metric") ? " kph" : " mph";
        if ((spdmps==null) || isNaN(spd) || spd===0){
          windTxt = "Calm";
        } else {
          windTxt = (dirTxt ? (dirTxt + " @ ") : "") + spd + unit;
        }
      }catch(e){}
    }

    // Icon (after we know override)
    if (termHasANSI() && !fc.__transport_error) {
      var iconURL=null;
      try{
        if (fc.properties && fc.properties.periods && fc.properties.periods.length)
          iconURL = fc.properties.periods[0].icon || null;
      }catch(_){}
      if (!printIconFromNWSIconURL(iconURL, 2, topY, iconOverride, todHint)) {
        var fb = js.exec_dir + "icons/unknown" + iconExt;
        if (file_exists(fb)) { console.gotoxy(2, topY); console.printfile(fb); }
      }
    }

    // Alerts summary pieces (sanitized), one per line
    var alertParts = [];
    var anyAlerts = false;
    if (!alerts.__transport_error && alerts.features && alerts.features.length){
      var take = Math.min(ALERTS_MAX, alerts.features.length);
      var i;
      for (i=0;i<take;i++){
        var a = alerts.features[i];
        var col = alertColor(a);
        var s = summarizeAlert(a); // already sanitized
        alertParts.push(col + s + C_RESET);
      }
      anyAlerts = alertParts.length>0;
    }

    // Body colors
    var gy="\x01n\x01w", wh="\x01h\x01w", yl="\x01h\x01y";

    /* ========================= Output (ANSI) ========================= */
    if (termHasANSI()) {
      function line(y, label, value){ console.gotoxy(rightX, y); put(wh + label + yl + value); }
      line(topY,   LocationHeader,   locLabel);
      line(topY+1, ConditionsHeader, cond);
      line(topY+2, TempHeader,       fmtTempPair(tempPair));
      line(topY+3, SunHeader,        astro.sr + gy + " / " + yl + astro.ss);
      line(topY+4, LunarHeader,      astro.phase);
      line(topY+5, WindHeader,       windTxt + rhTxt + dpTxt);

      // BLANK LINE BEFORE ALERTS
      console.gotoxy(1, topY+6);
      put("\r\n");

      // WX ALERT banner at far-left with white bg + bright red fg
      console.gotoxy(1, topY+7);
      if (anyAlerts && ALERTS_BEEP) put("\x07");
      // “WX ALERT” label; rest of content goes on same line or next lines
      put("\x1b[47m\x1b[1;31m WX ALERT:\x1b[0m ");

      if (alertParts.length>0) {
        put(alertParts[0] + "\r\n");
        var j;
        for (j=1;j<alertParts.length;j++){
          put("           " + alertParts[j] + "\r\n"); // indent subsequent lines
        }
      } else {
        put(yl + "None active" + C_RESET + "\r\n");
      }

      // BLANK LINE AFTER ALERTS
      put("\r\n");

      // Forecast (first 3 periods)
      var y = topY + 10;
      if (!fc.__transport_error && fc.properties && fc.properties.periods && fc.properties.periods.length){
        var maxShow=Math.min(3, fc.properties.periods.length);
        var k;
        for (k=0;k<maxShow;k++){
          var p=fc.properties.periods[k];
          var name=cleanText(p.name || ("Period "+p.number));
          var short=cleanText(p.shortForecast || "");
          console.gotoxy(2, y+(k*3));
          put(yl + name + gy + ": " + wh + short + "\r\n");
          console.gotoxy(2, y+(k*3)+1);
          if (p.temperature!=null && p.temperature!=="") {
            var hiLo = p.isDaytime ? "Hi " : "Lo ";
            var unitP = (p.temperatureUnit||"");
            if (PREF_UNITS==="metric" && unitP==="F"){
              var ctemp = Math.round((p.temperature-32)*5/9);
              put(wh + hiLo + ctemp + " C\r\n");
            } else if (PREF_UNITS==="imperial" && unitP==="C"){
              var ftemp = Math.round((p.temperature*9/5)+32);
              put(wh + hiLo + ftemp + " F\r\n");
            } else {
              put(wh + hiLo + p.temperature + " " + unitP + "\r\n");
            }
          }
        }
      }

      // Footer (colored text only)
      put(
        "\r\n" +
        "\x01h\x01y" + "syncWx-NWS v2.6" + C_RESET + " | " +
        "\x01h\x01g" + "pwbass.com" + C_RESET + " | " +
        "\x01h\x01w" + "Data: " + "\x01h\x01g" + "weather.gov" +
        C_RESET + "\r\n"
      );

      // Prompt to view full alert text
      if (anyAlerts){
        put("\r\n" + "\x01h\x01y" + "View full alert text? (Y/N): " + C_RESET);
        var k2 = console.getkey(K_UPPER);
        put("\r\n");
        if (k2 === "Y"){
          try{ console.clear(); }catch(_){}
          put(C_HDR + "Active Alerts" + C_RESET + "\r\n\r\n");
          var ai;
          for (ai=0; ai<alerts.features.length; ai++){
            var A = alerts.features[ai];
            var colA = alertColor(A);
            var propsA = A.properties || {};
            var head = cleanText(propsA.headline || propsA.event || "Alert");
            var eff  = propsA.effective ? ("Effective: "+isoLocalDate(propsA.effective)) : "";
            var exp  = (propsA.ends||propsA.expires) ? ("Expires: "+isoLocalDate(propsA.ends||propsA.expires)) : "";
            var area = propsA.areaDesc ? ("Area: " + cleanText(propsA.areaDesc)) : "";
            put(colA + "\x01h" + head + C_RESET + "\r\n");
            if (eff)  put(C_INFO + eff + C_RESET + "\r\n");
            if (exp)  put(C_INFO + exp + C_RESET + "\r\n");
            if (area) put(C_INFO + area + C_RESET + "\r\n");
            if (propsA.description)  put("\r\n" + "\x01h\x01w" + cleanText(propsA.description) + C_RESET + "\r\n");
            if (propsA.instruction)  put("\r\n" + "\x01h\x01w" + cleanText(propsA.instruction) + C_RESET + "\r\n");
            put("\r\n");
          }
          safePause();
        }
      }
      safePause();

    } else {
      /* ========================= Output (ASCII) ========================= */
      put(LocationHeader + locLabel + "\r\n");
      put(ConditionsHeader + cond + "\r\n");
      put(TempHeader + fmtTempPair(tempPair) + "\r\n");
      put(SunHeader + astro.sr + " / " + astro.ss + "\r\n");
      put(LunarHeader + astro.phase + "\r\n");
      put(WindHeader + windTxt + rhTxt + dpTxt + "\r\n");
      put("\r\n" + "WX ALERT: " + (anyAlerts ? stripNonAscii(alertParts.join(" | ")) : "None active") + "\r\n\r\n");

      if (!fc.__transport_error && fc.properties && fc.properties.periods && fc.properties.periods.length){
        var maxShow2=Math.min(3, fc.properties.periods.length);
        var m;
        for (m=0;m<maxShow2;m++){
          var pp=fc.properties.periods[m];
          var nm=cleanText(pp.name || ("Period "+pp.number));
          var sh=cleanText(pp.shortForecast || "");
          put(nm + ": " + sh + "\r\n");
          if (pp.temperature!=null && pp.temperature!=="") {
            var hl = pp.isDaytime ? "Hi " : "Lo ";
            var un = (pp.temperatureUnit||"");
            if (PREF_UNITS==="metric" && un==="F"){
              var cr = Math.round((pp.temperature-32)*5/9);
              put(hl + cr + " C\r\n\r\n");
            } else if (PREF_UNITS==="imperial" && un==="C"){
              var fr = Math.round((pp.temperature*9/5)+32);
              put(hl + fr + " F\r\n\r\n");
            } else {
              put(hl + pp.temperature + " " + un + "\r\n\r\n");
            }
          }
        }
      }
      put("syncWx-NWS v2.6 | pwbass.com | Data: weather.gov\r\n");
      if (anyAlerts){
        put("View full alert text? (Y/N): ");
        var kk = console.getkey(K_UPPER);
        put("\r\n");
        if (kk==="Y"){
          try{ console.clear(); }catch(_){}
          print("Active Alerts\r\n\r\n");
          var aj;
          for (aj=0; aj<alerts.features.length; aj++){
            var B = alerts.features[aj];
            var p2 = B.properties || {};
            var hd = cleanText(p2.headline || p2.event || "Alert");
            print(hd + "\r\n");
            if (p2.effective) print("Effective: "+isoLocalDate(p2.effective)+"\r\n");
            if (p2.ends||p2.expires) print("Expires: "+isoLocalDate(p2.ends||p2.expires)+"\r\n");
            if (p2.areaDesc) print("Area: "+cleanText(p2.areaDesc)+"\r\n");
            if (p2.description)  print("\r\n"+cleanText(p2.description)+"\r\n");
            if (p2.instruction)  print("\r\n"+cleanText(p2.instruction)+"\r\n");
            print("\r\n");
          }
          safePause();
        }
      }
      safePause();
    }

  }catch(err){
    log("ERROR weather.js outer: " + err);
    print("Unexpected error: " + err + "\r\n");
    safePause();
  }
})();
