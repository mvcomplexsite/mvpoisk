import { getList, removeFromList, getProfile, counts, getHistory, removeFromHistory, setWatched } from './storage.js?v=30';
import { imageAttrs, bindImageFallbacks } from './images.js?v=30';

const grid = document.querySelector('#savedGrid');
const empty = document.querySelector('#libraryEmpty');
const emptyIcon = empty?.querySelector('.empty-icon');
const emptyTitle = empty?.querySelector('h2');
const emptyCopy = empty?.querySelector('p');
const subtitle = document.querySelector('#librarySubtitle');
const requestedTab = new URLSearchParams(location.search).get('tab');
let active = ['watchLater', 'favorites', 'history'].includes(requestedTab) ? requestedTab : 'watchLater';

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[ch]));
}
function scoreClass(score) { return score >= 7.5 ? 'rating-high' : score >= 6 ? 'rating-mid' : score ? 'rating-low' : 'rating-muted'; }

function card(movie) {
  const posters = [movie.poster?.url, movie.poster?.previewUrl].filter(Boolean);
  const genres = Array.isArray(movie.genres) ? movie.genres.join(' • ') : '';
  return `<article class="saved-card">
    <a class="movie-card" href="movie.html?id=${encodeURIComponent(movie.id)}">
      <div class="poster-wrap"><div class="poster-fallback">MV</div>${posters.length ? `<img ${imageAttrs(posters, { width: 520 })} alt="Постер: ${esc(movie.name)}" loading="lazy" decoding="async">` : ''}<span class="rating-pill ${scoreClass(Number(movie.rating || 0))}">${movie.rating ? Number(movie.rating).toFixed(1) : '—'}</span><span class="type-pill">${movie.isSeries ? 'Сериал' : 'Фильм'}</span></div>
      <div class="card-copy"><h3>${esc(movie.name || 'Без названия')}</h3><p>${esc([movie.year, genres].filter(Boolean).join(' • '))}</p></div>
    </a>
    <button class="saved-remove" type="button" data-remove-id="${movie.id}">Удалить</button>
  </article>`;
}

function historyMeta(item) {
  const season = Number(item?.progress?.season);
  const episode = Number(item?.progress?.episode);
  const percent = Number(item?.progress?.percent);
  if (item.completed) return 'Просмотрено';
  if (item.isSeries && season > 0 && episode > 0) return `${season} сезон • ${episode} серия`;
  if (Number.isFinite(percent) && percent > 0 && percent < 1) return `Продолжить • ${Math.round(percent * 100)}%`;
  return item.isSeries ? 'Начат сериал' : 'Начат фильм';
}

function historyDate(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return `Сегодня, ${new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date)}`;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' }).format(date);
}

function historyCard(item) {
  const title = item.name || item.alternativeName || 'Без названия';
  const posters = [item.poster?.url, item.poster?.previewUrl].filter(Boolean);
  const percent = Number(item?.progress?.percent);
  const hasProgress = Number.isFinite(percent) && percent > 0 && percent < 1 && !item.completed;
  return `<article class="history-card${item.completed ? ' is-complete' : ''}">
    <a class="history-poster" href="movie.html?id=${encodeURIComponent(item.id)}">
      <span class="poster-fallback">MV</span>
      ${posters.length ? `<img ${imageAttrs(posters, { width: 360 })} alt="Постер: ${esc(title)}" loading="lazy" decoding="async">` : ''}
      <span class="history-play">▶</span>
      ${hasProgress ? `<span class="history-progress"><i style="width:${Math.round(percent * 100)}%"></i></span>` : ''}
    </a>
    <div class="history-copy">
      <div class="history-topline"><span>${item.isSeries ? 'Сериал' : 'Фильм'}</span><time>${esc(historyDate(item.lastWatchedAt))}</time></div>
      <a href="movie.html?id=${encodeURIComponent(item.id)}"><h3>${esc(title)}</h3></a>
      <p>${esc([item.year, historyMeta(item)].filter(Boolean).join(' • '))}</p>
      <div class="history-actions">
        <a class="history-primary" href="movie.html?id=${encodeURIComponent(item.id)}">${item.completed ? 'Смотреть снова' : 'Продолжить'}</a>
        <button type="button" class="history-watched${item.completed ? ' active' : ''}" data-history-watched="${item.id}">${item.completed ? '✓ Просмотрено' : 'Отметить просмотренным'}</button>
        <button type="button" class="history-remove" data-history-remove="${item.id}">Удалить</button>
      </div>
    </div>
  </article>`;
}

