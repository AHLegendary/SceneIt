// Movie lookup for the UI. Two kinds of movies:
//   * the 60-movie catalog in src/data/movies.json, with full details, ids
//     like "dune-part-two-2024", used for suggestions and For You
//   * any other movie, found through live search or loaded from the
//     database, with id "tmdb-<TMDb id>" and only the basics (title, year,
//     poster, genres, overview)
// movieFromDb turns a database or API movie into one of these, preferring
// the catalog version, so the same movie always gets the same id and object.

import MOVIES from '../data/movies.json'

const POSTER_BASE = 'https://image.tmdb.org/t/p/'
const BY_ID = new Map(MOVIES.map((m) => [m.id, m]))
const BY_TMDB = new Map(MOVIES.filter((m) => m.tmdb_id).map((m) => [m.tmdb_id, m]))
const EXTRA = new Map() // id -> movie, for movies outside the catalog

// ------------------------------------------------------------------ catalog

// Every movie in the local catalog.
export function getCatalog() {
  return MOVIES
}

export function getMovie(id) {
  return BY_ID.get(id) || EXTRA.get(id) || null
}

export function getMovieByTmdbId(tmdbId) {
  return BY_TMDB.get(tmdbId) || EXTRA.get(`tmdb-${tmdbId}`) || null
}

export function isCatalogMovie(movie) {
  return Boolean(movie && BY_ID.get(movie.id) === movie)
}

// Movie object for a row shaped like the `movies` table (also what the API
// returns): { tmdb_id, title, year, poster_path, genres, overview }.
// Returns the catalog movie when there is one, otherwise a remembered
// "tmdb-<id>" movie so getMovie(id) finds it later. Returns null for rows
// without a usable tmdb_id or title.
export function movieFromDb(row) {
  const tmdbId = Number(row?.tmdb_id)
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return null
  const known = getMovieByTmdbId(tmdbId)
  if (known) {
    // The leaderboard only returns basics; fill gaps when a fuller row arrives.
    if (!BY_ID.has(known.id)) {
      if (!known.genres.length && Array.isArray(row.genres)) known.genres = row.genres
      if (!known.overview && row.overview?.trim()) known.overview = row.overview.trim()
      if (!known.backdrop_path && row.backdrop_path) known.backdrop_path = row.backdrop_path
    }
    return known
  }
  if (!row.title) return null
  const movie = {
    id: `tmdb-${tmdbId}`,
    tmdb_id: tmdbId,
    title: row.title,
    year: Number.isFinite(row.year) ? row.year : null,
    genres: Array.isArray(row.genres) ? row.genres : [],
    poster_path: row.poster_path || null,
    backdrop_path: row.backdrop_path || null,
    overview: row.overview?.trim() || null,
  }
  EXTRA.set(movie.id, movie)
  return movie
}

// Full TMDb image URL for a path like "/abc.jpg", or null.
export function imageUrl(path, size = 'w342') {
  return path ? `${POSTER_BASE}${size}${path}` : null
}

// Full TMDb image URL, or null when the movie has no poster yet.
export function posterUrl(movie, size = 'w342') {
  return imageUrl(movie?.poster_path, size)
}

// Lowercase and strip accents so "amelie" finds "Amélie".
function normalize(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

// Title search over the local catalog. Titles that start with the query come
// first, then ones where a word starts with it, then any other match.
export function searchMovies(query, limit = 20) {
  const q = normalize(query || '')
  if (!q) return []
  const scored = []
  for (const movie of MOVIES) {
    const title = normalize(movie.title)
    const at = title.indexOf(q)
    if (at === -1) continue
    const tier = at === 0 ? 0 : /\W/.test(title[at - 1]) ? 1 : 2
    scored.push({ movie, tier })
  }
  return scored
    .sort((a, b) => a.tier - b.tier || b.movie.year - a.movie.year)
    .slice(0, limit)
    .map((s) => s.movie)
}

// A few well-known movies to show in search before the user types anything.
const SUGGESTION_IDS = [
  'dune-part-two-2024',
  'past-lives-2023',
  'spider-man-across-the-spider-verse-2023',
  'oppenheimer-2023',
  'the-holdovers-2023',
  'everything-everywhere-all-at-once-2022',
  'parasite-2019',
  'whiplash-2014',
]

// Catalog movies most people have rated on IMDb, used to top up the picks.
const BY_VOTES = [...MOVIES].sort((a, b) => (b.ratings?.imdb_votes ?? 0) - (a.ratings?.imdb_votes ?? 0))

// Popular picks for the Rank a movie dialog, leaving out movies already
// ranked (ids in `exclude`) and filling their spots from the rest of the
// catalog. Without this, ranking the picks left a list of greyed-out "Ranked"
// buttons and nothing new to rank (issue #42).
export function getSuggestions({ exclude = new Set(), limit = 8 } = {}) {
  const picks = []
  const seen = new Set()
  for (const movie of [...SUGGESTION_IDS.map(getMovie), ...BY_VOTES]) {
    if (picks.length >= limit) break
    if (!movie || seen.has(movie.id) || exclude.has(movie.id)) continue
    seen.add(movie.id)
    picks.push(movie)
  }
  return picks
}
