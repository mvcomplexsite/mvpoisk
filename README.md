# MVPoisk v36 — Telegram Accounts + TV Pairing

Что добавлено:

- вход/регистрация одним действием через Telegram;
- без email, паролей, SMTP и почтовых кодов;
- профиль Telegram (имя, username, avatar — если Telegram их отдаёт);
- облачная синхронизация существующих данных MVPoisk через Supabase;
- сохранение локального режима/кэша;
- TV-вход по одноразовому коду с уже авторизованного телефона/ПК;
- отдельный TV device token — Telegram/Supabase access token телефона на телевизор не копируется;
- отключение телевизора через «Выйти/Отключить этот телевизор»;
- Cloudflare Worker остаётся единым: movie API + TV pairing/state bridge.

## Главное

Перед публикацией заполни `SUPABASE_URL` и `SUPABASE_PUBLISHABLE_KEY` в `js/config.js`, выполни `supabase/schema.sql`, настрой Telegram как Custom OIDC provider в Supabase и добавь в Cloudflare Worker секреты `SUPABASE_URL` + `SUPABASE_SECRET_KEY`.

Полный порядок: `TELEGRAM-ACCOUNTS-SETUP.md`.

## Безопасность

Никогда не клади в GitHub/frontend:

- Telegram Client Secret;
- Supabase `service_role` key;
- любые секреты Cloudflare Worker.

В `js/config.js` допустимы только публичные `Project URL` и `Publishable/anon key`.
