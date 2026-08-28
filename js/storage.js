const KEYS = Object.freeze({
  profile: 'mvpoisk:profile:v1',
  watchLater: 'mvpoisk:watch-later:v1',
  favorites: 'mvpoisk:favorites:v1',
  history: 'mvpoisk:watch-history:v1',
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
    rating: Number(movie.rating?.kp || movie.rating || 0),
    isSeries: Boolean(movie.isSeries || /series/i.test(movie.type || '')),
    poster: {
      url: movie.poster?.url || '',
      previewUrl: movie.poster?.previewUrl || '',
    },
    backdrop: {
      url: movie.backdrop?.url || '',
      previewUrl: movie.backdrop?.previewUrl || '',
    },
    genres: (movie.genres || []).slice(0, 2).map(item => typeof item === 'string' ? item : item?.name).filter(Boolean),
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

function normalizeHistoryEntry(item) {
  if (!item || !Number.isFinite(Number(item.id))) return null;
  const progress = item.progress && typeof item.progress === 'object' ? item.progress : {};
  return {
    ...item,
    id: Number(item.id),
    firstWatchedAt: Number(item.firstWatchedAt || item.lastWatchedAt || Date.now()),
    lastWatchedAt: Number(item.lastWatchedAt || item.firstWatchedAt || Date.now()),
    starts: Math.max(1, Number(item.starts || 1)),
    completed: Boolean(item.completed),
    hiddenFromContinue: Boolean(item.hiddenFromContinue),
    source: ['primary', 'alternate', 'partner'].includes(item.source) ? item.source : 'primary',
    progress: {
      position: Number.isFinite(Number(progress.position)) ? Number(progress.position) : null,
      duration: Number.isFinite(Number(progress.duration)) ? Number(progress.duration) : null,
      percent: Number.isFinite(Number(progress.percent)) ? Math.max(0, Math.min(1, Number(progress.percent))) : null,
      season: Number.isFinite(Number(progress.season)) ? Number(progress.season) : null,
      episode: Number.isFinite(Number(progress.episode)) ? Number(progress.episode) : null,
      updatedAt: Number(progress.updatedAt || 0) || null,
    },
  };
}

export function getHistory() {
  const raw = read(KEYS.history, []);
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeHistoryEntry).filter(Boolean).sort((a, b) => b.lastWatchedAt - a.lastWatchedAt);
}

export function getHistoryEntry(id) {
  return getHistory().find(item => Number(item.id) === Number(id)) || null;
}

export function getContinueWatching(limit = 12) {
  return getHistory()
    .filter(item => !item.completed && !item.hiddenFromContinue)
    .slice(0, Math.max(1, Number(limit) || 12));
}

function saveHistory(items) {
  const clean = items.map(normalizeHistoryEntry).filter(Boolean).sort((a, b) => b.lastWatchedAt - a.lastWatchedAt).slice(0, 300);
  return write(KEYS.history, clean);
}

export function recordWatchStart(movie, source = 'primary') {
  if (!movie || !Number.isFinite(Number(movie.id))) return null;
  const now = Date.now();
  const snapshot = movieSnapshot(movie);
  const current = getHistory();
  const previous = current.find(item => Number(item.id) === Number(snapshot.id));
  const entry = {
    ...(previous || {}),
    ...snapshot,
    firstWatchedAt: previous?.firstWatchedAt || now,
    lastWatchedAt: now,
    starts: Number(previous?.starts || 0) + 1,
    completed: false,
    hiddenFromContinue: false,
    source: ['primary', 'alternate', 'partner'].includes(source) ? source : 'primary',
    progress: previous?.completed ? { position: null, duration: null, percent: null, season: previous?.progress?.season ?? null, episode: previous?.progress?.episode ?? null, updatedAt: now } : (previous?.progress || { position: null, duration: null, percent: null, season: null, episode: null, updatedAt: null }),
  };
  saveHistory([entry, ...current.filter(item => Number(item.id) !== Number(snapshot.id))]);
  return entry;
}

export function setWatched(movie, completed = true) {
  if (!movie || !Number.isFinite(Number(movie.id))) return false;
  const now = Date.now();
  const snapshot = movieSnapshot(movie);
  const current = getHistory();
  const previous = current.find(item => Number(item.id) === Number(snapshot.id));
  const entry = {
    ...(previous || {}),
    ...snapshot,
    firstWatchedAt: previous?.firstWatchedAt || now,
    lastWatchedAt: now,
    starts: Math.max(1, Number(previous?.starts || 1)),
    completed: Boolean(completed),
    hiddenFromContinue: false,
    source: previous?.source || 'primary',
    progress: {
      ...(previous?.progress || {}),
      percent: completed ? 1 : (previous?.progress?.percent ?? null),
      updatedAt: now,
    },
  };
  saveHistory([entry, ...current.filter(item => Number(item.id) !== Number(snapshot.id))]);
  return entry.completed;
}

export function toggleWatched(movie) {
  const current = getHistoryEntry(movie?.id);
  return setWatched(movie, !current?.completed);
}

export function dismissContinue(id) {
  const current = getHistory();
  const target = current.find(item => Number(item.id) === Number(id));
  if (!target) return false;
  target.hiddenFromContinue = true;
  return saveHistory(current);
}

export function removeFromHistory(id) {
  return saveHistory(getHistory().filter(item => Number(item.id) !== Number(id)));
}

export function updatePlaybackProgress(id, patch = {}) {
  const current = getHistory();
  const index = current.findIndex(item => Number(item.id) === Number(id));
  if (index < 0) return null;
  const entry = current[index];
  const previous = entry.progress || {};
  const position = Number.isFinite(Number(patch.position)) ? Math.max(0, Number(patch.position)) : previous.position ?? null;
  const duration = Number.isFinite(Number(patch.duration)) ? Math.max(0, Number(patch.duration)) : previous.duration ?? null;
  let percent = Number.isFinite(Number(patch.percent)) ? Number(patch.percent) : previous.percent ?? null;
  if (duration && Number.isFinite(position)) percent = position / duration;
  if (Number.isFinite(percent)) percent = Math.max(0, Math.min(1, percent));
  const season = Number.isFinite(Number(patch.season)) ? Math.max(0, Number(patch.season)) : previous.season ?? null;
  const episode = Number.isFinite(Number(patch.episode)) ? Math.max(0, Number(patch.episode)) : previous.episode ?? null;
  const completed = Number.isFinite(percent) && percent >= 0.93 ? true : entry.completed;
  current[index] = {
    ...entry,
    lastWatchedAt: Date.now(),
    completed,
    hiddenFromContinue: completed ? false : entry.hiddenFromContinue,
    progress: { position, duration, percent, season, episode, updatedAt: Date.now() },
  };
  saveHistory(current);
  return current[index];
}

export function counts() {
  return {
    watchLater: getList('watchLater').length,
    favorites: getList('favorites').length,
    history: getHistory().length,
    continueWatching: getContinueWatching(300).length,
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
