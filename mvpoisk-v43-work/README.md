# MVPoisk v43 — Player Stability Recovery

Restores the last known-working direct Rendex and Kinobox integrations. Cloudflare D1/Telegram accounts remain enabled. Clean Player Gateway from v39/v40 is intentionally removed from the playback path.

# MVPoisk v37 — Cloudflare Accounts

v37 убирает Supabase из MVPoisk. Telegram Login, собственные web-сессии, синхронизация пользовательских данных и TV pairing работают через существующий Cloudflare Worker + Cloudflare D1.

Основные файлы:

- `worker/worker.js` — Worker v37: PoiskKino key pool + Telegram OIDC + D1 + TV pairing.
- `cloudflare/schema.sql` — схема D1.
- `CLOUDFLARE-ACCOUNTS-SETUP.md` — пошаговая настройка.
- `js/account.js` — frontend auth/sync без Supabase SDK.
- `js/config.js` — публичная конфигурация сайта.

Плееры Rendex/Kinobox и существующая TV-логика не менялись этой версией.
