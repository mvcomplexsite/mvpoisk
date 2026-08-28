import { getMovie, getReviews, getSimilarMovies } from './api.js?v=25';
import { CONFIG, getWatchUrl } from './config.js?v=25';
import { imageUrl, imageAttrs, bindImageFallbacks } from './images.js?v=25';
import { hasInList, toggleInList, isWatchNoticeDismissed, dismissWatchNotice, getHistoryEntry, recordWatchStart, toggleWatched, updatePlaybackProgress } from './storage.js?v=25';

const root = document.querySelector('#movieRoot');
const params = new URLSearchParams(location.search);
const kpId = params.get('id');
let currentMovie = null;

let pendingWatchUrl = '';

function deviceInfo() {
  const ua = navigator.userAgent || '';
  const isiOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  if (isiOS) return { type: 'ios', label: 'iPhone / iPad' };
  if (isAndroid) return { type: 'android', label: 'Android' };
  return { type: 'desktop', label: 'Компьютер' };
}

function protectionMarkup() {
  const device = deviceInfo();
  if (device.type === 'android') {
    return `
      <div class="watch-protection-card">
        <div class="watch-protection-icon">A</div>
        <div class="watch-protection-copy">
          <div class="watch-protection-title"><span>Для Android</span><em>Простой вариант</em></div>
          <p>Включи частный DNS — он убирает часть рекламы без отдельного браузера.</p>
          <div class="watch-protection-actions">
            <button type="button" class="watch-help-button" data-copy-dns>Скопировать DNS</button>
            <a class="watch-help-link" href="https://adguard-dns.io/ru/public-dns.html" target="_blank" rel="noopener noreferrer">Как включить ↗</a>
          </div>
          <code class="watch-dns-value">dns.adguard-dns.com</code>
        </div>
      </div>`;
  }
  if (device.type === 'ios') {
    return `
      <div class="watch-protection-card">
        <div class="watch-protection-icon"></div>
        <div class="watch-protection-copy">
          <div class="watch-protection-title"><span>Для iPhone / iPad</span><em>Safari</em></div>
          <p>Блокировщик для Safari — самый понятный способ уменьшить рекламу при просмотре.</p>
          <div class="watch-protection-actions">
            <a class="watch-help-button" href="https://adguard.com/ru/adguard-ios/overview.html" target="_blank" rel="noopener noreferrer">Открыть AdGuard ↗</a>
          </div>
        </div>
      </div>`;
  }
  return `
    <div class="watch-protection-card">
      <div class="watch-protection-icon">✦</div>
      <div class="watch-protection-copy">
        <div class="watch-protection-title"><span>Для компьютера</span><em>Рекомендуем</em></div>
        <p>Если блокировщик уже включён — просто продолжай. Если нет, можно поставить лёгкое расширение для браузера.</p>
        <div class="watch-protection-actions">
          <a class="watch-help-button" href="https://adguard.com/ru/adguard-browser-extension/overview.html" target="_blank" rel="noopener noreferrer">Открыть AdGuard ↗</a>
        </div>
      </div>
    </div>`;
}

