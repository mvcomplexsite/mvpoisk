const ALLOWED_ORIGINS = new Set([
  'https://mvcomplexsite.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);

const UPSTREAMS = [
  { name: 'partner', url: 'https://fbhdplay.top/api/players' },
  { name: 'kinobox', url: 'https://kinobox.tv/api/players' },
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://mvcomplexsite.github.io';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(data, status, origin, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store',
      ...corsHeaders(origin),
      ...extra,
    },
  });
}

function normalize(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.players)) return payload.players;
  return [];
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, origin);

    const incoming = new URL(request.url);
    if (incoming.pathname !== '/players') {
      return json({ ok: true, service: 'mvpoisk-player-proxy', endpoint: '/players?kinopoisk=258687' }, 200, origin);
    }

    const allowedKeys = ['kinopoisk', 'imdb', 'tmdb', 'title'];
    const query = new URLSearchParams();
    for (const key of allowedKeys) {
      const value = incoming.searchParams.get(key);
      if (value) query.set(key, value.slice(0, 200));
    }
    if (![...query.keys()].length) return json({ error: 'missing_search_parameter' }, 400, origin);

    const errors = [];
    for (const upstream of UPSTREAMS) {
      const target = `${upstream.url}?${query.toString()}`;
      try {
        const response = await fetch(target, {
          headers: { Accept: 'application/json' },
          cf: { cacheTtl: 300, cacheEverything: true },
        });
        if (!response.ok) {
          errors.push(`${upstream.name}: HTTP ${response.status}`);
          continue;
        }
        const payload = await response.json();
        const players = normalize(payload).filter(item => item && item.success !== false && (item.iframeUrl || item.translations?.some?.(t => t?.iframeUrl)));
        if (!players.length) {
          errors.push(`${upstream.name}: no players`);
          continue;
        }
        return json({ data: players, upstream: upstream.name }, 200, origin);
      } catch (error) {
        errors.push(`${upstream.name}: ${error?.message || 'fetch error'}`);
      }
    }

    return json({ error: 'no_upstream_available', details: errors }, 502, origin);
  },
};
