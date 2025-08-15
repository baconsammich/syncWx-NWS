===============================================================================
FAQ — syncWx-NWS
===============================================================================

Q: When running syncWx-NWS as a 'logon' event, the weather sometimes shows
   the wrong location for the current caller. Why?

A: This is usually due to how Synchronet caches user information between
   nodes. If the script is run before Synchronet updates the `user.location`
   field for the current session, it may display stale data from the previous
   caller on that node.

   This was a known Synchronet bug that Digital Man fixed on Dec 16, 2015.
   To ensure correct behavior, update to any Synchronet build after that date:
   http://cvs.synchro.net/commitlog.ssjs#32554

   Alternatively, run syncWx-NWS as an external door rather than an automatic
   logon event — this guarantees that the correct user data is loaded.

-------------------------------------------------------------------------------

Q: What is the fallback location setting for?

A: If a caller’s City/State is missing in their BBS user record, syncWx-NWS
   will use a fallback latitude/longitude from your `modopts.ini`:

       [SyncWX]
       latitude  = 35.3880338
       longitude = -94.4265011
       location_name = Fort Smith, AR

   This ensures the program always has valid coordinates to query NWS,
   even if the user hasn’t set their location.

-------------------------------------------------------------------------------

Q: Can I use IP address geolocation instead?

A: The current syncWx-NWS script is designed to use **BBS user profile**
   data (City, ST). It does not use IP geolocation. If you want IP-based
   location, that would require a separate geolocation API and changes to
   the script. For sysops who want accuracy, the best practice is to have
   callers set their location in their user profile.

-------------------------------------------------------------------------------

Q: How do I get more info about an error?

A: Increase Synchronet’s `LogLevel` to `Debugging` in `/sbbs/ctrl/sbbs.ini`.
   This will show:
     - The exact NWS API request URL
     - Any HTTP errors returned
     - The geocoding request/response

   Synchronet LogLevel documentation:
   http://wiki.synchro.net/config:sbbs.ini#loglevel

-------------------------------------------------------------------------------

Q: Why do ftelnet or web callers see the fallback location instead of their own?

A: The user location is determined from their BBS account, not their IP
   address. Web callers who have not set their location will see the fallback
   coordinates you’ve configured. To personalize the weather report for them,
   have them log in at least once via telnet and set their City/State in
   their user settings.

-------------------------------------------------------------------------------

Q: What’s the best format for the City/State field?

A: Always use:
        City, ST
   Example:
        Fort Smith, AR

   This format produces the most reliable results when geocoded via
   OpenStreetMap’s Nominatim service.

-------------------------------------------------------------------------------
