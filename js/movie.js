import { getMovie, getReviews, getSimilarMovies } from './api.js?v=47';
import { CONFIG, getWatchUrl } from './config.js?v=47';
import { imageUrl, imageAttrs, bindImageFallbacks } from './images.js?v=47';
import { hasInList, toggleInList, isWatchNoticeDismissed, dismissWatchNotice, getHistoryEntry, recordWatchStart, toggleWatched, updatePlaybackProgress } from './storage.js?v=47';
import { syncFromCloud } from './account.js?v=47';

const root = document.querySelector('#movieRoot');
const params = new URLSearchParams(location.search);
const kpId = params.get('id');
let currentMovie = null;
const isTVMode = () => document.documentElement.classList.contains('tv-mode') || document.body?.dataset.tvMode === 'true';

function openTvPlayerShell(source = 'primary') {
  if (!isTVMode()) return;
  const section = document.querySelector('#embeddedPlayerSection');
  if (!section) return;
  section.hidden = false;
  section.dataset.tvSource = source;
  section.classList.add('is-tv-player-open');
  document.body.classList.add('tv-player-open');
  window.MVPoiskTV?.setPlayerOpen?.(true);
}

function closeTvPlayerShell() {
  const section = document.querySelector('#embeddedPlayerSection');
  const wasOpen = Boolean(section?.classList.contains('is-tv-player-open'));
  if (!wasOpen) return false;
  section.classList.remove('is-tv-player-open');
  if (section) delete section.dataset.tvSource;
  document.body.classList.remove('tv-player-open');
  window.MVPoiskTV?.setPlayerOpen?.(false);
  stopAlternatePlayer({ hide: true });
  stopEmbeddedPlayer({ hide: true });
  setTimeout(() => document.querySelector('[data-watch-action]')?.focus({ preventScroll: true }), 80);
  return true;
}

