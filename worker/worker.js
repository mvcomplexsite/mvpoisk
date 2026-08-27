const ALLOWED_ORIGINS = new Set([
  'https://mvcomplexsite.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);

const PARTNER_URL = 'https://fbhdplay.top/api/players';
const KINOBOX_URLS = [
  'https://api.kinobox.tv/api/players',
  'https://kinobox.tv/api/players',
];

// One source per request keeps Kinobox responses small and stays below
// the documented 2 requests/sec limit by spacing attempts.
const KINOBOX_SOURCES = ['kodik', 'alloha', 'videocdn', 'collaps'];
const MAX_JSON_BYTES = 768 * 1024; // 768 KiB hard cap
const FETCH_TIMEOUT_MS = 10000;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://mvcomplexsite.github.io';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Access-Control-Expose-Headers': 'X-MVPoisk-Upstream, X-MVPoisk-Upstream-Status',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(data, status, origin, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=120' : 'no-store',
      ...corsHeaders(origin),
      ...extra,
    },
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalize(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.players)
        ? payload.players
        : [];

  return list.map((item, index) => {
    const translations = Array.isArray(item?.translations) ? item.translations : [];
    const translation = translations.find(t => t?.iframeUrl) || translations[0] || null;
    return {
      source: String(item?.source || item?.type || `source-${index + 1}`),
      iframeUrl: String(item?.iframeUrl || translation?.iframeUrl || ''),
      success: item?.success !== false,
    };
  }).filter(item => item.success && /^https?:\/\//i.test(item.iframeUrl));
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readSmallJson(response) {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const contentLength = Number(response.headers.get('content-length') || 0);

  if (contentLength && contentLength > MAX_JSON_BYTES) {
    try { await response.body?.cancel(); } catch (_) {}
    throw new Error(`response_too_large:${contentLength}`);
  }

  if (!contentType.includes('json') && !contentType.includes('javascript') && !contentType.includes('text/plain')) {
    try { await response.body?.cancel(); } catch (_) {}
    throw new Error(`unexpected_content_type:${contentType || 'unknown'}`);
  }

  if (!response.body) throw new Error('empty_body');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_JSON_BYTES) {
        try { await reader.cancel(); } catch (_) {}
        throw new Error(`response_too_large_stream:${total}`);
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const text = new TextDecoder().decode(merged).trim();
  if (!text) throw new Error('empty_text');
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(`invalid_json:${text.slice(0, 180).replace(/\s+/g, ' ')}`);
  }
}

async function requestJson(url) {
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'identity',
      'User-Agent': 'MVPoisk-Player-Proxy/12',
    },
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location') || '';
    try { await response.body?.cancel(); } catch (_) {}
    throw new Error(`redirect:${response.status}:${location.slice(0, 160)}`);
  }
  if (!response.ok) {
    const status = response.status;
    const type = response.headers.get('content-type') || '';
    try { await response.body?.cancel(); } catch (_) {}
    throw new Error(`http_${status}:${type}`);
  }

  return await readSmallJson(response);
}

function buildSearchQuery(incoming) {
  const keys = ['kinopoisk', 'imdb', 'tmdb', 'title', 'query'];
  const query = new URLSearchParams();
  for (const key of keys) {
    const value = incoming.searchParams.get(key);
    if (value) query.set(key, value.slice(0, 200));
  }
  return query;
}

async function tryKinobox(query) {
  const errors = [];

  for (const base of KINOBOX_URLS) {
    for (let i = 0; i < KINOBOX_SOURCES.length; i++) {
      const source = KINOBOX_SOURCES[i];
      const q = new URLSearchParams(query);
      q.set('sources', source);
      const target = `${base}?${q.toString()}`;
      try {
        const payload = await requestJson(target);
        const players = normalize(payload);
        if (players.length) {
          return {
            players: players.slice(0, 2),
            upstream: base.includes('api.kinobox.tv') ? 'kinobox-api' : 'kinobox-web',
            selectedSource: source,
            errors,
          };
        }
        errors.push(`${base}/${source}: no players`);
      } catch (error) {
        errors.push(`${base}/${source}: ${error?.message || 'fetch error'}`);
      }
      // Kinobox docs state max 2 requests/sec per IP.
      if (i < KINOBOX_SOURCES.length - 1) await sleep(650);
    }
  }

  return { players: [], upstream: 'kinobox', errors };
}

async function tryPartner(query) {
  const target = `${PARTNER_URL}?${query.toString()}`;
  try {
    const payload = await requestJson(target);
    return { players: normalize(payload).slice(0, 3), upstream: 'partner', errors: [] };
  } catch (error) {
    return { players: [], upstream: 'partner', errors: [error?.message || 'fetch error'] };
  }
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405, origin);
    }

    const incoming = new URL(request.url);
    if (incoming.pathname === '/') {
      return json({
        ok: true,
        service: 'mvpoisk-player-proxy',
        version: 12,
        endpoint: '/players?source=kinobox&kinopoisk=258687',
        note: 'bounded JSON proxy; never streams arbitrary upstream bodies',
      }, 200, origin);
    }

    if (incoming.pathname !== '/players') {
      return json({ error: 'not_found' }, 404, origin);
    }

    const query = buildSearchQuery(incoming);
    if (![...query.keys()].length) {
      return json({ error: 'missing_search_parameter' }, 400, origin);
    }

    const requestedSource = incoming.searchParams.get('source') || 'kinobox';
    const result = requestedSource === 'partner'
      ? await tryPartner(query)
      : await tryKinobox(query);

    if (result.players.length) {
      return json({
        data: result.players,
        upstream: result.upstream,
        selectedSource: result.selectedSource || null,
      }, 200, origin, {
        'X-MVPoisk-Upstream': result.upstream,
        'X-MVPoisk-Upstream-Status': '200',
      });
    }

    return json({
      error: 'no_players',
      upstream: result.upstream,
      details: result.errors.slice(0, 12),
    }, 502, origin, {
      'X-MVPoisk-Upstream': result.upstream,
    });
  },
};
