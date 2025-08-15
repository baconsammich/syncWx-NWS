// crc32.js — tiny CRC-32 (IEEE 802.3) for Synchronet JS
// Public Domain / CC0. Drop this next to weather.js and `load("crc32.js")`.
// Exposes: crc32_calc(str) -> unsigned 32-bit integer
//          crc32_hex(str)  -> 8-char uppercase hex string

/*
Usage test (from JSexec or inside your script):
  load("crc32.js");
  print(format("%08lx\r\n", crc32_calc("test"))); // D87F7E0C
  print(crc32_hex("test") + "\r\n");              // D87F7E0C
*/

(function(){
  if (typeof crc32_calc === 'function') return; // already loaded

  var POLY = 0xEDB88320; // reversed 0x04C11DB7
  var TABLE = (function(){
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++)
        c = (c & 1) ? (POLY ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  // CRC over a JavaScript string as UTF-8 bytes (safe for URLs and ANSI text)
  function crc32_calc(str) {
    var crc = -1; // 0xFFFFFFFF
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) {
        crc = (crc >>> 8) ^ TABLE[(crc ^ code) & 0xFF];
      } else if (code < 0x800) {
        crc = (crc >>> 8) ^ TABLE[(crc ^ (0xC0 | (code >> 6))) & 0xFF];
        crc = (crc >>> 8) ^ TABLE[(crc ^ (0x80 | (code & 0x3F))) & 0xFF];
      } else {
        crc = (crc >>> 8) ^ TABLE[(crc ^ (0xE0 | (code >> 12))) & 0xFF];
        crc = (crc >>> 8) ^ TABLE[(crc ^ (0x80 | ((code >> 6) & 0x3F))) & 0xFF];
        crc = (crc >>> 8) ^ TABLE[(crc ^ (0x80 | (code & 0x3F))) & 0xFF];
      }
    }
    return (crc ^ -1) >>> 0; // unsigned
  }

  function crc32_hex(str) {
    var v = crc32_calc(str);
    var h = v.toString(16).toUpperCase();
    while (h.length < 8) h = '0' + h;
    return h;
  }

  // expose to global
  this.crc32_calc = crc32_calc;
  this.crc32_hex = crc32_hex;
})();
