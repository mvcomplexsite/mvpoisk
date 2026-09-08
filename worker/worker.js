// MVPoisk API cache + API-key pool for Cloudflare Workers.
// v36: movie API key pool + Telegram account TV pairing/state bridge.
//
// Add legitimate API keys as Cloudflare secrets:
// KINOPOISK_API_KEY_1 ... KINOPOISK_API_KEY_20
// The legacy KINOPOISK_API_KEY secret is also accepted for compatibility.

const UPSTREAM_ORIGIN = 'https://api.poiskkino.dev';
const MAX_ERROR_BODY = 5000;
const MAX_KEYS = 20;
const DEFAULT_QUOTA_COOLDOWN_SECONDS = 6 * 60 * 60; // retry an exhausted key later
const INVALID_KEY_COOLDOWN_SECONDS = 12 * 60 * 60;
const SHORT_RATE_LIMIT_COOLDOWN_SECONDS = 2 * 60;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'X-MVPoisk-Cache, X-MVPoisk-Upstream-Key, X-MVPoisk-Key-Pool',
    'Vary': 'Origin',
  };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...extra,
    },
  });
}

function getKeySlots(env) {
  const raw = [];

  // Prefer numbered keys. Keep the old single secret as a compatibility alias.
  for (let i = 1; i <= MAX_KEYS; i++) {
    const value = env[`KINOPOISK_API_KEY_${i}`];
    if (value) raw.push({ source: `KINOPOISK_API_KEY_${i}`, key: value });
  }
  if (env.KINOPOISK_API_KEY) raw.push({ source: 'KINOPOISK_API_KEY', key: env.KINOPOISK_API_KEY });

  const seen = new Set();
  const unique = [];
  for (const item of raw) {
    const key = String(item.key).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...item, key, slot: unique.length + 1 });
  }
  return unique;
}

function normalizeSearch(url) {
  const entries = [...url.searchParams.entries()].sort(([ak, av], [bk, bv]) => {
    const keyCompare = ak.localeCompare(bk);
    return keyCompare || String(av).localeCompare(String(bv));
  });
  const params = new URLSearchParams();
  for (const [key, value] of entries) params.append(key, value);
  return params.toString();
}

function cacheSeconds(pathname) {
  if (/\/movie\/\d+$/.test(pathname)) return 7 * 24 * 60 * 60;
  if (pathname.endsWith('/movie/search')) return 6 * 60 * 60;
  if (pathname.endsWith('/movie')) return 12 * 60 * 60;
  if (pathname.endsWith('/review')) return 12 * 60 * 60;
  if (pathname.includes('/dictionary/')) return 7 * 24 * 60 * 60;
  return 6 * 60 * 60;
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function orderedSlots(slots, requestIdentity) {
  if (slots.length <= 1) return slots;
  const day = new Date().toISOString().slice(0, 10);
  const start = hashString(`${day}|${requestIdentity}`) % slots.length;
  return [...slots.slice(start), ...slots.slice(0, start)];
}

function stateRequest(slot) {
  // Cache API state is intentionally separate from user-visible endpoints.
  return new Request(`https://mvpoisk-key-state.invalid/v20/${encodeURIComponent(slot.source)}`);
}

async function readSlotState(cache, slot) {
  const hit = await cache.match(stateRequest(slot));
  if (!hit) return null;
  try {
    return await hit.json();
  } catch {
    return { kind: 'cooldown' };
  }
}

async function markSlotState(cache, slot, kind, ttlSeconds, detail = '') {
  const ttl = Math.max(30, Math.floor(ttlSeconds || 60));
  const until = Date.now() + ttl * 1000;
  const response = json({ kind, slot: slot.slot, source: slot.source, until, detail }, 200, {
    'Cache-Control': `public, max-age=${ttl}, s-maxage=${ttl}`,
  });
  await cache.put(stateRequest(slot), response);
}

function parseRetryAfter(response) {
  const raw = response.headers.get('Retry-After');
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 60 * 60);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.min(Math.max(0, Math.ceil((date - Date.now()) / 1000)), 60 * 60);
  return 0;
}

function looksLikeQuota(body) {
  return /(quota|rate.?limit|daily.?limit|requests?.?limit|too many|exceed(?:ed)?|лимит|квот|превыш|запрос.{0,20}(сут|день|лимит))/i.test(body || '');
}

function classifyFailure(response, body) {
  if (response.status === 401) {
    return { cooldown: INVALID_KEY_COOLDOWN_SECONDS, kind: 'invalid_key' };
  }

  if (response.status === 429) {
    return {
      cooldown: parseRetryAfter(response) || SHORT_RATE_LIMIT_COOLDOWN_SECONDS,
      kind: 'rate_limited',
    };
  }

  if (response.status === 403 && looksLikeQuota(body)) {
    return { cooldown: DEFAULT_QUOTA_COOLDOWN_SECONDS, kind: 'quota_exhausted' };
  }

  return null;
}

