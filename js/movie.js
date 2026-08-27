import { getMovie, getReviews, getSimilarMovies } from './api.js?v=7';
import { CONFIG, getWatchUrl } from './config.js?v=7';
import { imageUrl, imageAttrs, bindImageFallbacks } from './images.js?v=7';

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
let playerProtectedMode = true;
let activePlayerFrame = null;
let activePlayerSources = [];
let activeSourceIndex = 0;

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

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function normalizePlayerPayload(payload) {
  let rows = [];
  if (Array.isArray(payload)) rows = payload;
  else if (Array.isArray(payload?.data)) rows = payload.data;
  else if (Array.isArray(payload?.sources)) rows = payload.sources;

  return rows
    .filter(item => item && item.success !== false)
    .map((item, index) => {
      const translations = Array.isArray(item.translations) ? item.translations : [];
      const direct = safeHttpUrl(item.iframeUrl || item.iframe_url || item.url);
      const translated = translations.map(t => safeHttpUrl(t?.iframeUrl || t?.iframe_url || t?.url)).find(Boolean) || '';
      const iframeUrl = direct || translated;
      const source = String(item.source || item.type || item.name || `Источник ${index + 1}`);
      const quality = translations.map(t => t?.quality).find(Boolean) || item.quality || '';
      return { source, iframeUrl, quality, translations };
    })
    .filter(item => item.iframeUrl);
}

function playerSearchCandidates(movie) {
  const candidates = [];
  const push = (key, value, label) => {
    const v = String(value ?? '').trim();
    if (!v) return;
    if (candidates.some(item => item.key === key && item.value === v)) return;
    candidates.push({ key, value: v, label });
  };

  push('kinopoisk', movie.id, `KinoPoisk ID ${movie.id}`);
  push('imdb', movie.externalId?.imdb, `IMDb ${movie.externalId?.imdb || ''}`);
  push('tmdb', movie.externalId?.tmdb, `TMDB ${movie.externalId?.tmdb || ''}`);
  push('title', movie.name || movie.alternativeName, `название «${movie.name || movie.alternativeName || ''}»`);
  return candidates;
}

function buildPlayerApiUrl(api, candidate) {
  const url = new URL(api.url);
  url.searchParams.set(candidate.key, candidate.value);
  return url.toString();
}

