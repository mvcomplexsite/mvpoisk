// MVPoisk public frontend configuration.
// API key is intentionally client-side for this deployment.
export const CONFIG = Object.freeze({
  API_BASE: 'https://api.poiskkino.dev/v1.4',
  API_KEY: 'MD2PV7Q-WPYM4Y8-GKQER3G-10WHNCP',
  GGPOISK_BASE: 'https://www.ggpoisk.ru',
  SOCIAL_ALIAS: 'MTU3OTQxNTUy',

  // The Kinobox client is hosted locally so content blockers cannot block
  // the player bootstrap script itself. Backends are tried in order.
  PLAYER_SCRIPT_URL: './js/kinobox.js?v=5',
  PLAYER_BACKENDS: [
    { name: 'Партнёрский', url: 'https://fbhdplay.top/' },
    { name: 'Резервный Kinobox', url: 'https://api.kinobox.tv/' },
  ],
  PLAYER_ATTEMPT_TIMEOUT_MS: 9000,

  PAGE_SIZE: 20,
  CACHE_TTL_MS: 10 * 60 * 1000,
});

export function getWatchUrl(kpId) {
  const id = encodeURIComponent(String(kpId));
  const alias = encodeURIComponent(CONFIG.SOCIAL_ALIAS);
  return `${CONFIG.GGPOISK_BASE}/film/${id}/?socialAlias=${alias}`;
}
