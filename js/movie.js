import { getMovie, getReviews, getSimilarMovies } from './api.js?v=16';
import { getWatchUrl } from './config.js?v=16';
import { imageUrl, imageAttrs, bindImageFallbacks } from './images.js?v=16';
import { hasInList, toggleInList } from './storage.js?v=16';

const root = document.querySelector('#movieRoot');
const params = new URLSearchParams(location.search);
const kpId = params.get('id');
let currentMovie = null;

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
            <a class="watch-button" href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer"><span class="watch-play">▶</span><span>Смотреть</span></a>
            <button class="secondary-button list-action" type="button" data-list-action="watchLater" aria-pressed="false"></button>
            <button class="secondary-button list-action favorite-action" type="button" data-list-action="favorites" aria-pressed="false"></button>
            <a class="secondary-button" href="https://www.kinopoisk.ru/film/${movie.id}/" target="_blank" rel="noopener noreferrer">Кинопоиск ↗</a>
          </div>
          <div class="watch-hint"><span></span>Просмотр откроется на партнёрском сайте GGpoisk</div>
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
  updateListButtons();
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
