import { CONFIG } from './config.js?v=34';
import { getMovies, searchMovies } from './api.js?v=34';
import { imageAttrs, bindImageFallbacks } from './images.js?v=34';
import { getContinueWatching, dismissContinue } from './storage.js?v=34';

const $ = selector => document.querySelector(selector);
const grid = $('#movieGrid');
const notice = $('#statusNotice');
const resultCount = $('#resultCount');
const catalogTitle = $('#catalogTitle');
const pagination = $('#pagination');
const pageIndicator = $('#pageIndicator');
const paginationPages = $('#paginationPages');
const continueSection = $('#continueSection');
const continueRow = $('#continueRow');

function continueContext(item) {
  const season = Number(item?.progress?.season);
  const episode = Number(item?.progress?.episode);
  if (item?.isSeries && season > 0 && episode > 0) return `${season} сезон, ${episode} серия`;
  if (item?.isSeries) return 'Продолжить сериал';
  return 'Продолжить фильм';
}

function continueCard(item) {
  const title = item.name || item.alternativeName || 'Без названия';
  const posters = [item.poster?.url, item.poster?.previewUrl].filter(Boolean);
  const artwork = imageAttrs(posters, { width: 560 });
  const percent = Number(item?.progress?.percent);
  const hasProgress = Number.isFinite(percent) && percent > 0 && percent < 1;
  return `<article class="continue-card">
    <a class="continue-link" href="movie.html?id=${encodeURIComponent(item.id)}" aria-label="Продолжить: ${escapeHtml(title)}">
      <div class="continue-art">
        <div class="poster-fallback">MV</div>
        ${artwork ? `<img ${artwork} alt="${escapeHtml(title)}" loading="lazy" decoding="async">` : ''}
        <span class="continue-play" aria-hidden="true">▶</span>
        ${hasProgress ? `<span class="continue-progress"><i style="width:${Math.round(percent * 100)}%"></i></span>` : ''}
      </div>
      <div class="continue-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(continueContext(item))}</span></div>
    </a>
    <button class="continue-dismiss" type="button" data-continue-dismiss="${item.id}" aria-label="Убрать ${escapeHtml(title)} из «Смотреть дальше»">×</button>
  </article>`;
}

function renderContinueWatching() {
  if (!continueSection || !continueRow) return;
  const items = getContinueWatching(12);
  continueSection.hidden = items.length === 0;
  continueRow.innerHTML = items.map(continueCard).join('');
  bindImageFallbacks(continueRow);
}

continueRow?.addEventListener('click', event => {
  const button = event.target.closest('[data-continue-dismiss]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  dismissContinue(button.dataset.continueDismiss);
  renderContinueWatching();
});

window.addEventListener('mvpoisk:storage-changed', renderContinueWatching);
window.addEventListener('storage', renderContinueWatching);

const state = {
  mode: 'catalog',
  query: '',
  page: 1,
  pages: 1,
  filters: { type: 'all', genre: '', year: '', rating: '', topMode: false },
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
  }[ch]));
}

function scoreClass(score) {
  if (!score) return 'rating-muted';
  if (score >= 7.5) return 'rating-high';
  if (score >= 6) return 'rating-mid';
  return 'rating-low';
}

function posterUrls(movie) {
  return [movie.poster?.url, movie.poster?.previewUrl].filter(Boolean);
}


function movieCard(movie) {
  const title = movie.name || movie.alternativeName || 'Без названия';
  const score = Number(movie.rating?.kp || 0);
  const genres = (movie.genres || []).slice(0, 2).map(g => g.name).join(' • ');
  const type = movie.isSeries || /series/i.test(movie.type || '') ? 'Сериал' : 'Фильм';
  const artwork = imageAttrs(posterUrls(movie), { width: 520 });
  return `
    <a class="movie-card" href="movie.html?id=${encodeURIComponent(movie.id)}" aria-label="${escapeHtml(title)}">
      <div class="poster-wrap">
        <div class="poster-fallback">MV</div>
        ${artwork ? `<img ${artwork} alt="Постер: ${escapeHtml(title)}" loading="lazy" decoding="async">` : ''}
        <span class="rating-pill ${scoreClass(score)}">${score ? score.toFixed(1) : '—'}</span>
        <span class="type-pill">${type}</span>
      </div>
      <div class="card-copy">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml([movie.year, genres].filter(Boolean).join(' • '))}</p>
      </div>
    </a>`;
}

