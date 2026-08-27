# MVPoisk v5

Статический кино-каталог для GitHub Pages.

## Что есть

- каталог, поиск и фильтры через ПоискКино API;
- отдельные страницы фильмов/сериалов с оригинальным KinoPoisk ID;
- постеры с fallback-цепочкой;
- отзывы, актёры, похожие фильмы;
- встроенный просмотр по KinoPoisk ID;
- локальная копия `js/kinobox.js`, поэтому блокировщик не может отрезать сам bootstrap-скрипт по стороннему домену;
- автоматический fallback плеера: сначала партнёрский endpoint `https://fbhdplay.top/api/players`, затем документированный Kinobox `https://kinobox.tv/api/players`;
- верхний iframe плеера запускается в защищённом sandbox без `allow-popups` и без разрешения top-navigation;
- если конкретный видеобалансер не работает в sandbox, есть ручная кнопка «Режим совместимости»;
- резервная ссылка на GGpoisk остаётся доступной.

## Просмотр

Локальный `kinobox.js` выполняет запрос к `${baseUrl}/api/players?kinopoisk=ID`, получает доступные `iframeUrl` и выводит выбранный плеер.

Защищённый режим не гарантирует отсутствие встроенной рекламы внутри самого видеобалансера. Он блокирует pop-up / попытки верхнеуровневой навигации из верхнего iframe, а сетевую рекламу дополнительно может фильтровать AdGuard.

## GitHub Pages

Загрузите содержимое папки в корень репозитория и включите:

Settings → Pages → Deploy from a branch → main → /(root)

## v6 player change

The embedded player no longer relies on the uploaded Kinobox bootstrap script to decide whether a backend succeeded. MVPoisk queries `/api/players?kinopoisk=<id>` itself, validates real `iframeUrl` values, renders its own source selector, and only then creates the iframe. Endpoints are tried in order: partner backend, then the documented Kinobox endpoint `https://kinobox.tv/api/players`.


## v7 player fallback
- Direct and AllOrigins-proxied player-discovery requests run in parallel.
- Only the small JSON list of iframe URLs is proxied; video traffic is not proxied.
- Search falls back from KinoPoisk ID to IMDb, TMDB and title when available.
- All HTML and ES-module URLs are cache-busted with v=7 to avoid stale browser copies.
- Each discovery request has a hard timeout.
