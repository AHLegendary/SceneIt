import { useSyncExternalStore } from 'react'
import { getModerationState, subscribe } from './moderationQueue.js'

// Moderation queue state ({ status, filter, list, error, rowErrors, busy }).
// Re-renders when it changes.
export function useModerationQueue() {
  return useSyncExternalStore(subscribe, getModerationState)
}
