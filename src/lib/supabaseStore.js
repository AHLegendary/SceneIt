// The signed-in user's account and ranked list, stored in Supabase.
//
// UI code calls these instead of talking to Supabase directly (see the data
// layer in the design doc). Supabase is async but React wants to read the list
// synchronously, so this module keeps an in-memory copy of the list:
//   * reads (getState, getMyTiers, ...) return the copy instantly
//   * writes (placeMovie, removeMovie) call the database, then reload the copy
//   * subscribe() tells React when the copy changes
//
// Movie ids: the UI uses ids like "dune-part-two-2024" (catalog) or
// "tmdb-12345" (anything else, see localStore.js); the database uses TMDb
// ids. We convert at this boundary so no component has to care.

import { isCategory, tiersInCategory } from '../features/ranking/scores.js'
import { getMovie, getMovieByTmdbId, isCatalogMovie, movieFromDb } from './localStore.js'
import { saveMovie, UnauthorizedError } from './movies.js'
import { supabase } from './supabase.js'

export const LOAD_ERROR = "Couldn't load your list. Check your connection and try again."
export const SAVE_ERROR = "Couldn't save your ranking. Check your connection and try again."
export const REMOVE_ERROR = "Couldn't remove that movie. Check your connection and try again."
export const SIGN_OUT_ERROR = "Couldn't log you out. Try again."
export const SESSION_ERROR = 'Your login session has expired. Log in again and your ranking will be saved.'

// TMDb ids known to be in the `movies` table: the seeded catalog, plus
// anything we've loaded from or saved to the database this session.
const savedMovies = new Set()

// status:
//   'loading'    checking for a saved session, or loading the list after login
//   'signed-out' nobody is logged in
//   'ready'      logged in and the list is loaded
//   'error'      logged in but the list failed to load (error has the message)
const SIGNED_OUT = { status: 'signed-out', user: null, username: null, tiers: [], error: null }
let state = { ...SIGNED_OUT, status: 'loading' }

const listeners = new Set()

// Replaces state with a new object so React sees the change.
function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}

// ------------------------------------------------------------------ reads

// For React's useSyncExternalStore: call listener whenever state changes.
export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// The whole account state. Same object until something changes.
export function getState() {
  return state
}

// Ranked list as tiers of movie objects, best first. Tied movies share a tier.
export function getMyTiers() {
  return state.tiers
}

// Ranked list as one flat list of movies, best first.
export function getMyList() {
  return state.tiers.flat()
}

export function isInList(id) {
  return state.tiers.some((tier) => tier.some((movie) => movie.id === id))
}

// Turns rankings rows ({ movie_id, position, category, movies: {...} }) into
// tiers of movies. Rows sharing a position are a tie. Each movie in the result
// is a copy carrying its `category` ('loved' | 'okay' | 'meh'). The joined `movies` row covers
// movies outside the catalog; rows we can't build a movie for are skipped,
// and empty tiers dropped, so the result is always dense.
export function rowsToTiers(rows) {
  const byPosition = new Map()
  for (const row of rows ?? []) {
    const found = getMovieByTmdbId(row.movie_id) || movieFromDb({ ...row.movies, tmdb_id: row.movie_id })
    if (!found) continue
    const movie = { ...found, category: row.category ?? null }
    savedMovies.add(movie.tmdb_id)
    if (!byPosition.has(row.position)) byPosition.set(row.position, [])
    byPosition.get(row.position).push(movie)
  }
  return [...byPosition.entries()].sort(([a], [b]) => a - b).map(([, tier]) => tier)
}

// ------------------------------------------------------------------ loading

