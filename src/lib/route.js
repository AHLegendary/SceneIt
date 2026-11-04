import { DEFAULT_PAGE, PAGES } from './pages.js'

export { DEFAULT_PAGE }

function decode(part) {
  try {
    return decodeURIComponent(part)
  } catch {
    return null
  }
}

// Reads the URL hash into { page, username }.
//   #/my-list                -> { page: 'my-list', username: null }
//   #/u/reil_99              -> { page: 'user', username: 'reil_99' }
//   #/u/reil_99/my-list      -> { page: 'user-list', username: 'reil_99' }
// Anything unknown falls back to the default page.
export function parseHash(hash) {
  const raw = (hash ?? '').replace(/^#\/?/, '')

  const listMatch = raw.match(/^u\/([^/?#]+)\/my-list$/)
  const userMatch = raw.match(/^u\/([^/?#]+)$/)
  const match = listMatch ?? userMatch
  if (match) {
    const username = decode(match[1])
    if (username === null) return { page: DEFAULT_PAGE, username: null }
    return { page: listMatch ? 'user-list' : 'user', username }
  }

  return { page: PAGES.some((p) => p.id === raw) ? raw : DEFAULT_PAGE, username: null }
}

// Link to another user's profile.
export function userHref(username) {
  return `#/u/${encodeURIComponent(username)}`
}

// Link to another user's full ranked list.
export function userListHref(username) {
  return `#/u/${encodeURIComponent(username)}/my-list`
}
