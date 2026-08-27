import { CONFIG } from './config.js?v=16';

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

function setCached(url, data, persist = true) {
  memoryCache.set(url, data);
  if (!persist) return;
  try {
    sessionStorage.setItem(cacheKey(url), JSON.stringify({ time: Date.now(), data }));
  } catch {
    // Large catalog batches can exceed browser storage quota. In-memory cache is enough.
  }
}

async function apiFetch(path, params = {}, { cache = true, persistCache = true } = {}) {
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
  if (cache) setCached(urlString, data, persistCache);
  return data;
}

function virtualPageInfo(uiPage, uiPageSize = CONFIG.PAGE_SIZE) {
  const batchSize = CONFIG.API_BATCH_SIZE;
  const pagesPerApiPage = Math.max(1, Math.floor(batchSize / uiPageSize));
  const maxUiPages = CONFIG.API_FREE_PAGE_LIMIT * pagesPerApiPage;
  const safeUiPage = Math.max(1, Math.min(maxUiPages, Number(uiPage) || 1));
  const apiPage = Math.floor((safeUiPage - 1) / pagesPerApiPage) + 1;
  const offset = ((safeUiPage - 1) % pagesPerApiPage) * uiPageSize;
  return { safeUiPage, apiPage, offset, batchSize, maxUiPages };
}

function virtualizeResponse(data, uiPage, uiPageSize, info) {
  const docs = Array.isArray(data?.docs) ? data.docs : [];
  const total = Number(data?.total || docs.length || 0);
  const realUiPages = Math.max(1, Math.ceil(total / uiPageSize));
  const accessiblePages = Math.min(realUiPages, info.maxUiPages);

  return {
    ...data,
    docs: docs.slice(info.offset, info.offset + uiPageSize),
    page: Math.min(uiPage, accessiblePages),
    pages: accessiblePages,
    total,
    apiLimited: realUiPages > accessiblePages,
    realPages: realUiPages,
  };
}

async function fetchVirtual(path, baseParams, uiPage, uiPageSize = CONFIG.PAGE_SIZE) {
  const info = virtualPageInfo(uiPage, uiPageSize);
  const data = await apiFetch(path, {
    ...baseParams,
    page: info.apiPage,
    limit: info.batchSize,
  }, { persistCache: false });
  return virtualizeResponse(data, info.safeUiPage, uiPageSize, info);
}

// Main search results use virtual pagination. Small calls (autocomplete) stay lightweight.
export function searchMovies(query, page = 1, limit = CONFIG.PAGE_SIZE) {
  if (limit === CONFIG.PAGE_SIZE) {
    return fetchVirtual('/movie/search', { query }, page, limit);
  }
  return apiFetch('/movie/search', { query, page, limit });
}

export function getMovie(id) {
  return apiFetch(`/movie/${encodeURIComponent(id)}`);
}

export function getReviews(movieId, limit = 6) {
  return apiFetch('/review', { movieId, page: 1, limit });
}

function movieFilterParams(filters = {}) {
  return {
    'rating.kp': filters.rating ? `${filters.rating}-10` : '6-10',
    'votes.kp': filters.topMode ? '100000-999999999' : '10000-999999999',
    'genres.name': filters.genre || undefined,
    year: filters.year ? `${filters.year}-2035` : undefined,
    isSeries: filters.type === 'series' ? true : filters.type === 'movie' ? false : undefined,
    notNullFields: ['poster.url', 'name'],
    sortField: filters.topMode ? 'rating.kp' : 'votes.kp',
    sortType: '-1',
  };
}

export function getMovies(filters = {}) {
  const params = movieFilterParams(filters);

  // The catalog has no custom limit: use one large legal API page and split it locally.
  if (!filters.limit) {
    return fetchVirtual('/movie', params, filters.page || 1, CONFIG.PAGE_SIZE);
  }

  // Small internal selections such as "similar movies" remain normal lightweight calls.
  return apiFetch('/movie', {
    ...params,
    page: filters.page || 1,
    limit: filters.limit,
  });
}

export function getSimilarMovies(movie) {
  if (Array.isArray(movie.similarMovies) && movie.similarMovies.length) {
    return Promise.resolve({ docs: movie.similarMovies.slice(0, 10) });
  }
  const genre = movie.genres?.[0]?.name;
  if (!genre) return Promise.resolve({ docs: [] });
  return getMovies({ genre, rating: 6, limit: 10 });
}
