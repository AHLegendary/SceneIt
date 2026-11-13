import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import Logo from './Logo.jsx'
import NotificationBell from './NotificationBell.jsx'
import SearchBar from './SearchBar.jsx'
import { BLEND_MIN_RANKINGS } from '../features/blends/blends.js'
import { useBlends } from '../features/blends/useBlends.js'
import { RECS_UNLOCK } from '../features/recommendations/recommend.js'
import { NAV_PAGES, PROFILE_SHORTCUTS } from '../lib/pages.js'
import { signOut } from '../lib/supabaseStore.js'
import { useFriendGroups } from '../lib/useFriends.js'
import { useMyTiers } from '../lib/useMyList.js'

const NAV_ICONS = { home: 'home', community: 'chart', blends: 'people' }

// Header: Logo | search | Home · Community · Movie Blend · For You · bell · Profile
// (or Log in / Sign up). For You and the notification bell only show when logged
// in (For You needs your rankings). Movie Blend always shows, as a teaser for logged-out visitors.
// The Profile button opens a semicircular menu of shortcuts (ProfileMenu).
// Nothing account-specific renders until the saved session has been checked,
// so logged-out visitors never see a flash of private controls.
export default function TopNav({ current, account, onNavigate, onOpen, onRank, onLogin, onSignUp }) {
  const signedIn = account.status === 'ready' || account.status === 'error'
  const checking = account.status === 'loading' && !account.user
  const requests = useFriendGroups().incoming.length
  const blendInvites = useBlends().invites.length
  const rankedCount = useMyTiers().reduce((n, tier) => n + tier.length, 0)
  // Same "6/15" progress as For You. An invite means you can join without
  // creating, so the unread-invite badge wins over the lock.
  const blendLocked = signedIn && rankedCount < BLEND_MIN_RANKINGS && blendInvites === 0

  return (
    <header className="nav">
      <div className="nav__inner">
        <Logo onClick={(e) => { e.preventDefault(); onNavigate('home') }} />
        <SearchBar onOpen={onOpen} />

        <nav className="nav__links" aria-label="Main">
          {NAV_PAGES.map((page) => (
            <button
              key={page.id}
              type="button"
              className={`nav__link${current === page.id ? ' is-active' : ''}`}
              aria-current={current === page.id ? 'page' : undefined}
              onClick={() => onNavigate(page.id)}
              aria-label={page.id === 'blends' && blendLocked ? `${page.label}, ${rankedCount} of ${BLEND_MIN_RANKINGS} movies ranked to create a blend` : undefined}
              title={page.id === 'blends' && blendLocked ? `Rank ${BLEND_MIN_RANKINGS} movies to create a blend` : undefined}
            >
              <Icon name={NAV_ICONS[page.id]} size={20} />
              <span>{page.label}</span>
              {page.id === 'blends' && blendLocked && (
                <span className="badge badge--progress" aria-hidden="true">
                  {rankedCount}/{BLEND_MIN_RANKINGS}
                </span>
              )}
              {page.id === 'blends' && blendInvites > 0 && (
                <span className="badge" aria-label={`${blendInvites} pending blend ${blendInvites === 1 ? 'invite' : 'invites'}`}>
                  {blendInvites > 9 ? '9+' : blendInvites}
                </span>
              )}
            </button>
          ))}

          {signedIn && <ForYouLink active={current === 'for-you'} onNavigate={onNavigate} />}

          {signedIn && <NotificationBell current={current} />}

          {checking ? (
            <span className="nav__placeholder" aria-hidden="true" />
          ) : signedIn ? (
            <ProfileMenu
              current={current}
              username={account.username}
              requests={requests}
              onNavigate={onNavigate}
              onRank={onRank}
            />
          ) : (
            <span className="nav__auth">
              <button type="button" className="nav__link" onClick={onLogin}>
                <Icon name="user" size={20} />
                <span>Log in</span>
              </button>
              <button type="button" className="btn btn--sm nav__signup" onClick={onSignUp}>
                Sign up
              </button>
            </span>
          )}
        </nav>
      </div>
    </header>
  )
}

