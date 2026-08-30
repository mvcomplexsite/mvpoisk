import { CONFIG } from './config.js?v=37';
import {
  exportLocalState,
  hasLocalUserData,
  getCloudSyncMeta,
  markCloudSynced,
  applyLocalState,
  clearLocalUserData,
  saveProfile,
} from './storage.js?v=37';

const WEB_SESSION_KEY = 'mvpoisk:web-session:v1';
const TV_DEVICE_KEY = 'mvpoisk:tv-device:v1';
const TV_PAIRING_KEY = 'mvpoisk:tv-pairing:v1';
const SYNCED_KEYS = new Set([
  'mvpoisk:profile:v1',
  'mvpoisk:watch-later:v1',
  'mvpoisk:favorites:v1',
  'mvpoisk:watch-history:v1',
]);

let webSession = readJson(WEB_SESSION_KEY, null);
let tvDevice = readJson(TV_DEVICE_KEY, null);
let tvPairing = readJson(TV_PAIRING_KEY, null, sessionStorage);
let initialized = false;
let initPromise = null;
let syncTimer = null;
let syncing = false;
let lastSyncMessage = 'Локальные данные';

function readJson(key, fallback, storage = localStorage) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value, storage = localStorage) {
  try {
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {}
}

function emit(detail = {}) {
  window.dispatchEvent(new CustomEvent('mvpoisk:account-changed', {
    detail: { ...getAccountState(), ...detail },
  }));
}

export function isTvMode() {
  const forced = new URLSearchParams(location.search).get('tv');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return /MVPoiskTV\/[\d.]+|Android TV|GoogleTV|BRAVIA|AFT[A-Z0-9]*/i.test(navigator.userAgent || '');
}

export function isAccountsConfigured() {
  return /^https:\/\//i.test(String(CONFIG.AUTH_WORKER_BASE || '').trim());
}

export function isTvPairingConfigured() {
  return isAccountsConfigured();
}

function profileFromSession() {
  const profile = webSession?.profile || {};
  return {
    name: String(profile.name || 'Пользователь').trim(),
    username: String(profile.username || '').replace(/^@/, '').trim(),
    avatarUrl: String(profile.avatarUrl || '').trim(),
    telegramId: String(profile.telegramId || '').trim(),
  };
}

function tvProfile() {
  const profile = tvDevice?.profile || {};
  return {
    name: String(profile.name || profile.displayName || 'MVPoisk').trim(),
    username: String(profile.username || '').replace(/^@/, '').trim(),
    avatarUrl: String(profile.avatarUrl || profile.picture || '').trim(),
    telegramId: String(profile.telegramId || '').trim(),
  };
}

export function getAccountState() {
  const profile = webSession?.token ? profileFromSession() : tvProfile();
  const signedIn = Boolean(webSession?.token || tvDevice?.token);
  return {
    configured: isAccountsConfigured(),
    tvPairingConfigured: isTvPairingConfigured(),
    initialized,
    signedIn,
    user: webSession?.token ? { profile: webSession.profile || {} } : null,
    isTvDevice: Boolean(!webSession?.token && tvDevice?.token),
    tvMode: isTvMode(),
    displayName: profile.name || '',
    telegramUsername: profile.username || '',
    avatarUrl: profile.avatarUrl || '',
    telegramId: profile.telegramId || '',
    syncMessage: lastSyncMessage,
    pairing: tvPairing,
  };
}

function cleanState(input = {}) {
  return {
    version: 1,
    profile: input?.profile && typeof input.profile.name === 'string' ? input.profile : null,
    watchLater: Array.isArray(input?.watchLater) ? input.watchLater : [],
    favorites: Array.isArray(input?.favorites) ? input.favorites : [],
    history: Array.isArray(input?.history) ? input.history : [],
  };
}

function mergeById(localItems = [], remoteItems = [], timestampField = 'savedAt') {
  const merged = new Map();
  for (const item of [...remoteItems, ...localItems]) {
    const id = Number(item?.id);
    if (!Number.isFinite(id)) continue;
    const previous = merged.get(id);
    if (!previous || Number(item?.[timestampField] || 0) >= Number(previous?.[timestampField] || 0)) merged.set(id, item);
  }
  return [...merged.values()].sort((a, b) => Number(b?.[timestampField] || 0) - Number(a?.[timestampField] || 0));
}

function mergeStates(localState, remoteState) {
  const local = cleanState(localState);
  const remote = cleanState(remoteState);
  const localProfileAt = Number(local.profile?.updatedAt || 0);
  const remoteProfileAt = Number(remote.profile?.updatedAt || 0);
  return {
    version: 1,
    profile: localProfileAt >= remoteProfileAt ? (local.profile || remote.profile) : (remote.profile || local.profile),
    watchLater: mergeById(local.watchLater, remote.watchLater, 'savedAt').slice(0, 250),
    favorites: mergeById(local.favorites, remote.favorites, 'savedAt').slice(0, 250),
    history: mergeById(local.history, remote.history, 'lastWatchedAt').slice(0, 300),
  };
}

function cloudTime(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasCloudIdentity() {
  return Boolean(webSession?.token || tvDevice?.token);
}

async function workerJson(path, options = {}) {
  const base = String(CONFIG.AUTH_WORKER_BASE || '').replace(/\/$/, '');
  if (!base) throw new Error('Cloudflare Auth Worker не настроен.');
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data === null ? null : data;
}

function webAuthHeaders() {
  return webSession?.token ? { Authorization: `Bearer ${webSession.token}` } : {};
}

async function fetchCloudRow() {
  if (tvDevice?.token) {
    return workerJson('/auth/tv/state', {
      method: 'GET',
      headers: { Authorization: `Bearer ${tvDevice.token}` },
    });
  }
  if (!webSession?.token) return null;
  return workerJson('/user/state', {
    method: 'GET',
    headers: webAuthHeaders(),
  });
}

async function writeCloudState(state) {
  if (tvDevice?.token) {
    return workerJson('/auth/tv/state', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tvDevice.token}` },
      body: JSON.stringify({ state }),
    });
  }
  if (!webSession?.token) return null;
  return workerJson('/user/state', {
    method: 'PUT',
    headers: webAuthHeaders(),
    body: JSON.stringify({ state }),
  });
}

export async function pushLocalState({ quiet = false } = {}) {
  if (!hasCloudIdentity() || syncing) return null;
  syncing = true;
  if (!quiet) { lastSyncMessage = 'Синхронизация…'; emit({ sync: 'syncing' }); }
  try {
    const data = await writeCloudState(exportLocalState());
    markCloudSynced(data?.updated_at || '');
    lastSyncMessage = 'Синхронизировано';
    emit({ sync: 'done' });
    return data;
  } catch (error) {
    lastSyncMessage = 'Не удалось синхронизировать';
    emit({ sync: 'error', error });
    if (!quiet) console.warn('MVPoisk cloud sync:', error);
    return null;
  } finally {
    syncing = false;
  }
}

export async function syncFromCloud({ quiet = false } = {}) {
  if (!hasCloudIdentity() || syncing) return;
  syncing = true;
  if (!quiet) { lastSyncMessage = 'Синхронизация…'; emit({ sync: 'syncing' }); }
  try {
    const row = await fetchCloudRow();
    const local = exportLocalState();
    const meta = getCloudSyncMeta();

    if (!row) {
      syncing = false;
      if (hasLocalUserData()) await pushLocalState({ quiet });
      else {
        lastSyncMessage = 'Аккаунт подключён';
        emit({ sync: 'done' });
      }
      return;
    }

    const remote = cleanState(row.state || {});
    const remoteChanged = !meta.lastCloudUpdatedAt || cloudTime(row.updated_at) > cloudTime(meta.lastCloudUpdatedAt) + 500;
    const localChanged = meta.localUpdatedAt > meta.lastSyncedLocalUpdatedAt;

    if (!meta.lastCloudUpdatedAt || (remoteChanged && localChanged)) {
      const merged = mergeStates(local, remote);
      applyLocalState(merged, { synced: false });
      syncing = false;
      await pushLocalState({ quiet });
      return;
    }

    if (remoteChanged) {
      applyLocalState(remote, { cloudUpdatedAt: row.updated_at, synced: true });
    } else if (localChanged) {
      syncing = false;
      await pushLocalState({ quiet });
      return;
    } else {
      markCloudSynced(row.updated_at);
    }

    const remoteName = getAccountState().displayName;
    if (remoteName && !exportLocalState().profile?.name) saveProfile(remoteName);
    lastSyncMessage = 'Синхронизировано';
    emit({ sync: 'done' });
  } catch (error) {
    if (error?.status === 401 && webSession?.token) {
      webSession = null;
      writeJson(WEB_SESSION_KEY, null);
      lastSyncMessage = 'Сессия истекла';
      emit({ authEvent: 'SESSION_EXPIRED' });
      return;
    }
    lastSyncMessage = 'Офлайн — данные сохранены на устройстве';
    emit({ sync: 'error', error });
    if (!quiet) console.warn('MVPoisk cloud sync:', error);
  } finally {
    syncing = false;
  }
}

function schedulePush() {
  if (!hasCloudIdentity()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushLocalState({ quiet: true }), 900);
}

function installSyncListeners() {
  window.addEventListener('mvpoisk:storage-changed', event => {
    if (SYNCED_KEYS.has(event.detail?.key)) schedulePush();
  });
  window.addEventListener('focus', () => {
    if (hasCloudIdentity()) syncFromCloud({ quiet: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && hasCloudIdentity()) syncFromCloud({ quiet: true });
  });
}

function extractAuthFragment() {
  if (!location.hash || !/^#(?:mv_auth|mv_auth_error)=/.test(location.hash)) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const handoff = params.get('mv_auth');
  const authError = params.get('mv_auth_error');
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  return { handoff, authError };
}

function browserDeviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  return `MVPoisk Web${platform ? ` · ${String(platform).slice(0, 50)}` : ''}`;
}

async function exchangeAuthHandoff(handoff) {
  const data = await workerJson('/auth/session/exchange', {
    method: 'POST',
    body: JSON.stringify({ handoff, deviceName: browserDeviceName() }),
  });
  webSession = {
    token: data.token,
    expiresAt: Date.parse(data.expiresAt || '') || (Date.now() + 30 * 24 * 60 * 60 * 1000),
    profile: data.profile || {},
    signedInAt: Date.now(),
  };
  writeJson(WEB_SESSION_KEY, webSession);
  const name = profileFromSession().name;
  if (name && !exportLocalState().profile?.name) saveProfile(name);
  return webSession;
}

async function refreshWebSession() {
  if (!webSession?.token) return;
  try {
    const data = await workerJson('/auth/me', { method: 'GET', headers: webAuthHeaders() });
    webSession = {
      ...webSession,
      profile: data.profile || webSession.profile || {},
      expiresAt: Date.parse(data.expiresAt || '') || webSession.expiresAt,
    };
    writeJson(WEB_SESSION_KEY, webSession);
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      webSession = null;
      writeJson(WEB_SESSION_KEY, null);
    } else {
      throw error;
    }
  }
}

async function refreshTvProfile() {
  if (!tvDevice?.token || !isTvPairingConfigured()) return;
  try {
    const data = await workerJson('/auth/tv/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${tvDevice.token}` },
    });
    tvDevice = { ...tvDevice, profile: data.profile || tvDevice.profile || {}, lastSeenAt: Date.now() };
    writeJson(TV_DEVICE_KEY, tvDevice);
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      tvDevice = null;
      writeJson(TV_DEVICE_KEY, null);
    }
  }
}

