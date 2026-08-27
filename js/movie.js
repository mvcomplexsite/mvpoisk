import { getMovie, getReviews, getSimilarMovies } from './api.js?v=10';
import { CONFIG, getWatchUrl } from './config.js?v=10';
import { imageUrl, imageAttrs, bindImageFallbacks } from './images.js?v=10';

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


let playerInitStarted = false;
let playerProtectionEnabled = false;
let activePlayerUrl = '';
let activePlayerLabel = '';
let playerLoadTimer = null;
let availablePlayers = [];

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

function withTimeout(promise, ms = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: promise(controller.signal).finally(() => clearTimeout(timer)) };
}

function normalizePlayers(payload) {
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.players)
        ? payload.players
        : [];

  return raw.map((item, index) => {
    const translations = Array.isArray(item?.translations) ? item.translations : [];
    const fallbackTranslation = translations.find(t => t?.iframeUrl) || translations[0];
    return {
      source: String(item?.source || item?.type || `Источник ${index + 1}`),
      iframeUrl: String(item?.iframeUrl || fallbackTranslation?.iframeUrl || ''),
      translations,
      success: item?.success !== false,
    };
  }).filter(item => item.success && /^https?:\/\//i.test(item.iframeUrl));
}

function playerProxyUrl(movie) {
  const configured = String(CONFIG.PLAYER_PROXY_URL || '').trim();
  if (!configured) return null;
  const url = new URL(configured, location.href);
  url.searchParams.set('kinopoisk', String(movie.id));
  if (movie.externalId?.imdb) url.searchParams.set('imdb', String(movie.externalId.imdb));
  if (movie.externalId?.tmdb) url.searchParams.set('tmdb', String(movie.externalId.tmdb));
  if (movie.name || movie.alternativeName) url.searchParams.set('title', String(movie.name || movie.alternativeName));
  return url;
}

async function fetchPlayersViaProxy(movie) {
  const url = playerProxyUrl(movie);
  if (!url) return [];

  const request = withTimeout(signal => fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  }), 14000);
  const response = await request.done;
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok) {
    const details = Array.isArray(payload?.details) ? `: ${payload.details.join(' • ')}` : '';
    throw new Error(`Player proxy HTTP ${response.status}${details}`);
  }
  const players = normalizePlayers(payload);
  if (!players.length) {
    const details = Array.isArray(payload?.details) ? `: ${payload.details.join(' • ')}` : '';
    throw new Error(`Player proxy returned no playable sources${details}`);
  }
  setPlayerSourceLabel(`MVPoisk proxy • upstream: ${payload?.upstream || 'unknown'} • найдено источников: ${players.length}`);
  return players;
}

function makePlayerFrame(url) {
  const frame = document.createElement('iframe');
  frame.className = 'mv-player-frame';
  frame.src = url;
  frame.allowFullscreen = true;
  frame.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
  frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  if (playerProtectionEnabled) {
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-presentation');
  }
  return frame;
}

function markFrameLoading(label) {
  clearTimeout(playerLoadTimer);
  setPlayerState('loading', `Загружаем ${label}…`);
  playerLoadTimer = setTimeout(() => {
    const shell = document.querySelector('#playerShell');
    if (shell?.dataset.state === 'loading') {
      setPlayerState('error', 'Плеер не ответил. Попробуйте другой источник или резервную ссылку ниже.');
      setPlayerSourceLabel(`${label} • таймаут загрузки iframe`);
    }
  }, 18000);
}

function renderPlayerFrame(url, label) {
  const host = document.querySelector('#playerFrameHost');
  if (!host || !url) return;
  activePlayerUrl = url;
  activePlayerLabel = label;
  host.innerHTML = '';
  const frame = makePlayerFrame(url);
  markFrameLoading(label);
  frame.addEventListener('load', () => {
    clearTimeout(playerLoadTimer);
    setPlayerState('ready', '');
    setPlayerSourceLabel(`${label} • iframe загружен${playerProtectionEnabled ? ' • защита от pop-up включена' : ' • режим совместимости'}`);
  }, { once: true });
  host.appendChild(frame);
}

function renderPlayerMenu(players) {
  const toolbar = document.querySelector('#playerToolbar');
  if (!toolbar) return;
  toolbar.innerHTML = players.map((player, index) => `
    <button class="mv-player-source${index === 0 ? ' is-active' : ''}" type="button" data-player-index="${index}">${esc(player.source)}</button>
  `).join('');
  toolbar.hidden = players.length < 2;
  toolbar.querySelectorAll('[data-player-index]').forEach(button => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.playerIndex);
      const player = availablePlayers[index];
      if (!player) return;
      toolbar.querySelectorAll('.mv-player-source').forEach(el => el.classList.remove('is-active'));
      button.classList.add('is-active');
      renderPlayerFrame(player.iframeUrl, player.source);
    });
  });
}

function togglePlayerProtection() {
  playerProtectionEnabled = !playerProtectionEnabled;
  const button = document.querySelector('#compatibilityButton');
  if (button) {
    button.textContent = playerProtectionEnabled
      ? 'Отключить защиту (совместимость)'
      : 'Включить защиту от pop-up';
  }
  if (activePlayerUrl) renderPlayerFrame(activePlayerUrl, activePlayerLabel || 'Плеер');
}

async function initEmbeddedPlayer(movie) {
  const section = document.querySelector('#watchSection');
  const button = document.querySelector('#watchButton');
  if (!section) return;

  section.hidden = false;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelector('#compatibilityButton')?.removeAttribute('hidden');

  if (playerInitStarted) return;
  playerInitStarted = true;
  button?.setAttribute('aria-busy', 'true');
  button?.classList.add('is-loading');
  if (button) button.textContent = '▶ Открываем плеер…';

  try {
    if (!String(CONFIG.PLAYER_PROXY_URL || '').trim()) throw new Error('PLAYER_PROXY_URL не настроен');
    setPlayerState('loading', 'Получаем список источников через MVPoisk proxy…');
    availablePlayers = await fetchPlayersViaProxy(movie);
    renderPlayerMenu(availablePlayers);
    renderPlayerFrame(availablePlayers[0].iframeUrl, availablePlayers[0].source);
  } catch (error) {
    console.warn('MVPoisk player proxy failed:', error);
    setPlayerState('error', 'Не удалось получить рабочий плеер через MVPoisk proxy. Резервная ссылка на GGpoisk остаётся ниже.');
    setPlayerSourceLabel(`Proxy: ${error?.message || 'неизвестная ошибка'}`);
  } finally {
    button?.removeAttribute('aria-busy');
    button?.classList.remove('is-loading');
    if (button) button.textContent = '▶ Плеер открыт';
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
          <div class="mv-player-stack" id="kinoboxPlayer">
            <div class="mv-player-toolbar" id="playerToolbar" hidden></div>
            <div class="mv-player-frame-host" id="playerFrameHost"></div>
          </div>
        </div>
        <div class="player-meta-line">
          <span id="playerSourceLabel">По умолчанию используется режим совместимости; защиту от pop-up можно включить вручную.</span>
        </div>
        <div class="player-fallback-actions">
          <button class="secondary-button compatibility-button" id="compatibilityButton" type="button" hidden>Включить защиту от pop-up</button>
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
  document.querySelector('#compatibilityButton')?.addEventListener('click', togglePlayerProtection);

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
