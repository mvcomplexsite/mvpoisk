# MVPoisk v10 — Worker подключён

Подключён Worker: `https://mvpoisk.cizikvpn.workers.dev/players`.

Схема: MVPoisk → Worker → upstream `/api/players` → реальный `iframeUrl` → iframe на странице.

Прямой Kinobox embed удалён, так как он давал Angie 404.

Проверка Worker: `https://mvpoisk.cizikvpn.workers.dev/players?kinopoisk=1309707`.

## v11 — streaming Worker
Cloudflare Worker no longer parses upstream JSON. Successful responses are streamed directly to the browser to avoid `Memory limit would be exceeded before EOF`.

Important: redeploy `worker/worker.js` in the existing Cloudflare Worker, then upload the v11 site files to GitHub Pages.
The frontend tries `partner` and `kinobox`, first by KinoPoisk ID and then by available fallback identifiers.
