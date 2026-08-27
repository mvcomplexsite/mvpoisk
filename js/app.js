import { CONFIG } from './config.js?v=11';
import { getMovies, searchMovies } from './api.js?v=11';
import { imageAttrs, bindImageFallbacks } from './images.js?v=11';

const $ = selector => document.querySelector(selector);
const grid = $('#movieGrid');
const notice = $('#statusNotice');
const resultCount = $('#resultCount');
const catalogTitle = $('#catalogTitle');
const pagination = $('#pagination');
const pageIndicator = $('#pageIndicator');

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
  if (error?.status === 401) return 'API отклонил токен. Проверь ключ ПоискКино.';
  if (error?.status === 403) return 'Доступ к этому запросу ограничен тарифом API.';
  if (error?.status === 429) return 'Лимит запросов API на сегодня исчерпан. Попробуй позже.';
  return 'Не удалось получить данные. Проверь соединение и доступность API.';
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
  resultCount.textContent = data?.total ? `${Number(data.total).toLocaleString('ru-RU')} найдено` : `${docs.length} на странице`;
  grid.innerHTML = docs.map(movieCard).join('');
  bindImageFallbacks(grid);
  if (!docs.length) showNotice('Ничего не найдено. Попробуй изменить запрос или фильтры.');

  pagination.hidden = state.pages <= 1;
  pageIndicator.textContent = `${state.page} / ${state.pages}`;
  $('#prevPage').disabled = state.page <= 1;
  $('#nextPage').disabled = state.page >= state.pages || state.page >= 10;
}

let suggestTimer;
$('#searchInput').addEventListener('input', event => {
  clearTimeout(suggestTimer);
  const query = event.target.value.trim();
  const box = $('#suggestions');
  if (query.length < 2) {
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
  }, 380);
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

$('#prevPage').addEventListener('click', () => {
  if (state.page <= 1) return;
  state.page--;
  state.mode === 'search' ? performSearch(state.query, state.page) : loadCatalog();
});

$('#nextPage').addEventListener('click', () => {
  if (state.page >= state.pages || state.page >= 10) return;
  state.page++;
  state.mode === 'search' ? performSearch(state.query, state.page) : loadCatalog();
});

loadCatalog();
