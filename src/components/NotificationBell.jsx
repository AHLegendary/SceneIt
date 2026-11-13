import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import {
  loadNotifications,
  markAllRead,
  markAllSeen,
  openNotification,
  unreadCount,
  unseenCount,
} from '../lib/notifications.js'
import { timeAgo } from '../lib/timeAgo.js'
import { useNotifications } from '../lib/useNotifications.js'

// What the "no longer available" popup says, by kind of notification.
const GONE_COMMENT = 'This comment is no longer available.'
const GONE_REQUEST = 'This request is no longer pending.'

// What a click on an available notification does: go to its page.
function goTo(href) {
  window.location.hash = href
}

// The bell in the top nav: a badge with how many notifications you haven't
// seen, and a dropdown panel with the list (newest first).
//
//   * Opening the panel marks everything *seen* (the badge goes to 0).
//   * A row stays "unread" (tinted, with a dot) until you click it, or use
//     "Mark all read".
//   * Clicking a row asks the database whether its target still exists right
//     now. If it does, the panel closes and you go there; if not, you stay
//     where you are and a small popup says so.
//
// Escape, a click outside, or moving to another page closes the panel (the same
// behaviour as ProfileMenu).
export default function NotificationBell({ current }) {
  const { status, list, error } = useNotifications()
  const [open, setOpen] = useState(false)
  const [opening, setOpening] = useState(null) // id of the row being opened
  const [openError, setOpenError] = useState(null)
  const [gone, setGone] = useState(null) // the popup message, or null
  const wrap = useRef(null)
  const panelId = useId()
  const titleId = useId()

  const unseen = unseenCount({ list })
  const unread = unreadCount({ list })

  const close = useCallback(() => setOpen(false), [])

  // Moving to another page closes it. Done while rendering, the way React
  // recommends for state that follows a prop.
  const [seenPage, setSeenPage] = useState(current)
  if (seenPage !== current) {
    setSeenPage(current)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && close()
    const onDown = (e) => wrap.current && !wrap.current.contains(e.target) && close()
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open, close])

  async function toggle() {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setOpenError(null)
    // Fresh list first, so what you see is what gets marked seen.
    await loadNotifications()
    await markAllSeen()
  }

  async function click(notification) {
    setOpenError(null)
    setOpening(notification.id)
    try {
      const result = await openNotification(notification.id)
      setOpen(false)
      if (result.available) {
        goTo(result.href)
      } else {
        setGone(notification.type === 'comment' || notification.type === 'reply' ? GONE_COMMENT : GONE_REQUEST)
        loadNotifications() // so the row shows it is gone the next time the panel opens
      }
    } catch (e) {
      setOpenError(e.message)
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="notif" ref={wrap}>
      <button
        type="button"
        className={`nav__link nav__link--bell${open ? ' is-open' : ''}`}
        aria-label={unseen > 0 ? `Notifications, ${unseen} unseen` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <Icon name="bell" size={20} />
        {unseen > 0 && (
          <span className="badge" aria-hidden="true">
            {unseen > 9 ? '9+' : unseen}
          </span>
        )}
      </button>

      <div id={panelId} className="notif__panel" role="region" aria-labelledby={titleId} hidden={!open}>
        {open && (
          <>
            <div className="notif__head">
              <h2 id={titleId} className="notif__title">Notifications</h2>
              {unread > 0 && (
                <button type="button" className="notif__markall" onClick={markAllRead}>
                  Mark all read
                </button>
              )}
            </div>

            {status === 'error' && (
              <div className="profile__alert" role="alert">
                {error}{' '}
                <button type="button" className="profile__link" onClick={loadNotifications}>Try again</button>
              </div>
            )}
            {openError && <div className="profile__alert" role="alert">{openError}</div>}

            {list.length === 0 ? (
              status === 'loading' ? (
                <p className="notif__empty">Loading…</p>
              ) : status === 'error' ? null : (
                <p className="notif__empty">No notifications yet.</p>
              )
            ) : (
              <ul className="notif__list">
                {list.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={`notif__row${n.readAt ? '' : ' is-unread'}`}
                      disabled={opening !== null}
                      onClick={() => click(n)}
                    >
                      <span className="notif__dot" aria-hidden="true" />
                      <span className="notif__text">
                        <span className="notif__line">
                          {!n.readAt && <span className="sr-only">Unread. </span>}
                          <Sentence n={n} />
                          <span className="notif__time"> · {timeAgo(n.createdAt)}</span>
                        </span>
                        {n.preview && <span className="notif__preview">{n.preview}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {gone && <GoneDialog message={gone} onClose={() => setGone(null)} />}
    </div>
  )
}

// "alex commented on your review of Dune", and so on, per kind.
function Sentence({ n }) {
  const who = <strong>{n.actorUsername ?? 'Someone'}</strong>
  const movie = n.movieTitle ? <strong>{n.movieTitle}</strong> : null
  switch (n.type) {
    case 'comment':
      return <>{who} commented on your review{movie && <> of {movie}</>}</>
    case 'reply':
      return <>{who} replied to your comment{movie && <> on {movie}</>}</>
    case 'friend_request':
      return <>{who} sent you a friend request</>
    case 'blend_invite':
      return <>{who} invited you to a Movie Blend</>
    default:
      return <>{who} did something</>
  }
}

// The popup for a notification whose target is gone. Reuses the dialog look of
// RecsUnlockedDialog. Escape and a click on the backdrop close it.
function GoneDialog({ message, onClose }) {
  const titleId = useId()

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay overlay--top overlay--center" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog notif__gone" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <p id={titleId} className="notif__gonetext">{message}</p>
        <div className="unlocked__actions">
          <button type="button" className="btn btn--accent" onClick={onClose} autoFocus>OK</button>
        </div>
      </div>
    </div>
  )
}
