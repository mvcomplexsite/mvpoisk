const PROXY_BASE = 'https://wsrv.nl/';

function cleanUrls(urls) {
  const list = Array.isArray(urls) ? urls : [urls];
  return [...new Set(list
    .map(value => String(value || '').trim())
    .filter(value => /^https?:\/\//i.test(value)))];
}

function escapeAttr(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[ch]));
}

/**
 * Route remote artwork through an image cache/CDN.
 * This keeps KinoPoisk/Yandex image hosts out of the normal browser request path
 * on networks where those hosts are slow or filtered.
 */
export function imageUrl(url, { width, quality = 82 } = {}) {
  const raw = String(url || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';

  const params = new URLSearchParams();
  params.set('url', raw);
  if (width) params.set('w', String(width));
  params.set('output', 'webp');
  params.set('q', String(quality));
  params.set('maxage', '30d');

  return `${PROXY_BASE}?${params.toString()}`;
}

/**
 * Ordered image sources:
 * 1) proxied originals, 2) direct originals.
 * If a full-size poster fails, previewUrl can still succeed before we give up.
 */
export function imageCandidates(urls, options = {}) {
  const raw = cleanUrls(urls);
  const proxied = raw.map(url => imageUrl(url, options)).filter(Boolean);
  return [...new Set([...proxied, ...raw])];
}

/** Build safe attributes for an <img> with automatic source rotation. */
export function imageAttrs(urls, options = {}) {
  const candidates = imageCandidates(urls, options);
  if (!candidates.length) return '';

  const [first, ...fallbacks] = candidates;
  const encodedFallbacks = escapeAttr(JSON.stringify(fallbacks));
  return `data-image-fallback src="${escapeAttr(first)}" data-image-candidates="${encodedFallbacks}" referrerpolicy="no-referrer"`;
}

/**
 * On image error rotate through the prepared candidate URLs.
 * After the final failure the image is hidden and the styled fallback underneath
 * remains visible. This is deliberately isolated from API/catalog logic.
 */
export function bindImageFallbacks(root = document) {
  root.querySelectorAll('img[data-image-fallback]').forEach(node => {
    if (node.dataset.fallbackBound === '1') return;
    node.dataset.fallbackBound = '1';

    let candidates = [];
    try {
      const parsed = JSON.parse(node.dataset.imageCandidates || '[]');
      candidates = Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      candidates = [];
    }

    const tryNext = () => {
      const next = candidates.shift();
      if (next) {
        node.hidden = false;
        node.src = next;
        return;
      }
      node.hidden = true;
      node.removeEventListener('error', tryNext);
    };

    node.addEventListener('error', tryNext);

    // innerHTML can start loading before the listener is attached.
    if (node.complete && node.naturalWidth === 0) {
      queueMicrotask(tryNext);
    }
  });
}
