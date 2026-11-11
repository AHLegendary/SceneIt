import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import Logo from './Logo.jsx'
import SearchBar from './SearchBar.jsx'
import { NAV_PAGES, PROFILE_SHORTCUTS } from '../lib/pages.js'
import { signOut } from '../lib/supabaseStore.js'
import { useFriendGroups } from '../lib/useFriends.js'

// Header: Logo | search | Home · Leaderboard · Profile (or Log in / Sign up).
// The Profile button opens a semicircular menu of shortcuts (ProfileMenu).
// Nothing account-specific renders until the saved session has been checked,
// so logged-out visitors never see a flash of private controls.
export default function TopNav({ current, account, onNavigate, onOpen, onRank, onLogin, onSignUp }) {
  const signedIn = account.status === 'ready' || account.status === 'error'
  const checking = account.status === 'loading' && !account.user
  const requests = useFriendGroups().incoming.length

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
            >
              <Icon name={page.id === 'home' ? 'home' : 'chart'} size={20} />
              <span>{page.label}</span>
            </button>
          ))}

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
  useEffect(() => {
    setOpen(false)
  }, [current])

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
