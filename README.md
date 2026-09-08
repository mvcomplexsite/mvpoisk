# MVPoisk v39 — Cloudflare Accounts + Web Clean Player Gateway

v39 сохраняет Cloudflare D1 + Telegram Accounts из v37/v38 и меняет только web-путь плееров (ПК/телефон).

Что нового:

- Rendex SDK хранится локально в `js/rendex-sdk.min.js`, чтобы страница не зависела от загрузки SDK с `graphicslab.io`.
- Для web основной iframe проходит через `/player/rendex/frame` на нашем Worker.
- В разрешённой партнёром копии `embed.js` функция `fetchAdTags()` возвращает нулевые `preroll/midroll/postroll`, остальная логика контента/серий/озвучек не менялась.
- Clean-frame дополнительно блокирует известные VAST/ad network запросы и popup/top-navigation.
- Kinobox на web больше не использует штатное меню `1 :: 2 :: ...`: Worker получает `/api/players`, frontend показывает свои кнопки «Источник 1/2/...», а выбранный iframe идёт через ограниченный clean-frame gateway.
- Android TV оставлен на прежней ветке, чтобы не ломать текущий APK.

Основные файлы:

- `worker/worker.js` — Worker v39: PoiskKino key pool + Telegram/D1 + clean player gateway.
- `js/rendex-sdk.min.js` — локальная партнёрская SDK-копия.
- `js/rendex-clean-embed.js` — партнёрский embed с отключённым получением рекламных тегов.
- `js/movie.js` — переключение web плееров через gateway.
- `WEB-CLEAN-PLAYER-V39.md` — кратко о clean-player части.

Порядок деплоя: сначала Worker v39, затем файлы сайта v39.
