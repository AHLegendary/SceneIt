import { useEffect, useRef, useState } from 'react'
import {
  acceptFriendRequest,
  relationTo,
  searchUsers,
  sendFriendRequest,
  SEND_RESULTS,
} from '../lib/friends.js'
import { fetchProfileByUsername } from '../lib/profileQueries.js'
import { validateUsername } from '../lib/validation.js'
import { useFriends } from '../lib/useFriends.js'
import './ProfilePage.css'

const LOAD_ERROR = "Couldn't load this profile. Check your connection and try again."

// Someone else's profile, at #/u/<username>.
//   public (or you're friends)  -> pronouns and bio
//   private, you're logged in   -> a private notice with an Add friend button
//   private, logged out         -> can't tell it apart from a missing user
export default function UserProfilePage({ username, account }) {
  const signedIn = account.status === 'ready'
  const myId = account.user?.id ?? null
  const friends = useFriends()
  // 'loading' | 'profile' | 'private' | 'missing' | 'hidden' | 'error'
  const [view, setView] = useState({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  // Whose profile this is. Kept across reloads so friend status doesn't depend
  // on the view being cleared (which caused an endless reload for friends).
  const [targetId, setTargetId] = useState(null)
  const loadedFor = useRef('')

  const known = view.profile ?? view.user
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
        // Your own profile lives on the Profile tab.
        if (result.kind === 'profile' && result.profile.id === myId) {
          window.location.hash = '/profile'
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
  }, [username, signedIn, myId, isFriend, attempt])

  const heading = (
    <header className="page__head">
      <div>
        {signedIn && (
          <a className="profile__link uprofile__back" href="#/friends">
            ← Back to Friends
          </a>
        )}
        <h1 className="page__title profile__name">{known?.username ?? username}</h1>
        {view.kind === 'profile' && view.profile.pronouns && (
          <p className="uprofile__pronouns">{view.profile.pronouns}</p>
        )}
      </div>
    </header>
  )

  if (view.kind === 'loading') {
    return (
      <section className="page">
        {heading}
        <p className="page__sub">Loading profile…</p>
      </section>
    )
  }

  if (view.kind === 'error') {
    return (
      <section className="page">
        {heading}
        <div className="profile__alert" role="alert">
          {LOAD_ERROR}{' '}
          <button type="button" className="profile__link" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      </section>
    )
  }

  if (view.kind === 'missing') {
    return (
      <section className="page">
        {heading}
        <p className="page__sub">No one on SceneIt goes by that username.</p>
      </section>
    )
  }

  if (view.kind === 'hidden') {
    return (
      <section className="page">
        {heading}
        <div className="uprofile">
          <p className="uprofile__muted">
            This profile is private, or the user doesn't exist. Log in to find out and to add friends.
          </p>
          <button type="button" className="btn" onClick={() => (window.location.hash = '/login')}>
            Log in
          </button>
        </div>
      </section>
    )
  }

  if (view.kind === 'private') {
    return (
      <section className="page">
        {heading}
        <div className="uprofile">
          <span className="uprofile__tag">Private profile</span>
          <p>
            {view.user.username} keeps their profile private. Add them as a friend to see their
            pronouns and bio.
          </p>
          <FriendAction user={view.user} relation={relation} ready={friends.status === 'ready'} />
        </div>
      </section>
    )
  }

  const { profile } = view
  return (
    <section className="page">
      {heading}
      <div className="uprofile">
        {!profile.is_public && <span className="uprofile__tag">Private profile, shared with friends</span>}
        {profile.bio ? (
          <p className="uprofile__bio">{profile.bio}</p>
        ) : (
          <p className="uprofile__muted">No bio yet.</p>
        )}
        {signedIn ? (
          <FriendAction user={profile} relation={relation} ready={friends.status === 'ready'} />
        ) : (
          <button type="button" className="btn" onClick={() => (window.location.hash = '/login')}>
            Log in to add friends
          </button>
        )}
      </div>
    </section>
  )
}

// The button that matches how you're already connected to this person.
function FriendAction({ user, relation, ready }) {
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  async function run(action, success) {
    setBusy(true)
    setFlash(null)
    try {
      const result = await action(user.id)
      setFlash({ text: success(result), error: false })
    } catch (e) {
      setFlash({ text: e.message, error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="uprofile__action">
      {relation === 'friends' ? (
        <span className="friends__tag">Friends</span>
      ) : relation === 'outgoing' ? (
        <span className="friends__tag">Requested</span>
      ) : relation === 'incoming' ? (
        <button
          type="button"
          className="btn btn--sm"
          disabled={busy || !ready}
          onClick={() => run(acceptFriendRequest, () => `You and ${user.username} are now friends`)}
        >
          Accept request
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--sm"
          disabled={busy || !ready}
          onClick={() => run(sendFriendRequest, (result) => SEND_RESULTS[result] ?? 'Done')}
        >
          {busy ? 'Sending…' : 'Add friend'}
        </button>
      )}
      {flash && (
        <div className={`notice${flash.error ? ' notice--error' : ''}`} role={flash.error ? 'alert' : 'status'}>
          <span>{flash.text}</span>
        </div>
      )}
    </div>
  )
}
