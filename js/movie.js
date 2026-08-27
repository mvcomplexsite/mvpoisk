import { getMovie, getReviews, getSimilarMovies } from './api.js';
import { CONFIG, getWatchUrl } from './config.js';
import { imageUrl, imageAttrs, bindImageFallbacks } from './images.js';

const root = document.querySelector('#movieRoot');
const params = new URLSearchParams(location.search);
const kpId = params.get('id');

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[ch]));
}
function img(url, width) { return url ? esc(imageUrl(url, { width })) : ''; }
function score(v) { const n = Number(v || 0); return n ? n.toFixed(1) : '—'; }
function scoreClass(v) { const n=Number(v||0); return n>=7.5?'rating-high':n>=6?'rating-mid':n?'rating-low':'rating-muted'; }
function runtime(min) {
  if (!min) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return [h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean).join(' ');
}
function firstText(...values) { return values.find(v => typeof v === 'string' && v.trim()) || ''; }


let playerScriptPromise = null;
let playerInitStarted = false;
let activePlayerInstance = null;
let playerProtectedMode = true;

function loadClassicScript(src) {
  if (playerScriptPromise) return playerScriptPromise;

  playerScriptPromise = new Promise((resolve, reject) => {
    const existing = [...document.scripts].find(script => script.dataset.mvpoiskPlayerScript === src);
    if (existing) {
      if (typeof window.kinobox === 'function') return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Не удалось загрузить локальный скрипт плеера.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.mvpoiskPlayerScript = src;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => {
      script.remove();
      playerScriptPromise = null;
      reject(new Error('Не удалось загрузить локальный скрипт плеера.'));
    }, { once: true });
    document.head.appendChild(script);
  });

  return playerScriptPromise;
}

function setPlayerState(state, message) {
  const shell = document.querySelector('#playerShell');
  const status = document.querySelector('#playerStatus');
  if (!shell || !status) return;
  shell.dataset.state = state;
  status.textContent = message || '';
}

function setPlayerSourceLabel(text = '') {
  const label = document.querySelector('#playerSourceLabel');
  if (label) label.textContent = text;
}

function destroyPlayer(container) {
  try { activePlayerInstance?.$destroy?.(); } catch {}
  activePlayerInstance = null;
  if (container) container.innerHTML = '';
}

function hardenIframe(iframe) {
  if (!(iframe instanceof HTMLIFrameElement)) return;
  iframe.allowFullscreen = true;
  iframe.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  if (playerProtectedMode) {
    // No allow-popups / allow-top-navigation: ads cannot open new tabs or replace MVPoisk.
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-presentation');
  } else {
    iframe.removeAttribute('sandbox');
  }
}

function watchPlayerIframes(container) {
  const apply = () => container.querySelectorAll('iframe').forEach(hardenIframe);
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(container, { childList: true, subtree: true });
  return observer;
}

function hasPlayableData(payload) {
  return Array.isArray(payload?.data) && payload.data.some(item => item?.iframeUrl);
}

