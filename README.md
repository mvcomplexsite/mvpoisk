# MVPoisk v37 — Cloudflare Accounts

v37 убирает Supabase из MVPoisk. Telegram Login, собственные web-сессии, синхронизация пользовательских данных и TV pairing работают через существующий Cloudflare Worker + Cloudflare D1.

Основные файлы:

- `worker/worker.js` — Worker v37: PoiskKino key pool + Telegram OIDC + D1 + TV pairing.
- `cloudflare/schema.sql` — схема D1.
- `CLOUDFLARE-ACCOUNTS-SETUP.md` — пошаговая настройка.
- `js/account.js` — frontend auth/sync без Supabase SDK.
- `js/config.js` — публичная конфигурация сайта.

Плееры Rendex/Kinobox и существующая TV-логика не менялись этой версией.


## v38 web clean player
Web playback now applies partner-authorized ad suppression parameters (`noads=1`, `onlyNoAds=1`) and sandbox popup/top-navigation blocking. Kinobox is served from the included local SDK copy so its iframe is sandboxed before navigation. TV behavior is unchanged.