function shouldTryAnotherKey(status) {
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

async function smallErrorText(response) {
  try {
    const text = await response.text();
    return text.slice(0, MAX_ERROR_BODY);
  } catch {
    return '';
  }
}

function remainingQuota(response) {
  const names = ['x-ratelimit-remaining', 'ratelimit-remaining', 'x-rate-limit-remaining'];
  for (const name of names) {
    const raw = response.headers.get(name);
    if (raw == null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function withCacheHeaders(response, state, keySlot = '', poolSize = '') {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders())) headers.set(name, value);
  headers.set('X-MVPoisk-Cache', state);
  if (keySlot !== '') headers.set('X-MVPoisk-Upstream-Key', String(keySlot));
  if (poolSize !== '') headers.set('X-MVPoisk-Key-Pool', String(poolSize));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function poolStatus(cache, slots) {
  const states = await Promise.all(slots.map(slot => readSlotState(cache, slot)));
  return slots.map((slot, index) => ({
    slot: slot.slot,
    source: slot.source,
    state: states[index]?.kind || 'ready',
    cooldownUntil: states[index]?.until || null,
  }));
}


// ===== MVPoisk Accounts / Telegram OIDC / D1 / TV pairing =====
const TV_PAIR_TTL_SECONDS = 10 * 60;
const WEB_SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;
const AUTH_FLOW_TTL_SECONDS = 10 * 60;
const AUTH_HANDOFF_TTL_SECONDS = 2 * 60;
const TV_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_FRONTEND_URL = 'https://mvcomplexsite.github.io/mvpoisk/';
let telegramJwksMemory = { expiresAt: 0, keys: [] };

function d1Configured(env) {
  return Boolean(env.DB && typeof env.DB.prepare === 'function');
}

function telegramConfigured(env) {
  return Boolean(String(env.TELEGRAM_CLIENT_ID || '').trim() && String(env.TELEGRAM_CLIENT_SECRET || '').trim());
}

function authConfigured(env) {
  return d1Configured(env) && telegramConfigured(env);
}

async function readJsonBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function cleanCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function formatCode(code) {
  const clean = cleanCode(code);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

function randomBytes(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64urlFromBytes(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomToken(prefix = '', size = 32) {
  return `${prefix}${base64urlFromBytes(randomBytes(size))}`;
}

function randomCode(length = 6) {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += TV_CODE_ALPHABET[byte % TV_CODE_ALPHABET.length];
  return out;
}

async function sha256Bytes(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || ''))));
}

async function sha256Hex(value) {
  const digest = await sha256Bytes(value);
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Base64url(value) {
  return base64urlFromBytes(await sha256Bytes(value));
}

function validHash(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ''));
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function allowedFrontendBases(env) {
  const configured = String(env.AUTH_FRONTEND_URLS || env.AUTH_FRONTEND_URL || DEFAULT_FRONTEND_URL)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return configured.length ? configured : [DEFAULT_FRONTEND_URL];
}

function safeReturnUrl(env, candidate) {
  let target;
  try { target = new URL(String(candidate || DEFAULT_FRONTEND_URL)); } catch { target = new URL(DEFAULT_FRONTEND_URL); }
  if (target.protocol !== 'https:') return DEFAULT_FRONTEND_URL;
  for (const baseValue of allowedFrontendBases(env)) {
    try {
      const base = new URL(baseValue);
      const prefix = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
      if (target.origin === base.origin && (target.pathname === base.pathname || target.pathname.startsWith(prefix))) {
        return target.toString();
      }
    } catch {}
  }
  return allowedFrontendBases(env)[0] || DEFAULT_FRONTEND_URL;
}

function telegramCallbackUrl(request, env) {
  const explicit = String(env.AUTH_CALLBACK_URL || '').trim();
  if (explicit) return explicit;
  const incoming = new URL(request.url);
  return `${incoming.origin}/auth/telegram/callback`;
}

function profileFromUserRow(row) {
  if (!row) return { name: 'Пользователь', username: '', avatarUrl: '', telegramId: '' };
  return {
    name: String(row.display_name || row.telegram_name || row.username || 'Пользователь'),
    username: String(row.username || '').replace(/^@/, ''),
    avatarUrl: String(row.avatar_url || ''),
    telegramId: String(row.telegram_id || row.telegram_sub || ''),
  };
}

async function d1First(env, sql, ...bindings) {
  return env.DB.prepare(sql).bind(...bindings).first();
}

async function d1Run(env, sql, ...bindings) {
  return env.DB.prepare(sql).bind(...bindings).run();
}

async function cleanupAuthRows(env) {
  if (!d1Configured(env)) return;
  const now = Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM oauth_flows WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM auth_handoffs WHERE expires_at < ? OR used_at IS NOT NULL').bind(now - 60_000),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL').bind(now - 7 * 24 * 60 * 60 * 1000),
      env.DB.prepare("DELETE FROM tv_pairs WHERE expires_at < ? AND status = 'pending'").bind(now - 60_000),
    ]);
  } catch {}
}

function parseJwtPart(part) {
  try { return JSON.parse(new TextDecoder().decode(base64urlDecode(part))); } catch { return null; }
}

async function telegramJwks() {
  if (telegramJwksMemory.expiresAt > Date.now() && telegramJwksMemory.keys.length) return telegramJwksMemory.keys;
  const response = await fetch('https://oauth.telegram.org/.well-known/jwks.json', {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`telegram_jwks_http_${response.status}`);
  const data = await response.json();
  const keys = Array.isArray(data?.keys) ? data.keys : [];
  if (!keys.length) throw new Error('telegram_jwks_empty');
  telegramJwksMemory = { expiresAt: Date.now() + 10 * 60 * 1000, keys };
  return keys;
}

async function verifyTelegramIdToken(idToken, clientId) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('telegram_invalid_id_token');
  const header = parseJwtPart(parts[0]);
  const claims = parseJwtPart(parts[1]);
  if (!header || !claims || header.alg !== 'RS256') throw new Error('telegram_invalid_jwt_header');

  const keys = await telegramJwks();
  const jwk = keys.find(item => item.kid === header.kid) || (keys.length === 1 ? keys[0] : null);
  if (!jwk) throw new Error('telegram_signing_key_not_found');
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64urlDecode(parts[2]);
  const verified = await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, signature, signed);
  if (!verified) throw new Error('telegram_invalid_signature');

  const now = nowSeconds();
  const aud = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud || '')];
  if (claims.iss !== 'https://oauth.telegram.org') throw new Error('telegram_invalid_issuer');
  if (!aud.includes(String(clientId))) throw new Error('telegram_invalid_audience');
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) < now - 30) throw new Error('telegram_token_expired');
  if (!claims.sub) throw new Error('telegram_missing_subject');
  return claims;
}

