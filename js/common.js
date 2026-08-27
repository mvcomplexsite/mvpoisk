import { getProfile, saveProfile, clearProfile, counts } from './storage.js?v=18';

function updateHeaderState() {
  const total = counts().watchLater + counts().favorites;
  document.querySelectorAll('[data-list-count]').forEach(node => {
    node.textContent = String(total);
    node.hidden = total === 0;
  });
  const profile = getProfile();
  document.querySelectorAll('[data-profile-open]').forEach(node => {
    node.textContent = profile?.name || 'Профиль';
    node.title = profile ? `Локальный профиль: ${profile.name}` : 'Создать локальный профиль';
  });
}

function ensureProfileModal() {
  if (document.querySelector('#profileModal')) return document.querySelector('#profileModal');
  const profile = getProfile();
  const wrap = document.createElement('div');
  wrap.id = 'profileModal';
  wrap.className = 'modal-shell';
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="modal-backdrop" data-modal-close></div>
    <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="profileTitle">
      <button class="modal-close" type="button" aria-label="Закрыть" data-modal-close>×</button>
      <span class="eyebrow">Локальный аккаунт</span>
      <h2 id="profileTitle">${profile ? 'Профиль' : 'Создать профиль'}</h2>
      <p class="modal-copy">Имя, «Посмотрю позже» и избранное сохраняются только в этом браузере. Настоящую синхронизацию между устройствами можно подключить позже.</p>
      <form id="profileForm" class="profile-form">
        <label><span>Имя</span><input id="profileName" maxlength="32" autocomplete="nickname" placeholder="Например, Алекс" value="${escapeAttr(profile?.name || '')}"></label>
        <button class="primary-action" type="submit">${profile ? 'Сохранить' : 'Создать профиль'}</button>
      </form>
      ${profile ? '<button class="danger-link" id="profileClear" type="button">Удалить локальный профиль</button>' : ''}
    </section>`;
  document.body.appendChild(wrap);

  wrap.querySelectorAll('[data-modal-close]').forEach(node => node.addEventListener('click', () => closeProfileModal()));
  wrap.querySelector('#profileForm').addEventListener('submit', event => {
    event.preventDefault();
    if (saveProfile(wrap.querySelector('#profileName').value)) {
      updateHeaderState();
      closeProfileModal();
    }
  });
  wrap.querySelector('#profileClear')?.addEventListener('click', () => {
    clearProfile();
    wrap.remove();
    updateHeaderState();
  });
  return wrap;
}

function escapeAttr(value) {
  return String(value || '').replace(/[&<>'"]/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;'
  }[ch]));
}

function openProfileModal() {
  const modal = ensureProfileModal();
  modal.hidden = false;
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => modal.querySelector('#profileName')?.focus());
}

function closeProfileModal() {
  const modal = document.querySelector('#profileModal');
  if (modal) modal.hidden = true;
  document.body.classList.remove('modal-open');
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
  try { await navigator.serviceWorker.register('./sw.js?v=18'); } catch (error) { console.warn('PWA service worker:', error); }
}

document.querySelectorAll('[data-profile-open]').forEach(node => node.addEventListener('click', openProfileModal));
window.addEventListener('mvpoisk:storage-changed', updateHeaderState);
window.addEventListener('storage', updateHeaderState);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeProfileModal(); });
updateHeaderState();
setupInstall();
registerServiceWorker();
