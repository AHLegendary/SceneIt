// Data for the homepage rows that aren't already covered by another module:
// Trending Now (TMDb through our API, with the catalog as a fallback) and
// Recently Ranked by Friends (friends' most recent rankings, readable under RLS
// because accepted friends can see each other's lists).

import { getCatalog, movieFromDb } from './localStore.js'
import { fetchTrending } from './movies.js'
import { supabase } from './supabase.js'

export const ACTIVITY_ERROR = "Couldn't load what your friends are watching."

// Catalog movies ordered by how many people have rated them on IMDb, newest
// first among the big ones. Used when the live trending request fails (no
// API key in local dev, or TMDb is down), and labelled as such by the row.
export function catalogPopular(limit = 12) {
  return [...getCatalog()]
    .sort((a, b) => (b.ratings?.imdb_votes ?? 0) * (b.year >= 2022 ? 2 : 1) - (a.ratings?.imdb_votes ?? 0) * (a.year >= 2022 ? 2 : 1))
    .slice(0, limit)
}

// Returns { movies, live }: live is false when the catalog fallback was used.
export async function loadTrending(limit = 12) {
  try {
    const rows = await fetchTrending()
    const movies = rows.map(movieFromDb).filter(Boolean).slice(0, limit)
    if (movies.length) return { movies, live: true }
  } catch {
    // fall through to the catalog
  }
  return { movies: catalogPopular(limit), live: false }
}

// Turns rankings rows from friends into activity items, newest first, one per
// movie (the most recent friend to rank it). friends: [{ id, username }].
export function rowsToActivity(rows, friends) {
  const byId = new Map(friends.map((f) => [f.id, f]))
  const seen = new Set()
  const items = []
  for (const row of rows ?? []) {
    const friend = byId.get(row.user_id)
    const movie = movieFromDb({ ...row.movies, tmdb_id: row.movie_id })
    if (!friend || !movie || seen.has(movie.id)) continue
    seen.add(movie.id)
    items.push({ movie, friend, at: row.updated_at })
  }
  return items
}

// The most recent movies the user's friends ranked. Throws with a user-facing
// message if the request fails. Empty array when there are no friends.
export async function loadFriendsActivity(friends, limit = 12) {
  if (!friends.length) return []
  const { data, error } = await supabase
    .from('rankings')
    .select('user_id, movie_id, updated_at, movies(tmdb_id, title, year, poster_path, genres, overview)')
    .in('user_id', friends.map((f) => f.id))
    .order('updated_at', { ascending: false })
    .limit(limit * 3)
  if (error) throw new Error(ACTIVITY_ERROR)
  return rowsToActivity(data, friends).slice(0, limit)
}