export async function initAccounts() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    installSyncListeners();
    if (!isAccountsConfigured()) {
      initialized = true;
      lastSyncMessage = 'Локальные данные';
      emit();
      return getAccountState();
    }

    try {
      const authFragment = extractAuthFragment();
      if (authFragment?.authError) console.warn('Telegram auth:', authFragment.authError);
      if (authFragment?.handoff) await exchangeAuthHandoff(authFragment.handoff);

      if (isTvMode() && tvDevice?.token) await refreshTvProfile();
      if (!isTvMode() && webSession?.token) await refreshWebSession();

      initialized = true;
      if (hasCloudIdentity()) lastSyncMessage = 'Синхронизация…';
      emit({ authEvent: authFragment?.handoff ? 'SIGNED_IN' : 'INITIAL_SESSION' });
      if (hasCloudIdentity()) setTimeout(() => syncFromCloud({ quiet: true }), 0);
      return getAccountState();
    } catch (error) {
      initialized = true;
      lastSyncMessage = hasCloudIdentity() ? 'Аккаунт подключён — облако временно недоступно' : 'Аккаунты временно недоступны';
      emit({ error });
      console.warn('MVPoisk accounts:', error);
      return getAccountState();
    }
  })();
  return initPromise;
}

export async function signInWithTelegram() {
  if (isTvMode()) throw new Error('На телевизоре используйте вход по коду.');
  if (!isAccountsConfigured()) throw new Error('Cloudflare Auth Worker ещё не настроен.');
  const base = String(CONFIG.AUTH_WORKER_BASE).replace(/\/$/, '');
  const returnUrl = `${location.origin}${location.pathname}${location.search}`;
  location.assign(`${base}/auth/telegram/start?return=${encodeURIComponent(returnUrl)}`);
}

