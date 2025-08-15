// wxlanguage.js — language strings for syncWXremix (NWS edition)
// Supported options in /ctrl/modopts.ini under [SyncWX]:
//   language = en | sp | it | fr | de
//
// Note: api.weather.gov does not use per-request language flags.
// WXlang is kept for compatibility but unused by NWS.

var opts = load({}, "modopts.js", "SyncWX");

var language = (opts && typeof opts.language !== 'undefined')
  ? String(opts.language).toLowerCase()
  : 'en';

// Default strings (English)
WXlang           = ""; // kept for compatibility; unused by NWS
LocationHeader   = "Your Location: ";
ConditionsHeader = "Current Conditions: ";
TempHeader       = "Temp: ";
SunHeader        = "Sunrise/Sunset: ";
LunarHeader      = "Lunar Phase: ";
WindHeader       = "Wind: ";
UVHeader         = "UV Index: ";
AlertExpires     = "Expires ";
ReadAlert        = "Read the Full Alert";

// Apply language overrides
if (language === "sp") {                 // Español
  LocationHeader   = "Lugar: ";
  ConditionsHeader = "Condiciones actuales: ";
  TempHeader       = "Temperatura: ";
  SunHeader        = "Amanecer/Puesta del sol: ";
  LunarHeader      = "Fase lunar: ";
  WindHeader       = "Viento: ";
  UVHeader         = "Índice UV: ";
  AlertExpires     = "Expira ";
  ReadAlert        = "Leer la alerta";

} else if (language === "it") {          // Italiano
  LocationHeader   = "Località: ";
  ConditionsHeader = "Condizioni attuali: ";
  TempHeader       = "Temperatura: ";
  SunHeader        = "Alba/Tramonto: ";
  LunarHeader      = "Fase lunare: ";
  WindHeader       = "Vento: ";
  UVHeader         = "Indice UV: ";
  AlertExpires     = "Scade ";
  ReadAlert        = "Leggi l'avviso";

} else if (language === "fr") {          // Français
  LocationHeader   = "Votre emplacement : ";
  ConditionsHeader = "Conditions actuelles : ";
  TempHeader       = "Température : ";
  SunHeader        = "Lever/Coucher du soleil : ";
  LunarHeader      = "Phase lunaire : ";
  WindHeader       = "Vent : ";
  UVHeader         = "Indice UV : ";
  AlertExpires     = "Expire ";
  ReadAlert        = "Lire l'alerte complète";

} else if (language === "de") {          // Deutsch
  LocationHeader   = "Ihr Standort: ";
  ConditionsHeader = "Aktuelle Bedingungen: ";
  TempHeader       = "Temperatur: ";
  SunHeader        = "Sonnenaufgang/Sonnenuntergang: ";
  LunarHeader      = "Mondphase: ";
  WindHeader       = "Wind: ";
  UVHeader         = "UV-Index: ";
  AlertExpires     = "Läuft ab ";
  ReadAlert        = "Vollständige Warnung lesen";
}

// Degree symbol:
// - English (legacy CP437 BBS art): use CP437 degree (\370)
// - Other languages: use Unicode U+00B0 (works cleanly with UTF-8 clients)
if (language === "en") {
  degreeSymbol = "\370";       // CP437 degree (ANSI/PC)
} else {
  degreeSymbol = "\u00B0";     // Unicode degree
}
