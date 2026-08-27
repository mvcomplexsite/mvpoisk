# MVPoisk v10 — Worker подключён

Подключён Worker: `https://mvpoisk.cizikvpn.workers.dev/players`.

Схема: MVPoisk → Worker → upstream `/api/players` → реальный `iframeUrl` → iframe на странице.

Прямой Kinobox embed удалён, так как он давал Angie 404.

Проверка Worker: `https://mvpoisk.cizikvpn.workers.dev/players?kinopoisk=1309707`.
