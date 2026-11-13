import { useSyncExternalStore } from 'react'
import { getNotificationsState, subscribe } from './notifications.js'

// Notifications store state ({ status, list, error }). Re-renders when it changes.
export function useNotifications() {
  return useSyncExternalStore(subscribe, getNotificationsState)
}
