const params = new URLSearchParams(location.search);
const ua = navigator.userAgent || '';
const forced = params.get('tv');
const uaLooksLikeTV = /Android TV|GoogleTV|BRAVIA|SmartTV|SMART-TV|HbbTV|NetCast|Web0S|AFT[A-Z0-9]*|TV Safari/i.test(ua);
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
    return `${parsed.pathname.split('/').pop() || './'}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

function isVisible(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hidden || el.closest('[hidden]')) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 2 && rect.height > 2;
}

function focusables() {
  return [...document.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
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
    if (dx >= -2) return Infinity;
    primary = -dx; secondary = Math.abs(dy);
  } else if (direction === 'right') {
    if (dx <= 2) return Infinity;
    primary = dx; secondary = Math.abs(dy);
  } else if (direction === 'up') {
    if (dy >= -2) return Infinity;
    primary = -dy; secondary = Math.abs(dx);
  } else {
    if (dy <= 2) return Infinity;
    primary = dy; secondary = Math.abs(dx);
  }
  // Strongly prefer elements aligned on the same row/column, but still allow escape.
  return primary + secondary * 2.2;
}

function moveFocus(direction) {
  const items = focusables();
  if (!items.length) return false;
  const current = document.activeElement instanceof HTMLElement && isVisible(document.activeElement)
    ? document.activeElement
    : null;
  if (!current || !items.includes(current)) {
    const preferred = document.querySelector('.continue-card .continue-link, .movie-card, #searchInput, .nav a, .nav button');
    const target = preferred && isVisible(preferred) ? preferred : items[0];
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    return true;
  }

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
  best.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  return true;
}

function setupTvMode() {
  if (!isTV) return;
  document.body.classList.add('tv-mode');
  document.body.dataset.tvMode = 'true';

  // Preserve TV mode across the whole static site without changing application code.
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
    if (active instanceof HTMLInputElement && active.type !== 'button') {
      // Let text fields use left/right normally; up/down exits the field.
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
    event.target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  });

  // Dynamic catalog cards arrive after the API request. Focus a useful item once they exist.
  const observer = new MutationObserver(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    const first = document.querySelector('.continue-card .continue-link, .movie-grid .movie-card, #searchInput, .movie-actions-primary .watch-button');
    if (first && isVisible(first)) first.focus({ preventScroll: true });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    const first = document.querySelector('.continue-card .continue-link, .movie-grid .movie-card, #searchInput, .movie-actions-primary .watch-button, .nav a');
    if (first && isVisible(first)) first.focus({ preventScroll: true });
  }, 700);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupTvMode, { once: true });
else setupTvMode();

export { isTV, withTv };
