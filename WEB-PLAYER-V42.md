# MVPoisk v42 — Kinobox primary on web

Desktop/mobile playback now uses a browser-side Kinobox source list as the primary path.

- No Cloudflare iframe proxy is used.
- Turbo/obrut is excluded.
- Preferred order: Collaps, Kodik, Vibix, HDVB, Voidboost, Ashdi.
- Alloha/Cdnmovies/VideoCDN remain later fallbacks if returned.
- `noads=1` and `onlyNoAds=1` are appended as partner-approved hints.
- The selected source is remembered locally and reused when available.
- Rendex is demoted to an optional web fallback.
- TV keeps the older integration for now.
