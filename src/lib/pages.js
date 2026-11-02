// Pages reachable from the sidebar, in display order.
export const PAGES = [
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'my-list', label: 'My List' },
  { id: 'for-you', label: 'For You' },
  { id: 'login', label: 'Log in' },
]

// Pages anyone can see without logging in. Everything else needs an account.
export const PUBLIC_PAGES = new Set(['leaderboard', 'login'])
