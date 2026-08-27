// MVPoisk public frontend configuration.
// API key is intentionally client-side for this deployment.
export const CONFIG = Object.freeze({
  API_BASE: 'https://api.poiskkino.dev/v1.4',
  API_KEY: 'MD2PV7Q-WPYM4Y8-GKQER3G-10WHNCP',
  GGPOISK_BASE: 'https://www.ggpoisk.ru',
  SOCIAL_ALIAS: 'MTU3OTQxNTUy',

  // Optional server-side proxy for player discovery.
  // After deploying worker/worker.js, paste its /players URL here.
  PLAYER_PROXY_URL: '',
  KINOBOX_EMBED_BASE: 'https://kinobox.tv/embed/#',


  PAGE_SIZE: 20,
  CACHE_TTL_MS: 10 * 60 * 1000,
});

export function getWatchUrl(kpId) {
  const id = encodeURIComponent(String(kpId));
  const alias = encodeURIComponent(CONFIG.SOCIAL_ALIAS);
  return `${CONFIG.GGPOISK_BASE}/film/${id}/?socialAlias=${alias}`;
}