export async function updateDisplayName(name) {
  const clean = String(name || '').trim().slice(0, 32);
  if (!clean) throw new Error('Введите имя.');
  if (webSession?.token) {
    const data = await workerJson('/auth/profile', {
      method: 'PUT',
      headers: webAuthHeaders(),
      body: JSON.stringify({ displayName: clean }),
    });
    webSession = { ...webSession, profile: data.profile || { ...(webSession.profile || {}), name: clean } };
    writeJson(WEB_SESSION_KEY, webSession);
  }
  saveProfile(clean);
  schedulePush();
  emit();
  return clean;
}

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function cleanPairCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function formatPairCode(value) {
  const clean = cleanPairCode(value);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

function deviceName() {
  const model = /\(([^)]+)\)/.exec(navigator.userAgent || '')?.[1] || '';
  return model ? `MVPoisk TV · ${model.slice(0, 60)}` : 'MVPoisk TV';
}

export async function beginTvPairing({ force = false } = {}) {
  if (!isTvPairingConfigured()) throw new Error('Вход на TV ещё не настроен.');
  if (!isTvMode()) throw new Error('Код создаётся только на телевизоре.');
  const now = Date.now();
  if (!force && tvPairing?.code && Number(tvPairing.expiresAt || 0) > now + 10_000) return tvPairing;

  const deviceToken = `mvptv_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const claimSecret = base64url(crypto.getRandomValues(new Uint8Array(24)));
  const [deviceTokenHash, claimSecretHash] = await Promise.all([sha256(deviceToken), sha256(claimSecret)]);
  const data = await workerJson('/auth/tv/pair/start', {
    method: 'POST',
    body: JSON.stringify({ deviceTokenHash, claimSecretHash, deviceName: deviceName() }),
  });
  tvPairing = {
    code: cleanPairCode(data.code),
    displayCode: data.displayCode || formatPairCode(data.code),
    expiresAt: Date.parse(data.expiresAt || '') || (Date.now() + 10 * 60 * 1000),
    claimSecretHash,
    deviceToken,
  };
  writeJson(TV_PAIRING_KEY, tvPairing, sessionStorage);
  emit({ pairingStarted: true });
  return tvPairing;
}

export async function pollTvPairing() {
  if (!tvPairing?.code || !tvPairing?.claimSecretHash) return { status: 'none' };
  const data = await workerJson('/auth/tv/pair/poll', {
    method: 'POST',
    body: JSON.stringify({ code: tvPairing.code, claimSecretHash: tvPairing.claimSecretHash }),
  });
  if (data.status === 'approved') {
    tvDevice = { token: tvPairing.deviceToken, profile: data.profile || {}, pairedAt: Date.now() };
    writeJson(TV_DEVICE_KEY, tvDevice);
    tvPairing = null;
    writeJson(TV_PAIRING_KEY, null, sessionStorage);
    lastSyncMessage = 'TV подключён';
    emit({ tvPaired: true });
    setTimeout(() => syncFromCloud({ quiet: false }), 0);
  }
  return data;
}

export async function approveTvPairCode(code) {
  if (!webSession?.token) throw new Error('Сначала войдите через Telegram.');
  const clean = cleanPairCode(code);
  if (clean.length < 6) throw new Error('Введите код с телевизора.');
  return workerJson('/auth/tv/pair/approve', {
    method: 'POST',
    headers: webAuthHeaders(),
    body: JSON.stringify({ code: clean }),
  });
}

export async function signOut() {
  if (hasCloudIdentity()) await pushLocalState({ quiet: true });
  if (tvDevice?.token) {
    try {
      await workerJson('/auth/tv/device', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tvDevice.token}` },
      });
    } catch {}
    tvDevice = null;
    writeJson(TV_DEVICE_KEY, null);
    tvPairing = null;
    writeJson(TV_PAIRING_KEY, null, sessionStorage);
  }
  if (webSession?.token) {
    try { await workerJson('/auth/logout', { method: 'POST', headers: webAuthHeaders() }); } catch {}
    webSession = null;
    writeJson(WEB_SESSION_KEY, null);
  }
  clearLocalUserData();
  lastSyncMessage = 'Локальные данные';
  emit({ authEvent: 'SIGNED_OUT' });
}
