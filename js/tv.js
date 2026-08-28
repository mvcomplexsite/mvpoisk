const params = new URLSearchParams(location.search);
const ua = navigator.userAgent || '';
const forced = params.get('tv');
const uaLooksLikeTV = /MVPoiskTV|Android TV|GoogleTV|BRAVIA|SmartTV|SMART-TV|HbbTV|NetCast|Web0S|AFT[A-Z0-9]*|TV Safari/i.test(ua);
const saved = localStorage.getItem('mvpoisk:tv-mode:v1') === '1';
const isTV = forced === '1' || (forced !== '0' && (uaLooksLikeTV || saved));

if (!isTV) {
  document.documentElement.classList.remove('tv-mode');
} else {
  document.documentElement.classList.add('tv-mode');
  document.body?.classList.add('tv-mode');
  try { localStorage.setItem('mvpoisk:tv-mode:v1', '1'); } catch {}
}

function withTv(url) {
  if (!isTV || !url) return url;
  try {
    const parsed = new URL(url, location.href);
    if (parsed.origin !== location.origin) return url;
    parsed.searchParams.set('tv', '1');
    const filename = parsed.pathname.split('/').pop();
    return `${filename || './'}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

function isVisible(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hidden || el.closest('[hidden]')) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 2 && rect.height > 2;
}

function focusables(scope = document) {
  return [...scope.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])'
  )].filter(isVisible);
}

function center(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function directionScore(currentRect, candidateRect, direction) {
  const a = center(currentRect);
  const b = center(candidateRect);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let primary = 0;
  let secondary = 0;
  if (direction === 'left') {
    if (dx >= -3) return Infinity;
    primary = -dx; secondary = Math.abs(dy);
  } else if (direction === 'right') {
    if (dx <= 3) return Infinity;
    primary = dx; secondary = Math.abs(dy);
  } else if (direction === 'up') {
    if (dy >= -3) return Infinity;
    primary = -dy; secondary = Math.abs(dx);
  } else {
    if (dy <= 3) return Infinity;
    primary = dy; secondary = Math.abs(dx);
  }
  return primary + secondary * (direction === 'left' || direction === 'right' ? 3.4 : 1.75);
}

function scrollFocusIntoView(target) {
  if (!(target instanceof HTMLElement)) return;
  target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

function moveInsideShelf(current, direction) {
  if (!['left', 'right'].includes(direction)) return false;
  const shelf = current.closest('.continue-row,.movie-grid,.people-row,.similar-row,.saved-grid,.library-tabs');
  if (!shelf) return false;
  const items = focusables(shelf);
  const index = items.indexOf(current);
  if (index < 0) return false;
  const next = items[index + (direction === 'right' ? 1 : -1)];
  if (!next) return false;
  next.focus({ preventScroll: true });
  scrollFocusIntoView(next);
  return true;
}

function moveFocus(direction) {
  const items = focusables();
  if (!items.length) return false;
  const current = document.activeElement instanceof HTMLElement && isVisible(document.activeElement)
    ? document.activeElement
    : null;

  if (!current || !items.includes(current)) {
    const preferred = document.querySelector('[data-watch-action], .continue-card .continue-link, .movie-grid .movie-card, #searchInput, .nav a, .nav button');
    const target = preferred && isVisible(preferred) ? preferred : items[0];
    target.focus({ preventScroll: true });
    scrollFocusIntoView(target);
    return true;
  }

  if (moveInsideShelf(current, direction)) return true;

  const currentRect = current.getBoundingClientRect();
  let best = null;
  let bestScore = Infinity;
  for (const candidate of items) {
    if (candidate === current) continue;
    const score = directionScore(currentRect, candidate.getBoundingClientRect(), direction);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (!best) return false;
  best.focus({ preventScroll: true });
  scrollFocusIntoView(best);
  return true;
}

function preparePlayerFrames() {
  if (!isTV) return;
  document.querySelectorAll('#embeddedPlayerHost iframe,#alternatePlayerHost iframe').forEach(frame => {
    frame.tabIndex = 0;
    frame.setAttribute('data-tv-player-frame', '1');
  });
}

function focusActivePlayerFrame() {
  if (!isTV || !document.body.classList.contains('tv-player-open')) return false;
  preparePlayerFrames();
  const frame = document.querySelector(
    '#embeddedPlayerSection[data-tv-source="alternate"] #alternatePlayerHost iframe, #embeddedPlayerHost iframe, #alternatePlayerHost iframe'
  );
  if (!frame || !isVisible(frame)) return false;
  frame.focus({ preventScroll: true });
  return true;
}

function setupTvMode() {
  if (!isTV) return;
  document.body.classList.add('tv-mode');
  document.body.dataset.tvMode = 'true';

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    const next = withTv(href);
    if (next !== href) link.setAttribute('href', next);
  }, true);

  document.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const active = document.activeElement;

    // Once the partner player owns focus, never steal its D-pad events. This is
    // important for season/episode/voice controls inside the cross-origin iframe.
    if (active instanceof HTMLIFrameElement || document.body.classList.contains('tv-player-frame-focused')) return;

    if (active instanceof HTMLInputElement && active.type !== 'button') {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') return;
    }

    const direction = event.key.replace('Arrow', '').toLowerCase();
    if (moveFocus(direction)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  document.addEventListener('focusin', event => {
    if (!(event.target instanceof HTMLElement)) return;
    const frameFocused = event.target instanceof HTMLIFrameElement;
    document.body.classList.toggle('tv-player-frame-focused', frameFocused);
    try { window.MVPoiskAndroid?.setPlayerFrameFocused?.(frameFocused); } catch {}
    if (!frameFocused) scrollFocusIntoView(event.target);
  });

  document.addEventListener('focusout', event => {
    if (event.target instanceof HTMLIFrameElement) {
      document.body.classList.remove('tv-player-frame-focused');
      try { window.MVPoiskAndroid?.setPlayerFrameFocused?.(false); } catch {}
    }
  });

  document.addEventListener('mvpoisk:tv-player-opened', () => {
    setTimeout(() => {
      preparePlayerFrames();
      focusActivePlayerFrame();
    }, 900);
  });

  const observer = new MutationObserver(() => {
    preparePlayerFrames();
    if (document.body.classList.contains('tv-player-open')) {
      const active = document.activeElement;
      if (!(active instanceof HTMLIFrameElement)) setTimeout(focusActivePlayerFrame, 150);
      return;
    }
    if (document.activeElement && document.activeElement !== document.body) return;
    const first = document.querySelector('.continue-card .continue-link, .movie-grid .movie-card, #searchInput, [data-watch-action], .nav a, .nav button');
    if (first && isVisible(first)) first.focus({ preventScroll: true });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    const first = document.querySelector('.continue-card .continue-link, .movie-grid .movie-card, #searchInput, [data-watch-action], .nav a');
    if (first && isVisible(first)) first.focus({ preventScroll: true });
  }, 700);
}

window.MVPoiskTV = {
  isTV,
  withTv,
  focusPlayer: focusActivePlayerFrame,
  preparePlayerFrames,
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupTvMode, { once: true });
else setupTvMode();

export { isTV, withTv };
