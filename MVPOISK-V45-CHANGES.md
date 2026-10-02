# MVPoisk v45

## Player
- Restored the previously stable Rendex/Vibix embedded player as the primary player on desktop, mobile and TV.
- Removed the v44 Collaps/VenomPlayer primary path from the active UI.
- Removed the Kinobox source-selection UI from the active playback flow.
- GGPoisk is now the single, obvious reserve action from the movie card and the player header.
- The old second player panel is no longer rendered.

## Worker
- Worker version bumped to 45.
- Removed the v44 Collaps config bridge from the deployment Worker.
- Public movie API proxy is allow-listed to the routes MVPoisk actually uses: movie list, movie search, movie details, and reviews.
- `limit`, `page`, and search-query size are bounded so the Worker is harder to abuse as a generic API-key drain.
- `/health` no longer exposes Cloudflare secret variable names for key slots.

## Reliability
- Service worker no longer returns `index.html` as a fallback for failed JavaScript/CSS requests.
- Only successful same-origin responses are written into the runtime cache.
- Android TV WebView/session data is excluded from ordinary Android backup (`allowBackup=false`).
