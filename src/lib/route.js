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
//   #/u/reil_99/review/<id>  -> { page: 'review', username: 'reil_99', reviewId: '<id>' }
//   #/u/reil_99/review/<id>/c/<commentId>
//                            -> { page: 'review', username: 'reil_99', reviewId: '<id>', commentId: '<commentId>' }
//                               (the same page, scrolled to that comment; notifications link here)
//   #/blends/abc             -> { page: 'blend', username: null, blendId: 'abc' }
//   #/community              -> { page: 'community', username: null, tab: 'reviews' }
//   #/community/leaderboard  -> { page: 'community', username: null, tab: 'leaderboard' }
//   #/leaderboard            -> same as #/community/leaderboard (the old address still works)
// Anything unknown falls back to the default page.
export function parseHash(hash) {
  const raw = (hash ?? '').replace(/^#\/?/, '')

  const communityMatch = raw.match(/^community(?:\/(reviews|leaderboard))?$/)
  if (communityMatch) return { page: 'community', username: null, tab: communityMatch[1] ?? 'reviews' }
  if (raw === 'leaderboard') return { page: 'community', username: null, tab: 'leaderboard' }

  const blendMatch = raw.match(/^blends\/([^/?#]+)$/)
  if (blendMatch) {
    const blendId = decode(blendMatch[1])
    if (blendId === null) return { page: DEFAULT_PAGE, username: null }
    return { page: 'blend', username: null, blendId }
  }

  const commentMatch = raw.match(/^u\/([^/?#]+)\/review\/([^/?#]+)\/c\/([^/?#]+)$/)
  if (commentMatch) {
    const username = decode(commentMatch[1])
    const reviewId = decode(commentMatch[2])
    const commentId = decode(commentMatch[3])
    if (username === null || reviewId === null || commentId === null) return { page: DEFAULT_PAGE, username: null }
    return { page: 'review', username, reviewId, commentId }
  }

  const reviewMatch = raw.match(/^u\/([^/?#]+)\/review\/([^/?#]+)$/)
  if (reviewMatch) {
    const username = decode(reviewMatch[1])
    const reviewId = decode(reviewMatch[2])
    if (username === null || reviewId === null) return { page: DEFAULT_PAGE, username: null }
    return { page: 'review', username, reviewId }
  }

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

// Link to one Movie Blend.
export function blendHref(blendId) {
  return `#/blends/${encodeURIComponent(blendId)}`
}

// Link to another user's profile.
export function userHref(username) {
  return `#/u/${encodeURIComponent(username)}`
}

// Link to another user's full ranked list.
export function userListHref(username) {
  return `#/u/${encodeURIComponent(username)}/my-list`
}

// Link to the discussion page of a review: the review, then its comments.
export function reviewHref(username, reviewId) {
  return `#/u/${encodeURIComponent(username)}/review/${encodeURIComponent(reviewId)}`
}

// Link to one comment (or reply) on a review: the same page as reviewHref, scrolled to it.
export function reviewCommentHref(username, reviewId, commentId) {
  return `${reviewHref(username, reviewId)}/c/${encodeURIComponent(commentId)}`
}

// Link to the Community page: its Reviews tab (the default) or its Leaderboard tab.
export function communityHref(tab = 'reviews') {
  return tab === 'leaderboard' ? '#/community/leaderboard' : '#/community'
}
