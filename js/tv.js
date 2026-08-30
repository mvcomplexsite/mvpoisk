const params = new URLSearchParams(location.search);
const ua = navigator.userAgent || '';
const forced = params.get('tv');
const uaLooksLikeTV = /MVPoiskTV\/[\d.]+|Android TV|GoogleTV|BRAVIA|AFT[A-Z0-9]*/i.test(ua);
const isTV = forced === '1' || (forced !== '0' && uaLooksLikeTV);

// v30/v31 remembered TV mode in localStorage. That could accidentally make a
// desktop browser stay in the TV layout after a single ?tv=1 test. v32 never
// persists TV mode; the query string or the Android TV app UA is the source of truth.
try { localStorage.removeItem('mvpoisk:tv-mode:v1'); } catch {}

document.documentElement.classList.toggle('tv-mode', isTV);
if (document.body) document.body.classList.toggle('tv-mode', isTV);

function withTv(url) {
  if (!isTV || !url) return url;
  try {
    const parsed = new URL(url, location.href);
    if (parsed.origin !== location.origin) return url;
    parsed.searchParams.set('tv', '1');
    const appVersion = params.get('app');
    if (appVersion) parsed.searchParams.set('app', appVersion);
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
  return rect.width > 3 && rect.height > 3;
}

function focusables(scope = document) {
  return [...scope.querySelectorAll(
    'a[href],button:not([disabled]),select:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])'
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
  let primary;
  let secondary;
  if (direction === 'left') {
    if (dx >= -4) return Infinity;
    primary = -dx; secondary = Math.abs(dy);
  } else if (direction === 'right') {
    if (dx <= 4) return Infinity;
    primary = dx; secondary = Math.abs(dy);
  } else if (direction === 'up') {
    if (dy >= -4) return Infinity;
    primary = -dy; secondary = Math.abs(dx);
  } else {
    if (dy <= 4) return Infinity;
    primary = dy; secondary = Math.abs(dx);
  }
  return primary + secondary * (direction === 'left' || direction === 'right' ? 3.2 : 1.9);
}

function scrollFocusIntoView(target) {
  if (!(target instanceof HTMLElement)) return;
  target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}

function moveInsideShelf(current, direction) {
  if (!['left', 'right'].includes(direction)) return false;
  const shelf = current.closest('.continue-row,.people-row,.similar-row,.library-tabs,.movie-actions-primary');
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

function preferredTarget() {
  if (document.body?.classList.contains('movie-page')) {
    return document.querySelector('[data-watch-action], .movie-actions-primary button, .back-link');
  }
  return document.querySelector('.continue-card .continue-link, .movie-grid .movie-card, .nav a, .nav button');
}

function moveFocus(direction) {
  const accountDialog = document.querySelector('#accountModal:not([hidden]) .account-card');
  const scope = accountDialog instanceof HTMLElement ? accountDialog : document;
  const items = focusables(scope).filter(el => !(el instanceof HTMLIFrameElement));
  if (!items.length) return false;
  const current = document.activeElement instanceof HTMLElement && isVisible(document.activeElement)
    ? document.activeElement
    : null;

  if (!current || !items.includes(current)) {
    const preferred = preferredTarget();
    const target = preferred && isVisible(preferred) ? preferred : items[0];
    target?.focus({ preventScroll: true });
    scrollFocusIntoView(target);
    return Boolean(target);
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

function openSearchKeyboard() {
  const input = document.querySelector('#searchInput');
  const form = document.querySelector('#searchForm');
  if (!(input instanceof HTMLInputElement)) return;

  // Search on Android TV is a real editing state, not just a temporary focus.
  // Keep the DOM input focused until the user submits or presses Back. Some TV
  // WebViews briefly blur the element while the system IME window is opening;
  // v34 restores the focus instead of treating that transient blur as "done".
  document.body.classList.add('tv-search-editing');
  if (form instanceof HTMLElement) form.tabIndex = -1;
  input.tabIndex = 0;
  try { window.MVPoiskAndroid?.setSearchEditing?.(true); } catch {}
  input.focus({ preventScroll: true });

  const ensureInputFocus = () => {
    if (!document.body.classList.contains('tv-search-editing')) return;
    if (document.activeElement !== input) input.focus({ preventScroll: true });
  };
  requestAnimationFrame(ensureInputFocus);
  setTimeout(ensureInputFocus, 120);
  setTimeout(ensureInputFocus, 360);
  try { window.MVPoiskAndroid?.requestKeyboard?.(); } catch {}
}

function closeSearchEditing({ refocus = true } = {}) {
  const input = document.querySelector('#searchInput');
  const form = document.querySelector('#searchForm');
  document.body.classList.remove('tv-search-editing');
  try { window.MVPoiskAndroid?.setSearchEditing?.(false); } catch {}
  if (input instanceof HTMLInputElement) input.tabIndex = -1;
  if (form instanceof HTMLElement) form.tabIndex = 0;
  if (refocus && form instanceof HTMLElement && isVisible(form)) {
    setTimeout(() => form.focus({ preventScroll: true }), 0);
  }
}

function setPlayerOpen(open) {
  if (!isTV) return;
  document.body.classList.toggle('tv-player-open', Boolean(open));
  try { window.MVPoiskAndroid?.setPlayerOpen?.(Boolean(open)); } catch {}
}

function setupTvMode() {
  if (!isTV) return;
  document.body.classList.add('tv-mode');
  document.body.dataset.tvMode = 'true';

  // Do not focus the text field while browsing with D-pad. On Android TV focus
  // alone can summon the software keyboard, which made v31 feel broken.
  const searchInput = document.querySelector('#searchInput');
  const searchForm = document.querySelector('#searchForm');
  const searchSubmit = searchForm?.querySelector('button[type="submit"]');
  if (searchInput instanceof HTMLInputElement) searchInput.tabIndex = -1;
  if (searchForm instanceof HTMLElement) {
    searchForm.tabIndex = 0;
    searchForm.setAttribute('role', 'button');
    searchForm.setAttribute('aria-label', 'Открыть поиск');
  }
  if (searchSubmit instanceof HTMLElement) searchSubmit.tabIndex = -1;

  searchForm?.addEventListener('submit', event => {
    const input = document.querySelector('#searchInput');
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.value.trim()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openSearchKeyboard();
    } else {
      closeSearchEditing({ refocus: true });
    }
  }, true);

  searchForm?.addEventListener('click', event => {
    if (document.body.classList.contains('tv-search-editing')) return;
    event.preventDefault();
    openSearchKeyboard();
  });

  searchInput?.addEventListener('blur', () => {
    // Opening Android TV's software keyboard may generate a transient blur.
    // Do not close editing because of it; restore the input focus instead.
    setTimeout(() => {
      if (!document.body.classList.contains('tv-search-editing')) return;
      if (document.activeElement !== searchInput) searchInput.focus({ preventScroll: true });
    }, 140);
  });

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    const next = withTv(href);
    if (next !== href) link.setAttribute('href', next);
  }, true);

  document.addEventListener('keydown', event => {
    // The Android app owns D-pad while the partner player is open. This prevents
    // parent-page focus from jumping back to the movie page during playback.
    if (document.body.classList.contains('tv-player-open')) return;

    const active = document.activeElement;
    if (active === searchForm && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      event.stopPropagation();
      openSearchKeyboard();
      return;
    }
    if (active === searchInput) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSearchEditing({ refocus: true });
      }
      return;
    }

    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const direction = event.key.replace('Arrow', '').toLowerCase();
    if (moveFocus(direction)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  document.addEventListener('focusin', event => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target === searchInput) return;
    if (!document.body.classList.contains('tv-player-open')) scrollFocusIntoView(event.target);
  });

  const observer = new MutationObserver(() => {
    if (document.body.classList.contains('tv-player-open')) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    const first = preferredTarget();
    if (first && isVisible(first)) first.focus({ preventScroll: true });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    const first = preferredTarget();
    if (first && isVisible(first)) first.focus({ preventScroll: true });
  }, 800);
}

window.MVPoiskTV = {
  isTV,
  withTv,
  setPlayerOpen,
  openSearchKeyboard,
  closeSearchEditing,
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupTvMode, { once: true });
else setupTvMode();

export { isTV, withTv };
