import { useEffect, useState, useSyncExternalStore } from 'react'
import { fetchWatchlist, getWatchlist, loadWatchlist, subscribe } from './watchlist.js'

// The signed-in user's watchlist: { status, movies }. Re-renders on change.
export function useMyWatchlist() {
  return useSyncExternalStore(subscribe, getWatchlist)
}

// Another user's watchlist. Pass null until you know whose it is.
// Returns { status: 'idle' | 'loading' | 'ready' | 'error', movies, retry }.
export function useUserWatchlist(userId) {
  const [attempt, setAttempt] = useState(0)
  // Anything that isn't the answer to the current request counts as loading.
  const [result, setResult] = useState({ key: null, status: 'idle', movies: [] })
  const key = `${userId}:${attempt}`

  useEffect(() => {
    if (!userId) return undefined
    let current = true
    fetchWatchlist(userId).then(
      (movies) => current && setResult({ key, status: 'ready', movies }),
      () => current && setResult({ key, status: 'error', movies: [] }),
    )
    return () => {
      current = false
    }
  }, [userId, key])

  let state = result
  if (!userId) state = { status: 'idle', movies: [] }
  else if (result.key !== key) state = { status: 'loading', movies: [] }
  return { status: state.status, movies: state.movies, retry: () => setAttempt((n) => n + 1) }
}

// Own list's retry, for the error state.
export const retryMyWatchlist = loadWatchlist
