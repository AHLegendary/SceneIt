import { useEffect, useState } from 'react'
import { fetchUserTiers } from './rankingsQueries.js'

// Loads another user's ranked list. Pass null until you know whose it is.
// status: 'idle' (no user yet) | 'loading' | 'ready' | 'error'
export function useUserTiers(userId) {
  const [state, setState] = useState({ status: 'idle', tiers: [] })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!userId) {
      setState({ status: 'idle', tiers: [] })
      return undefined
    }
    let current = true
    setState({ status: 'loading', tiers: [] })
    fetchUserTiers(userId).then(
      (tiers) => current && setState({ status: 'ready', tiers }),
      () => current && setState({ status: 'error', tiers: [] }),
    )
    return () => {
      current = false
    }
  }, [userId, attempt])

  return { ...state, retry: () => setAttempt((n) => n + 1) }
}
