# MVPoisk v36 — настройка Telegram Accounts + вход TV по коду

Эта версия не использует email/пароли/SMTP. Основная схема:

`Telegram OIDC → Supabase Auth → Supabase DB`

Для TV:

`TV одноразовый код → Cloudflare Worker → подтверждение авторизованным пользователем → отдельный TV device token`

---

## 1. Создать Supabase проект

Открой: https://supabase.com/dashboard

1. `New project`.
2. Название: `MVPoisk`.
3. Сохрани Database Password у себя.
4. Дождись создания проекта.

Потом открой настройки проекта и найди:

- `Project URL` — вида `https://xxxx.supabase.co`;
- `Publishable key` / публичный anon key — вида `sb_publishable_...` или старый `eyJ...` anon key.

Вставь ТОЛЬКО эти публичные значения в `js/config.js`:

```js
SUPABASE_URL: 'https://xxxx.supabase.co',
SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxxxx',
```

`service_role` сюда НЕ вставлять.

---

## 2. Создать Telegram-бота для входа

Открой Telegram → `@BotFather`.

1. Создай нового бота через `/newbot` (если отдельного бота MVPoisk ещё нет).
2. Имя можно `MVPoisk` / `MVPoisk Login`.
3. Поставь логотип MVPoisk как avatar бота — пользователь будет видеть его при авторизации.
4. В BotFather выбери созданного бота → `Login Widget`.
5. В этом разделе Telegram покажет `Client ID` и `Client Secret`.

`Client Secret` держи только в Supabase. Не вставляй его в GitHub или JS сайта.

---

## 3. Создать Telegram Custom OIDC provider в Supabase

В Supabase:

`Authentication → Sign In / Providers → Custom Providers → New Provider`

Выбери `Auto-discovery (OIDC)`.

Поля:

```text
Identifier: custom:telegram
Name: Telegram
Issuer URL: https://oauth.telegram.org
Client ID: [из BotFather]
Client Secret: [из BotFather]
Scopes: openid profile
Email optional / Allow users without email: ON
```

Telegram не обязан отдавать email, поэтому `Email optional` обязательно.

Supabase покажет `Callback URL`. Обычно это адрес проекта Supabase вида:

```text
https://PROJECT_REF.supabase.co/auth/v1/callback
```

Скопируй именно тот Callback URL, который показывает твой Supabase.

---

## 4. Разрешить URL в BotFather

Вернись в:

`@BotFather → твой бот → Login Widget → Allowed URLs`

Добавь:

1. Callback URL из Supabase, например:

```text
https://PROJECT_REF.supabase.co/auth/v1/callback
```

2. Текущий сайт MVPoisk:

```text
https://mvcomplexsite.github.io
```

Если позже появится собственный домен — добавь и его.

---

## 5. URL Configuration Supabase

В Supabase:

`Authentication → URL Configuration`

Поставь:

```text
Site URL:
https://mvcomplexsite.github.io/mvpoisk/
```

В Redirect URLs добавь:

```text
https://mvcomplexsite.github.io/mvpoisk/
https://mvcomplexsite.github.io/mvpoisk/**
```

Если потом будет собственный домен, добавь его сюда тоже.

---

## 6. Создать таблицы

В Supabase:

`SQL Editor → New query`

Открой файл:

```text
supabase/schema.sql
```

Скопируй весь SQL → `Run`.

Должны появиться таблицы:

```text
mvpoisk_user_state
mvpoisk_tv_devices
```

`mvpoisk_user_state` доступна авторизованному пользователю только для его собственного `user_id` через RLS.

`mvpoisk_tv_devices` закрыта от браузера вообще — с ней работает только Cloudflare Worker через backend secret key.

---

## 7. Подключить Supabase к Cloudflare Worker

Открой Cloudflare Dashboard → Workers → текущий Worker `mvpoisk`.

Нужно обновить Worker кодом из:

```text
worker/worker.js
```

Он сохраняет текущий PoiskKino key-pool и добавляет `/auth/tv/...` endpoints.

В настройках Worker добавь секреты/переменные:

### `SUPABASE_URL`

Значение:

```text
https://PROJECT_REF.supabase.co
```

### `SUPABASE_SECRET_KEY`