// Reloads the signed-in user's list from the database. Never throws: a
// failure puts the store in 'error' so the page can offer a retry.
export async function loadMyList() {
  const user = state.user
  if (!user) return
  const { data, error } = await supabase
    .from('rankings')
    .select('movie_id, position, category, movies(tmdb_id, title, year, poster_path, genres, overview)')
    .eq('user_id', user.id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (state.user?.id !== user.id) return // logged out or switched users mid-request
  if (error) setState({ status: 'error', error: LOAD_ERROR })
  else setState({ status: 'ready', tiers: rowsToTiers(data), error: null })
}

// Username from the profiles table (falls back to the signup metadata).
async function loadUsername(user) {
  const { data } = await supabase.from('profiles').select('username').eq('id', user.id).maybeSingle()
  if (data?.username && state.user?.id === user.id) setState({ username: data.username })
}

function handleSession(session) {
  const user = session?.user ?? null
  if (!user) {
    setState(SIGNED_OUT)
    return
  }
  // Token refreshes fire too; nothing to reload for the same user.
  if (state.user?.id === user.id && state.status !== 'error') return
  setState({ status: 'loading', user, username: user.user_metadata?.username ?? null, tiers: [], error: null })
  loadMyList()
  loadUsername(user)
}

let started = false

// Starts following Supabase's login state. Call once at app startup.
// Supabase immediately reports the saved session (or none), then every
// login, logout and token refresh after that.
export function startAuth() {
  if (started) return
  started = true
  supabase.auth.onAuthStateChange((_event, session) => {
    // Supabase says not to call other supabase functions inside this
    // callback (it can deadlock), so do the work right after it returns.
    setTimeout(() => handleSession(session), 0)
  })
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error(SIGN_OUT_ERROR)
}

// ------------------------------------------------------------------ writes

function requireSignedIn() {
  if (!state.user) throw new Error('Log in to rank movies.')
}

function requireMovie(id) {
  const movie = getMovie(id)
  if (!movie) throw new Error(`Unknown movie: ${id}`)
  return movie
}

// Movies found through live search aren't in the database yet. Ask the API
// to add it (rankings.movie_id has to point at a row in `movies`).
async function ensureSaved(movie) {
  if (isCatalogMovie(movie) || savedMovies.has(movie.tmdb_id)) return
  const { data } = await supabase.auth.getSession()
  let token = data?.session?.access_token
  if (!token) throw new Error(SESSION_ERROR)
  try {
    await saveMovie(movie.tmdb_id, token)
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error
    // The server didn't accept the token even though the browser thought it
    // was current: force a refresh and try once more.
    const refreshed = await supabase.auth.refreshSession()
    token = refreshed.data?.session?.access_token
    if (!token) {
      await supabase.auth.signOut().catch(() => {})
      throw new Error(SESSION_ERROR)
    }
    await saveMovie(movie.tmdb_id, token)
  }
  savedMovies.add(movie.tmdb_id)
}

// Puts a movie where head-to-head placement landed it, moving it if it was
// already ranked (that's how reranking saves). The placement is inside the
// movie's category, the same list CompareView compared it against:
//   category: 'loved' | 'okay' | 'meh'
//   tied = false: as its own tier at `index` (0 = best in that category)
//   tied = true:  into the category's existing tier at `index`
// The database keeps the whole list ordered loved -> okay -> not a fan.
// Throws an Error with a user-facing message if the save fails; the list
// is left as it was.
// Makes sure the access token is still valid before a write. Supabase refreshes
// it in the background, but a tab that has been open for hours can miss that;
// getSession() refreshes an expired token, and returns null if it can't.
async function requireFreshSession() {
  const { data } = await supabase.auth.getSession()
  const session = data?.session
  if (!session) throw new Error(SESSION_ERROR)
  // Expired (or about to): refresh now. If the refresh token is dead too
  // (used up by another tab, for instance), the user has to log in again.
  // (sessions without an expiry, like test doubles, are taken as fresh)
  if (session.expires_at && session.expires_at * 1000 < Date.now() + 30_000) {
    const { data: fresh, error } = await supabase.auth.refreshSession()
    if (error || !fresh?.session) {
      await supabase.auth.signOut().catch(() => {})
      throw new Error(SESSION_ERROR)
    }
  }
}

function describe(error) {
  const text = error?.message || error?.details || String(error ?? '')
  return text && text !== SAVE_ERROR ? ` (${text})` : ''
}

export async function placeMovie(id, { category, index, tied = false }) {
  const movie = requireMovie(id)
  requireSignedIn()
  if (!isCategory(category)) throw new Error(`Unknown category: ${category}`)
  const categoryTiers = tiersInCategory(state.tiers, category).length
  const position = Math.max(0, Math.min(Number.isFinite(index) ? index : Infinity, categoryTiers))
  await requireFreshSession()
  try {
    await ensureSaved(movie)
  } catch (cause) {
    console.error('Saving the movie before ranking failed:', cause)
    // The API answers "Log in to rank movies." when it can't verify the token.
    if (/log in/i.test(cause?.message ?? '')) {
      await supabase.auth.signOut().catch(() => {})
      throw new Error(SESSION_ERROR)
    }
    throw new Error(`${SAVE_ERROR}${describe(cause)}`)
  }
  const { error } = await supabase.rpc('save_ranking', {
    p_movie_id: movie.tmdb_id,
    p_category: category,
    p_position: position,
    p_tied: Boolean(tied),
  })
  if (error) {
    console.error('save_ranking failed:', error)
    if (/not signed in|jwt|expired/i.test(error.message ?? '')) {
      // Log out locally too, like the other expiry paths, so "Log in" goes to
      // the login page instead of bouncing a still-"logged in" user home.
      await supabase.auth.signOut().catch(() => {})
      throw new Error(SESSION_ERROR)
    }
    throw new Error(`${SAVE_ERROR}${describe(error)}`)
  }
  await loadMyList()
}

export async function removeMovie(id) {
  const movie = requireMovie(id)
  requireSignedIn()
  const { error } = await supabase.rpc('remove_ranking', { p_movie_id: movie.tmdb_id })
  if (error) throw new Error(REMOVE_ERROR)
  await loadMyList()
}