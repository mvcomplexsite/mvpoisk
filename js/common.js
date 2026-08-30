import { getProfile, saveProfile, counts } from './storage.js?v=37';
import {
  initAccounts,
  getAccountState,
  isAccountsConfigured,
  isTvPairingConfigured,
  signInWithTelegram,
  signOut,
  updateDisplayName,
  syncFromCloud,
  beginTvPairing,
  pollTvPairing,
  approveTvPairCode,
} from './account.js?v=37';

let tvPollTimer = null;

function esc(value = '') {
  return String(value || '').replace(/[&<>'"]/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;'
  }[ch]));
}

function accountLabel(account = getAccountState()) {
  const local = getProfile();
  if (local?.name) return local.name;
  if (account.telegramUsername) return `@${account.telegramUsername}`;
  return account.displayName || (account.signedIn ? 'Аккаунт' : 'Войти');
}

function updateHeaderState() {
  const c = counts();
  const total = c.watchLater + c.favorites;
  document.querySelectorAll('[data-list-count]').forEach(node => {
    node.textContent = String(total);
    node.hidden = total === 0;
  });

  const account = getAccountState();
  const label = account.signedIn ? accountLabel(account) : (account.configured ? 'Войти' : (getProfile()?.name || 'Профиль'));
  document.querySelectorAll('[data-profile-open]').forEach(node => {
    if (node.classList.contains('profile-pill')) return;
    node.textContent = label;
    node.title = account.signedIn ? `MVPoisk: ${label}` : (account.configured ? 'Войти в MVPoisk' : 'Локальный профиль');
  });

  const profileLabel = document.querySelector('#profileLabel');
  if (profileLabel) profileLabel.textContent = account.signedIn ? accountLabel(account) : (account.configured ? 'Войти в аккаунт' : (getProfile()?.name || 'Локальный профиль'));
  const profileAvatar = document.querySelector('#profileAvatar');
  if (profileAvatar) {
    const base = account.signedIn ? accountLabel(account).replace(/^@/, '') : (getProfile()?.name || 'MV');
    profileAvatar.textContent = base.slice(0, 2).toUpperCase();
  }

  document.querySelectorAll('[data-cloud-status]').forEach(node => {
    node.textContent = account.signedIn ? account.syncMessage : 'Локально';
  });
}

function modal() {
  let wrap = document.querySelector('#accountModal');
  if (wrap) return wrap;
  wrap = document.createElement('div');
  wrap.id = 'accountModal';
  wrap.className = 'modal-shell account-modal';
  wrap.hidden = true;
  wrap.innerHTML = '<div class="modal-backdrop" data-account-close></div><section class="modal-card account-card" role="dialog" aria-modal="true" aria-labelledby="accountTitle"><button class="modal-close" type="button" aria-label="Закрыть" data-account-close>×</button><div id="accountModalBody"></div></section>';
  document.body.appendChild(wrap);
  wrap.querySelectorAll('[data-account-close]').forEach(node => node.addEventListener('click', closeAccountModal));
  return wrap;
}

function statusHtml(message = '', type = '') {
  if (!message) return '<div class="account-status" data-account-status hidden></div>';
  return `<div class="account-status ${type ? `is-${type}` : ''}" data-account-status>${esc(message)}</div>`;
}

function localProfileMarkup() {
  const profile = getProfile();
  return `
    <span class="eyebrow">Локальный режим</span>
    <h2 id="accountTitle">Профиль MVPoisk</h2>
    <p class="modal-copy">Облачные аккаунты ещё не подключены. Списки и история пока остаются только на этом устройстве.</p>
    <form class="profile-form" data-local-profile-form>
      <label><span>Имя</span><input name="name" maxlength="32" autocomplete="nickname" placeholder="Например, Алекс" value="${esc(profile?.name || '')}"></label>
      <button class="primary-action" type="submit">Сохранить</button>
    </form>
    <div class="account-setup-note">Для Telegram-входа нужно подключить D1 к Cloudflare Worker и добавить Telegram Client ID/Secret в его Secrets.</div>`;
}

