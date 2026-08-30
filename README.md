# MVPoisk v37 — Cloudflare Accounts

v37 убирает Supabase из MVPoisk. Telegram Login, собственные web-сессии, синхронизация пользовательских данных и TV pairing работают через существующий Cloudflare Worker + Cloudflare D1.

Основные файлы:

- `worker/worker.js` — Worker v37: PoiskKino key pool + Telegram OIDC + D1 + TV pairing.
- `cloudflare/schema.sql` — схема D1.
- `CLOUDFLARE-ACCOUNTS-SETUP.md` — пошаговая настройка.
- `js/account.js` — frontend auth/sync без Supabase SDK.
- `js/config.js` — публичная конфигурация сайта.

Плееры Rendex/Kinobox и существующая TV-логика не менялись этой версией.