// Recommendations used to be hidden on the homepage and people couldn't find
// them (issue #38). This keeps them one click away, and until they unlock it
// shows progress ("6/15") so it's clear what unlocks them.
function ForYouLink({ active, onNavigate }) {
  const count = useMyTiers().reduce((n, tier) => n + tier.length, 0)
  const locked = count < RECS_UNLOCK
  return (
    <button
      type="button"
      className={`nav__link${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={() => onNavigate('for-you')}
      aria-label={locked ? `For You, locked: ${count} of ${RECS_UNLOCK} movies ranked` : 'For You'}
      title={locked ? `Rank ${RECS_UNLOCK} movies to unlock recommendations` : undefined}
    >
      <Icon name="sparkle" size={20} />
      <span>For You</span>
      {locked && (
        <span className="badge badge--progress" aria-hidden="true">
          {count}/{RECS_UNLOCK}
        </span>
      )}
    </button>
  )
}

const SHORTCUT_ICONS = { friends: 'friends', 'my-list': 'bookmark', rank: 'swords', profile: 'card' }

// Profile button + the semicircle beneath it. Clicking Profile toggles it;
// while open the page behind is dimmed and blurred, and Escape or a click
// anywhere outside closes it. Each shortcut is its own circular button so
// it works with keyboard and touch.
function ProfileMenu({ current, username, requests, onNavigate, onRank }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const wrap = useRef(null)
  const menuId = useId()

  const close = useCallback(() => setOpen(false), [])

  // Moving to another page closes it (e.g. a shortcut or the back button).
  // Done while rendering, the way React recommends for state that follows a prop.
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

  function go(id) {
    setOpen(false)
    if (id === 'rank') onRank()
    else onNavigate(id)
  }

  async function logOut() {
    setBusy(true)
    setError(null)
    try {
      await signOut()
      setOpen(false)
      onNavigate('home')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const active = current === 'profile' || current === 'friends' || current === 'my-list'

  return (
    <div className="pmenu" ref={wrap}>
      {open && createPortal(<div className="wheel-backdrop" aria-hidden="true" />, document.body)}
      <button
        type="button"
        className={`nav__link nav__link--profile${active ? ' is-active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="user" size={20} />
        <span>Profile</span>
        {requests > 0 && (
          <span className="badge" aria-label={`${requests} pending friend ${requests === 1 ? 'request' : 'requests'}`}>
            {requests > 9 ? '9+' : requests}
          </span>
        )}
        <Icon name="chevronDown" size={16} className="nav__caret" />
      </button>

      <div id={menuId} className={`wheel${open ? ' is-open' : ''}`} role="menu" aria-label="Profile menu" hidden={!open}>
        <svg className="wheel__lines" viewBox="0 0 360 190" preserveAspectRatio="none" aria-hidden="true">
          <path d="M180 0 L180 190" />
          <path d="M180 0 L45.6 134.4" />
          <path d="M180 0 L314.4 134.4" />
        </svg>
        <span className="wheel__avatar" aria-hidden="true">
          <Icon name="user" size={30} strokeWidth={2.2} />
        </span>
        <span className="wheel__name" title={username ?? undefined}>{username ?? 'You'}</span>
        {PROFILE_SHORTCUTS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`wheel__item wheel__item--${item.id}`}
            onClick={() => go(item.id)}
          >
            <span className="wheel__icon">
              <Icon name={SHORTCUT_ICONS[item.id]} size={22} />
              {item.id === 'friends' && requests > 0 && <span className="badge badge--dot" aria-hidden="true" />}
            </span>
            <span className="wheel__label">{item.label}</span>
          </button>
        ))}
        <button type="button" role="menuitem" className="wheel__logout" onClick={logOut} disabled={busy}>
          <Icon name="logout" size={14} />
          {busy ? 'Logging out…' : 'Log out'}
        </button>
        {error && <span className="wheel__error" role="alert">{error}</span>}
      </div>
    </div>
  )
}
