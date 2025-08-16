# syncWx-NWS

**syncWx-NWS** is a JavaScript weather application designed to run on a [Synchronet Bulletin Board System](http://www.synchro.net).  
It is a fork of **syncWXremix** by [KenDB3](http://bbs.kd3.us), updated by **Patrick Bass (D2SK)** of [Retro Mafia BBS](telnet://retromafia.retrogoldbbs.com:8023) to use the [National Weather Service API](https://api.weather.gov).

The icon files use Synchronet **Ctrl-A** color codes for styling (similar to ANSI), allowing ASCII graphics to render correctly on both ANSI and plain ASCII terminals.  
Reference for Synchronet Ctrl-A codes can be found [here](http://wiki.synchro.net/custom:ctrl-a_codes).

The icon designs were inspired by the [wego](https://github.com/schachmat/wego) weather app by Markus Teich. His contribution/inspiration is acknowledged in the ISC license included in the `icons` folder.

---

## Features

- Uses the [NWS API](https://api.weather.gov) for U.S. forecasts, observations, and alerts.
- Detects the BBS caller's **City, State** and automatically geocodes it to latitude/longitude.
- Falls back to configured coordinates in `modopts.ini` if no location is set.
- Displays current conditions, temperature (F & C), sunrise/sunset, lunar phase, wind.
- Shows 4 forecast periods with icons.
- Works in ANSI and plain ASCII modes.
- Can be run as a **door** or a **logon event**.
- Built-in support for monochrome terminals.
- No API key required.

---

## Installation

1. **Copy the files**  
   Place the following files into your Synchronet directories:
   - `weather.js` → `/sbbs/xtrn/syncWx-NWS/`
   - `icons/` → `/sbbs/xtrn/syncWx-NWS/icons/`
   - `SYSOP.txt`, `LICENSE`, and `README.md` in the same directory for reference.

2. **Configure modopts.ini**  
   Edit `/sbbs/ctrl/modopts.ini` and add:
   ```ini
   [SyncWX]
   user_agent = RetroMafia BBS (sysop: hello@retrogoldbbs.com)
   email = hello@retrogoldbbs.com
   weathericon_ext = .asc
   ```

3. **Install in SCFG**  
   - In Synchronet SCFG, add a new external program:
     - Name: syncWx-NWS
     - Internal Code: SYNCWX
     - Start-up Directory: `../xtrn/syncWx-NWS`
     - Command Line: `?weather.js`
     - Execution Cost: `0`
     - Access Requirements: *Your choice*
     - Execution Requirements: *Your choice*
     - Native Executable: No
     - Use Shell: No

4. **Run**  
   Users can run it from the external programs menu or it can be called from `logon.js`.

---
## Logon Event (add to logon.js)
```
/* ===== Run weather at logon (robust path; run as its own JS process) ===== */
(function(){
    try{
        if(!options.run_syncwx){ dbg("disabled via modopts"); return; }
        if(options.syncwx_min_level && user.security.level < options.syncwx_min_level){ dbg("below min level"); return; }
        if(options.syncwx_skip_guests && (user.security.restrictions & UFLAG_G)){ dbg("skipping guest"); return; }
        if(options.syncwx_skip_rlogin && (bbs.sys_status & SS_RLOGIN)){ dbg("skipping rlogin"); return; }
        if(options.syncwx_hours && !withinHourWindow(options.syncwx_hours)){ dbg("outside hour window "+options.syncwx_hours); return; }

        var cand = [];
        var cfg = String(options.syncwx_path||"");
        if(cfg) cand.push(cfg);
        cand.push("../xtrn/syncWx-NWS/weather.js");
        cand.push("xtrn/syncWx-NWS/weather.js");
        cand.push("C:/sbbs/xtrn/syncWx-NWS/weather.js");
        cand.push("C:\\sbbs\\xtrn\\syncWx-NWS\\weather.js");

        var launched=false;
        for(var i=0;i<cand.length && !launched;i++){
            var requested = cand[i];
            var ap = joinRoot(requested);   // C:/sbbs/xtrn/syncWx-NWS/weather.js
            if(exists(ap)){
                // Launch as a separate JS process so js.exec_dir === module dir.
                // Use forward slashes to keep Synchronet happy on Windows.
                var cmd = "?" + norm(ap);
                dbg("exec " + cmd);
                bbs.exec(cmd);
                launched = true;
                break;
            }
            // If candidate is already absolute and exists, use it
            var rp = norm(requested);
            if(/^([A-Za-z]:\/|\/)/.test(rp) && exists(requested)){
                var cmd2 = "?" + rp;
                bbs.exec(cmd2);
                launched = true;
                break;
            }
        }
        if(!launched) dbg("NOT FOUND — verify weather.js is at C:\\sbbs\\xtrn\\syncWx-NWS\\weather.js");
        if(options.syncwx_debug) console.crlf();
    }catch(e){
        dbg("hook error: " + e);
    }
})();
```
---
## FAQ

**Q:** Why does it sometimes show the wrong location when used as a logon event?  
**A:** This was a Synchronet bug fixed on Dec 16, 2015. You must run a build newer than that date.  
[CVS Commit for the fix](http://cvs.synchro.net/commitlog.ssjs#32554)

**Q:** How does fallback work?  
**A:** If no location is found, the script uses the fallback location from `modopts.ini`.

**Q:** Why does UV Index say N/A?  
**A:** NWS API does not currently provide UV index in the standard forecast JSON.

**Q:** Can it work for non-U.S. locations?  
**A:** No, the NWS API is U.S.-only.

---

## License

Copyright (c) 2025, Patrick Bass <patrick@pwbass.com>  
Portions originally (c) 2015, Kenny DiBattista <kendb3@bbs.kd3.us>  

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
