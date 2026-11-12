import { useSyncExternalStore } from 'react'
import { getBlendsState, subscribe } from './blends.js'

// Blends store state ({ status, blends, invites, error, notice }). Re-renders
// when it changes.
export function useBlends() {
  return useSyncExternalStore(subscribe, getBlendsState)
}