async function upsertTelegramUser(env, claims) {
  const now = Date.now();
  const userId = `tg:${String(claims.sub)}`;
  const telegramName = String(claims.name || claims.given_name || claims.preferred_username || 'Пользователь').slice(0, 120);
  const username = String(claims.preferred_username || '').replace(/^@/, '').slice(0, 80);
  const avatarUrl = String(claims.picture || '').slice(0, 1000);
  const telegramId = String(claims.id || claims.sub || '').slice(0, 80);
  await d1Run(env, `
    INSERT INTO users (id, telegram_sub, telegram_id, telegram_name, username, display_name, avatar_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      telegram_id = excluded.telegram_id,
      telegram_name = excluded.telegram_name,
      username = excluded.username,
      avatar_url = excluded.avatar_url,
      updated_at = excluded.updated_at
  `, userId, String(claims.sub), telegramId, telegramName, username, telegramName, avatarUrl, now, now);
  return d1First(env, 'SELECT * FROM users WHERE id = ?', userId);
}

async function issueWebSession(env, userId, deviceName = 'Web') {
  const token = randomToken('mvps_', 36);
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const expiresAt = now + WEB_SESSION_TTL_SECONDS * 1000;
  await d1Run(env, `
    INSERT INTO sessions (token_hash, user_id, device_type, device_name, created_at, last_seen_at, expires_at)
    VALUES (?, ?, 'web', ?, ?, ?, ?)
  `, tokenHash, userId, String(deviceName || 'Web').slice(0, 120), now, now, expiresAt);
  return { token, expiresAt };
}

async function authenticateWebSession(request, env) {
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+(mvps_[A-Za-z0-9_-]{20,})$/i.exec(header);
  if (!match || !d1Configured(env)) return null;
  const tokenHash = await sha256Hex(match[1]);
  const now = Date.now();
  const row = await d1First(env, `
    SELECT s.token_hash, s.user_id, s.device_name, s.expires_at,
           u.telegram_sub, u.telegram_id, u.telegram_name, u.username, u.display_name, u.avatar_url
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
  `, tokenHash, now);
  if (!row) return null;
  d1Run(env, 'UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', now, tokenHash).catch(() => {});
  return { tokenHash, userId: row.user_id, row, profile: profileFromUserRow(row) };
}

async function createTelegramAuth(request, env, incoming) {
  if (!authConfigured(env)) {
    return json({ error: 'auth_not_configured', message: 'Cloudflare D1 or Telegram OAuth secrets are not configured.' }, 503);
  }
  const returnUrl = safeReturnUrl(env, incoming.searchParams.get('return'));
  const state = randomToken('', 24);
  const verifier = randomToken('', 48);
  const challenge = await sha256Base64url(verifier);
  const now = Date.now();
  await d1Run(env, `
    INSERT INTO oauth_flows (state, code_verifier, return_url, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `, state, verifier, returnUrl, now, now + AUTH_FLOW_TTL_SECONDS * 1000);

  const callback = telegramCallbackUrl(request, env);
  const authUrl = new URL('https://oauth.telegram.org/auth');
  authUrl.searchParams.set('client_id', String(env.TELEGRAM_CLIENT_ID));
  authUrl.searchParams.set('redirect_uri', callback);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  return Response.redirect(authUrl.toString(), 302);
}

async function telegramCallback(request, env, incoming) {
  if (!authConfigured(env)) return json({ error: 'auth_not_configured' }, 503);
  const code = incoming.searchParams.get('code');
  const state = incoming.searchParams.get('state');
  const oauthError = incoming.searchParams.get('error');
  if (oauthError) {
    const fallback = safeReturnUrl(env, DEFAULT_FRONTEND_URL);
    const target = new URL(fallback);
    target.hash = `mv_auth_error=${encodeURIComponent(oauthError)}`;
    return Response.redirect(target.toString(), 302);
  }
  if (!code || !state) return json({ error: 'telegram_callback_missing_parameters' }, 400);

  const flow = await d1First(env, 'SELECT state, code_verifier, return_url, expires_at FROM oauth_flows WHERE state = ?', state);
  if (!flow || Number(flow.expires_at) <= Date.now()) return json({ error: 'telegram_auth_flow_expired' }, 410);
  await d1Run(env, 'DELETE FROM oauth_flows WHERE state = ?', state);

  const callback = telegramCallbackUrl(request, env);
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callback,
    client_id: String(env.TELEGRAM_CLIENT_ID),
    code_verifier: String(flow.code_verifier),
  });
  const basic = btoa(`${String(env.TELEGRAM_CLIENT_ID)}:${String(env.TELEGRAM_CLIENT_SECRET)}`);
  const tokenResponse = await fetch('https://oauth.telegram.org/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basic}`,
      'Accept': 'application/json',
    },
    body: form.toString(),
  });
  let tokenData = null;
  try { tokenData = await tokenResponse.json(); } catch {}
  if (!tokenResponse.ok || !tokenData?.id_token) {
    console.error('Telegram token exchange failed', tokenResponse.status, tokenData);
    return json({ error: 'telegram_token_exchange_failed', status: tokenResponse.status }, 502);
  }

  const claims = await verifyTelegramIdToken(tokenData.id_token, String(env.TELEGRAM_CLIENT_ID));
  const user = await upsertTelegramUser(env, claims);
  const handoff = randomToken('mvah_', 32);
  const handoffHash = await sha256Hex(handoff);
  const now = Date.now();
  await d1Run(env, `
    INSERT INTO auth_handoffs (code_hash, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `, handoffHash, user.id, now, now + AUTH_HANDOFF_TTL_SECONDS * 1000);

  const target = new URL(safeReturnUrl(env, flow.return_url));
  target.hash = `mv_auth=${encodeURIComponent(handoff)}`;
  return Response.redirect(target.toString(), 302);
}