function telegramGuestMarkup() {
  return `
    <span class="eyebrow">Аккаунт MVPoisk</span>
    <h2 id="accountTitle">Войти в MVPoisk</h2>
    <p class="modal-copy">Один аккаунт для избранного, истории и «Смотреть дальше» на телефоне, компьютере и телевизоре.</p>
    ${statusHtml()}
    <button class="telegram-login-button" type="button" data-telegram-login>
      <span class="telegram-login-icon" aria-hidden="true">➤</span>
      <span><strong>Войти через Telegram</strong><small>Без почты и пароля</small></span>
    </button>
    <p class="account-fineprint">При первом входе аккаунт MVPoisk создаётся автоматически из Telegram-профиля.</p>`;
}

function formatRemaining(expiresAt) {
  const seconds = Math.max(0, Math.ceil((Number(expiresAt || 0) - Date.now()) / 1000));
  const min = Math.floor(seconds / 60);
  const sec = String(seconds % 60).padStart(2, '0');
  return `${min}:${sec}`;
}

function tvGuestMarkup() {
  const account = getAccountState();
  const pairing = account.pairing;
  if (!isTvPairingConfigured()) {
    return `
      <span class="eyebrow">Вход на телевизоре</span>
      <h2 id="accountTitle">TV-вход ещё не настроен</h2>
      <p class="modal-copy">Нужно подключить D1 к Cloudflare Worker. После этого здесь появится одноразовый код.</p>`;
  }
  if (!pairing?.code || Number(pairing.expiresAt || 0) <= Date.now()) {
    return `
      <span class="eyebrow">Вход на телевизоре</span>
      <h2 id="accountTitle">Подключить MVPoisk TV</h2>
      <p class="modal-copy">Создаём одноразовый код для этого телевизора.</p>
      ${statusHtml('Получаем код…')}
      <button class="primary-action tv-pair-refresh" type="button" data-tv-new-code>Получить код</button>`;
  }
  return `
    <span class="eyebrow">Вход на телевизоре</span>
    <h2 id="accountTitle">Подключить MVPoisk TV</h2>
    <p class="modal-copy">Открой MVPoisk на телефоне или компьютере, войди через Telegram и в профиле выбери «Подключить телевизор».</p>
    ${statusHtml()}
    <div class="tv-pair-code" aria-label="Код подключения">${esc(pairing.displayCode || pairing.code)}</div>
    <div class="tv-pair-timer">Код действует ещё <strong>${formatRemaining(pairing.expiresAt)}</strong></div>
    <div class="tv-pair-steps"><span>1</span><p>Войди в MVPoisk на телефоне/ПК</p><span>2</span><p>Введи этот код в профиле</p><span>3</span><p>Телевизор войдёт автоматически</p></div>
    <button class="account-text-button" type="button" data-tv-new-code>Получить новый код</button>`;
}

function accountMarkup() {
  const account = getAccountState();
  const local = getProfile();
  const name = local?.name || account.displayName || account.telegramUsername || 'Пользователь';
  const subtitle = account.isTvDevice
    ? 'Телевизор подключён к аккаунту'
    : (account.telegramUsername ? `@${account.telegramUsername}` : 'Telegram');
  const avatar = account.avatarUrl
    ? `<img class="account-avatar account-avatar-image" src="${esc(account.avatarUrl)}" alt="">`
    : `<span class="account-avatar">${esc(name.slice(0, 2).toUpperCase())}</span>`;
  return `
    <span class="eyebrow">Аккаунт MVPoisk</span>
    <div class="account-identity">
      ${avatar}
      <div><h2 id="accountTitle">${esc(name)}</h2><p>${esc(subtitle)}</p></div>
    </div>
    <div class="account-sync-row"><span class="account-sync-dot"></span><span>${esc(account.syncMessage)}</span><button type="button" data-sync-now>Обновить</button></div>
    ${statusHtml()}
    ${!account.isTvDevice ? `
      <form class="account-form account-name-form" data-name-form>
        <label><span>Имя в MVPoisk</span><input name="name" maxlength="32" autocomplete="name" value="${esc(name)}"></label>
        <button class="secondary-account-action" type="submit">Сохранить имя</button>
      </form>
      <div class="tv-link-panel">
        <strong>Подключить телевизор</strong>
        <p>На телевизоре открой «Войти», затем введи показанный код сюда.</p>
        <form class="tv-link-form" data-tv-link-form>
          <input name="code" inputmode="text" autocomplete="off" maxlength="9" placeholder="ABCD-12" aria-label="Код с телевизора">
          <button type="submit">Подключить</button>
        </form>
      </div>` : ''}
    <div class="account-cloud-summary">
      <div><strong>${counts().watchLater}</strong><span>Позже</span></div>
      <div><strong>${counts().favorites}</strong><span>Избранное</span></div>
      <div><strong>${counts().history}</strong><span>История</span></div>
    </div>
    <p class="account-fineprint">Списки и история хранятся локально для быстрого доступа и синхронизируются с аккаунтом при наличии сети.</p>
    <button class="account-signout" type="button" data-signout>${account.isTvDevice ? 'Отключить этот телевизор' : 'Выйти с этого устройства'}</button>`;
}

