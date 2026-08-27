import { CONFIG } from './config.js?v=14';

const memoryCache = new Map();

function cacheKey(url) {
  return `mvpoisk:${url}`;
}

function getCached(url) {
  if (memoryCache.has(url)) return memoryCache.get(url);
  try {
    const raw = sessionStorage.getItem(cacheKey(url));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (Date.now() - cached.time > CONFIG.CACHE_TTL_MS) {
      sessionStorage.removeItem(cacheKey(url));
      return null;
    }
    memoryCache.set(url, cached.data);
    return cached.data;
  } catch {
    return null;
  }
}

function setCached(url, data) {
  memoryCache.set(url, data);
  try {
    sessionStorage.setItem(cacheKey(url), JSON.stringify({ time: Date.now(), data }));
  } catch {
    // Storage may be disabled; in-memory cache is enough.
  }
}

async function apiFetch(path, params = {}, { cache = true } = {}) {
  const url = new URL(`${CONFIG.API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === '' || value === null || value === undefined) return;
    if (Array.isArray(value)) value.forEach(item => url.searchParams.append(key, item));
    else url.searchParams.set(key, String(value));
  });

  const urlString = url.toString();
  if (cache) {
    const cached = getCached(urlString);
    if (cached) return cached;
  }

  const response = await fetch(urlString, {
    headers: { 'X-API-KEY': CONFIG.API_KEY },
  });

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body.message || body.error || '';
    } catch {}
    const error = new Error(detail || `API error ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  if (cache) setCached(urlString, data);
  return data;
}

export function searchMovies(query, page = 1, limit = 12) {
  return apiFetch('/movie/search', { query, page, limit });
}

export function getMovie(id) {
  return apiFetch(`/movie/${encodeURIComponent(id)}`);
}

export function getReviews(movieId, limit = 6) {
  return apiFetch('/review', { movieId, page: 1, limit });
}

export function getMovies(filters = {}) {
  const params = {
    page: filters.page || 1,
    limit: filters.limit || CONFIG.PAGE_SIZE,
    'rating.kp': filters.rating ? `${filters.rating}-10` : '6-10',
    'votes.kp': filters.topMode ? '100000-999999999' : '10000-999999999',
    'genres.name': filters.genre || undefined,
    year: filters.year ? `${filters.year}-2035` : undefined,
    isSeries: filters.type === 'series' ? true : filters.type === 'movie' ? false : undefined,
    notNullFields: ['poster.url', 'name'],
    sortField: filters.topMode ? 'rating.kp' : 'votes.kp',
    sortType: '-1',
  };
  return apiFetch('/movie', params);
}

export function getSimilarMovies(movie) {
  if (Array.isArray(movie.similarMovies) && movie.similarMovies.length) {
    return Promise.resolve({ docs: movie.similarMovies.slice(0, 10) });
  }
  const genre = movie.genres?.[0]?.name;
  if (!genre) return Promise.resolve({ docs: [] });
  return getMovies({ genre, rating: 6, limit: 10 });
}
