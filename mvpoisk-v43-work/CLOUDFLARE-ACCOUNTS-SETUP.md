# MVPoisk v37 — Telegram Accounts полностью на Cloudflare

Архитектура v37:

`MVPoisk → Cloudflare Worker → Telegram OIDC → Cloudflare D1`

Supabase больше не используется.

## 1. Создай D1

Cloudflare Dashboard → D1 SQL database → Create database.

Имя:

`mvpoisk-db`

Открой базу → Console. Скопируй **весь** файл:

`cloudflare/schema.sql`

в консоль и нажми Execute/Run.

После выполнения должны появиться таблицы:

- `users`
- `sessions`
- `oauth_flows`
- `auth_handoffs`
- `user_state`
- `tv_pairs`

## 2. Привяжи D1 к существующему Worker

Cloudflare → Workers & Pages → `mvpoisk` → Bindings → Add binding → D1 database.

Variable name:

`DB`

Database:

`mvpoisk-db`

Binding **обязательно** должен называться ровно `DB`.

## 3. Telegram Login

В BotFather используй Login Widget / Telegram Login для бота MVPoisk.

Нужны:

- Client ID
- Client Secret

Для алгоритма подписи оставь стандартный `RS256`.

В Allowed URLs добавь callback Worker:

`https://mvpoisk.cizikvpn.workers.dev/auth/telegram/callback`

Если позже Worker получит свой домен, callback нужно будет поменять и в BotFather, и в Worker settings.

## 4. Добавь Worker Secrets

Cloudflare → `mvpoisk` Worker → Settings → Variables and Secrets.

Secret:

`TELEGRAM_CLIENT_ID`

значение — Client ID из BotFather.

Secret:

`TELEGRAM_CLIENT_SECRET`

значение — Client Secret из BotFather.

Ни один из этих секретов не вставляется в GitHub или JS сайта.

## 5. Разрешённый адрес MVPoisk

Добавь обычную Worker variable:

`AUTH_FRONTEND_URL`

значение пока:

`https://mvcomplexsite.github.io/mvpoisk/`

Это защита от открытого redirect. Когда сайт перенесём на Cloudflare-домен, поменяем только эту variable.

Необязательно: `AUTH_CALLBACK_URL`. Если не задан, Worker сам использует:

`https://mvpoisk.cizikvpn.workers.dev/auth/telegram/callback`

## 6. Обнови Worker

Вставь `worker/worker.js` в существующий Worker и Deploy.

Текущие `KINOPOISK_API_KEY_1...` не удаляй — v37 сохраняет весь API key pool.

Старые `SUPABASE_URL` / `SUPABASE_SECRET_KEY` можно удалить: v37 их не читает.

## 7. Проверка Worker

Открой:

`https://mvpoisk.cizikvpn.workers.dev/health`

Должно быть:

```json
{
  "version": 37,
  "d1Configured": true,
  "telegramConfigured": true,
  "accountsConfigured": true,
  "tvPairing": "ready"
}
```

Также проверь поле `telegramCallbackUrl`: оно должно совпадать с Allowed URL в BotFather.

## 8. Залей сайт v37

В основном репозитории `mvpoisk` замени файлы содержимым архива v37 и дождись GitHub Pages deployment.

В `js/config.js` больше нет Supabase. Для аккаунтов там только:

```js
AUTH_WORKER_BASE: 'https://mvpoisk.cizikvpn.workers.dev'
```

## 9. Проверка входа

На ПК/телефоне:

MVPoisk → Войти → Войти через Telegram.

Цепочка должна быть:

1. MVPoisk отправляет на `/auth/telegram/start`.
2. Worker создаёт `state` + PKCE в D1.
3. Telegram подтверждает пользователя.
4. Telegram возвращает на `/auth/telegram/callback` Worker.
5. Worker проверяет подпись Telegram ID token через JWKS.
6. Worker создаёт/обновляет пользователя в D1.
7. Worker возвращает на MVPoisk с одноразовым handoff-кодом во fragment URL.
8. MVPoisk обменивает handoff на собственную 90-дневную сессию.
9. Handoff сразу становится недействительным.

Телефонный Telegram token в браузере MVPoisk не хранится.

## 10. TV

На TV: профиль → Войти. Телевизор получает одноразовый код.

На уже авторизованном ПК/телефоне: профиль → Подключить телевизор → ввести код.

TV получает свой отдельный device token. Web-сессия и Telegram token на телевизор не копируются.

## 11. Перенос самого сайта на Cloudflare (после проверки аккаунтов)

После того как вход заработал на текущем GitHub Pages, фронтенд можно перенести в Cloudflare Pages/Static Assets. Это не требует переделывать базу.

После переноса нужно:

1. поменять `AUTH_FRONTEND_URL` на новый URL сайта;
2. при необходимости поменять Telegram callback, если меняется домен Worker;
3. добавить новый callback в BotFather Allowed URLs.

После этого GitHub Pages можно отключить.
