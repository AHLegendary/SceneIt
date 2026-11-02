import { PAGES } from '../lib/pages.js'

// Left-hand navigation. Big tab labels; the active page gets the filled pill.

export default function Sidebar({ current, onNavigate, signedIn = false }) {
  // The Log in tab is only useful while logged out.
  const pages = PAGES.filter((page) => page.id !== 'login' || !signedIn)
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
            {page.label}
          </button>
        ))}
      </div>
    </nav>
  )
}
