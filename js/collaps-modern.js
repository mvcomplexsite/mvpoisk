import { CONFIG } from './config.js?v=44';

const VENOM_VERSION = '0.2.92';
const VENOM_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/venom-player@${VENOM_VERSION}`;
const VENOM_PUBLIC_PATH = `https://cdn.jsdelivr.net/npm/venom-player@${VENOM_VERSION}/dist/`;
const CONFIG_TIMEOUT_MS = 12000;
const PLAYER_READY_TIMEOUT_MS = 15000;

let venomScriptPromise = null;

function loadVenomPlayer() {
  if (window.VenomPlayer?.make) return Promise.resolve(window.VenomPlayer);
  if (venomScriptPromise) return venomScriptPromise;
  venomScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-mv-venom-player]');
    if (existing) {
      const timer = setInterval(() => {
        if (window.VenomPlayer?.make) {
          clearInterval(timer);
          resolve(window.VenomPlayer);
        }
      }, 80);
      setTimeout(() => {
        clearInterval(timer);
        if (window.VenomPlayer?.make) resolve(window.VenomPlayer);
        else reject(new Error('venom_player_load_timeout'));
      }, 10000);
      return;
    }
    const script = document.createElement('script');
    script.src = VENOM_SCRIPT_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.mvVenomPlayer = '1';
    script.onload = () => window.VenomPlayer?.make
      ? resolve(window.VenomPlayer)
      : reject(new Error('venom_player_missing_global'));
    script.onerror = () => reject(new Error('venom_player_script_failed'));
    document.head.appendChild(script);
  }).catch(error => {
    venomScriptPromise = null;
    throw error;
  });
  return venomScriptPromise;
}

function cleanSerializable(value, depth = 0) {
  if (depth > 18) return undefined;
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.map(item => cleanSerializable(item, depth + 1)).filter(item => item !== undefined);
  if (type !== 'object') return undefined;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['ads', 'adsconfig', 'advertising', 'preroll', 'midroll', 'postroll'].includes(normalized)) continue;
    const cloned = cleanSerializable(item, depth + 1);
    if (cloned !== undefined) out[key] = cloned;
  }
  return out;
}