function ensureWatchNotice() {
  let modal = document.querySelector('#watchNotice');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'watchNotice';
  modal.className = 'watch-warning-shell';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="watch-warning-backdrop" data-watch-close></div>
    <section class="watch-warning-card" role="dialog" aria-modal="true" aria-labelledby="watchWarningTitle">
      <button class="watch-warning-close" type="button" data-watch-close aria-label="Закрыть">×</button>
      <div class="watch-warning-brand"><img src="icons/logo-mark-64.png" width="32" height="32" alt=""><span>MVPoisk</span></div>
      <span class="eyebrow">Перед просмотром</span>
      <h2 id="watchWarningTitle">На сайте партнёра может быть реклама</h2>
      <p class="watch-warning-copy">MVPoisk её не размещает. Если хочешь смотреть спокойнее, ниже есть простой вариант защиты для твоего устройства.</p>
      ${protectionMarkup()}
      <div class="watch-warning-note"><span>✓</span><p>Защита необязательна. Если у тебя уже есть AdGuard или другой блокировщик — ничего настраивать не нужно.</p></div>
      <div class="watch-warning-actions">
        <button class="watch-warning-primary" type="button" data-watch-continue><span>▶</span> Смотреть</button>
        <button class="watch-warning-never" type="button" data-watch-never>Больше не показывать и продолжить</button>
      </div>
    </section>`;
  document.body.appendChild(modal);

  const close = () => {
    modal.hidden = true;
    document.body.classList.remove('watch-warning-open');
    pendingWatchUrl = '';
  };
  modal.querySelectorAll('[data-watch-close]').forEach(node => node.addEventListener('click', close));
  modal.querySelector('[data-watch-continue]').addEventListener('click', () => openPartnerWatch(false));
  modal.querySelector('[data-watch-never]').addEventListener('click', () => openPartnerWatch(true));
  modal.querySelector('[data-copy-dns]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const value = 'dns.adguard-dns.com';
    let copied = false;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch {
      const area = document.createElement('textarea');
      area.value = value;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { copied = document.execCommand('copy'); } catch {}
      area.remove();
    }
    if (copied) {
      const old = button.textContent;
      button.textContent = 'Скопировано ✓';
      button.classList.add('is-copied');
      setTimeout(() => { button.textContent = old; button.classList.remove('is-copied'); }, 1800);
    }
  });
  return modal;
}

function openPartnerWatch(dismiss = false) {
  const url = pendingWatchUrl;
  if (!url) return;
  if (dismiss) dismissWatchNotice();
  const modal = document.querySelector('#watchNotice');
  if (modal) modal.hidden = true;
  document.body.classList.remove('watch-warning-open');
  pendingWatchUrl = '';
  const opened = window.open(url, '_blank');
  if (opened) opened.opener = null;
  else window.location.href = url;
}

function openWatchNotice(url) {
  pendingWatchUrl = url;
  const modal = ensureWatchNotice();
  modal.hidden = false;
  document.body.classList.add('watch-warning-open');
  requestAnimationFrame(() => modal.querySelector('[data-watch-continue]')?.focus());
}

let playerObserver = null;
let playerTimer = null;
let playerScriptPromise = null;
let playerAttemptId = 0;
let playerStarting = false;
let telemetryBound = false;
let lastTelemetryWrite = 0;

function watchButtonLabel() {
  if (!currentMovie) return 'Смотреть';
  const entry = getHistoryEntry(currentMovie.id);
  if (entry?.completed) return 'Смотреть снова';
  if (entry) return 'Продолжить просмотр';
  return 'Смотреть';
}

function updateWatchStateButtons() {
  const watch = document.querySelector('[data-watch-action]');
  if (watch && !playerStarting) {
    const label = watch.querySelector('span:last-child');
    if (label) label.textContent = watchButtonLabel();
  }
  const watched = document.querySelector('[data-watched-action]');
  if (watched && currentMovie) {
    const done = Boolean(getHistoryEntry(currentMovie.id)?.completed);
    watched.classList.toggle('is-watched', done);
    watched.setAttribute('aria-pressed', String(done));
    watched.innerHTML = done ? '<span>✓</span><span>Просмотрено</span>' : '<span>✓</span><span>Отметить просмотренным</span>';
  }
}

function rememberPlayerDiagnostic(event, kind, detected) {
  try {
    const key = 'mvpoisk:player-diagnostics:v1';
    const old = JSON.parse(sessionStorage.getItem(key) || '[]');
    const data = event?.data;
    const keys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).slice(0, 16) : [];
    const next = [{ at: Date.now(), origin: event?.origin || '', kind: String(kind || '').slice(0, 80), keys, detected }, ...old].slice(0, 25);
    sessionStorage.setItem(key, JSON.stringify(next));
  } catch {}
}

function numberFromObject(value, wanted, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return null;
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (wanted.includes(normalized) && Number.isFinite(Number(item))) return Number(item);
  }
  for (const item of Object.values(value)) {
    if (item && typeof item === 'object') {
      const found = numberFromObject(item, wanted, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

function stringFromObject(value, wanted, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 3) return '';
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (wanted.includes(normalized) && (typeof item === 'string' || typeof item === 'number')) return String(item);
  }
  for (const item of Object.values(value)) {
    if (item && typeof item === 'object') {
      const found = stringFromObject(item, wanted, depth + 1);
      if (found) return found;
    }
  }
  return '';
}

function parsePlayerMessage(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    const clean = raw.trim();
    if (!(clean.startsWith('{') || clean.startsWith('['))) return null;
    try { data = JSON.parse(clean); } catch { return null; }
  }
  if (!data || typeof data !== 'object') return null;
  const kind = stringFromObject(data, ['event', 'type', 'name', 'method', 'action']);
  const position = numberFromObject(data, ['currenttime', 'currentposition', 'position', 'playedtime', 'playbacktime']);
  const duration = numberFromObject(data, ['duration', 'totalduration', 'totaltime', 'length']);
  let percent = numberFromObject(data, ['percent', 'progress', 'percentage']);
  if (Number.isFinite(percent) && percent > 1 && percent <= 100) percent /= 100;
  const season = numberFromObject(data, ['season', 'seasonnumber', 'seasonnum']);
  const episode = numberFromObject(data, ['episode', 'episodenumber', 'episodenum', 'series']);
  return { kind, position, duration, percent, season, episode };
}

function bindPlayerTelemetry() {
  if (telemetryBound) return;
  telemetryBound = true;
  window.addEventListener('message', event => {
    if (!currentMovie) return;
    const section = document.querySelector('#embeddedPlayerSection');
    if (!section || section.hidden) return;
    const frames = [...document.querySelectorAll('#embeddedPlayerHost iframe, #alternatePlayerHost iframe')];
    const sourceMatches = frames.some(frame => {
      try { return frame.contentWindow === event.source; } catch { return false; }
    });
    const parsed = parsePlayerMessage(event.data);
    if (!parsed) return;
    const recognizedKind = /(time|progress|playback|player|episode|season|ended|complete)/i.test(parsed.kind || '');
    if (!sourceMatches && !recognizedKind) return;

    const patch = {};
    if (Number.isFinite(parsed.duration) && parsed.duration >= 180 && parsed.duration <= 24 * 60 * 60) patch.duration = parsed.duration;
    if ('duration' in patch && Number.isFinite(parsed.position) && parsed.position >= 0 && parsed.position <= patch.duration * 1.1) patch.position = parsed.position;
    if ('duration' in patch && Number.isFinite(parsed.percent) && parsed.percent >= 0 && parsed.percent <= 1) patch.percent = parsed.percent;
    if (Number.isFinite(parsed.season) && parsed.season >= 0 && parsed.season < 1000) patch.season = parsed.season;
    if (Number.isFinite(parsed.episode) && parsed.episode >= 0 && parsed.episode < 10000) patch.episode = parsed.episode;
    const detected = Object.keys(patch);
    rememberPlayerDiagnostic(event, parsed.kind, detected);
    // Only persist playback state when the message came from an iframe that
    // MVPoisk itself mounted. Other recognized messages remain diagnostics only.
    if (!sourceMatches || !detected.length) return;

    const now = Date.now();
    const important = 'season' in patch || 'episode' in patch || patch.percent === 1;
    if (!important && now - lastTelemetryWrite < 5000) return;
    lastTelemetryWrite = now;
    updatePlaybackProgress(currentMovie.id, patch);
    updateWatchStateButtons();
  });
}

// Reserve Kinobox path. Kept completely separate from the working Rendex path:
// it is not downloaded or initialized until the user asks for another source.
let alternateScriptPromise = null;
let alternateInstance = null;
let alternateTimer = null;
let alternateAttemptId = 0;
let alternateStarting = false;

function playerElements() {
  return {
    section: document.querySelector('#embeddedPlayerSection'),
    host: document.querySelector('#embeddedPlayerHost'),
    status: document.querySelector('#embeddedPlayerStatus'),
  };
}

function setPlayerStatus(message, state = 'loading') {
  const { status } = playerElements();
  if (!status) return;
  status.dataset.state = state;
  status.innerHTML = state === 'loading'
    ? `<span class="player-status-dot"></span><span>${esc(message)}</span>`
    : state === 'ready'
      ? `<span class="player-status-ok">✓</span><span>${esc(message)}</span>`
      : `<span class="player-status-error">!</span><span>${esc(message)}</span>`;
}

function loadRendexSdk() {
  if (playerScriptPromise) return playerScriptPromise;
  playerScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.dataset.mvRendexSdk = '1';
    // The SDK response contains short-lived signed metadata, so force a fresh copy
    // for each page session rather than relying on a potentially expired browser cache.
    const separator = CONFIG.RENDEX_SDK_URL.includes('?') ? '&' : '?';
    script.src = `${CONFIG.RENDEX_SDK_URL}${separator}mvpoisk=${Date.now()}`;
    script.onload = () => resolve();
    script.onerror = () => {
      playerScriptPromise = null;
      script.remove();
      reject(new Error('Rendex SDK blocked or unavailable'));
    };
    document.head.appendChild(script);
  });
  return playerScriptPromise;
}

function setPlayerStarting(value) {
  playerStarting = value;
  const button = document.querySelector('[data-watch-action]');
  if (!button) return;
  button.disabled = value;
  button.classList.toggle('is-loading', value);
  const label = button.querySelector('span:last-child');
  if (label) label.textContent = value ? 'Подключаем…' : watchButtonLabel();
}

function markPlayerReady(iframe) {
  if (!iframe || iframe.dataset.mvPlayerReady === '1') return;
  const { host } = playerElements();
  host?.classList.remove('player-failed');
  iframe.dataset.mvPlayerReady = '1';
  iframe.classList.add('mv-embedded-iframe');
  iframe.title = currentMovie ? `Смотреть ${currentMovie.name || currentMovie.alternativeName || 'фильм'}` : 'Плеер';
  iframe.setAttribute('allowfullscreen', '');
  if (!iframe.getAttribute('allow')) {
    iframe.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
  }
  clearTimeout(playerTimer);
  setPlayerStarting(false);
  setPlayerStatus('Плеер подключён.', 'ready');
  iframe.addEventListener('load', () => {
    setPlayerStatus('Плеер загружен. Управление качеством, сериями и озвучкой — внутри плеера, если они доступны.', 'ready');
  }, { once: true });
}

function stopEmbeddedPlayer({ hide = true } = {}) {
  playerAttemptId += 1;
  playerObserver?.disconnect();
  clearTimeout(playerTimer);
  const { section, host } = playerElements();
  if (host) {
    // Removing the cross-origin iframe is the reliable way to stop hidden audio/video.
    host.replaceChildren();
    host.classList.remove('player-failed');
  }
  setPlayerStarting(false);
  setPlayerStatus('Плеер остановлен.', 'ready');
  if (section && hide) section.hidden = true;
}

function observePlayer(host) {
  playerObserver?.disconnect();
  const scan = () => {
    const iframe = host.querySelector('iframe');
    if (iframe) markPlayerReady(iframe);
    return iframe;
  };
  if (scan()) return;
  playerObserver = new MutationObserver(() => scan());
  playerObserver.observe(host, { childList: true, subtree: true });
}

function alternateElements() {
  return {
    panel: document.querySelector('#alternatePlayerPanel'),
    host: document.querySelector('#alternatePlayerHost'),
    status: document.querySelector('#alternatePlayerStatus'),
    button: document.querySelector('[data-player-alternate]'),
  };
}

function setAlternateStatus(message, state = 'loading') {
  const { status } = alternateElements();
  if (!status) return;
  status.dataset.state = state;
  status.innerHTML = state === 'loading'
    ? `<span class="player-status-dot"></span><span>${esc(message)}</span>`
    : state === 'ready'
      ? `<span class="player-status-ok">✓</span><span>${esc(message)}</span>`
      : `<span class="player-status-error">!</span><span>${esc(message)}</span>`;
}

function setAlternateStarting(value) {
  alternateStarting = value;
  const { button } = alternateElements();
  if (!button) return;
  button.disabled = value;
  button.classList.toggle('is-loading', value);
  button.textContent = value ? 'Ищем источники…' : 'Другой источник';
}

function loadKinoboxSdk() {
  if (typeof window.kinobox === 'function') return Promise.resolve();
  if (alternateScriptPromise) return alternateScriptPromise;
  alternateScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.dataset.mvKinoboxSdk = '1';
    script.src = CONFIG.KINOBOX_SDK_URL;
    script.onload = () => typeof window.kinobox === 'function'
      ? resolve()
      : reject(new Error('Kinobox loaded without global function'));
    script.onerror = () => {
      alternateScriptPromise = null;
      script.remove();
      reject(new Error('Kinobox SDK blocked or unavailable'));
    };
    document.head.appendChild(script);
  });
  return alternateScriptPromise;
}

function stopAlternatePlayer({ hide = true } = {}) {
  alternateAttemptId += 1;
  clearTimeout(alternateTimer);
  alternateTimer = null;
  try { alternateInstance?.$destroy?.(); } catch {}
  alternateInstance = null;
  const { panel, host } = alternateElements();
  host?.replaceChildren();
  if (panel && hide) panel.hidden = true;
  setAlternateStarting(false);
}

function closePlayerSection() {
  stopAlternatePlayer({ hide: true });
  stopEmbeddedPlayer({ hide: true });
}

async function startAlternatePlayer(force = false) {
  if (!currentMovie) return;
  const { section } = playerElements();
  const { panel, host } = alternateElements();
  if (!section || !panel || !host) return;
  if (alternateStarting && !force) return;

  recordWatchStart(currentMovie, 'alternate');
  updateWatchStateButtons();
  const attemptId = ++alternateAttemptId;
  setAlternateStarting(true);

  // Only one playback iframe should stay alive at a time. Removing the Rendex
  // iframe stops its audio, but does not change how Rendex itself is integrated.
  stopEmbeddedPlayer({ hide: false });
  section.hidden = false;
  panel.hidden = false;
  host.replaceChildren();
  setAlternateStatus('Ищем запасные плееры по KinoPoisk ID…', 'loading');
  requestAnimationFrame(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));

  try {
    await loadKinoboxSdk();
    if (attemptId !== alternateAttemptId) return;

    const slot = document.createElement('div');
    slot.className = 'mv-kinobox-slot';
    slot.dataset.kinopoisk = String(currentMovie.id);
    host.appendChild(slot);

    alternateInstance = window.kinobox(slot, {
      baseUrl: CONFIG.KINOBOX_BASE_URL,
      search: { kinopoisk: String(currentMovie.id) },
      notFoundMessage: 'Запасные источники для этого фильма не найдены.',
      events: {
        playerLoaded(result) {
          if (attemptId !== alternateAttemptId) return;
          clearTimeout(alternateTimer);
          const players = Array.isArray(result?.data)
            ? result.data.filter(item => item && item.iframeUrl)
            : [];
          setAlternateStarting(false);
          if (players.length) {
            const word = players.length === 1 ? 'источник' : players.length < 5 ? 'источника' : 'источников';
            setAlternateStatus(`Найдено ${players.length} ${word}. Переключение доступно внутри запасного плеера.`, 'ready');
          } else {
            const message = result?.error?.title || 'Запасные источники не найдены.';
            setAlternateStatus(message, 'error');
          }
        }
      }
    });

    alternateTimer = setTimeout(() => {
      if (attemptId !== alternateAttemptId) return;
      const iframe = host.querySelector('iframe');
      if (iframe) {
        setAlternateStarting(false);
        setAlternateStatus('Запасной плеер подключён.', 'ready');
      } else {
        setAlternateStarting(false);
        setAlternateStatus('Запасной сервис отвечает дольше обычного. Можно повторить или вернуться к основному источнику.', 'error');
      }
    }, CONFIG.PLAYER_LOAD_TIMEOUT_MS);
  } catch (error) {
    if (attemptId !== alternateAttemptId) return;
    clearTimeout(alternateTimer);
    setAlternateStarting(false);
    console.warn('[MVPoisk alternate player]', error);
    host.replaceChildren();
    host.innerHTML = '<div class="alternate-player-error"><div class="player-fail-mark">!</div><strong>Запасной источник недоступен</strong><span>Основной плеер можно запустить снова одной кнопкой.</span></div>';
    setAlternateStatus('Не удалось подключить запасной сервис.', 'error');
  }
}

async function startPrimaryPlayer(force = false) {
  stopAlternatePlayer({ hide: true });
  return startEmbeddedPlayer(force);
}

async function startEmbeddedPlayer(force = false) {
  if (!currentMovie) return;
  const { section, host } = playerElements();
  if (!section || !host) return;

  if (playerStarting && !force) return;
  recordWatchStart(currentMovie, 'primary');
  updateWatchStateButtons();
  const attemptId = ++playerAttemptId;
  setPlayerStarting(true);

  section.hidden = false;
  requestAnimationFrame(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }));

  if (!force && host.querySelector('iframe')) {
    setPlayerStarting(false);
    setPlayerStatus('Плеер уже подключён.', 'ready');
    return;
  }

  playerObserver?.disconnect();
  clearTimeout(playerTimer);
  host.classList.remove('player-failed');
  host.dataset.playerAttempt = String((Number(host.dataset.playerAttempt || 0) + 1));
  host.innerHTML = `
    <div class="embedded-player-loader" aria-hidden="true">
      <div class="spinner"></div>
      <strong>Подключаем плеер…</strong>
      <span>Обычно это занимает несколько секунд</span>
    </div>
    <ins class="mv-rendex-slot"
      data-publisher-id="${esc(CONFIG.RENDEX_PUBLISHER_ID)}"
      data-type="kp"
      data-id="${esc(currentMovie.id)}"></ins>`;
  setPlayerStatus('Ищем видео по KinoPoisk ID…', 'loading');
  observePlayer(host);

  playerTimer = setTimeout(() => {
    if (attemptId !== playerAttemptId) return;
    if (!host.querySelector('iframe')) {
      playerObserver?.disconnect();
      setPlayerStarting(false);
      host.classList.add('player-failed');
      const loader = host.querySelector('.embedded-player-loader');
      if (loader) loader.innerHTML = '<div class="player-fail-mark">!</div><strong>Плеер не подключился</strong><span>Попробуй ещё раз или открой просмотр у партнёра</span>';
      setPlayerStatus('Встроенный плеер не ответил. Можно повторить или открыть просмотр у партнёра.', 'error');
    }
  }, CONFIG.PLAYER_LOAD_TIMEOUT_MS);

  try {
    await loadRendexSdk();
    if (attemptId !== playerAttemptId) return;
    // The SDK normally scans existing <ins> elements and also watches newly added slots.
    // On a manual retry, replacing the slot triggers a clean rescan without touching
    // the partner's internal API/HLS logic.
    if (!host.querySelector('iframe') && force) {
      const slot = host.querySelector('.mv-rendex-slot');
      if (slot) slot.replaceWith(slot.cloneNode(true));
    }
  } catch (error) {
    if (attemptId !== playerAttemptId) return;
    clearTimeout(playerTimer);
    playerObserver?.disconnect();
    setPlayerStarting(false);
    console.warn('[MVPoisk player]', error);
    host.classList.add('player-failed');
    const loader = host.querySelector('.embedded-player-loader');
    if (loader) loader.innerHTML = '<div class="player-fail-mark">!</div><strong>Сервис плеера недоступен</strong><span>Резервный переход остаётся доступен сверху</span>';
    setPlayerStatus('Сервис встроенного плеера сейчас недоступен. Используй резервный переход.', 'error');
  }
}

function bindWatchAction() {
  const button = document.querySelector('[data-watch-action]');
  button?.addEventListener('click', () => startPrimaryPlayer(false));

  document.querySelector('[data-player-retry]')?.addEventListener('click', () => startPrimaryPlayer(true));
  document.querySelector('[data-player-alternate]')?.addEventListener('click', () => startAlternatePlayer(false));
  document.querySelector('[data-alternate-retry]')?.addEventListener('click', () => startAlternatePlayer(true));
  document.querySelector('[data-player-primary]')?.addEventListener('click', () => startPrimaryPlayer(true));
  document.querySelector('[data-player-close]')?.addEventListener('click', closePlayerSection);

  document.querySelectorAll('[data-partner-watch]').forEach(link => {
    link.addEventListener('click', event => {
      if (currentMovie) {
        recordWatchStart(currentMovie, 'partner');
        updateWatchStateButtons();
      }
      if (isWatchNoticeDismissed()) return;
      event.preventDefault();
      openWatchNotice(link.href);
    });
  });
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;'
  }[ch]));
}

function img(url, width) { return url ? esc(imageUrl(url, { width })) : ''; }
function score(value) { const number = Number(value || 0); return number ? number.toFixed(1) : '—'; }
function scoreClass(value) { const number = Number(value || 0); return number >= 7.5 ? 'rating-high' : number >= 6 ? 'rating-mid' : number ? 'rating-low' : 'rating-muted'; }
function runtime(minutes) {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return [h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean).join(' ');
}
function firstText(...values) { return values.find(value => typeof value === 'string' && value.trim()) || ''; }

function personCard(person) {
  return `<div class="person-card">
    <div class="person-photo"><span>MV</span>${person.photo ? `<img ${imageAttrs([person.photo], { width: 320 })} alt="${esc(person.name || person.enName || '')}" loading="lazy" decoding="async">` : ''}</div>
    <strong>${esc(person.name || person.enName || '—')}</strong>
    <small>${esc(person.description || person.profession || '')}</small>
  </div>`;
}

function similarCard(movie) {
  const posters = [movie.poster?.url, movie.poster?.previewUrl].filter(Boolean);
  return `<a class="similar-card" href="movie.html?id=${encodeURIComponent(movie.id)}">
    <div><span>MV</span>${posters.length ? `<img ${imageAttrs(posters, { width: 420 })} alt="${esc(movie.name || '')}" loading="lazy" decoding="async">` : ''}</div>
    <strong>${esc(movie.name || movie.alternativeName || 'Без названия')}</strong>
    <small>${esc([movie.year, movie.rating?.kp ? `КП ${score(movie.rating.kp)}` : ''].filter(Boolean).join(' • '))}</small>
  </a>`;
}

function reviewCard(review, index) {
  const type = String(review.type || '').toLowerCase();
  const label = type.includes('positive') ? 'Положительный' : type.includes('negative') ? 'Отрицательный' : 'Нейтральный';
  const cls = type.includes('positive') ? 'review-positive' : type.includes('negative') ? 'review-negative' : 'review-neutral';
  const text = String(review.review || '').trim();
  const expandable = text.length > 330 || text.split('\n').length > 5;
  const id = `review-${index}`;
  return `<article class="review-card ${cls}">
    <div class="review-head"><strong>${esc(review.author || 'Пользователь')}</strong><span>${label}</span></div>
    ${review.title ? `<h3>${esc(review.title)}</h3>` : ''}
    <div class="review-copy${expandable ? ' review-collapsed' : ''}" id="${id}">${esc(text)}</div>
    ${expandable ? `<button class="review-toggle" type="button" data-review-toggle="${id}" aria-expanded="false">Читать полностью</button>` : ''}
  </article>`;
}

function updateListButtons() {
  if (!currentMovie) return;
  const later = hasInList('watchLater', currentMovie.id);
  const favorite = hasInList('favorites', currentMovie.id);
  const laterButton = document.querySelector('[data-list-action="watchLater"]');
  const favButton = document.querySelector('[data-list-action="favorites"]');
  if (laterButton) {
    laterButton.classList.toggle('is-saved', later);
    laterButton.setAttribute('aria-pressed', String(later));
    laterButton.innerHTML = later ? '<span>✓</span><span>В «Посмотрю позже»</span>' : '<span>＋</span><span>Посмотрю позже</span>';
  }
  if (favButton) {
    favButton.classList.toggle('is-saved', favorite);
    favButton.setAttribute('aria-pressed', String(favorite));
    favButton.innerHTML = favorite ? '<span>♥</span><span>В избранном</span>' : '<span>♡</span><span>В избранное</span>';
  }
}

function bindMovieActions() {
  document.querySelectorAll('[data-list-action]').forEach(button => {
    button.addEventListener('click', () => {
      if (!currentMovie) return;
      toggleInList(button.dataset.listAction, currentMovie);
      updateListButtons();
    });
  });
  document.querySelector('[data-watched-action]')?.addEventListener('click', () => {
    if (!currentMovie) return;
    toggleWatched(currentMovie);
    updateWatchStateButtons();
  });
}

function renderMovie(movie) {
  currentMovie = movie;
  const title = movie.name || movie.alternativeName || 'Без названия';
  const subtitle = movie.alternativeName && movie.alternativeName !== title ? movie.alternativeName : '';
  const posterUrls = [movie.poster?.url, movie.poster?.previewUrl].filter(Boolean);
  const poster = posterUrls[0] || '';
  const backdrop = movie.backdrop?.url || movie.backdrop?.previewUrl || poster;
  const genres = (movie.genres || []).map(g => g.name).join(' • ');
  const countries = (movie.countries || []).map(c => c.name).join(', ');
  const description = firstText(movie.description, movie.shortDescription, 'Описание пока отсутствует.');
  const people = (movie.persons || []).filter(p => ['актеры', 'актер', 'actor'].includes(String(p.profession || '').toLowerCase())).slice(0, 12);
  const meta = [movie.year, genres, runtime(movie.movieLength), movie.ageRating ? `${movie.ageRating}+` : ''].filter(Boolean).join(' • ');
  const watchUrl = getWatchUrl(movie.id);

  document.title = `${title} — MVPoisk`;
  root.innerHTML = `
    <section class="movie-hero" style="--movie-bg: url('${img(backdrop, 1800)}')">
      <div class="movie-backdrop"></div>
      <div class="movie-hero-inner">
        <div class="movie-poster"><div class="poster-fallback big">MV</div>${posterUrls.length ? `<img ${imageAttrs(posterUrls, { width: 700 })} alt="Постер: ${esc(title)}" decoding="async">` : ''}</div>
        <div class="movie-main-copy">
          <div class="movie-kicker">${movie.isSeries ? 'Сериал' : 'Фильм'} • KinoPoisk ID ${movie.id}</div>
          <h1>${esc(title)}</h1>
          ${subtitle ? `<p class="movie-subtitle">${esc(subtitle)}</p>` : ''}
          <p class="movie-meta">${esc(meta)}</p>
          <div class="movie-ratings">
            <div><span class="rating-box ${scoreClass(movie.rating?.kp)}">${score(movie.rating?.kp)}</span><small>Кинопоиск</small></div>
            <div><span class="rating-box">${score(movie.rating?.imdb)}</span><small>IMDb</small></div>
          </div>
          <p class="movie-description">${esc(description)}</p>
          <div class="movie-actions movie-actions-primary">
            <button class="watch-button" data-watch-action type="button"><span class="watch-play">▶</span><span>${esc(watchButtonLabel())}</span></button>
            <button class="secondary-button list-action" type="button" data-list-action="watchLater" aria-pressed="false"></button>
            <button class="secondary-button list-action favorite-action" type="button" data-list-action="favorites" aria-pressed="false"></button>
            <button class="secondary-button watched-action" type="button" data-watched-action aria-pressed="false"><span>✓</span><span>Отметить просмотренным</span></button>
            <a class="secondary-button" href="https://www.kinopoisk.ru/film/${movie.id}/" target="_blank" rel="noopener noreferrer">Кинопоиск ↗</a>
          </div>
          <div class="watch-hint"><span></span>Сначала попробуем открыть плеер прямо в MVPoisk. Резервный переход всегда останется доступен.</div>
        </div>
      </div>
    </section>
    <section class="embedded-player-section" id="embeddedPlayerSection" hidden>
      <div class="embedded-player-inner">
        <div class="embedded-player-heading">
          <div>
            <span class="eyebrow">Просмотр</span>
            <h2>${esc(title)}</h2>
            <p>${movie.isSeries ? 'Сезоны, серии и озвучки выбираются внутри плеера, если доступны. ' : ''}Плеер партнёра подключается по KinoPoisk ID ${movie.id}.</p>
          </div>
          <div class="embedded-player-actions">
            <button type="button" class="player-mini-button" data-player-retry>Повторить</button>
            <button type="button" class="player-mini-button player-source-button" data-player-alternate>Другой источник</button>
            <a class="player-mini-button player-mini-primary" data-partner-watch href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer">Открыть у партнёра ↗</a>
            <button type="button" class="player-mini-button" data-player-close>Закрыть</button>
          </div>
        </div>
        <div class="embedded-player-stage" id="embeddedPlayerHost"></div>
        <div class="embedded-player-status" id="embeddedPlayerStatus" data-state="loading"><span class="player-status-dot"></span><span>Плеер ещё не запускался.</span></div>
        <div class="alternate-player-panel" id="alternatePlayerPanel" hidden>
          <div class="alternate-player-heading">
            <div>
              <span class="eyebrow">Запасной просмотр</span>
              <h3>Другие источники</h3>
              <p>Загружаются только по твоему запросу. Выбери доступный вариант внутри плеера.</p>
            </div>
            <div class="alternate-player-actions">
              <button type="button" class="player-mini-button" data-alternate-retry>Повторить поиск</button>
              <button type="button" class="player-mini-button player-mini-primary" data-player-primary>Основной источник</button>
            </div>
          </div>
          <div class="alternate-player-host" id="alternatePlayerHost"></div>
          <div class="embedded-player-status alternate-player-status" id="alternatePlayerStatus" data-state="loading"><span class="player-status-dot"></span><span>Запасной источник ещё не запускался.</span></div>
        </div>
      </div>
    </section>
    <div class="movie-content">
      <section class="facts-panel">
        <div><span>Год</span><strong>${esc(movie.year || '—')}</strong></div>
        <div><span>Страна</span><strong>${esc(countries || '—')}</strong></div>
        <div><span>Жанры</span><strong>${esc(genres || '—')}</strong></div>
        <div><span>Длительность</span><strong>${esc(runtime(movie.movieLength) || '—')}</strong></div>
        <div><span>KinoPoisk ID</span><strong>${movie.id}</strong></div>
      </section>
      ${people.length ? `<section class="content-section"><div class="section-heading"><div><span class="eyebrow">В ролях</span><h2>Актёры</h2></div></div><div class="people-row">${people.map(personCard).join('')}</div></section>` : ''}
      <section class="content-section" id="reviewsSection" hidden><div class="section-heading"><div><span class="eyebrow">Мнения зрителей</span><h2>Отзывы</h2></div></div><div class="reviews-grid" id="reviewsGrid"></div></section>
      <section class="content-section" id="similarSection" hidden><div class="section-heading"><div><span class="eyebrow">Ещё по теме</span><h2>Похожие фильмы</h2></div></div><div class="similar-row" id="similarGrid"></div></section>
    </div>`;
  bindImageFallbacks(root);
  bindMovieActions();
  bindWatchAction();
  bindPlayerTelemetry();
  updateListButtons();
  updateWatchStateButtons();
}

function bindReviewToggles() {
  document.querySelectorAll('[data-review-toggle]').forEach(button => {
    button.addEventListener('click', () => {
      const copy = document.getElementById(button.dataset.reviewToggle);
      if (!copy) return;
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      copy.classList.toggle('review-collapsed', expanded);
      button.textContent = expanded ? 'Читать полностью' : 'Свернуть';
    });
  });
}

async function loadExtras(movie) {
  const [reviewsResult, similarResult] = await Promise.allSettled([getReviews(movie.id, 6), getSimilarMovies(movie)]);
  if (reviewsResult.status === 'fulfilled') {
    const reviews = reviewsResult.value?.docs || [];
    if (reviews.length) {
      document.querySelector('#reviewsGrid').innerHTML = reviews.map(reviewCard).join('');
      document.querySelector('#reviewsSection').hidden = false;
      bindReviewToggles();
    }
  }
  if (similarResult.status === 'fulfilled') {
    const movies = (similarResult.value?.docs || []).filter(item => Number(item.id) !== Number(movie.id)).slice(0, 10);
    if (movies.length) {
      const grid = document.querySelector('#similarGrid');
      grid.innerHTML = movies.map(similarCard).join('');
      bindImageFallbacks(grid);
      document.querySelector('#similarSection').hidden = false;
    }
  }
}

async function init() {
  if (!kpId || !/^\d+$/.test(kpId)) {
    root.innerHTML = `<div class="page-error"><h1>Некорректный KinoPoisk ID</h1><p>Открой фильм из каталога MVPoisk.</p><a href="./">На главную</a></div>`;
    return;
  }
  try {
    const movie = await getMovie(kpId);
    renderMovie(movie);
    loadExtras(movie);
  } catch (error) {
    console.error(error);
    const text = error?.status === 404 ? 'Фильм с таким KinoPoisk ID не найден.' : error?.status === 429 ? 'Лимит запросов API исчерпан.' : 'Не удалось загрузить страницу фильма.';
    root.innerHTML = `<div class="page-error"><h1>${esc(text)}</h1><p>KinoPoisk ID: ${esc(kpId)}</p><a href="./">Вернуться в каталог</a></div>`;
  }
}
init();

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    const modal = document.querySelector('#watchNotice');
    if (modal && !modal.hidden) {
      modal.hidden = true;
      document.body.classList.remove('watch-warning-open');
      pendingWatchUrl = '';
    }
  }
});
