# MVPoisk v9

Статический фронтенд для GitHub Pages.

## Что исправлено

- Подсказки поиска больше не наслаиваются на фильтры и карточки: список находится в нормальном потоке страницы.
- Удалена зависимость от загрузки `kinobox.min.js` в основном сценарии.
- Пока proxy не настроен, «Смотреть» пробует прямой `https://kinobox.tv/embed/#KINOPOISK_ID`.
- Для стабильного получения списка плееров добавлен `worker/worker.js`. Worker делает server-side запрос, поэтому браузерный CORS GitHub Pages больше не мешает.
- Источники выводятся кнопками над плеером; можно переключать балансер.
- Защита iframe от pop-up включается отдельной кнопкой, чтобы не ломать несовместимые плееры.

## Подключение Worker

1. Создать бесплатный Cloudflare Worker.
2. Вставить содержимое `worker/worker.js` и Deploy.
3. Получится адрес вида `https://mvpoisk-player-proxy.<account>.workers.dev`.
4. В `js/config.js` указать:

```js
PLAYER_PROXY_URL: 'https://mvpoisk-player-proxy.<account>.workers.dev/players',
```

5. Залить изменения в GitHub Pages и сделать Ctrl+F5.

Само видео Worker не проксирует — только маленький JSON со списком iframe-источников.
