# MVPoisk v45

Production web build for MVPoisk.

## Playback
- Primary embedded player: Rendex/Vibix integration already used by the project before the v42/v44 player experiments.
- Reserve action: GGPoisk.
- No active Kinobox source picker and no Collaps/VenomPlayer bridge.

## Backend
- `worker/worker.js` — Cloudflare Worker v45: PoiskKino key pool/cache, Telegram OIDC, D1 sessions/state, TV pairing.
- Public PoiskKino proxy is limited to the movie/search/review routes used by this frontend.
- `cloudflare/schema.sql` — D1 schema.

## Frontend
- `js/account.js` — Telegram account/session/cloud-sync client.
- `js/movie.js` — movie page and simplified player flow.
- `js/config.js` — public frontend configuration.
- `sw.js` — PWA cache/offline behavior.

See `MVPOISK-V45-CHANGES.md` for the changes in this build.