async function fetchJsonWithTimeout(url, timeoutMs = CONFIG.PLAYER_API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPlayerSources(api, candidate) {
  const targetUrl = buildPlayerApiUrl(api, candidate);
  const routes = [
    { name: 'напрямую', url: targetUrl },
    ...(CONFIG.PLAYER_CORS_PROXIES || []).map(proxy => ({
      name: `через ${proxy.name}`,
      url: proxy.build(targetUrl),
    })),
  ];

  const attempts = routes.map(async route => {
    const payload = await fetchJsonWithTimeout(route.url);
    const sources = normalizePlayerPayload(payload);
    if (!sources.length) throw new Error('источники не найдены');
    return { sources, route: route.name };
  });

  try {
    return await Promise.any(attempts);
  } catch (aggregate) {
    const details = (aggregate?.errors || []).map(err => err?.name === 'AbortError' ? 'таймаут' : (err?.message || 'ошибка сети'));
    throw new Error(details.join(' / ') || 'ошибка сети');
  }
}

function hardenIframe(iframe) {
  if (!(iframe instanceof HTMLIFrameElement)) return;
  iframe.allowFullscreen = true;
  iframe.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  if (playerProtectedMode) {
    // No allow-popups / allow-top-navigation: common popup and tab ads are blocked.
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-presentation');
  } else {
    iframe.removeAttribute('sandbox');
  }
}

function sourceButtonLabel(source, index) {
  const quality = source.quality ? ` • ${source.quality}` : '';
  return `${index + 1}. ${source.source}${quality}`;
}

function showPlayerSource(index) {
  const container = document.querySelector('#kinoboxPlayer');
  if (!container || !activePlayerSources[index]) return;
  activeSourceIndex = index;
  const source = activePlayerSources[index];

  container.querySelectorAll('.mv-player-source').forEach((button, buttonIndex) => {
    button.classList.toggle('is-active', buttonIndex === index);
    button.setAttribute('aria-pressed', buttonIndex === index ? 'true' : 'false');
  });

  const frameHost = container.querySelector('.mv-player-frame-host');
  if (!frameHost) return;
  frameHost.innerHTML = '';

  const iframe = document.createElement('iframe');
  iframe.className = 'mv-player-frame';
  iframe.src = source.iframeUrl;
  iframe.title = `Плеер ${source.source}`;
  iframe.loading = 'eager';
  hardenIframe(iframe);
  frameHost.appendChild(iframe);
  activePlayerFrame = iframe;

  setPlayerSourceLabel(`Источник: ${source.source} • ${playerProtectedMode ? 'защита от pop-up включена' : 'режим совместимости'}`);
}

function renderPlayerSources(sources) {
  const container = document.querySelector('#kinoboxPlayer');
  if (!container) return;
  activePlayerSources = sources;
  activeSourceIndex = 0;

  container.innerHTML = `
    <div class="mv-player-toolbar" aria-label="Источники просмотра">
      ${sources.map((source, index) => `<button class="mv-player-source${index === 0 ? ' is-active' : ''}" type="button" aria-pressed="${index === 0 ? 'true' : 'false'}" data-player-index="${index}">${esc(sourceButtonLabel(source, index))}</button>`).join('')}
    </div>
    <div class="mv-player-frame-host"></div>`;

  container.querySelectorAll('.mv-player-source').forEach(button => {
    button.addEventListener('click', () => showPlayerSource(Number(button.dataset.playerIndex)));
  });
  showPlayerSource(0);
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
  container.innerHTML = '';
  setPlayerState('loading', 'Ищем доступные источники просмотра…');
  setPlayerSourceLabel('');
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const errors = [];
  let selectedApi = null;
  let selectedCandidate = null;
  let selectedRoute = null;
  let sources = null;
  const candidates = playerSearchCandidates(movie);

  outer:
  for (const candidate of candidates) {
    for (const api of CONFIG.PLAYER_APIS) {
      setPlayerState('loading', `Ищем по ${candidate.label}: ${api.name}…`);
      try {
        const result = await fetchPlayerSources(api, candidate);
        if (result.sources.length) {
          selectedApi = api;
          selectedCandidate = candidate;
          selectedRoute = result.route;
          sources = result.sources;
          break outer;
        }
      } catch (error) {
        const reason = error?.message || 'ошибка сети';
        errors.push(`${api.name}/${candidate.key}: ${reason}`);
        console.warn('MVPoisk player API failed:', api.url, candidate, error);
      }
    }
  }

  if (!sources?.length) {
    setPlayerState('error', 'Не удалось получить список плееров. Попробовали KinoPoisk ID и резервные идентификаторы. Ссылка на GGpoisk остаётся ниже.');
    setPlayerSourceLabel(errors.slice(-4).join(' • '));
    button?.removeAttribute('aria-busy');
    button?.classList.remove('is-loading');
    playerInitStarted = false;
    return;
  }

  renderPlayerSources(sources);
  setPlayerState('ready', '');
  setPlayerSourceLabel(`${selectedApi.name} • ${selectedCandidate.label} • ${selectedRoute}: найдено ${sources.length} • защита от pop-up включена`);
  button?.removeAttribute('aria-busy');
  button?.classList.remove('is-loading');
  if (button) button.textContent = '▶ Плеер открыт';
  if (compatibilityButton) compatibilityButton.hidden = false;
}

function enableCompatibilityMode() {
  const button = document.querySelector('#compatibilityButton');
  if (!activePlayerFrame || !playerProtectedMode) return;

  playerProtectedMode = false;
  const src = activePlayerFrame.src;
  activePlayerFrame.removeAttribute('sandbox');
  setPlayerSourceLabel(`Источник: ${activePlayerSources[activeSourceIndex]?.source || 'плеер'} • режим совместимости • защита от pop-up отключена`);
  if (button) {
    button.textContent = 'Режим совместимости включён';
    button.disabled = true;
  }

  if (src) {
    activePlayerFrame.src = 'about:blank';
    requestAnimationFrame(() => { activePlayerFrame.src = src; });
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