async function exchangeHandoff(env, body) {
  const handoff = String(body.handoff || '');
  if (!/^mvah_[A-Za-z0-9_-]{20,}$/.test(handoff)) return json({ error: 'invalid_handoff' }, 400);
  const hash = await sha256Hex(handoff);
  const now = Date.now();
  const row = await d1First(env, `
    SELECT code_hash, user_id, expires_at, used_at FROM auth_handoffs
    WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?
  `, hash, now);
  if (!row) return json({ error: 'handoff_expired' }, 410);
  const consume = await d1Run(env, 'UPDATE auth_handoffs SET used_at = ? WHERE code_hash = ? AND used_at IS NULL', now, hash);
  if (!consume?.meta || Number(consume.meta.changes || 0) < 1) return json({ error: 'handoff_already_used' }, 409);

  const session = await issueWebSession(env, row.user_id, String(body.deviceName || 'Web'));
  const user = await d1First(env, 'SELECT * FROM users WHERE id = ?', row.user_id);
  return json({ ok: true, token: session.token, expiresAt: new Date(session.expiresAt).toISOString(), profile: profileFromUserRow(user) });
}

async function updateWebProfile(request, env, body) {
  const session = await authenticateWebSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const displayName = String(body.displayName || body.name || '').trim().slice(0, 32);
  if (!displayName) return json({ error: 'invalid_name', message: 'Введите имя.' }, 400);
  await d1Run(env, 'UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?', displayName, Date.now(), session.userId);
  const user = await d1First(env, 'SELECT * FROM users WHERE id = ?', session.userId);
  return json({ ok: true, profile: profileFromUserRow(user) });
}

async function logoutWeb(request, env) {
  const session = await authenticateWebSession(request, env);
  if (!session) return json({ ok: true });
  await d1Run(env, 'UPDATE sessions SET revoked_at = ? WHERE token_hash = ?', Date.now(), session.tokenHash);
  return json({ ok: true });
}

async function readUserState(env, userId) {
  const row = await d1First(env, 'SELECT state_json, updated_at FROM user_state WHERE user_id = ?', userId);
  if (!row) return null;
  let state = {};
  try { state = JSON.parse(row.state_json || '{}'); } catch {}
  return { state, updated_at: new Date(Number(row.updated_at || 0)).toISOString() };
}

async function writeUserState(env, userId, state) {
  const safeState = state && typeof state === 'object' ? state : {};
  const raw = JSON.stringify(safeState);
  if (raw.length > 1_600_000) return { tooLarge: true };
  const now = Date.now();
  await d1Run(env, `
    INSERT INTO user_state (user_id, state_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
  `, userId, raw, now);
  return { state: safeState, updated_at: new Date(now).toISOString() };
}

async function webOrTvIdentity(request, env) {
  const web = await authenticateWebSession(request, env);
  if (web) return { kind: 'web', userId: web.userId, profile: web.profile, web };
  const tv = await authenticateTvDevice(request, env);
  if (tv) return { kind: 'tv', userId: tv.user_id, profile: tv.profile, tv };
  return null;
}

async function insertTvPair(env, body) {
  const claimSecretHash = String(body.claimSecretHash || '').toLowerCase();
  const deviceTokenHash = String(body.deviceTokenHash || '').toLowerCase();
  const deviceName = String(body.deviceName || 'MVPoisk TV').slice(0, 120);
  if (!validHash(claimSecretHash) || !validHash(deviceTokenHash)) {
    return json({ error: 'invalid_pair_request', message: 'Некорректный запрос подключения.' }, 400);
  }
  const now = Date.now();
  const expiresAt = now + TV_PAIR_TTL_SECONDS * 1000;
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode(6);
    try {
      await d1Run(env, `
        INSERT INTO tv_pairs (pair_code, claim_secret_hash, device_token_hash, device_name, status, created_at, expires_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?)
      `, code, claimSecretHash, deviceTokenHash, deviceName, now, expiresAt);
      return json({ code, displayCode: formatCode(code), expiresAt: new Date(expiresAt).toISOString() }, 201);
    } catch (error) {
      if (/UNIQUE|constraint/i.test(String(error?.message || error))) continue;
      throw error;
    }
  }
  return json({ error: 'pair_code_generation_failed' }, 503);
}

async function findPair(env, code) {
  const clean = cleanCode(code);
  if (clean.length < 6) return null;
  return d1First(env, 'SELECT * FROM tv_pairs WHERE pair_code = ?', clean);
}

function pairExpired(row) {
  return !row?.expires_at || Number(row.expires_at) <= Date.now();
}

async function approveTvPair(request, env, body) {
  const session = await authenticateWebSession(request, env);
  if (!session) return json({ error: 'unauthorized', message: 'Сначала войдите в MVPoisk через Telegram.' }, 401);
  const row = await findPair(env, body.code);
  if (!row || row.revoked_at) return json({ error: 'invalid_code', message: 'Код не найден.' }, 404);
  if (pairExpired(row)) return json({ error: 'expired_code', message: 'Код подключения истёк.' }, 410);
  if (row.status === 'approved' && row.user_id && row.user_id !== session.userId) return json({ error: 'already_approved' }, 409);
  const profileJson = JSON.stringify(session.profile || { name: 'Пользователь' });
  const now = Date.now();
  await d1Run(env, `
    UPDATE tv_pairs SET user_id = ?, profile_json = ?, status = 'approved', approved_at = ?, last_seen_at = ?
    WHERE pair_code = ?
  `, session.userId, profileJson, now, now, row.pair_code);
  return json({ ok: true, status: 'approved', deviceName: row.device_name });
}

