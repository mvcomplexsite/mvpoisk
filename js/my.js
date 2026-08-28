import { getList, removeFromList, getProfile, counts } from './storage.js?v=20';
import { imageAttrs, bindImageFallbacks } from './images.js?v=20';

const grid = document.querySelector('#savedGrid');
const empty = document.querySelector('#libraryEmpty');
let active = 'watchLater';

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
function updateProfile() {
  const profile = getProfile();
  const label = document.querySelector('#profileLabel');
  const avatar = document.querySelector('#profileAvatar');
  label.textContent = profile?.name || 'Создать профиль';
  avatar.textContent = profile?.name ? profile.name.slice(0, 2).toUpperCase() : 'MV';
}
function render() {
  const c = counts();
  document.querySelector('#laterCount').textContent = c.watchLater;
  document.querySelector('#favoriteCount').textContent = c.favorites;
  const items = getList(active);
  grid.innerHTML = items.map(card).join('');
  bindImageFallbacks(grid);
  grid.hidden = items.length === 0;
  empty.hidden = items.length !== 0;
  grid.querySelectorAll('[data-remove-id]').forEach(button => button.addEventListener('click', () => {
    removeFromList(active, button.dataset.removeId);
    render();
  }));
  updateProfile();
}
document.querySelectorAll('[data-library-tab]').forEach(button => button.addEventListener('click', () => {
  active = button.dataset.libraryTab;
  document.querySelectorAll('[data-library-tab]').forEach(node => { const on = node === button; node.classList.toggle('active', on); node.setAttribute('aria-selected', String(on)); });
  render();
}));
window.addEventListener('mvpoisk:storage-changed', render);
window.addEventListener('storage', render);
render();