function friendlyError(error) {
  const text = String(error?.message || error || 'Неизвестная ошибка');
  if (/auth_not_configured|telegram.*not.*configured/i.test(text)) return 'Telegram-вход ещё не настроен в Cloudflare.';
  if (/expired/i.test(text)) return 'Код подключения истёк. Получите новый код на телевизоре.';
  if (/not.?found|invalid.?code/i.test(text)) return 'Код не найден или уже недействителен.';
  if (/network|fetch/i.test(text)) return 'Нет соединения с сервером. Попробуйте ещё раз.';
  return text;
}

function setStatus(message = '', type = '') {
  const node = document.querySelector('#accountModal [data-account-status]');
  if (!node) return;
  node.hidden = !message;
  node.textContent = message;
  node.className = `account-status${type ? ` is-${type}` : ''}`;
}

function setBusy(form, busy) {
  form?.querySelectorAll('button,input').forEach(node => { node.disabled = Boolean(busy); });
}

function renderAccountModal() {
  const wrap = modal();
  const body = wrap.querySelector('#accountModalBody');
  const account = getAccountState();
  if (!isAccountsConfigured()) body.innerHTML = localProfileMarkup();
  else if (account.signedIn) body.innerHTML = accountMarkup();
  else if (account.tvMode) body.innerHTML = tvGuestMarkup();
  else body.innerHTML = telegramGuestMarkup();
  bindAccountEvents(body);
}

function stopTvPolling() {
  clearTimeout(tvPollTimer);
  tvPollTimer = null;
}

function scheduleTvPoll(delay = 1800) {
  stopTvPolling();
  if (modal().hidden || !getAccountState().tvMode || getAccountState().signedIn || !getAccountState().pairing?.code) return;
  tvPollTimer = setTimeout(async () => {
    try {
      const result = await pollTvPairing();
      if (result.status === 'approved') {
        renderAccountModal();
        updateHeaderState();
        return;
      }
      if (result.status === 'expired') {
        renderAccountModal();
        return;
      }
    } catch (error) {
      console.warn('TV pair poll:', error);
    }
    scheduleTvPoll(1800);
  }, delay);
}

async function ensureTvPairing(force = false) {
  if (!getAccountState().tvMode || getAccountState().signedIn || !isTvPairingConfigured()) return;
  try {
    await beginTvPairing({ force });
    if (!modal().hidden) renderAccountModal();
    scheduleTvPoll();
  } catch (error) {
    setStatus(friendlyError(error), 'error');
  }
}