async function pollTvPair(env, body) {
  const row = await findPair(env, body.code);
  if (!row || row.revoked_at) return json({ status: 'invalid' }, 404);
  const supplied = String(body.claimSecretHash || '').toLowerCase();
  if (!validHash(supplied) || supplied !== String(row.claim_secret_hash || '').toLowerCase()) return json({ error: 'forbidden' }, 403);
  if (row.status !== 'approved' && pairExpired(row)) return json({ status: 'expired' }, 410);
  if (row.status !== 'approved' || !row.user_id) return json({ status: 'pending', expiresAt: new Date(Number(row.expires_at)).toISOString() });
  let profile = { name: 'Пользователь' };
  try { profile = JSON.parse(row.profile_json || '{}'); } catch {}
  return json({ status: 'approved', profile, deviceName: row.device_name });
}

async function authenticateTvDevice(request, env) {
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+(mvptv_[A-Za-z0-9_-]{20,})$/i.exec(header);
  if (!match || !d1Configured(env)) return null;
  const tokenHash = await sha256Hex(match[1]);
  const row = await d1First(env, `
    SELECT * FROM tv_pairs
    WHERE device_token_hash = ? AND status = 'approved' AND revoked_at IS NULL
  `, tokenHash);
  if (!row?.user_id) return null;
  d1Run(env, 'UPDATE tv_pairs SET last_seen_at = ? WHERE pair_code = ?', Date.now(), row.pair_code).catch(() => {});
  let profile = { name: 'Пользователь' };
  try { profile = JSON.parse(row.profile_json || '{}'); } catch {}
  return { ...row, profile };
}

async function handleAuth(request, env, incoming, ctx) {
  const path = incoming.pathname;
  try {
    if (path === '/auth/telegram/start' && request.method === 'GET') {
      ctx?.waitUntil(cleanupAuthRows(env));
      return createTelegramAuth(request, env, incoming);
    }
    if (path === '/auth/telegram/callback' && request.method === 'GET') {
      return telegramCallback(request, env, incoming);
    }
    if (!d1Configured(env)) return json({ error: 'd1_not_configured', message: 'D1 binding DB is not configured.' }, 503);

    if (path === '/auth/session/exchange' && request.method === 'POST') {
      return exchangeHandoff(env, await readJsonBody(request));
    }
    if (path === '/auth/me' && request.method === 'GET') {
      const session = await authenticateWebSession(request, env);
      if (!session) return json({ error: 'unauthorized' }, 401);
      return json({ ok: true, profile: session.profile, expiresAt: new Date(Number(session.row.expires_at)).toISOString() });
    }
    if (path === '/auth/profile' && request.method === 'PUT') {
      return updateWebProfile(request, env, await readJsonBody(request));
    }
    if (path === '/auth/logout' && request.method === 'POST') {
      return logoutWeb(request, env);
    }
    if (path === '/auth/tv/pair/start' && request.method === 'POST') {
      return insertTvPair(env, await readJsonBody(request));
    }
    if (path === '/auth/tv/pair/poll' && request.method === 'POST') {
      return pollTvPair(env, await readJsonBody(request));
    }
    if (path === '/auth/tv/pair/approve' && request.method === 'POST') {
      return approveTvPair(request, env, await readJsonBody(request));
    }

    const device = await authenticateTvDevice(request, env);
    if (!device) return json({ error: 'unauthorized', message: 'TV-сессия недействительна.' }, 401);
    if (path === '/auth/tv/me' && request.method === 'GET') {
      return json({ ok: true, profile: device.profile, deviceName: device.device_name });
    }
    if (path === '/auth/tv/state' && request.method === 'GET') {
      return json(await readUserState(env, device.user_id));
    }
    if (path === '/auth/tv/state' && request.method === 'PUT') {
      const body = await readJsonBody(request);
      const row = await writeUserState(env, device.user_id, body.state);
      if (row?.tooLarge) return json({ error: 'state_too_large' }, 413);
      return json(row);
    }
    if (path === '/auth/tv/device' && request.method === 'DELETE') {
      await d1Run(env, "UPDATE tv_pairs SET status = 'revoked', revoked_at = ? WHERE pair_code = ?", Date.now(), device.pair_code);
      return json({ ok: true });
    }
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    console.error('MVPoisk auth worker:', error);
    return json({ error: 'auth_backend_error', message: String(error?.message || error || 'Auth backend error') }, 500);
  }
}

async function handleUserApi(request, env, incoming) {
  if (!d1Configured(env)) return json({ error: 'd1_not_configured' }, 503);
  const identity = await webOrTvIdentity(request, env);
  if (!identity) return json({ error: 'unauthorized' }, 401);
  if (incoming.pathname === '/user/state' && request.method === 'GET') {
    return json(await readUserState(env, identity.userId));
  }
  if (incoming.pathname === '/user/state' && request.method === 'PUT') {
    const body = await readJsonBody(request);
    const row = await writeUserState(env, identity.userId, body.state);
    if (row?.tooLarge) return json({ error: 'state_too_large' }, 413);
    return json(row);
  }
  return json({ error: 'not_found' }, 404);
}



// ===== v40 Web Clean Player Gateway =====
const KINOBOX_ORIGINS = ['https://fbphdplay.top', 'https://api.kinobox.tv'];
const CLEAN_FRAME_MAX_BYTES = 2_500_000;
const CLEAN_RENDEX_EMBED_URL = 'https://mvcomplexsite.github.io/mvpoisk/js/rendex-clean-embed.js?v=40';
const RENDEX_ALLOWED_SUFFIXES = [
  'vibix.org', 'stravers.live', 'stloadi.live', 'graphicslab.io',
  'alloeclub.com', 'allohalive.com', 'allohastream.com', 'thealloha.com',
  'newplayjj.com', 'playjjnow.com', 'allarknow.com', 'pljjalgo.com'
];
const KINOBOX_OBRUT_BLOCK_COUNTRIES = new Set(['AU','CA','DE','JP','NL','ES','TR','GB','US','FR']);

