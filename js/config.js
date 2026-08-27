// MVPoisk public frontend configuration.
// API key is intentionally client-side for this GitHub Pages deployment.
export const CONFIG = Object.freeze({
  API_BASE: 'https://api.poiskkino.dev/v1.4',
  API_KEY: 'MD2PV7Q-WPYM4Y8-GKQER3G-10WHNCP',
  GGPOISK_BASE: 'https://www.ggpoisk.ru',
  SOCIAL_ALIAS: 'MTU3OTQxNTUy',
  PAGE_SIZE: 20,
  // Demo/free API allows only the first 10 API pages. We request a larger
  // batch and split it into normal 20-item MVPoisk pages client-side.
  API_BATCH_SIZE: 240,
  API_FREE_PAGE_LIMIT: 10,
  CACHE_TTL_MS: 10 * 60 * 1000,
});

export function getWatchUrl(kpId) {
  const id = encodeURIComponent(String(kpId));
  const alias = encodeURIComponent(CONFIG.SOCIAL_ALIAS);
  return `${CONFIG.GGPOISK_BASE}/film/${id}/?socialAlias=${alias}`;
}
