import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, m } from 'motion/react'
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
// Where each circle sits, in px from the Profile button's bottom-right corner
// (x grows leftward as it goes negative). A shallow arc: My Profile tucked
// under the button, then stepping down-left and back up. The connector line
// and the expand animation use the same numbers.
const FAN_SPOTS = {
  profile: { x: -36, y: 62 },
  rank: { x: -126, y: 92 },
  'my-list': { x: -216, y: 108 },
  friends: { x: -306, y: 92 },
}
const FAN_W = 420
const FAN_ORDER = ['friends', 'my-list', 'rank', 'profile']

function ProfileMenu({ current, username, requests, onNavigate, onRank }) {
  const [open, setOpen] = useState(false)
  // Stays true while the circles animate back into the button after closing,
  // so the menu isn't yanked out of the page mid-exit (Motion's AnimatePresence
  // tells us when that's done). `hidden` follows this, aria-expanded follows `open`.
  const [present, setPresent] = useState(false)
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
    // Scrolling closes it too: with no backdrop, the circles would otherwise
    // float over whatever the page scrolls under them.
    const onScroll = () => close()
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', onScroll)
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
      <button
        type="button"
        className={`nav__link nav__link--profile${active ? ' is-active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          setPresent(true)
          setOpen((v) => !v)
        }}
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

      {/* Fan menu: four circles on an arc down and to the left of the button,
          no panel behind them. Positions are CSS variables per item so the
          expand animation can start every circle at the button. */}
      <div id={menuId} className={`fan${open ? ' is-open' : ''}`} role="menu" aria-label="Profile menu" hidden={!present}>
        <AnimatePresence onExitComplete={() => setPresent(false)}>
          {open && (
            <m.div
              key="fan"
              className="fan__body"
              initial={false}
              exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.14, ease: 'easeIn' } }}
            >
              <svg className="fan__lines" viewBox={`0 0 ${FAN_W} 200`} width={FAN_W} height={200} aria-hidden="true">
                <polyline
                  className="fan__trace"
                  points={FAN_ORDER.map((id) => `${FAN_W + FAN_SPOTS[id].x},${FAN_SPOTS[id].y}`).join(' ')}
                />
              </svg>
              {PROFILE_SHORTCUTS.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className={`fan__item fan__item--${item.id}`}
                  style={{ '--i': i, '--x': `${FAN_SPOTS[item.id].x}px`, '--y': `${FAN_SPOTS[item.id].y}px` }}
                  onClick={() => go(item.id)}
                >
                  <span className="fan__icon">
                    <Icon name={SHORTCUT_ICONS[item.id]} size={22} />
                    {item.id === 'friends' && requests > 0 && <span className="badge badge--dot" aria-hidden="true" />}
                  </span>
                  <span className="fan__label">{item.label}</span>
                </button>
              ))}
              <span className="fan__name" title={username ?? undefined}>{username ?? 'You'}</span>
              <button type="button" role="menuitem" className="fan__logout" style={{ '--i': 4 }} onClick={logOut} disabled={busy}>
                <Icon name="logout" size={14} />
                {busy ? 'Logging out…' : 'Log out'}
              </button>
              {error && <span className="fan__error" role="alert">{error}</span>}
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