function hostnameAllowed(hostname, suffixes) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return suffixes.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

function addNoAdsParams(rawUrl) {
  const url = new URL(rawUrl);
  if (!url.searchParams.has('noads')) url.searchParams.set('noads', '1');
  if (!url.searchParams.has('onlyNoAds')) url.searchParams.set('onlyNoAds', '1');
  return url;
}

function cleanGuardScript(originalHost, originalUrl, parentDomain) {
  const hostJson = JSON.stringify(String(originalHost || ''));
  const urlJson = JSON.stringify(String(originalUrl || ''));
  const parentJson = JSON.stringify(String(parentDomain || ''));
  return `<script>
  (()=>{
    window.__MVPOISK_CLEAN_PLAYER__=true;
    window.__MVPOISK_ORIGINAL_HOST__=${hostJson};
    window.__MVPOISK_ORIGINAL_URL__=${urlJson};
    window.__MVPOISK_PARENT_DOMAIN__=${parentJson};
    const badHosts=[
      'pagead2.googlesyndication.com','stats.g.doubleclick.net','adservice.google.com',
      'www.googleadservices.com','ad.doubleclick.net','ade.googlesyndication.com',
      'imasdk.googleapis.com','cdn.radiantmediatechs.com','pc.alloviewroll.com',
      'vak345.com','spadsync.com','adstat.yandex.ru'
    ];
    const badPath=/(^|[\\/._?&=-])(vast|vpaid|preroll|midroll|postroll|pauseroll|adserver|adservice|advert(?:ising)?|ads?)([\\/._?&=-]|$)/i;
    const bad=(value,body='')=>{
      try{
        const text=String(value&&value.url||value||'');
        const u=new URL(text,location.href);
        const h=u.hostname.toLowerCase();
        if(badHosts.some(x=>h===x||h.endsWith('.'+x))) return true;
        if(badPath.test(u.pathname+u.search)) return true;
        if(body && badPath.test(String(body))) return true;
      }catch{}
      return false;
    };
    const emptyResponse=(url)=>{
      const text=/vast|vpaid/i.test(String(url||''))?'<VAST version="4.1"></VAST>':'{}';
      const type=text[0]==='<'?'application/xml':'application/json';
      return new Response(text,{status:200,headers:{'Content-Type':type,'Cache-Control':'no-store'}});
    };
    const nativeFetch=window.fetch.bind(window);
    window.fetch=(input,init={})=>bad(input,init&&init.body)?Promise.resolve(emptyResponse(input&&input.url||input)):nativeFetch(input,init);
    const XHR=window.XMLHttpRequest;
    if(XHR){
      const open=XHR.prototype.open,send=XHR.prototype.send;
      XHR.prototype.open=function(method,url,...rest){this.__mvCleanUrl=url;return open.call(this,method,url,...rest)};
      XHR.prototype.send=function(body){
        if(bad(this.__mvCleanUrl,body)){
          try{return open.call(this,'GET','data:application/json,%7B%7D',true),send.call(this)}catch{return this.abort()}
        }
        return send.call(this,body)
      };
    }
    try{window.open=()=>null}catch{}
    const nativeBeacon=navigator.sendBeacon&&navigator.sendBeacon.bind(navigator);
    if(nativeBeacon) navigator.sendBeacon=(url,data)=>bad(url,data)?true:nativeBeacon(url,data);
    const cleanNode=node=>{
      if(!node||node.nodeType!==1)return;
      const src=node.src||node.href||'';
      if(src&&bad(src)){try{node.remove()}catch{}}
    };
    new MutationObserver(list=>list.forEach(m=>m.addedNodes.forEach(cleanNode))).observe(document.documentElement,{childList:true,subtree:true});
    addEventListener('DOMContentLoaded',()=>{try{parent.postMessage({type:'mvpoisk-clean-frame-ready'},'*')}catch{}},{once:true});
    addEventListener('error',()=>{},true);
  })();
  </script>`;
}

function replaceNamedEmbedScript(html) {
  return html.replace(/(<script\\b[^>]*\\bsrc=["'])([^"']*\\bembed(?:\\.min)?\\.js(?:\\?[^"']*)?)(["'][^>]*>)/gi,
    (_all, a, _src, c) => `${a}${CLEAN_RENDEX_EMBED_URL}${c}`);
}

function neutralizeInlineAdTags(html) {
  const marker = 'async function fetchAdTags(';
  const start = html.indexOf(marker);
  if (start < 0) return html;
  const brace = html.indexOf('{', start);
  if (brace < 0) return html;
  let level = 0;
  let quote = '';
  let escaped = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') level++;
    else if (ch === '}') {
      level--;
      if (level === 0) {
        const fn = "async function fetchAdTags(){return {preroll:'0',midroll:[{time:0,vast:'0'},{time:0,vast:'0'}],postroll:'0'};}";
        return html.slice(0, start) + fn + html.slice(i + 1);
      }
    }
  }
  return html;
}

function patchInlineOriginalHost(html) {
  return html.replace(/var playerInstance,current_video_id,domain=window\\[[^\\]]+\\]\\[[^\\]]+\\],parent_domain=/,
    "var playerInstance,current_video_id,domain=(window.__MVPOISK_ORIGINAL_HOST__||window.location.hostname),parent_domain=");
}