function skeletons(count = 10) {
  grid.innerHTML = Array.from({ length: count }, () => `
    <div class="movie-card skeleton-card" aria-hidden="true">
      <div class="poster-wrap skeleton"></div>
      <div class="skeleton-line skeleton"></div>
      <div class="skeleton-line small skeleton"></div>
    </div>`).join('');
}

function showNotice(text, kind = '') {
  notice.hidden = !text;
  notice.className = `notice ${kind}`;
  notice.textContent = text;
}

function friendlyError(error) {
  if (error?.status === 401) return 'Источник данных временно недоступен. Попробуй немного позже.';
  if (error?.status === 403 || error?.status === 429) return 'Лимит источника данных временно достигнут. Закэшированные страницы продолжат работать, новые запросы восстановятся позже.';
  if (error?.name === 'AbortError') return 'Источник данных отвечает слишком долго. Попробуй ещё раз.';
  return 'Не удалось получить данные. MVPoisk попробует использовать сохранённую копию, если она есть.';
}

async function loadCatalog() {
  state.mode = 'catalog';
  skeletons();
  showNotice('');
  catalogTitle.textContent = state.filters.topMode ? 'Топ по рейтингу' : 'Популярное кино';

  try {
    const data = await getMovies({ ...state.filters, page: state.page });
    renderResults(data);
  } catch (error) {
    grid.innerHTML = '';
    showNotice(friendlyError(error), 'notice-error');
    console.error(error);
  }
}

async function performSearch(query, page = 1) {
  const clean = query.trim();
  if (!clean) return loadCatalog();
  state.mode = 'search';
  state.query = clean;
  state.page = page;
  skeletons();
  showNotice('');
  catalogTitle.textContent = `Результаты: «${clean}»`;
  document.querySelector('#discover').scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const data = await searchMovies(clean, page, CONFIG.PAGE_SIZE);
    renderResults(data);
  } catch (error) {
    grid.innerHTML = '';
    showNotice(friendlyError(error), 'notice-error');
    console.error(error);
  }
}

function renderResults(data) {
  const docs = Array.isArray(data?.docs) ? data.docs : [];
  state.pages = Math.max(1, Number(data?.pages || 1));
  state.page = Number(data?.page || state.page || 1);
  resultCount.textContent = data?.total ? `${Number(data.total).toLocaleString('ru-RU')} найдено${data.apiLimited ? ` • доступно ${data.pages} стр.` : ''}` : `${docs.length} на странице`;
  if (data?._mvpoiskStale) showNotice('Показываем последнюю сохранённую версию — источник данных сейчас временно недоступен.', 'notice-soft');
  grid.innerHTML = docs.map(movieCard).join('');
  bindImageFallbacks(grid);
  if (!docs.length) showNotice('Ничего не найдено. Попробуй изменить запрос или фильтры.');

  renderPagination();
}

function renderPagination() {
  pagination.hidden = state.pages <= 1;
  if (state.pages <= 1) return;

  pageIndicator.textContent = `${state.page} / ${state.pages}`;
  $('#firstPage').disabled = state.page <= 1;
  $('#prevPage').disabled = state.page <= 1;
  $('#nextPage').disabled = state.page >= state.pages;
  $('#lastPage').disabled = state.page >= state.pages;

  // Показываем компактное окно вокруг текущей страницы, не создавая сотни кнопок.
  const visible = new Set([1, state.pages]);
  for (let page = Math.max(1, state.page - 2); page <= Math.min(state.pages, state.page + 2); page++) {
    visible.add(page);
  }
  const pages = [...visible].sort((a, b) => a - b);
  const chunks = [];
  let previous = null;

  for (const page of pages) {
    if (previous !== null && page - previous > 1) {
      chunks.push('<span class="pagination-ellipsis" aria-hidden="true">…</span>');
    }
    chunks.push(`<button type="button" class="pagination-number${page === state.page ? ' active' : ''}" data-page="${page}"${page === state.page ? ' aria-current="page"' : ''}>${page}</button>`);
    previous = page;
  }
  paginationPages.innerHTML = chunks.join('');
}

