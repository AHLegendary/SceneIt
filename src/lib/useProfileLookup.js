import { useEffect, useRef, useState } from 'react'
import { relationTo, searchUsers } from './friends.js'
import { fetchProfileByUsername } from './profileQueries.js'
import { validateUsername } from './validation.js'
import { useFriends } from './useFriends.js'

// Looks up another user by username and works out what you're allowed to see.
// view.kind:
//   'loading'
//   'profile'  -> view.profile (public, or you're friends)
//   'private'  -> view.user ({ id, username }); logged in, not allowed to see more
//   'hidden'   -> logged out; private and nonexistent look the same
//   'missing'  -> no such user
//   'error'
// ownHash is where to send you if the username turns out to be your own.
export function useProfileLookup(username, account, ownHash) {
  const signedIn = account.status === 'ready'
  const myId = account.user?.id ?? null
  const friends = useFriends()
  const [view, setView] = useState({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  // Whose profile this is. Kept across reloads so friend status doesn't depend
  // on the view being cleared (which caused an endless reload for friends).
  const [targetId, setTargetId] = useState(null)
  const loadedFor = useRef('')

  const relation = targetId ? relationTo(friends.list, targetId) : null
  const isFriend = relation === 'friends'

  useEffect(() => {
    let current = true
    // Show "Loading…" only for a new username, login, or retry. A change in
    // friend status refreshes quietly so the page doesn't flash.
    const key = `${username}|${signedIn}|${myId}|${attempt}`
    if (loadedFor.current !== key) {
      loadedFor.current = key
      setTargetId(null)
      setView({ kind: 'loading' })
    }

    async function lookup() {
      if (validateUsername(username) !== '') return { kind: 'missing' }

      const profile = await fetchProfileByUsername(username)
      if (profile) return { kind: 'profile', profile }
      if (!signedIn) return { kind: 'hidden' }

      // Not visible. Search can still find private users by username.
      const matches = await searchUsers(username)
      const match = matches.find((u) => u.username.toLowerCase() === username.toLowerCase())
      return match ? { kind: 'private', user: match } : { kind: 'missing' }
    }

    lookup().then(
      (result) => {
        if (!current) return
        if (result.kind === 'profile' && result.profile.id === myId) {
          window.location.hash = ownHash
          return
        }
        setTargetId(result.profile?.id ?? result.user?.id ?? null)
        setView(result)
      },
      () => current && setView({ kind: 'error' }),
    )
    return () => {
      current = false
    }
    // isFriend: becoming friends (or unfriending) changes what's visible, so look again.
  }, [username, signedIn, myId, isFriend, attempt, ownHash])

  return {
    view,
    relation,
    signedIn,
    friendsReady: friends.status === 'ready',
    retry: () => setAttempt((n) => n + 1),
  }
}