async function fetchHtmlForCleanFrame(upstreamUrl, request, kind = 'generic') {
  const lengthHint = Number(request.headers.get('Content-Length') || 0);
  if (lengthHint > CLEAN_FRAME_MAX_BYTES) throw new Error('frame_too_large');
  const frontend = new URL(allowedFrontendBases({ AUTH_FRONTEND_URL: DEFAULT_FRONTEND_URL })[0] || DEFAULT_FRONTEND_URL);
  const upstream = await fetch(upstreamUrl.toString(), {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0 MVPoisk CleanPlayer/39',
      'Referer': frontend.toString(),
      'Accept-Language': request.headers.get('Accept-Language') || 'ru,en;q=0.8',
    },
  });
  if (!upstream.ok) throw new Error(`upstream_frame_http_${upstream.status}`);
  const ct = String(upstream.headers.get('Content-Type') || '').toLowerCase();
  if (ct && !ct.includes('text/html') && !ct.includes('application/xhtml')) throw new Error('frame_not_html');
  const declared = Number(upstream.headers.get('Content-Length') || 0);
  if (declared && declared > CLEAN_FRAME_MAX_BYTES) throw new Error('frame_too_large');
  let html = await upstream.text();
  if (html.length > CLEAN_FRAME_MAX_BYTES) throw new Error('frame_too_large');

  const finalUrl = new URL(upstream.url || upstreamUrl.toString());
  if (kind === 'rendex') {
    html = replaceNamedEmbedScript(html);
    html = neutralizeInlineAdTags(html);
    html = patchInlineOriginalHost(html);
  }
  const injection = `<base href="${finalUrl.toString().replace(/"/g,'&quot;')}">${cleanGuardScript(finalUrl.hostname, finalUrl.toString(), frontend.hostname)}`;
  if (/<head\\b[^>]*>/i.test(html)) html = html.replace(/<head\\b[^>]*>/i, match => `${match}${injection}`);
  else html = `${injection}${html}`;

  const headers = new Headers();
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer-when-downgrade');
  headers.set('Permissions-Policy', 'autoplay=(self "*")');
  return new Response(html, { status: 200, headers });
}

