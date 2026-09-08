# MVPoisk v40 — Cloudflare Accounts + Web Clean Player Gateway

v40 сохраняет Cloudflare D1 + Telegram Accounts из v37/v38 и меняет только web-путь плееров (ПК/телефон).

Что нового:

- Rendex SDK хранится локально в `js/rendex-sdk.min.js`, чтобы страница не зависела от загрузки SDK с `graphicslab.io`.
- Для web основной iframe проходит через `/player/rendex/frame` на нашем Worker.
- В разрешённой партнёром копии `embed.js` функция `fetchAdTags()` возвращает нулевые `preroll/midroll/postroll`, остальная логика контента/серий/озвучек не менялась.
- Clean-frame дополнительно блокирует известные VAST/ad network запросы и popup/top-navigation.
- Kinobox сначала пробует получить список источников через Worker; если upstream не отвечает Cloudflare, MVPoisk автоматически возвращается к проверенной браузерной Kinobox-интеграции, чтобы запасной просмотр не оставался сломанным.
- Android TV оставлен на прежней ветке, чтобы не ломать текущий APK.

Основные файлы:

- `worker/worker.js` — Worker v40: PoiskKino key pool + Telegram/D1 + clean player gateway.
- `js/rendex-sdk.min.js` — локальная партнёрская SDK-копия.
- `js/rendex-clean-embed.js` — партнёрский embed с отключённым получением рекламных тегов.
- `js/movie.js` — переключение web плееров через gateway.
- `WEB-CLEAN-PLAYER-V40.md` — изменения recovery-ветки clean-player.

Порядок деплоя: сначала Worker v40, затем файлы сайта v40. Если clean Rendex не проходит партнёрские проверки домена/подписи, frontend автоматически возвращает оригинальный рабочий iframe; это fallback для доступности, а не гарантия отсутствия рекламы в fallback-режиме.
