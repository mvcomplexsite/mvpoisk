import { CONFIG } from './config.js?v=31';

const memoryCache = new Map();
const fallbackMemory = new Map();

function cacheKey(url) {
  return `mvpoisk:api:${url}`;
}

function fallbackKey(path, params, uiPage, uiPageSize) {
  const stable = Object.entries(params || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  return `mvpoisk:page:${path}:${JSON.stringify(stable)}:${uiPage}:${uiPageSize}`;
}

function readLocal(key, maxAge) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || typeof cached.time !== 'number') return null;
    if (Date.now() - cached.time > maxAge) return null;
    return cached.data;
  } catch {
    return null;
  }
}

function writeLocal(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ time: Date.now(), data }));
  } catch {
    // Storage can be full on mobile browsers. Worker cache still remains.
  }
}

function getFreshCached(url) {
  const hit = memoryCache.get(url);
  if (hit && Date.now() - hit.time <= CONFIG.CACHE_TTL_MS) return hit.data;
  const data = readLocal(cacheKey(url), CONFIG.CACHE_TTL_MS);
  if (data) memoryCache.set(url, { time: Date.now(), data });
  return data;
}

function getStaleCached(url) {
  const hit = memoryCache.get(url);
  if (hit && Date.now() - hit.time <= CONFIG.STALE_CACHE_TTL_MS) return hit.data;
  return readLocal(cacheKey(url), CONFIG.STALE_CACHE_TTL_MS);
}

function setCached(url, data, persist = true) {
  memoryCache.set(url, { time: Date.now(), data });
  if (persist) writeLocal(cacheKey(url), data);
}

function buildUrl(path, params = {}) {
  const url = new URL(`${CONFIG.API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === '' || value === null || value === undefined) return;
    if (Array.isArray(value)) value.forEach(item => url.searchParams.append(key, item));
    else url.searchParams.set(key, String(value));
  });
  return url;
}

async function apiFetch(path, params = {}, { cache = true, persistCache = true, timeoutMs = 15000 } = {}) {
  const url = buildUrl(path, params);
  const urlString = url.toString();

  if (cache) {
    const cached = getFreshCached(urlString);
    if (cached) return cached;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(urlString, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = body.message || body.error || body.details || '';
        if (Array.isArray(detail)) detail = detail.join(' • ');
        else if (typeof detail === 'object') detail = JSON.stringify(detail);
      } catch {}
      const error = new Error(detail || `API error ${response.status}`);
      error.status = response.status;
      error.cacheState = response.headers.get('X-MVPoisk-Cache') || '';
      throw error;
    }

    const data = await response.json();
    if (cache) setCached(urlString, data, persistCache);
    return data;
  } catch (error) {
    if (cache) {
      const stale = getStaleCached(urlString);
      if (stale) return { ...stale, _mvpoiskStale: true };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
  const key = fallbackKey(path, baseParams, info.safeUiPage, uiPageSize);

  try {
    const data = await apiFetch(path, {
      ...baseParams,
      page: info.apiPage,
      limit: info.batchSize,
    }, { persistCache: false, timeoutMs: 20000 });

    const result = virtualizeResponse(data, info.safeUiPage, uiPageSize, info);
    fallbackMemory.set(key, { time: Date.now(), data: result });
    writeLocal(key, result);
    return result;
  } catch (error) {
    const memory = fallbackMemory.get(key);
    const stale = memory && Date.now() - memory.time <= CONFIG.STALE_CACHE_TTL_MS
      ? memory.data
      : readLocal(key, CONFIG.STALE_CACHE_TTL_MS);
    if (stale) return { ...stale, _mvpoiskStale: true };
    throw error;
  }
}

// Main search results use virtual pagination. Small calls (autocomplete) stay lightweight.
export function searchMovies(query, page = 1, limit = CONFIG.PAGE_SIZE) {
  if (limit === CONFIG.PAGE_SIZE) {
    return fetchVirtual('/movie/search', { query }, page, limit);
  }
  return apiFetch('/movie/search', { query, page, limit });
}

export function getMovie(id) {
  return apiFetch(`/movie/${encodeURIComponent(id)}`, {}, { timeoutMs: 12000 });
}

export function getReviews(movieId, limit = 6) {
  return apiFetch('/review', { movieId, page: 1, limit }, { timeoutMs: 12000 });
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

  if (!filters.limit) {
    return fetchVirtual('/movie', params, filters.page || 1, CONFIG.PAGE_SIZE);
  }

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