function bindAccountEvents(body) {
  body.querySelector('[data-local-profile-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    if (saveProfile(new FormData(event.currentTarget).get('name'))) {
      updateHeaderState();
      closeAccountModal();
    }
  });

  body.querySelector('[data-telegram-login]')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    setStatus('Открываем Telegram…');
    try {
      await signInWithTelegram();
    } catch (error) {
      event.currentTarget.disabled = false;
      setStatus(friendlyError(error), 'error');
    }
  });

  body.querySelector('[data-tv-new-code]')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    await ensureTvPairing(true);
  });

  body.querySelector('[data-tv-link-form]')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const code = new FormData(form).get('code');
    setBusy(form, true);
    setStatus('Подключаем телевизор…');
    try {
      await approveTvPairCode(code);
      setBusy(form, false);
      form.reset();
      setStatus('Телевизор подтверждён. Через пару секунд он войдёт автоматически.', 'success');
    } catch (error) {
      setBusy(form, false);
      setStatus(friendlyError(error), 'error');
    }
  });

  body.querySelector('[data-name-form]')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(form, true);
    try {
      await updateDisplayName(new FormData(form).get('name'));
      setBusy(form, false);
      renderAccountModal();
      updateHeaderState();
    } catch (error) {
      setBusy(form, false);
      setStatus(friendlyError(error), 'error');
    }
  });

  body.querySelector('[data-sync-now]')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    await syncFromCloud({ quiet: false });
    renderAccountModal();
    updateHeaderState();
  });

  body.querySelector('[data-signout]')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try {
      await signOut();
      renderAccountModal();
      updateHeaderState();
      if (getAccountState().tvMode) setTimeout(() => ensureTvPairing(true), 100);
    } catch (error) {
      event.currentTarget.disabled = false;
      setStatus(friendlyError(error), 'error');
    }
  });
}

function openAccountModal() {
  const wrap = modal();
  renderAccountModal();
  wrap.hidden = false;
  document.body.classList.add('modal-open');
  if (getAccountState().tvMode && !getAccountState().signedIn) {
    ensureTvPairing(false);
  } else if (!getAccountState().tvMode) {
    requestAnimationFrame(() => wrap.querySelector('button,input')?.focus());
  }
}

function closeAccountModal() {
  const wrap = document.querySelector('#accountModal');
  if (wrap) wrap.hidden = true;
  document.body.classList.remove('modal-open');
  stopTvPolling();
}

function showInstallHelp(text) {
  let toast = document.querySelector('#installToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'installToast';
    toast.className = 'install-toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<strong>Установить MVPoisk</strong><p>${text}</p><button type="button" data-install-dismiss>Понятно</button>`;
  toast.hidden = false;
  toast.querySelector('[data-install-dismiss]').onclick = () => { toast.hidden = true; };
}

let deferredInstallPrompt = null;
function setupInstall() {
  const buttons = [...document.querySelectorAll('[data-install-button]')];
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return;

  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isiOS) {
    buttons.forEach(button => {
      button.hidden = false;
      button.addEventListener('click', () => showInstallHelp('В Safari нажми «Поделиться» → «На экран Домой». После этого MVPoisk будет запускаться отдельным приложением.'));
    });
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    buttons.forEach(button => button.hidden = false);

    if (!sessionStorage.getItem('mvpoisk:install-offered')) {
      sessionStorage.setItem('mvpoisk:install-offered', '1');
      const toast = document.createElement('div');
      toast.id = 'installToast';
      toast.className = 'install-toast';
      toast.innerHTML = '<strong>Установить MVPoisk?</strong><p>Откроется как отдельное приложение без адресной строки браузера.</p><div><button type="button" data-install-now>Установить</button><button type="button" data-install-dismiss>Позже</button></div>';
      document.body.appendChild(toast);
      toast.querySelector('[data-install-now]').onclick = async () => {
        toast.remove();
        if (deferredInstallPrompt) {
          deferredInstallPrompt.prompt();
          await deferredInstallPrompt.userChoice.catch(() => null);
          deferredInstallPrompt = null;
          buttons.forEach(button => button.hidden = true);
        }
      };
      toast.querySelector('[data-install-dismiss]').onclick = () => toast.remove();
    }
  });

  buttons.forEach(button => button.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => null);
    deferredInstallPrompt = null;
    buttons.forEach(node => node.hidden = true);
  }));
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register('./sw.js?v=37'); } catch (error) { console.warn('PWA service worker:', error); }
}


document.querySelectorAll('[data-profile-open]').forEach(node => node.addEventListener('click', openAccountModal));
window.addEventListener('mvpoisk:storage-changed', updateHeaderState);
window.addEventListener('storage', updateHeaderState);
window.addEventListener('mvpoisk:account-changed', event => {
  updateHeaderState();
  if (!modal().hidden) {
    renderAccountModal();
    if (event.detail?.tvMode && !event.detail?.signedIn) scheduleTvPoll();
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeAccountModal();
});

updateHeaderState();
setupInstall();
registerServiceWorker();
initAccounts().then(() => updateHeaderState());