В Supabase открой `Settings → API Keys` и возьми новый серверный **Secret key** вида `sb_secret_...`. Если проект старый и нового Secret key нет, временно подойдёт legacy `service_role`. Добавь значение ТОЛЬКО как Cloudflare Worker Secret.

НИКОГДА не клади `SUPABASE_SECRET_KEY` в GitHub, `config.js` или HTML.

Существующие `KINOPOISK_API_KEY_1 ...` не удаляй.

После Deploy открой:

```text
https://mvpoisk.cizikvpn.workers.dev/health
```

В JSON должно быть:

```json
"accountsConfigured": true,
"tvPairing": "ready"
```

Если `accountsConfigured: false` — один из двух Supabase Worker secrets не настроен.

---

## 8. Залить сайт v36

В основной GitHub repo `mvpoisk` залей содержимое архива v36 в корень с заменой.

Проверь в `index.html`:

```text
styles.css?v=36
js/tv.js?v=36
js/common.js?v=36
js/app.js?v=36
```

И в `sw.js` должен быть cache `mvpoisk-shell-v36`.

Дождись зелёного `pages build and deployment`.

---

## 9. Проверить Telegram вход на ПК/телефоне

Открой:

```text
https://mvcomplexsite.github.io/mvpoisk/
```

Нажми `Профиль / Войти` → `Войти через Telegram`.

Ожидаемый сценарий:

1. Telegram открывает окно авторизации.
2. Пользователь подтверждает вход.
3. Telegram возвращает в Supabase.
4. Supabase возвращает на MVPoisk.
5. В профиле появляется имя / `@username` / avatar (если доступен).
6. Локальные списки объединяются с облаком.

Первый Telegram-вход автоматически создаёт аккаунт Supabase; отдельной регистрации нет.

---

## 10. Проверить TV pairing

Новый APK для этого этапа не обязателен: v36 работает поверх текущей Android TV оболочки, потому что TV загружает сайт.

На TV:

1. Открой MVPoisk.
2. Наведи пульт на `Войти` / профиль.
3. Нажми OK.
4. Появится код вроде:

```text
K7F2-M9
```

На телефоне/ПК:

1. Войди через Telegram.
2. Открой профиль.
3. Блок `Подключить телевизор`.
4. Введи `K7F2-M9`.
5. Нажми `Подключить`.

TV опрашивает сервер примерно раз в 2 секунды. После подтверждения он автоматически получает собственную TV-сессию и синхронизирует историю/избранное/«Позже».

Телефонный Supabase access token на телевизор НЕ передаётся.

---

## 11. Что синхронизируется

Сейчас v36 синхронизирует существующее состояние MVPoisk:

- профильное имя MVPoisk;
- «Посмотрю позже»;
- избранное;
- историю;
- просмотрено;
- «Смотреть дальше»;
- season/episode/progress, когда партнёрский player действительно передаёт эти данные.

Локальный `localStorage` остаётся как быстрый cache/offline fallback.

---

## 12. Безопасность — что можно/нельзя публиковать

Можно в frontend/GitHub:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
TELEGRAM_OIDC_PROVIDER = custom:telegram
AUTH_WORKER_BASE
```

Нельзя:

```text
Telegram Client Secret
SUPABASE_SECRET_KEY
Database password
любые секретные API keys
```

Telegram Client Secret хранится в Supabase provider settings.

Supabase Secret/service_role key хранится только в Cloudflare Worker Secret.

---

## 13. Если Telegram login не работает

Проверь по порядку:

1. Provider `custom:telegram` включён в Supabase.
2. Issuer именно `https://oauth.telegram.org`.
3. `openid profile` scopes.
4. `Email optional` включён.
5. Callback URL Supabase добавлен в BotFather Allowed URLs.
6. Site URL / Redirect URLs в Supabase правильные.
7. В `config.js` правильные Project URL + Publishable key.

---

## 14. Если TV код не появляется/не подтверждается

Открой Worker `/health` и проверь `accountsConfigured: true`.

Потом в Supabase Table Editor должна существовать `mvpoisk_tv_devices`.

При создании кода там временно появится строка `status = pending`.

После подтверждения с телефона она станет `status = approved` и получит `user_id`.

Если запись есть, но TV не входит — проверь, что на TV загружена именно web v36 (cache/Pages deploy).
