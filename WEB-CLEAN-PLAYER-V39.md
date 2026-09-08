# MVPoisk v39 — Web Clean Player Gateway

- Primary Rendex: local SDK, Cloudflare bootstrap proxy, partner embed.js patched only so fetchAdTags() returns zero preroll/midroll/postroll.
- The clean frame also blocks known VAST/ad network requests and popup navigation.
- Kinobox on web: sources are discovered server-side by the Worker and shown in MVPoisk's own source picker. Each selected source is loaded through a bounded clean-frame proxy.
- Android TV keeps the previous integration for now.

Deploy the v39 site first, then replace the Cloudflare Worker with worker/worker.js (or the TXT copy provided separately).
