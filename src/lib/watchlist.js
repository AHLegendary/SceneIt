// The watchlist: movies a user wants to watch later. Stored in the `watchlist`
// table (RLS: visible to whoever can see the owner's profile, writable only by
// the owner). This file has the queries and the signed-in user's own copy,
// kept in memory like the ranked list in supabaseStore.js.

import { getMovieByTmdbId, movieFromDb } from './localStore.js'
import { ensureSaved, getState as getAccount, requireFreshSession, subscribe as subscribeAccount } from './supabaseStore.js'
import { supabase } from './supabase.js'

export const LOAD_ERROR = "Couldn't load the watchlist. Check your connection and try again."
export const SAVE_ERROR = "Couldn't save to your watchlist. Check your connection and try again."
export const REMOVE_ERROR = "Couldn't remove that movie. Check your connection and try again."

// Turns watchlist rows ({ movie_id, movies: {...} }) into movie objects, in
// row order. Rows we can't build a movie for are skipped.
export function rowsToMovies(rows) {
  return (rows ?? [])
    .map((row) => getMovieByTmdbId(row.movie_id) || movieFromDb({ ...row.movies, tmdb_id: row.movie_id }))
    .filter(Boolean)
}

// A user's watchlist, most recently added first. Same visibility rules as
// their ranked list: a private non-friend gets an empty list, not an error.
export async function fetchWatchlist(userId) {
  const { data, error } = await supabase
    .from('watchlist')
    .select('movie_id, movies(tmdb_id, title, year, poster_path, genres, overview)')
    .eq('user_id', userId)
    .order('added_at', { ascending: false })
  if (error) throw error
  return rowsToMovies(data)
}

// ------------------------------------------------------------------ my watchlist

// status: 'idle' (signed out) | 'loading' | 'ready' | 'error'
let state = { userId: null, status: 'idle', movies: [] }
const listeners = new Set()

function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getWatchlist() {
  return state
}

export async function loadWatchlist() {
  const userId = state.userId
  if (!userId) return
  try {
    const movies = await fetchWatchlist(userId)
    if (state.userId === userId) setState({ status: 'ready', movies })
  } catch {
    if (state.userId === userId) setState({ status: 'error' })
  }
}

// Follows login state: load on login, clear on logout.
function syncUser() {
  const userId = getAccount().user?.id ?? null
  if (userId === state.userId) return
  setState({ userId, status: userId ? 'loading' : 'idle', movies: [] })
  loadWatchlist()
}
subscribeAccount(syncUser)
syncUser()

// Adds a movie (a movie object with a tmdb_id). Adding one that's already
// there is fine. Throws an Error with a user-facing message on failure.
export async function addToWatchlist(movie) {
  if (!state.userId) throw new Error('Log in to save movies.')
  await requireFreshSession()
  try {
    await ensureSaved(movie)
  } catch (cause) {
    console.error('Saving the movie before adding it to the watchlist failed:', cause)
    throw new Error(SAVE_ERROR)
  }
  const { error } = await supabase.from('watchlist').insert({ user_id: state.userId, movie_id: movie.tmdb_id })
  // 23505: already on the list (double click, or another tab).
  if (error && error.code !== '23505') throw new Error(SAVE_ERROR)
  await loadWatchlist()
}

export async function removeFromWatchlist(movie) {
  if (!state.userId) throw new Error('Log in to change your watchlist.')
  const { error } = await supabase.from('watchlist').delete().eq('user_id', state.userId).eq('movie_id', movie.tmdb_id)
  if (error) throw new Error(REMOVE_ERROR)
  await loadWatchlist()
}
