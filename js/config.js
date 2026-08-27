// MVPoisk public frontend configuration.
// API key is intentionally client-side for this deployment.
export const CONFIG = Object.freeze({
  API_BASE: 'https://api.poiskkino.dev/v1.4',
  API_KEY: 'MD2PV7Q-WPYM4Y8-GKQER3G-10WHNCP',
  GGPOISK_BASE: 'https://www.ggpoisk.ru',
  SOCIAL_ALIAS: 'MTU3OTQxNTUy',

  // Player discovery endpoints. MVPoisk reads the JSON itself and only embeds
  // a frame after a real iframeUrl has been returned.
  PLAYER_APIS: [
    { name: 'Партнёрский', url: 'https://fbhdplay.top/api/players' },
    { name: 'Kinobox', url: 'https://kinobox.tv/api/players' },
  ],
  PLAYER_API_TIMEOUT_MS: 6500,

  // Development/test CORS fallback. Only the small JSON response from the
  // player-discovery API goes through this proxy; video/iframe traffic does not.
  PLAYER_CORS_PROXIES: [
    { name: 'AllOrigins', build: target => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}` },
  ],

  PAGE_SIZE: 20,
  CACHE_TTL_MS: 10 * 60 * 1000,
});

export function getWatchUrl(kpId) {
  const id = encodeURIComponent(String(kpId));
  const alias = encodeURIComponent(CONFIG.SOCIAL_ALIAS);
  return `${CONFIG.GGPOISK_BASE}/film/${id}/?socialAlias=${alias}`;
}