window.MVPoiskTVPlayer = {
  closeIfOpen: closeTvPlayerShell,
  isOpen: () => document.body.classList.contains('tv-player-open'),
};

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
let backupAbort = null;
let backupSources = [];
let backupSourceIndex = -1;
let activePlayerMode = 'primary';
let activePlayerSource = 'rendex';
let playerTelemetryTimer = null;
let playerResumeTimer = null;
let resumeFrame = null;
let resumeApplied = false;
let kinoboxScriptPromise = null;
let kinoboxProbeInstance = null;

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
  if (currentMovie) {
    const done = Boolean(getHistoryEntry(currentMovie.id)?.completed);
    document.querySelectorAll('[data-watched-action]').forEach(watched => {
      watched.classList.toggle('is-watched', done);
      watched.setAttribute('aria-pressed', String(done));
      watched.innerHTML = done ? '<span>✓</span><span>Просмотрено</span>' : '<span>✓</span><span>Отметить просмотренным</span>';
    });
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

function inferSeasonEpisode(...values) {
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value) continue;
    let match = value.match(/(?:season|сезон)\s*[:#№._-]?\s*(\d{1,3}).*?(?:episode|эпизод|сер(?:ия|ии|ию)?)\s*[:#№._-]?\s*(\d{1,4})/i);
    if (!match) match = value.match(/\bs\s*(\d{1,3})\s*[eесs]\s*(\d{1,4})\b/i);
    if (!match) match = value.match(/\b(\d{1,3})\s*[xх]\s*(\d{1,4})\b/i);
    if (match) return { season: Number(match[1]), episode: Number(match[2]) };
  }
  return { season: null, episode: null };
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
  const normalizedKind = String(kind || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const answer = data?.answer ?? data?.value ?? null;

  let position = numberFromObject(data, ['currenttime', 'currentposition', 'position', 'playedtime', 'playbacktime', 'seconds']);
  let duration = numberFromObject(data, ['duration', 'totalduration', 'totaltime', 'length']);
  let percent = numberFromObject(data, ['percent', 'progress', 'percentage']);
  let playlistId = stringFromObject(data, ['playlistid', 'currentplaylistid', 'fileid', 'trackid']);
  let playlistTitle = stringFromObject(data, ['playlisttitle', 'currentplaylisttitle', 'filetitle', 'tracktitle']);

  // PlayerJS answers iframe API queries as {event, answer}.
  if (Number.isFinite(Number(answer))) {
    if (normalizedKind === 'time' || normalizedKind === 'currenttime') position = Number(answer);
    if (normalizedKind === 'duration') duration = Number(answer);
  }
  if (typeof answer === 'string' || typeof answer === 'number') {
    if (/playlist_?id|playlistid/.test(normalizedKind)) playlistId = String(answer);
    if (/playlist_?title|playlisttitle/.test(normalizedKind)) playlistTitle = String(answer);
  }

  if (Number.isFinite(percent) && percent > 1 && percent <= 100) percent /= 100;
  let season = numberFromObject(data, ['season', 'seasonnumber', 'seasonnum']);
  let episode = numberFromObject(data, ['episode', 'episodenumber', 'episodenum', 'series']);
  const inferred = inferSeasonEpisode(playlistId, playlistTitle);
  if (!Number.isFinite(season) && Number.isFinite(inferred.season)) season = inferred.season;
  if (!Number.isFinite(episode) && Number.isFinite(inferred.episode)) episode = inferred.episode;
  return { kind, position, duration, percent, season, episode, playlistId, playlistTitle };
}

function playerTargetOrigin(frame) {
  try {
    const src = String(frame?.getAttribute('src') || frame?.src || '');
    const url = new URL(src, location.href);
    return /^https?:$/.test(url.protocol) ? url.origin : '*';
  } catch {
    return '*';
  }
}

function postPlayerApi(frame, api, set) {
  if (!frame?.contentWindow) return false;
  const message = { api };
  if (set !== undefined) message.set = set;
  try {
    frame.contentWindow.postMessage(message, playerTargetOrigin(frame));
    return true;
  } catch {
    try { frame.contentWindow.postMessage(message, '*'); return true; } catch { return false; }
  }
}

function queryPlayerState(frame) {
  if (!frame?.isConnected) return;
  postPlayerApi(frame, 'time');
  postPlayerApi(frame, 'duration');
  postPlayerApi(frame, 'playlist_id');
  postPlayerApi(frame, 'playlist_title');
}

function resumableProgress() {
  if (!currentMovie) return null;
  const entry = getHistoryEntry(currentMovie.id);
  const progress = entry?.progress || null;
  if (!progress || entry?.completed) return null;
  const position = Number(progress.position);
  if (!Number.isFinite(position) || position < 8) return null;
  if (Number.isFinite(Number(progress.percent)) && Number(progress.percent) >= 0.93) return null;
  return progress;
}

function resumeDescription(progress) {
  const bits = [];
  if (Number.isFinite(Number(progress?.season))) bits.push(`сезон ${Number(progress.season)}`);
  if (Number.isFinite(Number(progress?.episode))) bits.push(`серия ${Number(progress.episode)}`);
  const seconds = Math.max(0, Math.floor(Number(progress?.position || 0)));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;
  const time = h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  bits.push(time);
  return bits.join(' · ');
}

function maybeRestorePlayback(frame) {
  if (!frame || frame !== resumeFrame || resumeApplied || !frame.isConnected) return false;
  const progress = resumableProgress();
  if (!progress) return false;

  const position = Math.max(0, Math.floor(Number(progress.position || 0)));
  const playlistId = String(progress.playlistId || '').trim();
  const isSeries = Boolean(currentMovie?.isSeries || /series/i.test(currentMovie?.type || ''));

  // Playlist ids belong to a particular embedded provider. Never send an id
  // learned from Rendex to a different backup provider (or vice versa).
  if (isSeries) {
    if (!playlistId) return false;
    if (progress.playerMode && progress.playerMode !== activePlayerMode) return false;
    if (activePlayerMode === 'backup' && progress.playerSource && playerSourceKey(progress.playerSource) !== playerSourceKey(activePlayerSource)) return false;
  }

  if (playlistId) {
    postPlayerApi(frame, 'play', `id:${playlistId}[seek:${position}]`);
  } else {
    postPlayerApi(frame, 'seek', position);
  }
  resumeApplied = true;
  clearTimeout(playerResumeTimer);
  setPlayerStatus(`Продолжаем с ${resumeDescription(progress)}.`, 'ready');
  return true;
}

function startPlayerBridge(frame) {
  const sameFrame = Boolean(frame && frame === resumeFrame);
  clearInterval(playerTelemetryTimer);
  clearTimeout(playerResumeTimer);
  resumeFrame = frame || null;
  if (!sameFrame) resumeApplied = false;
  if (!frame) return;
  const progress = resumableProgress();
  if (progress) setPlayerStatus(`Нашли позицию ${resumeDescription(progress)} — восстанавливаем…`, 'loading');
  setTimeout(() => queryPlayerState(frame), 500);
  setTimeout(() => queryPlayerState(frame), 1800);
  playerTelemetryTimer = setInterval(() => queryPlayerState(frame), 8000);
  // Some embeds do not emit an explicit ready event but already accept API calls.
  playerResumeTimer = setTimeout(() => maybeRestorePlayback(frame), 2600);
}

function stopPlayerBridge() {
  clearInterval(playerTelemetryTimer);
  clearTimeout(playerResumeTimer);
  playerTelemetryTimer = null;
  playerResumeTimer = null;
  resumeFrame = null;
  resumeApplied = false;
}

function bindPlayerTelemetry() {
  if (telemetryBound) return;
  telemetryBound = true;
  window.addEventListener('message', event => {
    if (!currentMovie) return;
    const section = document.querySelector('#embeddedPlayerSection');
    if (!section || section.hidden) return;
    const frames = [...document.querySelectorAll('#embeddedPlayerHost iframe, #alternatePlayerHost iframe')];
    const matchedFrame = frames.find(frame => {
      try { return frame.contentWindow === event.source; } catch { return false; }
    });
    const sourceMatches = Boolean(matchedFrame);
    const parsed = parsePlayerMessage(event.data);
    if (!parsed) return;
    const kind = String(parsed.kind || '');

    // The Rendex/Vibix embed can explicitly report that content failed to load.
    // Do not leave a dead/black primary iframe on screen in that case.
    if (sourceMatches && kind === 'mvpoisk-clean-content-error' && activePlayerMode === 'primary') {
      setPlayerStatus('Основной плеер не смог открыть видео — подключаем запасной…', 'loading');
      startBackupEmbeddedPlayer({ automatic: true });
      return;
    }

    const recognizedKind = /(time|progress|playback|player|episode|season|ended|complete|playlist|file|track|duration)/i.test(kind);
    if (!sourceMatches && !recognizedKind) return;

    const previous = getHistoryEntry(currentMovie.id)?.progress || {};
    const patch = {};
    if (Number.isFinite(parsed.duration) && parsed.duration >= 30 && parsed.duration <= 24 * 60 * 60) patch.duration = parsed.duration;
    const knownDuration = Number(patch.duration || previous.duration || 0);
    if (Number.isFinite(parsed.position) && parsed.position >= 0 && (!knownDuration || parsed.position <= knownDuration * 1.1)) patch.position = parsed.position;
    if (Number.isFinite(parsed.percent) && parsed.percent >= 0 && parsed.percent <= 1) patch.percent = parsed.percent;
    if (Number.isFinite(parsed.season) && parsed.season >= 0 && parsed.season < 1000) patch.season = parsed.season;
    if (Number.isFinite(parsed.episode) && parsed.episode >= 0 && parsed.episode < 10000) patch.episode = parsed.episode;
    if (parsed.playlistId) patch.playlistId = String(parsed.playlistId).slice(0, 160);
    if (parsed.playlistTitle) patch.playlistTitle = String(parsed.playlistTitle).slice(0, 240);
    patch.playerMode = activePlayerMode;
    patch.playerSource = activePlayerSource;
    const detected = Object.keys(patch);
    rememberPlayerDiagnostic(event, parsed.kind, detected);
    if (!sourceMatches) return;

    // A real response from the mounted iframe means PlayerJS is ready enough
    // to accept the cross-device resume command.
    maybeRestorePlayback(matchedFrame);

    const meaningful = detected.some(key => !['playerMode', 'playerSource'].includes(key));
    if (!meaningful) return;
    const now = Date.now();
    const metadataChanged =
      ('season' in patch && Number(patch.season) !== Number(previous.season)) ||
      ('episode' in patch && Number(patch.episode) !== Number(previous.episode)) ||
      ('playlistId' in patch && String(patch.playlistId || '') !== String(previous.playlistId || '')) ||
      ('playlistTitle' in patch && String(patch.playlistTitle || '') !== String(previous.playlistTitle || ''));
    const important = metadataChanged || patch.percent === 1;
    if (!important && now - lastTelemetryWrite < 10000) return;
    lastTelemetryWrite = now;
    updatePlaybackProgress(currentMovie.id, patch);
    updateWatchStateButtons();
  });
}

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


// MVPoisk playback/account sync fix v50
const BACKUP_SOURCE_PRIORITY = ['kodik', 'vibix', 'hdvb', 'voidboost', 'ashdi', 'cdnmovies', 'videocdn', 'alloha', 'collaps'];
const BACKUP_SOURCE_BLOCKED = new Set(['turbo', 'obrut']);

function playerSourceKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function kinoboxPlayerApiUrl(id) {
  const url = new URL('/api/players', CONFIG.KINOBOX_BASE_URL);
  url.searchParams.set('kinopoisk', String(id));
  return url.toString();
}

function normalizeBackupSources(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.sources)
        ? payload.sources
        : [];
  const seen = new Set();
  return rows
    .map((item, index) => {
      const type = String(item?.type || item?.source || `Источник ${index + 1}`).trim();
      const iframeUrl = String(item?.iframeUrl || '').trim();
      const key = playerSourceKey(type);
      return { index, type, key, iframeUrl };
    })
    .filter(item => {
      if (!/^https?:\/\//i.test(item.iframeUrl)) return false;
      if (BACKUP_SOURCE_BLOCKED.has(item.key) || /obrut/i.test(item.iframeUrl)) return false;
      if (seen.has(item.iframeUrl)) return false;
      seen.add(item.iframeUrl);
      return true;
    })
    .sort((a, b) => {
      const ai = BACKUP_SOURCE_PRIORITY.indexOf(a.key);
      const bi = BACKUP_SOURCE_PRIORITY.indexOf(b.key);
      const ar = ai < 0 ? 50 : ai;
      const br = bi < 0 ? 50 : bi;
      return ar - br || a.index - b.index;
    });
}

function cleanBackupPlayerUrl(rawUrl) {
  // Keep the partner-provided iframe URL byte-for-byte. Some backup providers
  // sign the full query string, so adding our own parameters can break playback.
  return String(rawUrl || '');
}

function updateBackupButton() {
  const button = document.querySelector('[data-player-backup]');
  if (!button) return;
  const hasMore = activePlayerMode === 'backup' && backupSources.length > 1;
  button.textContent = hasMore ? 'Другой источник' : 'Запасной';
  button.title = hasMore ? 'Переключить на следующий запасной источник' : 'Открыть запасной встроенный источник';
}

function mountBackupSource(host, index = 0) {
  if (!host || !backupSources.length) return false;
  const safeIndex = ((index % backupSources.length) + backupSources.length) % backupSources.length;
  const source = backupSources[safeIndex];
  backupSourceIndex = safeIndex;
  activePlayerMode = 'backup';
  activePlayerSource = source.key || source.type || 'backup';
  const src = cleanBackupPlayerUrl(source.iframeUrl);
  host.classList.remove('player-failed');
  host.innerHTML = `
    <div class="embedded-player-loader" aria-hidden="true">
      <div class="spinner"></div>
      <strong>Подключаем запасной источник…</strong>
      <span>${esc(source.type)}</span>
    </div>
    <iframe class="mv-embedded-iframe mv-backup-player-frame"
      src="${esc(src)}"
      title="${esc(`Запасной источник ${source.type}`)}"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowfullscreen
      referrerpolicy="origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-modals allow-popups"></iframe>`;
  const frame = host.querySelector('.mv-backup-player-frame');
  frame?.addEventListener('load', () => {
    setPlayerStarting(false);
    setPlayerStatus(`Запасной источник ${source.type} загружен. Если экран пустой — нажми «Другой источник».`, 'ready');
    startPlayerBridge(frame);
    updateBackupButton();
  }, { once: true });
  setPlayerStatus(`Подключаем запасной источник ${source.type}…`, 'loading');
  updateBackupButton();
  return true;
}


function loadKinoboxSdk() {
  if (typeof window.kinobox === 'function') return Promise.resolve();
  if (kinoboxScriptPromise) return kinoboxScriptPromise;
  kinoboxScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.dataset.mvKinoboxSdk = '1';
    script.src = CONFIG.KINOBOX_SDK_URL;
    script.onload = () => typeof window.kinobox === 'function'
      ? resolve()
      : reject(new Error('Kinobox loaded without global function'));
    script.onerror = () => {
      kinoboxScriptPromise = null;
      script.remove();
      reject(new Error('Kinobox SDK blocked or unavailable'));
    };
    document.head.appendChild(script);
  });
  return kinoboxScriptPromise;
}

