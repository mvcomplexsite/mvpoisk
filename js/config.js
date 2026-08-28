// MVPoisk frontend configuration.
// Movie data is requested through the MVPoisk Cloudflare Worker so the
// upstream token is not exposed to every browser request and responses can
// be shared from one cache between all visitors.
export const CONFIG = Object.freeze({
  API_BASE: 'https://mvpoisk.cizikvpn.workers.dev/api/v1.4',
  GGPOISK_BASE: 'https://www.ggpoisk.ru',
  RENDEX_SDK_URL: 'https://graphicslab.io/sdk/v2/rendex-sdk.min.js',
  RENDEX_PUBLISHER_ID: '668474171',
  // Optional reserve player supplied by the second partner. It is loaded only
  // after the user explicitly chooses “Другой источник”.
  KINOBOX_SDK_URL: 'https://fbphdplay.top/kinobox.js',
  KINOBOX_BASE_URL: 'https://fbphdplay.top/',
  PLAYER_LOAD_TIMEOUT_MS: 15000,
  SOCIAL_ALIAS: 'MTU3OTQxNTUy',
  PAGE_SIZE: 20,
  // Demo/free API allows only the first 10 upstream pages. Request a larger
  // batch and split it into normal 20-item MVPoisk pages client-side.
  API_BATCH_SIZE: 240,
  API_FREE_PAGE_LIMIT: 10,
  // Browser cache is only a second line of defence. The main shared cache is
  // inside the Cloudflare Worker.
  CACHE_TTL_MS: 60 * 60 * 1000,
  STALE_CACHE_TTL_MS: 7 * 24 * 60 * 60 * 1000,
});

export function getWatchUrl(kpId) {
  const id = encodeURIComponent(String(kpId));
  const alias = encodeURIComponent(CONFIG.SOCIAL_ALIAS);
  return `${CONFIG.GGPOISK_BASE}/film/${id}/?socialAlias=${alias}`;
}
