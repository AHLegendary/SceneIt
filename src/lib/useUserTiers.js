import { useEffect, useState } from 'react'
import { fetchUserTiers } from './rankingsQueries.js'

// Loads another user's ranked list. Pass null until you know whose it is.
// status: 'idle' (no user yet) | 'loading' | 'ready' | 'error'
export function useUserTiers(userId) {
  const [attempt, setAttempt] = useState(0)
  // The last answer, and which request it belongs to. Anything that isn't the
  // answer to the current request counts as loading, so the effect never has
  // to set a "loading" state itself.
  const [result, setResult] = useState({ key: null, status: 'idle', tiers: [] })
  const key = `${userId}:${attempt}`

  useEffect(() => {
    if (!userId) return undefined
    let current = true
    fetchUserTiers(userId).then(
      (tiers) => current && setResult({ key, status: 'ready', tiers }),
      () => current && setResult({ key, status: 'error', tiers: [] }),
    )
    return () => {
      current = false
    }
  }, [userId, attempt, key])

  let state = result
  if (!userId) state = { status: 'idle', tiers: [] }
  else if (result.key !== key) state = { status: 'loading', tiers: [] }

  return { status: state.status, tiers: state.tiers, retry: () => setAttempt((n) => n + 1) }
}