async function fetchBackupSourcesViaSdk() {
  await loadKinoboxSdk();
  const { host } = playerElements();
  if (!host) throw new Error('Player host missing');
  return new Promise((resolve, reject) => {
    const probe = document.createElement('div');
    probe.className = 'mv-kinobox-probe';
    probe.dataset.kinopoisk = String(currentMovie.id);
    probe.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    host.appendChild(probe);
    let settled = false;
    const finish = (error, rows = []) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { kinoboxProbeInstance?.$destroy?.(); } catch {}
      kinoboxProbeInstance = null;
      probe.remove();
      if (error) reject(error); else resolve(rows);
    };
    const timer = setTimeout(() => finish(new Error('Kinobox SDK timeout')), CONFIG.BACKUP_PLAYER_TIMEOUT_MS || 12000);
    try {
      kinoboxProbeInstance = window.kinobox(probe, {
        baseUrl: CONFIG.KINOBOX_BASE_URL,
        search: { kinopoisk: String(currentMovie.id) },
        menu: { enable: false },
        params: { all: { noads: '1', onlyNoAds: '1' } },
        notFoundMessage: 'Источники не найдены.',
        events: {
          playerLoaded(result) {
            const rows = normalizeBackupSources(result);
            if (!rows.length) finish(new Error('Kinobox SDK returned no sources'));
            else finish(null, rows);
          }
        }
      });
    } catch (error) {
      finish(error);
    }
  });
}