async function goToPage(page) {
  const target = Math.min(state.pages, Math.max(1, Number(page) || 1));
  if (target === state.page) return;
  state.page = target;
  if (state.mode === 'search') await performSearch(state.query, target);
  else await loadCatalog();
  document.querySelector('#discover')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let suggestTimer;
$('#searchInput').addEventListener('input', event => {
  clearTimeout(suggestTimer);
  const query = event.target.value.trim();
  const box = $('#suggestions');
  if (query.length < 3) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  suggestTimer = setTimeout(async () => {
    try {
      const data = await searchMovies(query, 1, 6);
      const docs = data.docs || [];
      if (!docs.length) { box.hidden = true; return; }
      box.innerHTML = docs.map(movie => `
        <a href="movie.html?id=${movie.id}" class="suggestion-row">
          <span class="suggestion-fallback">MV</span>
          ${posterUrls(movie).length ? `<img ${imageAttrs(posterUrls(movie), { width: 120 })} alt="" loading="lazy" decoding="async">` : ''}
          <span><strong>${escapeHtml(movie.name || movie.alternativeName || 'Без названия')}</strong><small>${escapeHtml([movie.year, movie.rating?.kp ? `КП ${Number(movie.rating.kp).toFixed(1)}` : ''].filter(Boolean).join(' • '))}</small></span>
        </a>`).join('');
      bindImageFallbacks(box);
      box.hidden = false;
    } catch {
      box.hidden = true;
    }
  }, 700);
});

document.addEventListener('click', event => {
  if (!event.target.closest('.search-area')) $('#suggestions').hidden = true;
});

$('#searchForm').addEventListener('submit', event => {
  event.preventDefault();
  $('#suggestions').hidden = true;
  performSearch($('#searchInput').value, 1);
});

document.querySelectorAll('[data-search]').forEach(button => {
  button.addEventListener('click', () => {
    $('#searchInput').value = button.dataset.search;
    performSearch(button.dataset.search, 1);
  });
});

$('#filterForm').addEventListener('submit', event => {
  event.preventDefault();
  state.page = 1;
  state.filters = {
    type: $('#typeFilter').value,
    genre: $('#genreFilter').value,
    year: $('#yearFilter').value,
    rating: $('#ratingFilter').value,
    topMode: state.filters.topMode,
  };
  loadCatalog();
});

$('#resetFilters').addEventListener('click', () => {
  $('#filterForm').reset();
  state.page = 1;
  state.filters = { type: 'all', genre: '', year: '', rating: '', topMode: false };
  loadCatalog();
});

document.querySelectorAll('[data-quick-filter]').forEach(button => {
  button.addEventListener('click', () => {
    const action = button.dataset.quickFilter;
    $('#filterForm').reset();
    state.page = 1;
    state.filters = { type: 'all', genre: '', year: '', rating: '', topMode: false };
    if (action === 'series') {
      state.filters.type = 'series';
      $('#typeFilter').value = 'series';
    }
    if (action === 'top') {
      state.filters.rating = '8';
      state.filters.topMode = true;
      $('#ratingFilter').value = '8';
    }
    loadCatalog();
    $('#discover').scrollIntoView({ behavior: 'smooth' });
  });
});

$('#firstPage').addEventListener('click', () => goToPage(1));
$('#prevPage').addEventListener('click', () => goToPage(state.page - 1));
$('#nextPage').addEventListener('click', () => goToPage(state.page + 1));
$('#lastPage').addEventListener('click', () => goToPage(state.pages));

paginationPages.addEventListener('click', event => {
  const button = event.target.closest('[data-page]');
  if (!button) return;
  goToPage(Number(button.dataset.page));
});

renderContinueWatching();
loadCatalog();
