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


// ===== MVPoisk Accounts / TV pairing =====
const TV_PAIR_TTL_SECONDS = 10 * 60;
const TV_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function supabaseSettings(env) {
  return {
    url: String(env.SUPABASE_URL || '').replace(/\/$/, ''),
    serviceKey: String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || ''),
  };
}

function authConfigured(env) {
  const cfg = supabaseSettings(env);
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(cfg.url) && cfg.serviceKey.length > 20;
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

function randomCode(length = 6) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += TV_CODE_ALPHABET[byte % TV_CODE_ALPHABET.length];
  return out;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function validHash(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ''));
}

async function supabaseFetch(env, path, options = {}) {
  const cfg = supabaseSettings(env);
  if (!authConfigured(env)) throw new Error('supabase_not_configured');
  const baseHeaders = {
    apikey: cfg.serviceKey,
    'Content-Type': 'application/json',
  };
  // Legacy service_role keys are JWTs and can be sent as Bearer. New
  // sb_secret_ keys must stay in the apikey header only.
  if (!cfg.serviceKey.startsWith('sb_secret_')) baseHeaders.Authorization = `Bearer ${cfg.serviceKey}`;
  const response = await fetch(`${cfg.url}${path}`, {
    ...options,
    headers: {
      ...baseHeaders,
      ...(options.headers || {}),
    },
  });
  return response;
}

async function supabaseJson(env, path, options = {}) {
  const response = await supabaseFetch(env, path, options);
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(data?.message || data?.error_description || data?.error || `Supabase HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return { data, response };
}

async function validateSupabaseUser(request, env) {
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || match[1].startsWith('mvptv_')) return null;
  const cfg = supabaseSettings(env);
  if (!authConfigured(env)) return null;
  const response = await fetch(`${cfg.url}/auth/v1/user`, {
    headers: {
      apikey: cfg.serviceKey,
      Authorization: `Bearer ${match[1]}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) return null;
  try { return await response.json(); } catch { return null; }
}

function profileFromAuthUser(user) {
  if (!user) return { name: 'Пользователь' };
  const identity = Array.isArray(user.identities)
    ? user.identities.find(item => String(item?.provider || '').includes('telegram')) || user.identities[0]
    : null;
  const meta = { ...(identity?.identity_data || {}), ...(user?.user_metadata || {}) };
  return {
    name: String(meta.name || meta.full_name || meta.display_name || meta.given_name || meta.preferred_username || 'Пользователь'),
    username: String(meta.preferred_username || meta.username || '').replace(/^@/, ''),
    avatarUrl: String(meta.picture || meta.avatar_url || ''),
    telegramId: String(meta.id || meta.sub || identity?.provider_id || ''),
  };
}

async function insertTvPair(env, body) {
  const claimSecretHash = String(body.claimSecretHash || '').toLowerCase();
  const deviceTokenHash = String(body.deviceTokenHash || '').toLowerCase();
  const deviceName = String(body.deviceName || 'MVPoisk TV').slice(0, 120);
  if (!validHash(claimSecretHash) || !validHash(deviceTokenHash)) {
    return json({ error: 'invalid_pair_request', message: 'Некорректный запрос подключения.' }, 400);
  }

  const expiresAt = new Date(Date.now() + TV_PAIR_TTL_SECONDS * 1000).toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(6);
    try {
      const { data } = await supabaseJson(env, '/rest/v1/mvpoisk_tv_devices', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          pair_code: code,
          claim_secret_hash: claimSecretHash,
          device_token_hash: deviceTokenHash,
          device_name: deviceName,
          status: 'pending',
          expires_at: expiresAt,
        }),
      });
      if (Array.isArray(data) && data[0]) {
        return json({ code, displayCode: formatCode(code), expiresAt }, 201);
      }
    } catch (error) {
      if (error.status === 409) continue;
      throw error;
    }
  }
  return json({ error: 'pair_code_generation_failed' }, 503);
}