async function fetchBackupSources() {
  if (backupSources.length) return backupSources;
  backupAbort?.abort();
  const controller = new AbortController();
  backupAbort = controller;
  const timeout = setTimeout(() => controller.abort(), CONFIG.BACKUP_PLAYER_TIMEOUT_MS || 12000);
  let directError = null;
  try {
    try {
      const response = await fetch(kinoboxPlayerApiUrl(currentMovie.id), {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Backup HTTP ${response.status}`);
      const rows = normalizeBackupSources(await response.json());
      if (!rows.length) throw new Error('No backup sources');
      backupSources = rows;
      return rows;
    } catch (error) {
      directError = error;
    }
  } finally {
    clearTimeout(timeout);
    if (backupAbort === controller) backupAbort = null;
  }

  try {
    const rows = await fetchBackupSourcesViaSdk();
    backupSources = rows;
    return rows;
  } catch (sdkError) {
    console.warn('[MVPoisk backup source lookup]', directError, sdkError);
    throw sdkError;
  }
}
async function startBackupEmbeddedPlayer({ next = false, automatic = false, preferredSource = '' } = {}) {
  if (!currentMovie) return;
  const { section, host } = playerElements();
  if (!section || !host) return;

  recordWatchStart(currentMovie, 'backup');
  updateWatchStateButtons();
  section.hidden = false;
  if (isTVMode()) openTvPlayerShell('backup');
  else if (!automatic) requestAnimationFrame(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }));

  if (next && backupSources.length) {
    setPlayerStarting(true);
    mountBackupSource(host, backupSourceIndex + 1);
    return;
  }

  setPlayerStarting(true);
  playerObserver?.disconnect();
  clearTimeout(playerTimer);
  host.classList.remove('player-failed');
  host.innerHTML = '<div class="embedded-player-loader"><div class="spinner"></div><strong>Ищем запасной источник…</strong><span>Это займёт несколько секунд</span></div>';
  setPlayerStatus(automatic ? 'Основной плеер не ответил — ищем запасной…' : 'Ищем запасной встроенный источник…', 'loading');

  try {
    await fetchBackupSources();
    let preferredIndex = 0;
    if (preferredSource) {
      const wanted = playerSourceKey(preferredSource);
      const found = backupSources.findIndex(item => item.key === wanted || playerSourceKey(item.type) === wanted);
      if (found >= 0) preferredIndex = found;
    }
    mountBackupSource(host, preferredIndex);
  } catch (error) {
    console.warn('[MVPoisk backup player]', error);
    setPlayerStarting(false);
    activePlayerMode = 'primary';
    host.classList.add('player-failed');
    host.innerHTML = '<div class="embedded-player-loader"><div class="player-fail-mark">!</div><strong>Запасной источник тоже не ответил</strong><span>Открой GGPoisk — он остаётся доступен сверху</span></div>';
    setPlayerStatus('Не удалось подключить встроенные источники. Используй GGPoisk.', 'error');
    updateBackupButton();
  }
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
  activePlayerMode = 'primary';
  activePlayerSource = 'rendex';
  startPlayerBridge(iframe);
  updateBackupButton();
  setPlayerStatus('Плеер подключён. Если увидишь чёрный экран — нажми «Запасной».', 'ready');
  iframe.addEventListener('load', () => {
    let src = '';
    try { src = String(iframe.getAttribute('src') || iframe.src || ''); } catch {}
    if (!src || /^about:blank(?:$|[?#])/i.test(src)) {
      setPlayerStatus('Основной плеер открыл пустой экран — подключаем запасной…', 'loading');
      startBackupEmbeddedPlayer({ automatic: true });
      return;
    }
    startPlayerBridge(iframe);
    setPlayerStatus('Плеер загружен. Если экран остаётся чёрным — нажми «Запасной».', 'ready');
  }, { once: true });
}
function stopEmbeddedPlayer({ hide = true } = {}) {
  playerAttemptId += 1;
  playerObserver?.disconnect();
  clearTimeout(playerTimer);
  backupAbort?.abort();
  backupAbort = null;
  try { kinoboxProbeInstance?.$destroy?.(); } catch {}
  kinoboxProbeInstance = null;
  backupSources = [];
  backupSourceIndex = -1;
  stopPlayerBridge();
  activePlayerMode = 'primary';
  activePlayerSource = 'rendex';
  const { section, host } = playerElements();
  if (host) {
    // Removing the cross-origin iframe is the reliable way to stop hidden audio/video.
    host.replaceChildren();
    host.classList.remove('player-failed');
  }
  setPlayerStarting(false);
  setPlayerStatus('Плеер остановлен.', 'ready');
  if (section && hide) section.hidden = true;
  updateBackupButton();
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

function closePlayerSection() {
  if (isTVMode() && document.body.classList.contains('tv-player-open')) {
    closeTvPlayerShell();
    return;
  }
  stopEmbeddedPlayer({ hide: true });
}

async function startAlternatePlayer() {
  if (!currentMovie) return;
  recordWatchStart(currentMovie, 'partner');
  updateWatchStateButtons();
  const url = getWatchUrl(currentMovie.id);
  if (isWatchNoticeDismissed()) {
    pendingWatchUrl = url;
    openPartnerWatch(false);
    return;
  }
  openWatchNotice(url);
}

async function startPrimaryPlayer(force = false) {
  // Manual retry always returns to the stable primary source.
  return startEmbeddedPlayer(force);
}

async function startPreferredPlayer() {
  if (!currentMovie) return;

  // Pull the latest account state right before playback. This is important on a
  // second device: page initialization and Telegram/D1 sync can finish after
  // the movie card itself has already rendered. Offline/errors remain harmless
  // because syncFromCloud() falls back to the local state.
  try { await syncFromCloud({ quiet: true }); } catch {}

  const entry = getHistoryEntry(currentMovie.id);
  if (entry?.source === 'backup') {
    return startBackupEmbeddedPlayer({ preferredSource: entry?.progress?.playerSource || '' });
  }
  return startEmbeddedPlayer(false);
}

async function startEmbeddedPlayer(force = false) {
  if (!currentMovie) return;
  const { section, host } = playerElements();
  if (!section || !host) return;

  if (playerStarting && !force) return;
  backupAbort?.abort();
  backupAbort = null;
  backupSources = [];
  backupSourceIndex = -1;
  activePlayerMode = 'primary';
  activePlayerSource = 'rendex';
  updateBackupButton();
  recordWatchStart(currentMovie, 'primary');
  updateWatchStateButtons();
  const attemptId = ++playerAttemptId;
  setPlayerStarting(true);

  section.hidden = false;
  if (isTVMode()) openTvPlayerShell('primary');
  else requestAnimationFrame(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }));

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
  setPlayerStatus('Подключаем видео…', 'loading');
  observePlayer(host);

  const fallbackFromPrimary = () => {
    if (attemptId !== playerAttemptId || host.querySelector('iframe')) return;
    playerObserver?.disconnect();
    setPlayerStatus('Основной плеер не ответил — подключаем запасной…', 'loading');
    startBackupEmbeddedPlayer({ automatic: true });
  };

  // Rendex occasionally loads its SDK successfully but misses the first <ins>
  // scan on slower/mobile browsers. Give the same primary source one clean
  // rescan before falling back. Total waiting time stays roughly the same as
  // before, so this does not make a broken page hang for longer.
  const firstWait = Math.min(Number(CONFIG.PLAYER_LOAD_TIMEOUT_MS || 15000), 8500);
  const secondWait = Math.max(3500, Number(CONFIG.PLAYER_LOAD_TIMEOUT_MS || 15000) - firstWait);
  playerTimer = setTimeout(() => {
    if (attemptId !== playerAttemptId || host.querySelector('iframe')) return;
    const slot = host.querySelector('.mv-rendex-slot');
    if (!slot) return fallbackFromPrimary();
    setPlayerStatus('Основной плеер отвечает медленно — повторяем подключение…', 'loading');
    slot.replaceWith(slot.cloneNode(true));
    playerTimer = setTimeout(fallbackFromPrimary, secondWait);
  }, firstWait);

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
    console.warn('[MVPoisk player]', error);
    setPlayerStatus('Основной сервис недоступен — подключаем запасной…', 'loading');
    startBackupEmbeddedPlayer({ automatic: true });
  }
}

function bindWatchAction() {
  const button = document.querySelector('[data-watch-action]');
  button?.addEventListener('click', () => startPreferredPlayer());

  document.querySelector('[data-player-retry]')?.addEventListener('click', () => startPrimaryPlayer(true));
  document.querySelector('[data-player-backup]')?.addEventListener('click', () => startBackupEmbeddedPlayer({ next: activePlayerMode === 'backup' }));
  document.querySelectorAll('[data-player-close]').forEach(button => button.addEventListener('click', closePlayerSection));

  document.querySelector('[data-watch-alternate-action]')?.addEventListener('click', () => startAlternatePlayer(false));
  document.querySelector('[data-tv-more]')?.addEventListener('click', event => {
    const actions = event.currentTarget.closest('.movie-actions-primary');
    if (!actions) return;
    const opened = actions.classList.toggle('tv-more-open');
    event.currentTarget.setAttribute('aria-expanded', String(opened));
  });

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
          <div class="movie-kicker">${movie.isSeries ? 'Сериал' : 'Фильм'}</div>
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
            <button class="secondary-button tv-more-action" type="button" data-tv-more aria-expanded="false"><span>⋯</span><span>Ещё</span></button>
            <button class="secondary-button ggpoisk-action" type="button" data-watch-alternate-action><span>↗</span><span>GGPoisk</span></button>
            <a class="secondary-button kp-link-button" href="https://www.kinopoisk.ru/film/${movie.id}/" target="_blank" rel="noopener noreferrer" aria-label="Открыть карточку фильма в Кинопоиске"><span class="kp-link-badge" aria-hidden="true"><img src="./icons/kinopoisk-mark.png" alt="" loading="lazy" decoding="async"></span><span class="kp-link-label">Кинопоиск</span><span class="kp-link-out" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 14L14 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 6H14V12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span></a>
          </div>
                  </div>
      </div>
    </section>
    <section class="embedded-player-section" id="embeddedPlayerSection" hidden>
      <div class="tv-player-cursor-help" aria-hidden="true">Стрелки — курсор · OK — нажать · Back — назад</div>
      <div class="embedded-player-inner">
        <div class="embedded-player-heading">
          <div>
            <span class="eyebrow">Просмотр</span>
            <h2>${esc(title)}</h2>
            <p>${movie.isSeries ? 'Основной плеер открывается прямо в MVPoisk. Сезоны, серии и озвучки выбираются внутри плеера.' : 'Основной плеер открывается прямо в MVPoisk. Если он не подходит, рядом есть переход в GGPoisk.'}</p>
          </div>
          <div class="embedded-player-actions">
            <button type="button" class="player-mini-button" data-player-retry>Повторить</button>
            <button type="button" class="player-mini-button player-mini-backup" data-player-backup>Запасной</button>
            <a class="player-mini-button player-mini-primary" data-partner-watch href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer">GGPoisk ↗</a>
            <button type="button" class="player-mini-button" data-player-close>Закрыть</button>
          </div>
        </div>
        <div class="embedded-player-stage" id="embeddedPlayerHost"></div>
        <div class="embedded-player-status" id="embeddedPlayerStatus" data-state="loading"><span class="player-status-dot"></span><span>Плеер ещё не запускался.</span></div>
      </div>
    </section>
    <div class="movie-content">
      <section class="facts-panel">
        <div><span>Год</span><strong>${esc(movie.year || '—')}</strong></div>
        <div><span>Страна</span><strong>${esc(countries || '—')}</strong></div>
        <div><span>Жанры</span><strong>${esc(genres || '—')}</strong></div>
        <div><span>Длительность</span><strong>${esc(runtime(movie.movieLength) || '—')}</strong></div>
        
      </section>
      ${people.length ? `<section class="content-section"><div class="section-heading"><div><span class="eyebrow">В ролях</span><h2>Актёры</h2></div></div><div class="people-row">${people.map(personCard).join('')}</div></section>` : ''}
      <section class="content-section" id="reviewsSection" hidden><div class="section-heading"><div><span class="eyebrow">Мнения зрителей</span><h2 id="reviewsHeading">Отзывы</h2></div></div><div class="reviews-grid" id="reviewsGrid"></div></section>
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
      const reviewsHeading = document.querySelector('#reviewsHeading');
      if (reviewsHeading) reviewsHeading.textContent = `Отзывы · ${reviews.length}`;
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
