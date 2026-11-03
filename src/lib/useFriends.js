import { useMemo, useSyncExternalStore } from 'react'
import { getFriendsState, groupFriendships, subscribe } from './friends.js'

// Friends store state ({ status, list, error }). Re-renders when it changes.
export function useFriends() {
  return useSyncExternalStore(subscribe, getFriendsState)
}

// The list split into { incoming, outgoing, friends }.
export function useFriendGroups() {
  const { list } = useFriends()
  return useMemo(() => groupFriendships(list), [list])
}
