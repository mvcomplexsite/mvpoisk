const ALLOWED_ORIGINS = new Set([
  'https://mvcomplexsite.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);

const UPSTREAMS = {
  partner: 'https://fbhdplay.top/api/players',
  kinobox: 'https://kinobox.tv/api/players',
};

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

async function readPreview(response, limit = 4096) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (bytes < limit) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const room = Math.max(0, limit - bytes);
      const slice = value.byteLength > room ? value.slice(0, room) : value;
      bytes += slice.byteLength;
      text += decoder.decode(slice, { stream: true });
      if (value.byteLength > room) break;
    }
    text += decoder.decode();
  } catch (_) {
    // Diagnostic preview only.
  } finally {
    try { await reader.cancel(); } catch (_) {}
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, limit);
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
    if (incoming.pathname !== '/players') {
      return json({
        ok: true,
        service: 'mvpoisk-player-proxy',
        version: 11,
        endpoint: '/players?source=kinobox&kinopoisk=258687',
        note: 'v11 streams successful upstream JSON instead of parsing it inside the Worker',
      }, 200, origin);
    }

    const source = incoming.searchParams.get('source') || 'kinobox';
    const upstreamBase = UPSTREAMS[source];
    if (!upstreamBase) {
      return json({ error: 'unknown_source', allowed: Object.keys(UPSTREAMS) }, 400, origin);
    }

    const allowedKeys = ['kinopoisk', 'imdb', 'tmdb', 'title', 'query'];
    const query = new URLSearchParams();
    for (const key of allowedKeys) {
      const value = incoming.searchParams.get(key);
      if (value) query.set(key, value.slice(0, 200));
    }
    if (![...query.keys()].length) {
      return json({ error: 'missing_search_parameter' }, 400, origin);
    }

    const target = `${upstreamBase}?${query.toString()}`;
    let response;
    try {
      response = await fetch(target, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'follow',
      });
    } catch (error) {
      return json({
        error: 'upstream_fetch_failed',
        upstream: source,
        message: error?.message || 'fetch failed',
      }, 502, origin, { 'X-MVPoisk-Upstream': source });
    }

    if (!response.ok) {
      const preview = await readPreview(response, 4096);
      return json({
        error: 'upstream_http_error',
        upstream: source,
        status: response.status,
        statusText: response.statusText,
        bodyPreview: preview,
      }, 502, origin, {
        'X-MVPoisk-Upstream': source,
        'X-MVPoisk-Upstream-Status': String(response.status),
      });
    }

    // IMPORTANT: do not call response.json()/text() here.
    // Some upstream responses exceed Cloudflare Worker's memory limit when buffered.
    // Stream the body to the browser and let MVPoisk parse the JSON client-side.
    const headers = {
      ...corsHeaders(origin),
      'Content-Type': response.headers.get('Content-Type') || 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=120',
      'X-MVPoisk-Upstream': source,
      'X-MVPoisk-Upstream-Status': String(response.status),
    };
    return new Response(response.body, { status: 200, headers });
  },
};
