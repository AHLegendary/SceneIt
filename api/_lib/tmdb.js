// Server-only TMDb helpers. Never import this file from src/ (it reads a secret).
const TMDB_BASE = 'https://api.themoviedb.org/3';

export async function tmdbFetch(path, params = {}) {
  const token = process.env.TMDB_READ_TOKEN;
  if (!token) {
    throw new Error('TMDB_READ_TOKEN is not set');
  }

  const url = new URL(TMDB_BASE + path);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const error = new Error(`TMDb request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

// TMDb's movie genre ids (GET /genre/movie/list). Search results only carry
// genre_ids, so we name them here instead of making another request.
const GENRE_NAMES = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance',
  878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
};

// Converts a raw TMDb movie (from search or details) into the shape of our
// `movies` table, so it can be shown and saved as is.
export function toMovie(raw) {
  const year = parseInt(String(raw.release_date ?? '').slice(0, 4), 10);
  const genres = Array.isArray(raw.genres)
    ? raw.genres.map((genre) => genre.name)
    : (raw.genre_ids ?? []).map((id) => GENRE_NAMES[id]).filter(Boolean);
  return {
    tmdb_id: raw.id,
    title: raw.title,
    year: Number.isFinite(year) ? year : null,
    poster_path: raw.poster_path || null,
    genres,
    overview: raw.overview || '',
  };
}

// TMDb's recommendations for one movie, in TMDb's order, in our movie shape
// plus tmdb_rating and tmdb_votes. Adult titles are dropped.
export async function fetchTmdbRecommendations(tmdbId) {
  const data = await tmdbFetch(`/movie/${tmdbId}/recommendations`, { page: '1' });
  return (data.results ?? [])
    .filter((m) => m && m.id && m.title && !m.adult)
    .map((m) => ({ ...toMovie(m), tmdb_rating: m.vote_average ?? null, tmdb_votes: m.vote_count ?? null }));
}