function cleanFrameError(message, status = 502) {
  const safe = String(message || 'clean_frame_error').replace(/[<>&"']/g, '');
  return new Response(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000;color:#ddd;font:14px system-ui}body{display:grid;place-items:center;height:100%}</style><div>Источник временно недоступен</div><script>try{parent.postMessage({type:'mvpoisk-clean-frame-error',message:${JSON.stringify(safe)}},'*')}catch{}</script>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function fetchKinoboxSources(request, kpId) {
  const id = String(kpId || '').trim();
  if (!/^\d{1,12}$/.test(id)) throw new Error('invalid_kinopoisk_id');
  const failures = [];
  for (const origin of KINOBOX_ORIGINS) {
    try {
      const url = new URL('/api/players', origin);
      url.searchParams.set('kinopoisk', id);
      const upstream = await fetch(url.toString(), {
        redirect: 'follow',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0 MVPoisk/40',
          'Referer': `${origin}/`,
          'Origin': origin,
          'Accept-Language': request.headers.get('Accept-Language') || 'ru,en;q=0.8',
        },
      });
      if (!upstream.ok) throw new Error(`http_${upstream.status}`);
      const payload = await upstream.json();
      let rows = Array.isArray(payload?.data) ? payload.data.filter(item => item && item.iframeUrl) : [];
      const country = String(request.cf?.country || '').toUpperCase();
      if (KINOBOX_OBRUT_BLOCK_COUNTRIES.has(country)) rows = rows.filter(item => String(item.type || '').toLowerCase() !== 'obrut');
      if (rows.length) return { payload, rows, origin };
      failures.push(`${origin}:empty`);
    } catch (error) {
      failures.push(`${origin}:${String(error?.message || error)}`);
    }
  }
  throw new Error(`kinobox_all_origins_failed:${failures.join('|').slice(0, 500)}`);
}

function publicKinoboxSource(item, index) {
  const translations = Array.isArray(item?.translations) ? item.translations.slice(0, 12).map(t => ({
    name: String(t?.name || '').slice(0, 120),
    quality: String(t?.quality || '').slice(0, 40),
  })) : [];
  return { index, type: String(item?.type || '').slice(0, 80), translations };
}

async function handlePlayerGateway(request, env, incoming) {
  try {
    if (incoming.pathname === '/player/rendex/frame' && request.method === 'GET') {
      const raw = incoming.searchParams.get('u') || '';
      let url;
      try { url = addNoAdsParams(raw); } catch { return cleanFrameError('invalid_frame_url', 400); }
      if (url.protocol !== 'https:' || !hostnameAllowed(url.hostname, RENDEX_ALLOWED_SUFFIXES)) {
        return cleanFrameError('rendex_host_not_allowed', 403);
      }
      return await fetchHtmlForCleanFrame(url, request, 'rendex');
    }

    if (incoming.pathname === '/player/kinobox/sources' && request.method === 'GET') {
      const { rows } = await fetchKinoboxSources(request, incoming.searchParams.get('kp'));
      return json({ ok: true, sources: rows.map(publicKinoboxSource), count: rows.length }, 200, {
        'Cache-Control': 'public, max-age=60, s-maxage=300',
      });
    }

    if (incoming.pathname === '/player/kinobox/frame' && request.method === 'GET') {
      const kp = incoming.searchParams.get('kp');
      const index = Number(incoming.searchParams.get('i') || 0);
      if (!Number.isInteger(index) || index < 0 || index > 20) return cleanFrameError('invalid_source_index', 400);
      const { rows } = await fetchKinoboxSources(request, kp);
      const selected = rows[index];
      if (!selected?.iframeUrl) return cleanFrameError('source_not_found', 404);
      let url;
      try { url = addNoAdsParams(selected.iframeUrl); } catch { return cleanFrameError('invalid_source_url', 502); }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return cleanFrameError('unsupported_source_protocol', 403);
      return await fetchHtmlForCleanFrame(url, request, 'generic');
    }

    if (incoming.pathname === '/player/health') {
      return json({ ok: true, version: 40, cleanGateway: 'recovery', rendexAdTags: 'disabled', rendexIdentityBridge: 'enabled', kinoboxDiscovery: 'server-side+browser-fallback' });
    }
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    console.error('MVPoisk player gateway:', error);
    if (incoming.pathname.endsWith('/frame')) return cleanFrameError(error?.message || error, 502);
    return json({ error: 'player_gateway_error', message: String(error?.message || error || 'Player gateway error') }, 502);
  }
}
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

    const incoming = new URL(request.url);
    if (incoming.pathname.startsWith('/player/')) return handlePlayerGateway(request, env, incoming);
    if (incoming.pathname.startsWith('/auth/')) return handleAuth(request, env, incoming, ctx);
    if (incoming.pathname.startsWith('/user/')) return handleUserApi(request, env, incoming);

    const cache = caches.default;
    const slots = getKeySlots(env);

    if (incoming.pathname === '/' || incoming.pathname === '/health') {
      const status = await poolStatus(cache, slots);
      const callback = telegramCallbackUrl(request, env);
      return json({
        ok: true,
        service: 'MVPoisk API cache + key pool + Cloudflare accounts + clean player gateway',
        version: 40,
        upstream: 'poiskkino.dev',
        cache: 'Cloudflare Cache API',
        configuredKeys: slots.length,
        readyKeys: status.filter(item => item.state === 'ready').length,
        strategy: 'balanced pool + automatic failover',
        d1Configured: d1Configured(env),
        telegramConfigured: telegramConfigured(env),
        accountsConfigured: authConfigured(env),
        tvPairing: d1Configured(env) ? 'ready' : 'needs D1 binding DB',
        telegramCallbackUrl: callback,
        frontendUrl: allowedFrontendBases(env)[0] || DEFAULT_FRONTEND_URL,
        cleanPlayerGateway: 'recovery',
        keys: status,
      });
    }

    if (!incoming.pathname.startsWith('/api/')) {
      return json({ error: 'not_found', hint: 'Use /api/v1.4/..., /auth/... or /player/...' }, 404);
    }
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

    const upstreamPath = incoming.pathname.replace(/^\/api/, '');
    if (!/^\/v1(?:\.\d+)?\//.test(upstreamPath)) {
      return json({ error: 'unsupported_api_path' }, 400);
    }

    const normalizedQuery = normalizeSearch(incoming);
    const cacheUrl = new URL(request.url);
    cacheUrl.search = normalizedQuery ? `?${normalizedQuery}` : '';
    const cacheRequest = new Request(cacheUrl.toString(), { method: 'GET' });

    const cached = await cache.match(cacheRequest);
    if (cached) return withCacheHeaders(cached, 'HIT', '', String(slots.length));
    if (!slots.length) return json({ error: 'no_api_key_configured' }, 500);

    const upstreamUrl = new URL(`${UPSTREAM_ORIGIN}${upstreamPath}`);
    upstreamUrl.search = normalizedQuery ? `?${normalizedQuery}` : '';
    const requestIdentity = `${upstreamPath}?${normalizedQuery}`;
    const candidates = orderedSlots(slots, requestIdentity);
    const slotStates = new Map();
    await Promise.all(candidates.map(async slot => {
      slotStates.set(slot.source, await readSlotState(cache, slot));
    }));

    const errors = [];
    let attempted = 0;
    for (const slot of candidates) {
      const currentState = slotStates.get(slot.source);
      if (currentState) {
        errors.push(`key ${slot.slot}: skipped (${currentState.kind})`);
        continue;
      }
      attempted++;
      let upstream;
      try {
        upstream = await fetch(upstreamUrl.toString(), {
          method: 'GET',
          headers: {
            'X-API-KEY': slot.key,
            'Accept': 'application/json',
            'User-Agent': 'MVPoisk/2.0 (+Cloudflare Worker)',
          },
        });
      } catch (error) {
        errors.push(`key ${slot.slot}: network ${error?.message || 'error'}`);
        continue;
      }

      if (!upstream.ok) {
        const body = await smallErrorText(upstream.clone());
        const failure = classifyFailure(upstream, body);
        if (failure) ctx.waitUntil(markSlotState(cache, slot, failure.kind, failure.cooldown, `HTTP ${upstream.status}`));
        errors.push(`key ${slot.slot}: HTTP ${upstream.status}${failure ? ` (${failure.kind})` : ''}${body ? ` ${body}` : ''}`);
        if (shouldTryAnotherKey(upstream.status)) continue;
        return json({ error: 'upstream_error', status: upstream.status, details: errors }, upstream.status || 502, {
          'X-MVPoisk-Cache': 'MISS',
          'X-MVPoisk-Key-Pool': String(slots.length),
        });
      }

      const ttl = cacheSeconds(upstreamPath);
      const headers = new Headers(upstream.headers);
      headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json; charset=utf-8');
      headers.set('Cache-Control', `public, max-age=300, s-maxage=${ttl}, stale-while-revalidate=86400`);
      for (const [name, value] of Object.entries(corsHeaders())) headers.set(name, value);
      headers.set('X-MVPoisk-Cache', 'MISS');
      headers.set('X-MVPoisk-Upstream-Key', String(slot.slot));
      headers.set('X-MVPoisk-Key-Pool', String(slots.length));
      if (remainingQuota(upstream) === 0) ctx.waitUntil(markSlotState(cache, slot, 'quota_exhausted', DEFAULT_QUOTA_COOLDOWN_SECONDS, 'remaining=0'));

      const response = new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
      ctx.waitUntil(cache.put(cacheRequest, response.clone()));
      return response;
    }

    return json({
      error: 'api_key_pool_exhausted',
      configuredKeys: slots.length,
      attemptedKeys: attempted,
      details: errors,
      retryHint: 'Keys in cooldown are retried automatically later.',
    }, 429, {
      'Retry-After': '120',
      'X-MVPoisk-Cache': 'MISS',
      'X-MVPoisk-Key-Pool': String(slots.length),
    });
  },
};
