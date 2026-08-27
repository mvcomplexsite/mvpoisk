const KEYS = Object.freeze({
  profile: 'mvpoisk:profile:v1',
  watchLater: 'mvpoisk:watch-later:v1',
  favorites: 'mvpoisk:favorites:v1',
  watchNoticeDismissed: 'mvpoisk:watch-notice-dismissed:v1',
});

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent('mvpoisk:storage-changed', { detail: { key } }));
    return true;
  } catch {
    return false;
  }
}

export function getProfile() {
  const profile = read(KEYS.profile, null);
  return profile && typeof profile.name === 'string' ? profile : null;
}

export function saveProfile(name) {
  const clean = String(name || '').trim().slice(0, 32);
  if (!clean) return false;
  return write(KEYS.profile, { name: clean, updatedAt: Date.now() });
}

export function clearProfile() {
  try { localStorage.removeItem(KEYS.profile); } catch {}
  window.dispatchEvent(new CustomEvent('mvpoisk:storage-changed', { detail: { key: KEYS.profile } }));
}

function listKey(type) {
  if (type === 'favorites') return KEYS.favorites;
  return KEYS.watchLater;
}

export function movieSnapshot(movie) {
  return {
    id: Number(movie.id),
    name: movie.name || movie.alternativeName || 'Без названия',
    alternativeName: movie.alternativeName || '',
    year: movie.year || null,
    rating: Number(movie.rating?.kp || 0),
    isSeries: Boolean(movie.isSeries || /series/i.test(movie.type || '')),
    poster: {
      url: movie.poster?.url || '',
      previewUrl: movie.poster?.previewUrl || '',
    },
    genres: (movie.genres || []).slice(0, 2).map(item => item?.name).filter(Boolean),
    savedAt: Date.now(),
  };
}

export function getList(type) {
  const items = read(listKey(type), []);
  return Array.isArray(items) ? items.filter(item => item && Number.isFinite(Number(item.id))) : [];
}

export function hasInList(type, id) {
  return getList(type).some(item => Number(item.id) === Number(id));
}

export function toggleInList(type, movie) {
  const key = listKey(type);
  const current = getList(type);
  const id = Number(movie.id);
  const exists = current.some(item => Number(item.id) === id);
  const next = exists
    ? current.filter(item => Number(item.id) !== id)
    : [movieSnapshot(movie), ...current.filter(item => Number(item.id) !== id)].slice(0, 250);
  write(key, next);
  return !exists;
}

export function removeFromList(type, id) {
  const next = getList(type).filter(item => Number(item.id) !== Number(id));
  write(listKey(type), next);
}

export function counts() {
  return {
    watchLater: getList('watchLater').length,
    favorites: getList('favorites').length,
  };
}


export function isWatchNoticeDismissed() {
  try { return localStorage.getItem(KEYS.watchNoticeDismissed) === '1'; } catch { return false; }
}

export function dismissWatchNotice() {
  try {
    localStorage.setItem(KEYS.watchNoticeDismissed, '1');
    window.dispatchEvent(new CustomEvent('mvpoisk:storage-changed', { detail: { key: KEYS.watchNoticeDismissed } }));
    return true;
  } catch {
    return false;
  }
}
