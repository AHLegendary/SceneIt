import { PAGES } from './pages.js'

export const DEFAULT_PAGE = 'leaderboard'

// Reads the URL hash into { page, username }.
//   #/my-list      -> { page: 'my-list', username: null }
//   #/u/reil_99    -> { page: 'user', username: 'reil_99' }
// Anything unknown falls back to the default page.
export function parseHash(hash) {
  const raw = (hash ?? '').replace(/^#\/?/, '')

  const userMatch = raw.match(/^u\/([^/?#]+)$/)
  if (userMatch) {
    try {
      return { page: 'user', username: decodeURIComponent(userMatch[1]) }
    } catch {
      return { page: DEFAULT_PAGE, username: null }
    }
  }

  return { page: PAGES.some((p) => p.id === raw) ? raw : DEFAULT_PAGE, username: null }
}

// Link to another user's profile.
export function userHref(username) {
  return `#/u/${encodeURIComponent(username)}`
}