function evaluateConfigExpression(expression) {
  return new Promise((resolve, reject) => {
    const requestId = `mvcp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.setAttribute('aria-hidden', 'true');
    frame.sandbox = 'allow-scripts';
    frame.srcdoc = `<!doctype html><meta charset="utf-8"><script>
      addEventListener('message', function(event) {
        var data = event.data || {};
        if (data.type !== 'mv-collaps-eval') return;
        try {
          var value = Function('"use strict";return (' + data.expression + ')')();
          var seen = new WeakSet();
          function clone(v, depth) {
            if (depth > 18) return undefined;
            if (v === null) return null;
            var t = typeof v;
            if (t === 'string' || t === 'boolean') return v;
            if (t === 'number') return Number.isFinite(v) ? v : undefined;
            if (Array.isArray(v)) return v.map(function(x){ return clone(x, depth + 1); }).filter(function(x){ return x !== undefined; });
            if (t !== 'object') return undefined;
            if (seen.has(v)) return undefined;
            seen.add(v);
            var o = {};
            Object.keys(v).forEach(function(k) {
              var n = k.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (['ads','adsconfig','advertising','preroll','midroll','postroll'].indexOf(n) >= 0) return;
              var x = clone(v[k], depth + 1);
              if (x !== undefined) o[k] = x;
            });
            return o;
          }
          parent.postMessage({ type: 'mv-collaps-eval-result', id: data.id, ok: true, config: clone(value, 0) }, '*');
        } catch (error) {
          parent.postMessage({ type: 'mv-collaps-eval-result', id: data.id, ok: false, error: String(error && error.message || error) }, '*');
        }
      });
    <\/script>`;

    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove();
      if (error) reject(error);
      else resolve(value);
    };
    const onMessage = event => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data || {};
      if (data.type !== 'mv-collaps-eval-result' || data.id !== requestId) return;
      if (!data.ok) finish(new Error(data.error || 'collaps_config_eval_failed'));
      else finish(null, cleanSerializable(data.config));
    };
    window.addEventListener('message', onMessage);
    const timer = setTimeout(() => finish(new Error('collaps_config_eval_timeout')), 5000);
    frame.addEventListener('load', () => {
      frame.contentWindow?.postMessage({ type: 'mv-collaps-eval', id: requestId, expression }, '*');
    }, { once: true });
    document.body.appendChild(frame);
  });
}

async function fetchCollapsConfig(kpId, sourceUrl = '') {
  const url = new URL('/player/collaps/config', CONFIG.AUTH_WORKER_BASE);
  url.searchParams.set('id', String(kpId));
  if (sourceUrl) url.searchParams.set('src', sourceUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`collaps_config_http_${response.status}`);
    const payload = await response.json();
    if (!payload?.ok || typeof payload.expression !== 'string' || !payload.expression.trim()) {
      throw new Error(payload?.error || 'collaps_config_missing_expression');
    }
    return evaluateConfigExpression(payload.expression);
  } finally {
    clearTimeout(timer);
  }
}

function buildPlayerOptions(rawConfig, container, title, historyEntry) {
  const options = cleanSerializable(rawConfig) || {};
  if (!options.source && !options.playlist) throw new Error('collaps_config_without_media');
  delete options.ads;
  delete options.adsConfig;
  delete options.advertising;
  options.container = container;
  options.publicPath = VENOM_PUBLIC_PATH;
  options.theme = 'modern';
  options.title = title || options.title || 'MVPoisk';
  options.pip = true;
  options.autoLandscape = true;
  options.speed = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  options.rewind = [5, 20];
  options.volume = 1;
  options.trackProgress = 5;
  options.doNotSaveProgress = true;
  options.ui = {
    ...(options.ui || {}),
    timeline: true,
    fullscreen: true,
    share: false,
    prevNext: true,
    titleOnlyOnFullscreen: true,
  };

  const progress = historyEntry?.progress || {};
  const position = Number(progress.position);
  const duration = Number(progress.duration);
  if (Number.isFinite(position) && position > 5 && (!Number.isFinite(duration) || position < duration - 20)) {
    options.time = Math.floor(position);
  }
  const season = Number(progress.season);
  const episode = Number(progress.episode);
  if (options.playlist && Number.isFinite(season) && Number.isFinite(episode) && season > 0 && episode > 0) {
    options.playlist.current = { season, episode: String(episode) };
  }
  if (options.playlist && typeof options.playlist === 'object') options.playlist.open = false;
  return options;
}

function bindVideoTelemetry(container, callbacks, state) {
  let boundVideo = null;
  let lastWrite = 0;
  const bind = video => {
    if (!video || video === boundVideo) return;
    boundVideo = video;
    video.playsInline = true;
    const sendProgress = force => {
      const now = Date.now();
      if (!force && now - lastWrite < 4000) return;
      const duration = Number(video.duration);
      const position = Number(video.currentTime);
      if (!Number.isFinite(duration) || duration < 30 || !Number.isFinite(position) || position < 0) return;
      lastWrite = now;
      callbacks.onProgress?.({
        position,
        duration,
        percent: duration > 0 ? Math.max(0, Math.min(1, position / duration)) : null,
        ...(state.season ? { season: state.season } : {}),
        ...(state.episode ? { episode: state.episode } : {}),
      });
    };
    video.addEventListener('loadedmetadata', () => callbacks.onReady?.(video), { once: true });
    video.addEventListener('canplay', () => callbacks.onReady?.(video), { once: true });
    video.addEventListener('timeupdate', () => sendProgress(false));
    video.addEventListener('pause', () => sendProgress(true));
    video.addEventListener('ended', () => {
      sendProgress(true);
      callbacks.onProgress?.({ position: Number(video.duration) || 1, duration: Number(video.duration) || 1, percent: 1, ...(state.season ? { season: state.season } : {}), ...(state.episode ? { episode: state.episode } : {}) });
    });
    video.addEventListener('error', () => callbacks.onVideoError?.(video.error));
  };

  const findAndBind = () => {
    const video = container.querySelector('video');
    if (video) bind(video);
    return video;
  };
  findAndBind();
  const observer = new MutationObserver(findAndBind);
  observer.observe(container, { childList: true, subtree: true });
  return () => observer.disconnect();
}

export async function mountCollapsModernPlayer({ container, kpId, sourceUrl = '', title = '', historyEntry = null, onReady, onProgress, onPlaylistItem, onVideoError } = {}) {
  if (!container) throw new Error('collaps_container_missing');
  const [VenomPlayer, rawConfig] = await Promise.all([
    loadVenomPlayer(),
    fetchCollapsConfig(kpId, sourceUrl),
  ]);

  const options = buildPlayerOptions(rawConfig, container, title, historyEntry);
  let player;
  try {
    player = VenomPlayer.make(options);
  } catch (error) {
    throw new Error(`collaps_venom_init_failed:${error?.message || error}`);
  }

  const state = { season: Number(historyEntry?.progress?.season) || null, episode: Number(historyEntry?.progress?.episode) || null };
  const callbacks = { onReady, onProgress, onPlaylistItem, onVideoError };
  let cleaned = false;
  let ready = false;
  const markReady = video => {
    if (ready) return;
    ready = true;
    onReady?.(video);
  };
  callbacks.onReady = markReady;
  const stopTelemetry = bindVideoTelemetry(container, callbacks, state);

  const bindPlayerEvents = current => {
    if (!current?.on) return;
    try {
      current.on('playlistItem', item => {
        const season = Number(item?.season);
        const episode = Number(item?.episode);
        if (Number.isFinite(season) && season > 0) state.season = season;
        if (Number.isFinite(episode) && episode > 0) state.episode = episode;
        onPlaylistItem?.({ season: state.season, episode: state.episode, raw: item });
      });
      current.on('ready', () => {
        const video = container.querySelector('video');
        markReady(video || null);
      });
    } catch {}
  };
  bindPlayerEvents(player);
  try {
    player.onRenew = renewed => bindPlayerEvents(renewed || player);
  } catch {}

  const readyTimer = setTimeout(() => {
    if (!ready && !cleaned) {
      const video = container.querySelector('video');
      if (video && video.readyState >= 1) markReady(video);
      else onVideoError?.(new Error('collaps_modern_ready_timeout'));
    }
  }, PLAYER_READY_TIMEOUT_MS);

  return {
    player,
    destroy() {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(readyTimer);
      stopTelemetry();
      try { player?.destroy?.(); } catch {}
      try { player?.remove?.(); } catch {}
      container.replaceChildren();
    },
  };
}
