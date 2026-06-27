# Storage Layout

The app intentionally keeps login/session data separate from cache data.

## Login And Session

- Keep Electron `userData` and `sessionData` at their default relationship.
- Do not call `app.setPath("sessionData", ...)` for cache fixes.
- The YouTube Music login profile uses the persistent partition `persist:yt-music-overlay`.
- A useful path hint for that profile is:
  - `%APPDATA%/YT Music Overlay/Partitions/yt-music-overlay`

Changing `sessionData` makes Electron look like a new browser profile and can make the user appear logged out.

## Cache

Cache can be moved safely because it does not own the login session:

- Disk cache: `userData/Cache/Disk`
- GPU cache: `userData/Cache/GPU`

These paths are configured with Chromium command-line switches in `src/main/main.ts`.

## Legacy Folder

`userData/SessionData` may exist from an older broken build. Do not delete or migrate it automatically. If cleanup is needed, do it manually after confirming the app is closed and the user is logged in with the normal profile.

## Debug Exports

Debug exports include the active storage paths under `app.storage`, so future session/cache issues can be diagnosed without guessing which profile is in use.
