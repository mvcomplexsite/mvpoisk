# MVPoisk v40 — Clean Player recovery

- Rendex clean frame now preserves the original iframe URL and approved parent domain when calling partner APIs.
- If the clean Rendex bootstrap reports a content error, MVPoisk automatically falls back to the original direct partner iframe instead of leaving a broken player.
- Kinobox discovery tries both the partner base and public Kinobox API, then falls back to the browser-side Kinobox integration if Cloudflare cannot reach either endpoint.
- TV behavior is unchanged.