async function findPair(env, code, extraQuery = '') {
  const clean = cleanCode(code);
  if (clean.length < 6) return null;
  const query = `/rest/v1/mvpoisk_tv_devices?pair_code=eq.${encodeURIComponent(clean)}${extraQuery}&select=id,pair_code,claim_secret_hash,device_token_hash,device_name,user_id,profile,status,expires_at,approved_at,revoked_at`;
  const { data } = await supabaseJson(env, query, { method: 'GET' });
  return Array.isArray(data) ? data[0] || null : null;
}

function pairExpired(row) {
  return !row?.expires_at || Date.parse(row.expires_at) <= Date.now();
}

async function approveTvPair(request, env, body) {
  const user = await validateSupabaseUser(request, env);
  if (!user?.id) return json({ error: 'unauthorized', message: 'Сначала войдите в MVPoisk через Telegram.' }, 401);
  const row = await findPair(env, body.code);
  if (!row || row.revoked_at) return json({ error: 'invalid_code', message: 'Код не найден.' }, 404);
  if (pairExpired(row)) return json({ error: 'expired_code', message: 'Код подключения истёк.' }, 410);
  if (row.status === 'approved' && row.user_id && row.user_id !== user.id) return json({ error: 'already_approved' }, 409);

  const now = new Date().toISOString();
  await supabaseJson(env, `/rest/v1/mvpoisk_tv_devices?id=eq.${encodeURIComponent(row.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: user.id,
      profile: profileFromAuthUser(user),
      status: 'approved',
      approved_at: now,
      last_seen_at: now,
    }),
  });
  return json({ ok: true, status: 'approved', deviceName: row.device_name });
}

async function pollTvPair(env, body) {
  const row = await findPair(env, body.code);
  if (!row || row.revoked_at) return json({ status: 'invalid' }, 404);
  const supplied = String(body.claimSecretHash || '').toLowerCase();
  if (!validHash(supplied) || supplied !== String(row.claim_secret_hash || '').toLowerCase()) {
    return json({ error: 'forbidden' }, 403);
  }
  if (row.status !== 'approved' && pairExpired(row)) return json({ status: 'expired' }, 410);
  if (row.status !== 'approved' || !row.user_id) return json({ status: 'pending', expiresAt: row.expires_at });
  return json({ status: 'approved', profile: row.profile || { name: 'Пользователь' }, deviceName: row.device_name });
}

async function authenticateTvDevice(request, env) {
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+(mvptv_[A-Za-z0-9_-]{20,})$/i.exec(header);
  if (!match) return null;
  const tokenHash = await sha256Hex(match[1]);
  const path = `/rest/v1/mvpoisk_tv_devices?device_token_hash=eq.${tokenHash}&status=eq.approved&revoked_at=is.null&select=id,user_id,device_name,profile,status,revoked_at`;
  const { data } = await supabaseJson(env, path, { method: 'GET' });
  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.user_id) return null;
  // Best-effort activity timestamp; do not block the main request if it fails.
  supabaseJson(env, `/rest/v1/mvpoisk_tv_devices?id=eq.${encodeURIComponent(row.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
  }).catch(() => {});
  return row;
}

async function readUserState(env, userId) {
  const { data } = await supabaseJson(env, `/rest/v1/mvpoisk_user_state?user_id=eq.${encodeURIComponent(userId)}&select=state,updated_at`, { method: 'GET' });
  return Array.isArray(data) ? data[0] || null : null;
}

async function writeUserState(env, userId, state) {
  const safeState = state && typeof state === 'object' ? state : {};
  const raw = JSON.stringify(safeState);
  if (raw.length > 1_600_000) return { tooLarge: true };
  const { data } = await supabaseJson(env, '/rest/v1/mvpoisk_user_state?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ user_id: userId, state: safeState }),
  });
  return Array.isArray(data) ? data[0] || null : data;
}