function updateProfile() {
  const profile = getProfile();
  const label = document.querySelector('#profileLabel');
  const avatar = document.querySelector('#profileAvatar');
  label.textContent = profile?.name || 'Создать профиль';
  avatar.textContent = profile?.name ? profile.name.slice(0, 2).toUpperCase() : 'MV';
}

function emptyState() {
  if (!empty) return;
  if (active === 'history') {
    if (emptyIcon) emptyIcon.textContent = '▶';
    if (emptyTitle) emptyTitle.textContent = 'История пока пустая';
    if (emptyCopy) emptyCopy.textContent = 'Запусти любой фильм или сериал — он появится здесь и в блоке «Смотреть дальше».';
    return;
  }
  if (emptyIcon) emptyIcon.textContent = '☆';
  if (emptyTitle) emptyTitle.textContent = 'Здесь пока пусто';
  if (emptyCopy) emptyCopy.textContent = 'Открой фильм и добавь его в список — он появится здесь.';
}

function syncTabs() {
  document.querySelectorAll('[data-library-tab]').forEach(node => {
    const on = node.dataset.libraryTab === active;
    node.classList.toggle('active', on);
    node.setAttribute('aria-selected', String(on));
  });
}

function render() {
  const c = counts();
  document.querySelector('#laterCount').textContent = c.watchLater;
  document.querySelector('#favoriteCount').textContent = c.favorites;
  document.querySelector('#historyCount').textContent = c.history;
  syncTabs();
  emptyState();

  if (active === 'history') {
    const items = getHistory();
    grid.classList.add('history-mode');
    grid.innerHTML = items.map(historyCard).join('');
    bindImageFallbacks(grid);
    grid.hidden = items.length === 0;
    empty.hidden = items.length !== 0;
    subtitle.textContent = 'Недавно запущенное, просмотренное и то, к чему можно вернуться.';
    return;
  }

  grid.classList.remove('history-mode');
  const items = getList(active);
  grid.innerHTML = items.map(card).join('');
  bindImageFallbacks(grid);
  grid.hidden = items.length === 0;
  empty.hidden = items.length !== 0;
  subtitle.textContent = active === 'favorites' ? 'Любимые фильмы и сериалы в одном месте.' : 'Сохраняй фильмы и сериалы, чтобы не потерять.';
}

function setActiveTab(next) {
  active = next;
  const url = new URL(location.href);
  if (active === 'watchLater') url.searchParams.delete('tab');
  else url.searchParams.set('tab', active);
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  render();
}

document.querySelectorAll('[data-library-tab]').forEach(button => button.addEventListener('click', () => setActiveTab(button.dataset.libraryTab)));

grid.addEventListener('click', event => {
  const removeSaved = event.target.closest('[data-remove-id]');
  if (removeSaved) {
    removeFromList(active, removeSaved.dataset.removeId);
    render();
    return;
  }
  const removeHistoryButton = event.target.closest('[data-history-remove]');
  if (removeHistoryButton) {
    removeFromHistory(removeHistoryButton.dataset.historyRemove);
    render();
    return;
  }
  const watchedButton = event.target.closest('[data-history-watched]');
  if (watchedButton) {
    const item = getHistory().find(entry => Number(entry.id) === Number(watchedButton.dataset.historyWatched));
    if (item) setWatched(item, !item.completed);
    render();
  }
});

window.addEventListener('mvpoisk:storage-changed', render);
window.addEventListener('storage', render);
updateProfile();
render();
