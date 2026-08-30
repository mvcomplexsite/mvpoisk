// MVPoisk frontend configuration.
// Movie data, Telegram auth, account sync and TV pairing are all served by
// the MVPoisk Cloudflare Worker.
export const CONFIG = Object.freeze({
  API_BASE: 'https://mvpoisk.cizikvpn.workers.dev/api/v1.4',

  // ===== Accounts (Cloudflare Worker + D1 + Telegram OIDC) =====
  // No Supabase keys are used in the browser anymore.
  AUTH_WORKER_BASE: 'https://mvpoisk.cizikvpn.workers.dev',

  GGPOISK_BASE: 'https://www.ggpoisk.ru',
  RENDEX_SDK_URL: 'https://graphicslab.io/sdk/v2/rendex-sdk.min.js',
  RENDEX_PUBLISHER_ID: '668474171',
  KINOBOX_SDK_URL: 'https://fbphdplay.top/kinobox.js',
  KINOBOX_BASE_URL: 'https://fbphdplay.top/',
  PLAYER_LOAD_TIMEOUT_MS: 15000,
  SOCIAL_ALIAS: 'MTU3OTQxNTUy',
  PAGE_SIZE: 20,
  API_BATCH_SIZE: 240,
  API_FREE_PAGE_LIMIT: 10,
  CACHE_TTL_MS: 60 * 60 * 1000,
  STALE_CACHE_TTL_MS: 7 * 24 * 60 * 60 * 1000,
});

export function getWatchUrl(kpId) {
  const id = encodeURIComponent(String(kpId));
  const alias = encodeURIComponent(CONFIG.SOCIAL_ALIAS);
  return `${CONFIG.GGPOISK_BASE}/film/${id}/?socialAlias=${alias}`;
}