async function handleAuth(request, env, incoming) {
  if (!authConfigured(env)) return json({ error: 'auth_not_configured', message: 'Supabase secrets are not configured on the Worker.' }, 503);
  const path = incoming.pathname;

  try {
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
      return json({ ok: true, profile: device.profile || { name: 'Пользователь' }, deviceName: device.device_name });
    }
    if (path === '/auth/tv/state' && request.method === 'GET') {
      const row = await readUserState(env, device.user_id);
      return json(row || null);
    }
    if (path === '/auth/tv/state' && request.method === 'PUT') {
      const body = await readJsonBody(request);
      const row = await writeUserState(env, device.user_id, body.state);
      if (row?.tooLarge) return json({ error: 'state_too_large' }, 413);
      return json(row || { state: body.state, updated_at: new Date().toISOString() });
    }
    if (path === '/auth/tv/device' && request.method === 'DELETE') {
      await supabaseJson(env, `/rest/v1/mvpoisk_tv_devices?id=eq.${encodeURIComponent(device.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'revoked', revoked_at: new Date().toISOString() }),
      });
      return json({ ok: true });
    }
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    console.error('MVPoisk auth worker:', error);
    return json({ error: 'auth_backend_error', message: error?.message || 'Auth backend error' }, error?.status && error.status < 500 ? error.status : 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

    const incoming = new URL(request.url);
    if (incoming.pathname.startsWith('/auth/')) return handleAuth(request, env, incoming);
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

    const cache = caches.default;
    const slots = getKeySlots(env);

    if (incoming.pathname === '/' || incoming.pathname === '/health') {
      const status = await poolStatus(cache, slots);
      return json({
        ok: true,
        service: 'MVPoisk API cache + key pool + TV auth bridge',
        version: 36,
        upstream: 'poiskkino.dev',
        cache: 'Cloudflare Cache API',
        configuredKeys: slots.length,
        readyKeys: status.filter(item => item.state === 'ready').length,
        strategy: 'balanced pool + automatic failover',
        accountsConfigured: authConfigured(env),
        tvPairing: authConfigured(env) ? 'ready' : 'needs SUPABASE_URL + SUPABASE_SECRET_KEY',
        keys: status,
      });
    }

    if (!incoming.pathname.startsWith('/api/')) {
      return json({ error: 'not_found', hint: 'Use /api/v1.4/...' }, 404);
    }

    const upstreamPath = incoming.pathname.replace(/^\/api/, '');
    if (!/^\/v1(?:\.\d+)?\//.test(upstreamPath)) {
      return json({ error: 'unsupported_api_path' }, 400);
    }

    const normalizedQuery = normalizeSearch(incoming);
    const cacheUrl = new URL(request.url);
    cacheUrl.search = normalizedQuery ? `?${normalizedQuery}` : '';
    const cacheRequest = new Request(cacheUrl.toString(), { method: 'GET' });

    const cached = await cache.match(cacheRequest);
    if (cached) return withCacheHeaders(cached, 'HIT', '', slots.length);

    if (!slots.length) return json({ error: 'no_api_key_configured' }, 500);

    const upstreamUrl = new URL(`${UPSTREAM_ORIGIN}${upstreamPath}`);
    upstreamUrl.search = normalizedQuery ? `?${normalizedQuery}` : '';

    // Spread cache misses across the whole pool. The same request on the same
    // day starts from the same key, which keeps distribution predictable.
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
        if (failure) {
          ctx.waitUntil(markSlotState(cache, slot, failure.kind, failure.cooldown, `HTTP ${upstream.status}`));
        }

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

      // If the provider exposes a remaining-quota header and it reached zero,
      // cool the key down after successfully returning this last response.
      if (remainingQuota(upstream) === 0) {
        ctx.waitUntil(markSlotState(cache, slot, 'quota_exhausted', DEFAULT_QUOTA_COOLDOWN_SECONDS, 'remaining=0'));
      }

      const response = new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
      ctx.waitUntil(cache.put(cacheRequest, response.clone()));
      return response;
    }

    // All currently available keys failed or are cooling down. A 429 makes the
    // frontend use its stale local cache instead of treating this as a broken page.
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