function startPlayerAttempt(movie, backend, container) {
  destroyPlayer(container);
  setPlayerSourceLabel(`Подключение: ${backend.name}`);

  return new Promise((resolve, reject) => {
    let settled = false;
    let frameSeen = false;
    const finish = (ok, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      observer.disconnect();
      ok ? resolve(value) : reject(value instanceof Error ? value : new Error(String(value || 'Ошибка плеера')));
    };

    const observer = new MutationObserver(() => {
      const iframe = container.querySelector('iframe');
      if (iframe) {
        frameSeen = true;
        hardenIframe(iframe);
        // The Kinobox UI has already selected a valid iframe URL at this point.
        finish(true, { backend, iframe });
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    const timer = window.setTimeout(() => {
      finish(false, new Error(`${backend.name}: таймаут ответа`));
    }, CONFIG.PLAYER_ATTEMPT_TIMEOUT_MS);

    try {
      activePlayerInstance = window.kinobox('#kinoboxPlayer', {
        baseUrl: backend.url,
        search: { kinopoisk: String(movie.id) },
        events: {
          playerLoaded(payload) {
            if (payload?.error) {
              finish(false, new Error(payload.error.title || `${backend.name}: источник вернул ошибку`));
              return;
            }
            if (!hasPlayableData(payload)) {
              finish(false, new Error(`${backend.name}: видео не найдено`));
              return;
            }
            const iframe = container.querySelector('iframe');
            if (iframe) {
              frameSeen = true;
              hardenIframe(iframe);
              finish(true, { backend, iframe });
            }
          }
        }
      });
    } catch (error) {
      finish(false, error);
    }
  });
}

async function initEmbeddedPlayer(movie) {
  const section = document.querySelector('#watchSection');
  const container = document.querySelector('#kinoboxPlayer');
  const button = document.querySelector('#watchButton');
  const compatibilityButton = document.querySelector('#compatibilityButton');
  if (!section || !container || playerInitStarted) {
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  playerInitStarted = true;
  section.hidden = false;
  button?.setAttribute('aria-busy', 'true');
  button?.classList.add('is-loading');
  setPlayerState('loading', 'Подключаем встроенный просмотр…');
  setPlayerSourceLabel('');
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    await loadClassicScript(CONFIG.PLAYER_SCRIPT_URL);
    if (typeof window.kinobox !== 'function') {
      throw new Error('Локальный Kinobox загружен, но функция запуска недоступна.');
    }

    let lastError = null;
    let result = null;
    for (let i = 0; i < CONFIG.PLAYER_BACKENDS.length; i += 1) {
      const backend = CONFIG.PLAYER_BACKENDS[i];
      setPlayerState('loading', i === 0
        ? `Пробуем ${backend.name.toLowerCase()} источник…`
        : `Первый источник не ответил. Пробуем ${backend.name.toLowerCase()}…`);
      try {
        result = await startPlayerAttempt(movie, backend, container);
        break;
      } catch (error) {
        lastError = error;
        console.warn('MVPoisk player backend failed:', backend.url, error);
      }
    }

    if (!result) throw lastError || new Error('Нет доступных источников.');

    watchPlayerIframes(container);
    setPlayerSourceLabel(`Источник: ${result.backend.name} • защита от pop-up включена`);
    setPlayerState('ready', '');
    button?.removeAttribute('aria-busy');
    button?.classList.remove('is-loading');
    if (button) button.textContent = '▶ Плеер открыт';
    if (compatibilityButton) compatibilityButton.hidden = false;
  } catch (error) {
    console.error('MVPoisk player error:', error);
    destroyPlayer(container);
    setPlayerSourceLabel('');
    setPlayerState('error', 'Не удалось получить встроенный плеер ни от партнёрского, ни от резервного источника. Резервная ссылка на GGpoisk остаётся ниже.');
    button?.removeAttribute('aria-busy');
    button?.classList.remove('is-loading');
    playerInitStarted = false;
  }
}

function enableCompatibilityMode() {
  const container = document.querySelector('#kinoboxPlayer');
  const button = document.querySelector('#compatibilityButton');
  const iframe = container?.querySelector('iframe');
  if (!iframe || !playerProtectedMode) return;

  playerProtectedMode = false;
  const src = iframe.src;
  iframe.removeAttribute('sandbox');
  setPlayerSourceLabel('Режим совместимости • защита от pop-up для плеера отключена');
  if (button) {
    button.textContent = 'Режим совместимости включён';
    button.disabled = true;
  }

  // Reload only the player frame so the relaxed sandbox takes effect.
  if (src) {
    iframe.src = 'about:blank';
    requestAnimationFrame(() => { iframe.src = src; });
  }
}

function personCard(person) {
  return `<div class="person-card">
    <div class="person-photo"><span>MV</span>${person.photo ? `<img ${imageAttrs([person.photo], { width: 320 })} alt="${esc(person.name || person.enName || '')}" loading="lazy" decoding="async">` : ''}</div>
    <strong>${esc(person.name || person.enName || '—')}</strong>
    <small>${esc(person.description || person.profession || '')}</small>
  </div>`;
}

function similarCard(movie) {
  const posters = [movie.poster?.url, movie.poster?.previewUrl].filter(Boolean);
  return `<a class="similar-card" href="movie.html?id=${movie.id}">
    <div><span>MV</span>${posters.length ? `<img ${imageAttrs(posters, { width: 420 })} alt="${esc(movie.name || '')}" loading="lazy" decoding="async">` : ''}</div>
    <strong>${esc(movie.name || movie.alternativeName || 'Без названия')}</strong>
    <small>${esc([movie.year, movie.rating?.kp ? `КП ${score(movie.rating.kp)}` : ''].filter(Boolean).join(' • '))}</small>
  </a>`;
}

function reviewCard(review) {
  const type = String(review.type || '').toLowerCase();
  const label = type.includes('positive') ? 'Положительный' : type.includes('negative') ? 'Отрицательный' : 'Нейтральный';
  const cls = type.includes('positive') ? 'review-positive' : type.includes('negative') ? 'review-negative' : 'review-neutral';
  return `<article class="review-card ${cls}">
    <div class="review-head"><strong>${esc(review.author || 'Пользователь')}</strong><span>${label}</span></div>
    ${review.title ? `<h3>${esc(review.title)}</h3>` : ''}
    <p>${esc(review.review || '').slice(0, 1500)}</p>
  </article>`;
}

function renderMovie(movie) {
  const title = movie.name || movie.alternativeName || 'Без названия';
  const subtitle = movie.alternativeName && movie.alternativeName !== title ? movie.alternativeName : '';
  const posterUrls = [movie.poster?.url, movie.poster?.previewUrl].filter(Boolean);
  const poster = posterUrls[0] || '';
  const backdrop = movie.backdrop?.url || movie.backdrop?.previewUrl || poster;
  const genres = (movie.genres || []).map(g => g.name).join(' • ');
  const countries = (movie.countries || []).map(c => c.name).join(', ');
  const description = firstText(movie.description, movie.shortDescription, 'Описание пока отсутствует.');
  const people = (movie.persons || []).filter(p => ['актеры', 'актер', 'actor'].includes(String(p.profession || '').toLowerCase())).slice(0, 12);
  const meta = [movie.year, genres, runtime(movie.movieLength), movie.ageRating ? `${movie.ageRating}+` : ''].filter(Boolean).join(' • ');
  const watchUrl = getWatchUrl(movie.id);

  document.title = `${title} — MVPoisk`;

  root.innerHTML = `
    <section class="movie-hero" style="--movie-bg: url('${img(backdrop, 1800)}')">
      <div class="movie-backdrop"></div>
      <div class="movie-hero-inner">
        <div class="movie-poster">
          <div class="poster-fallback big">MV</div>
          ${posterUrls.length ? `<img ${imageAttrs(posterUrls, { width: 700 })} alt="Постер: ${esc(title)}" decoding="async">` : ''}
        </div>
        <div class="movie-main-copy">
          <div class="movie-kicker">${movie.isSeries ? 'Сериал' : 'Фильм'} • KinoPoisk ID ${movie.id}</div>
          <h1>${esc(title)}</h1>
          ${subtitle ? `<p class="movie-subtitle">${esc(subtitle)}</p>` : ''}
          <p class="movie-meta">${esc(meta)}</p>
          <div class="movie-ratings">
            <div><span class="rating-box ${scoreClass(movie.rating?.kp)}">${score(movie.rating?.kp)}</span><small>Кинопоиск</small></div>
            <div><span class="rating-box">${score(movie.rating?.imdb)}</span><small>IMDb</small></div>
          </div>
          <p class="movie-description">${esc(description)}</p>
          <div class="movie-actions">
            <button class="watch-button" id="watchButton" type="button">▶ Смотреть</button>
            <a class="secondary-button" href="https://www.kinopoisk.ru/film/${movie.id}/" target="_blank" rel="noopener noreferrer">Кинопоиск ↗</a>
          </div>
        </div>
      </div>
    </section>

    <div class="movie-content">
      <section class="facts-panel">
        <div><span>Год</span><strong>${esc(movie.year || '—')}</strong></div>
        <div><span>Страна</span><strong>${esc(countries || '—')}</strong></div>
        <div><span>Жанры</span><strong>${esc(genres || '—')}</strong></div>
        <div><span>Длительность</span><strong>${esc(runtime(movie.movieLength) || '—')}</strong></div>
        <div><span>KinoPoisk ID</span><strong>${movie.id}</strong></div>
      </section>

      <section class="content-section watch-section" id="watchSection" hidden>
        <div class="section-heading watch-heading">
          <div><span class="eyebrow">Просмотр</span><h2>${movie.isSeries ? 'Смотреть сериал' : 'Смотреть фильм'}</h2></div>
          <span class="player-kp-id">KinoPoisk ID ${movie.id}</span>
        </div>
        <div class="player-shell" id="playerShell" data-state="idle">
          <div class="player-status" id="playerStatus">Нажмите «Смотреть», чтобы загрузить плеер.</div>
          <div class="kinobox" id="kinoboxPlayer" data-kinopoisk="${movie.id}"></div>
        </div>
        <div class="player-meta-line">
          <span id="playerSourceLabel">Защита от pop-up включается автоматически.</span>
        </div>
        <div class="player-fallback-actions">
          <button class="secondary-button compatibility-button" id="compatibilityButton" type="button" hidden>Плеер не запускается? Режим совместимости</button>
          <a class="secondary-button" href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer">Открыть на GGpoisk ↗</a>
        </div>
      </section>


      ${people.length ? `<section class="content-section"><div class="section-heading"><div><span class="eyebrow">В ролях</span><h2>Актёры</h2></div></div><div class="people-row">${people.map(personCard).join('')}</div></section>` : ''}

      <section class="content-section" id="reviewsSection" hidden>
        <div class="section-heading"><div><span class="eyebrow">Мнения зрителей</span><h2>Отзывы</h2></div></div>
        <div class="reviews-grid" id="reviewsGrid"></div>
      </section>

      <section class="content-section" id="similarSection" hidden>
        <div class="section-heading"><div><span class="eyebrow">Ещё по теме</span><h2>Похожие фильмы</h2></div></div>
        <div class="similar-row" id="similarGrid"></div>
      </section>
    </div>`;

  bindImageFallbacks(root);

  document.querySelector('#watchButton')?.addEventListener('click', () => initEmbeddedPlayer(movie));
  document.querySelector('#compatibilityButton')?.addEventListener('click', enableCompatibilityMode);

  if (location.hash === '#watch') {
    window.setTimeout(() => initEmbeddedPlayer(movie), 100);
  }
}


async function loadExtras(movie) {
  const [reviewsResult, similarResult] = await Promise.allSettled([
    getReviews(movie.id, 6),
    getSimilarMovies(movie),
  ]);

  if (reviewsResult.status === 'fulfilled') {
    const reviews = reviewsResult.value?.docs || [];
    if (reviews.length) {
      document.querySelector('#reviewsGrid').innerHTML = reviews.map(reviewCard).join('');
      document.querySelector('#reviewsSection').hidden = false;
    }
  }

  if (similarResult.status === 'fulfilled') {
    const movies = (similarResult.value?.docs || []).filter(m => Number(m.id) !== Number(movie.id)).slice(0, 10);
    if (movies.length) {
      document.querySelector('#similarGrid').innerHTML = movies.map(similarCard).join('');
      bindImageFallbacks(document.querySelector('#similarGrid'));
      document.querySelector('#similarSection').hidden = false;
    }
  }
}

async function init() {
  if (!kpId || !/^\d+$/.test(kpId)) {
    root.innerHTML = `<div class="page-error"><h1>Некорректный KinoPoisk ID</h1><p>Открой фильм из каталога MVPoisk.</p><a href="./">На главную</a></div>`;
    return;
  }

  try {
    const movie = await getMovie(kpId);
    renderMovie(movie);
    loadExtras(movie);
  } catch (error) {
    console.error(error);
    const text = error?.status === 404 ? 'Фильм с таким KinoPoisk ID не найден.' : error?.status === 429 ? 'Лимит запросов API исчерпан.' : 'Не удалось загрузить страницу фильма.';
    root.innerHTML = `<div class="page-error"><h1>${esc(text)}</h1><p>KinoPoisk ID: ${esc(kpId)}</p><a href="./">Вернуться в каталог</a></div>`;
  }
}

init();
