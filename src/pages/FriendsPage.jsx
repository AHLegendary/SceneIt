import { useEffect, useState } from 'react'
import {
  acceptFriendRequest,
  loadFriends,
  relationTo,
  removeFriendship,
  searchUsers,
  sendFriendRequest,
  SEND_RESULTS,
} from '../lib/friends.js'
import { userHref } from '../lib/route.js'
import { useFriendGroups, useFriends } from '../lib/useFriends.js'

const SEARCH_DELAY_MS = 250

// Friends page: find people by username, answer requests, manage friends.
export default function FriendsPage() {
  const { status, list, error } = useFriends()
  const groups = useFriendGroups()
  // userId -> what's happening to that row right now ('busy' | 'confirm')
  const [rowState, setRowState] = useState({})
  // { text, error } shown above the lists after an action
  const [flash, setFlash] = useState(null)

  function setRow(userId, value) {
    setRowState((s) => {
      const next = { ...s }
      if (value) next[userId] = value
      else delete next[userId]
      return next
    })
  }

  // Runs one friend action for one row, with busy state and a message.
  async function act(userId, action, success) {
    setRow(userId, 'busy')
    setFlash(null)
    try {
      const result = await action(userId)
      const text = typeof success === 'function' ? success(result) : success
      if (text) setFlash({ text, error: false })
    } catch (e) {
      setFlash({ text: e.message, error: true })
    } finally {
      setRow(userId, null)
    }
  }

  const send = (user) => act(user.id, sendFriendRequest, (result) => `${user.username}: ${SEND_RESULTS[result] ?? 'Done'}`)
  const accept = (user) => act(user.id, acceptFriendRequest, `You and ${user.username} are now friends`)
  const decline = (user) => act(user.id, removeFriendship, null)
  const cancel = (user) => act(user.id, removeFriendship, null)
  const unfriend = (user) => act(user.id, removeFriendship, `Removed ${user.username} from your friends`)

  return (
    <section className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Friends</h1>
          <p className="page__sub">Find people by username and see who's asked to be your friend.</p>
        </div>
      </header>

      <AddFriend list={list} rowState={rowState} onSend={send} onAccept={accept} />

      {flash && (
        <div className={`notice${flash.error ? ' notice--error' : ''}`} role={flash.error ? 'alert' : 'status'}>
          <span>{flash.text}</span>
          <button type="button" className="row__btn" onClick={() => setFlash(null)}>Dismiss</button>
        </div>
      )}

      {status === 'loading' ? (
        <div className="notice" role="status"><span>Loading your friends…</span></div>
      ) : status === 'error' ? (
        <div className="notice notice--error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn--sm" onClick={loadFriends}>Try again</button>
        </div>
      ) : (
        <>
          {groups.incoming.length > 0 && (
            <FriendSection title="Requests" count={groups.incoming.length}>
              {groups.incoming.map((user) => (
                <FriendRow key={user.id} user={user} meta={`Asked ${timeAgo(user.createdAt)}`}>
                  <button type="button" className="btn btn--sm" disabled={!!rowState[user.id]} onClick={() => accept(user)}>
                    Accept
                  </button>
                  <button type="button" className="row__btn" disabled={!!rowState[user.id]} onClick={() => decline(user)}>
                    Decline
                  </button>
                </FriendRow>
              ))}
            </FriendSection>
          )}

          <FriendSection title="Your friends" count={groups.friends.length}>
            {groups.friends.length === 0 ? (
              <li className="friends__empty">
                No friends yet. Search for someone's username above to send a request.
              </li>
            ) : (
              groups.friends.map((user) => (
                <FriendRow key={user.id} user={user} meta={`Friends since ${formatDate(user.createdAt)}`}>
                  {rowState[user.id] === 'confirm' ? (
                    <>
                      <button type="button" className="btn btn--sm btn--danger" onClick={() => unfriend(user)}>
                        Remove
                      </button>
                      <button type="button" className="row__btn" onClick={() => setRow(user.id, null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="row__btn"
                      disabled={rowState[user.id] === 'busy'}
                      onClick={() => setRow(user.id, 'confirm')}
                    >
                      Remove friend
                    </button>
                  )}
                </FriendRow>
              ))
            )}
          </FriendSection>

          {groups.outgoing.length > 0 && (
            <FriendSection title="Sent requests" count={groups.outgoing.length}>
              {groups.outgoing.map((user) => (
                <FriendRow key={user.id} user={user} meta={`Sent ${timeAgo(user.createdAt)}`}>
                  <button type="button" className="row__btn" disabled={!!rowState[user.id]} onClick={() => cancel(user)}>
                    Cancel request
                  </button>
                </FriendRow>
              ))}
            </FriendSection>
          )}
        </>
      )}
    </section>
  )
}

// Username search with an action button per result that matches how you're
// already connected to that person.
function AddFriend({ list, rowState, onSend, onAccept }) {
  const [query, setQuery] = useState('')
  // { query, users, error } for the latest finished search
  const [result, setResult] = useState(null)
  const q = query.trim()

  useEffect(() => {
    if (q.length < 2) return undefined
    let current = true
    const timer = setTimeout(() => {
      searchUsers(q).then(
        (users) => current && setResult({ query: q, users, error: null }),
        (e) => current && setResult({ query: q, users: [], error: e.message }),
      )
    }, SEARCH_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [q])

  const shown = q.length >= 2 ? result : null
  const stale = shown && shown.query !== q

  return (
    <div className="friends__add">
      <label className="search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          className="search__input"
          type="search"
          placeholder="Search usernames to add a friend"
          aria-label="Search usernames"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          spellCheck="false"
        />
      </label>

      {q.length === 1 && <p className="friends__hint">Keep typing, at least 2 characters.</p>}
      {q.length >= 2 && !shown && <p className="friends__hint">Searching…</p>}
      {shown?.error && <p className="friends__hint friends__hint--error" role="alert">{shown.error}</p>}
      {shown && !shown.error && shown.users.length === 0 && !stale && (
        <p className="friends__hint">No one with a username starting with “{q}”.</p>
      )}
      {shown && shown.users.length > 0 && (
        <ul className={`board friends__list${stale ? ' is-stale' : ''}`} aria-label="Search results">
          {shown.users.map((user) => {
            const relation = relationTo(list, user.id)
            const busy = !!rowState[user.id]
            return (
              <FriendRow key={user.id} user={user}>
                {relation === 'friends' ? (
                  <span className="friends__tag">Friends</span>
                ) : relation === 'outgoing' ? (
                  <span className="friends__tag">Requested</span>
                ) : relation === 'incoming' ? (
                  <button type="button" className="btn btn--sm" disabled={busy} onClick={() => onAccept(user)}>
                    Accept request
                  </button>
                ) : (
                  <button type="button" className="btn btn--sm" disabled={busy} onClick={() => onSend(user)}>
                    {busy ? 'Sending…' : 'Add friend'}
                  </button>
                )}
              </FriendRow>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function FriendSection({ title, count, children }) {
  return (
    <section className="friends__section" aria-label={title}>
      <h2 className="recs__title">
        {title} <span className="friends__count">{count}</span>
      </h2>
      <ul className="board friends__list">{children}</ul>
    </section>
  )
}

function FriendRow({ user, meta, children }) {
  return (
    <li className="frow">
      <span className="frow__avatar" aria-hidden="true">{user.username.charAt(0).toUpperCase()}</span>
      <span className="frow__info">
        <a className="frow__name frow__link" href={userHref(user.username)}>{user.username}</a>
        {meta && <span className="frow__meta">{meta}</span>}
      </span>
      <span className="frow__actions">{children}</span>
    </li>
  )
}

function formatDate(iso) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'recently' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// "just now", "5 min ago", "3 hr ago", "2 days ago", then a date.
function timeAgo(iso, now = Date.now()) {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'recently'
  const min = Math.floor((now - then) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const days = Math.floor(hr / 24)
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  return `on ${formatDate(iso)}`
}
