import { useBlends } from '../features/blends/useBlends.js'
import { PAGES } from '../lib/pages.js'
import { useFriendGroups } from '../lib/useFriends.js'

// Left-hand navigation. Big tab labels; the active page gets the filled pill.
// The Friends tab shows how many friend requests are waiting, and the Movie
// Blend tab how many blend invites.
// Log in is for logged-out users; Profile (labelled with the username) is for logged-in ones.

export default function Sidebar({ current, onNavigate, signedIn = false, username = null }) {
  const requests = useFriendGroups().incoming.length
  const blendInvites = useBlends().invites.length
  const pages = PAGES.filter((page) => {
    if (page.id === 'login') return !signedIn
    if (page.id === 'profile') return signedIn
    return true
  })
  return (
    <nav className="sidebar" aria-label="Main">
      <span className="logo">
        <img className="logo__mark" src="/favicon.svg" alt="" width="28" height="28" />
        <span className="logo__text">SceneIt</span>
      </span>
      <div className="sidebar__tabs">
        {pages.map((page) => (
          <button
            key={page.id}
            type="button"
            className={`sidebar__tab${current === page.id ? ' is-active' : ''}`}
            aria-current={current === page.id ? 'page' : undefined}
            onClick={() => onNavigate(page.id)}
          >
            {page.id === 'profile' ? (
              <span
                title={username ?? undefined}
                style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {username ?? page.label}
              </span>
            ) : (
              page.label
            )}
            {page.id === 'friends' && requests > 0 && (
              <span className="sidebar__badge" aria-label={`${requests} friend ${requests === 1 ? 'request' : 'requests'}`}>
                {requests}
              </span>
            )}
            {page.id === 'blends' && blendInvites > 0 && (
              <span className="sidebar__badge" aria-label={`${blendInvites} blend ${blendInvites === 1 ? 'invite' : 'invites'}`}>
                {blendInvites}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  )
}
