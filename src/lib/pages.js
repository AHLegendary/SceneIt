// Pages reachable from the sidebar, in display order.
export const PAGES = [
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'my-list', label: 'My List' },
  { id: 'for-you', label: 'For You' },
  { id: 'friends', label: 'Friends' },
  { id: 'blends', label: 'Movie Blend' },
  { id: 'login', label: 'Log in' },
  // Shown only when logged in; the tab label is the user's username.
  { id: 'profile', label: 'Profile' },
]

// 'user' is someone else's profile (#/u/name); it isn't a sidebar tab.
// 'blend' is one Movie Blend (#/blends/id); it isn't one either, and needs an account.
// Pages anyone can see without logging in. Everything else needs an account.
export const PUBLIC_PAGES = new Set(['leaderboard', 'login', 'user', 'user-list'])
