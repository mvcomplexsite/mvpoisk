// MVPoisk API cache + API-key pool for Cloudflare Workers.
// v20: balanced key pool, automatic failover and temporary cooldowns.
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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
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

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

    const incoming = new URL(request.url);
    const cache = caches.default;
    const slots = getKeySlots(env);

    if (incoming.pathname === '/' || incoming.pathname === '/health') {
      const status = await poolStatus(cache, slots);
      return json({
        ok: true,
        service: 'MVPoisk API cache + key pool',
        version: 20,
        upstream: 'poiskkino.dev',
        cache: 'Cloudflare Cache API',
        configuredKeys: slots.length,
        readyKeys: status.filter(item => item.state === 'ready').length,
        strategy: 'balanced pool + automatic failover',
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
