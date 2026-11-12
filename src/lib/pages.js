// Every page the app can show. The hash in the URL names one (#/my-list).
export const PAGES = [
  { id: 'home', label: 'Home' },
  { id: 'community', label: 'Community' },
  { id: 'my-list', label: 'My List' },
  { id: 'for-you', label: 'For You' },
  { id: 'friends', label: 'Friends' },
  { id: 'blends', label: 'Movie Blend' },
  { id: 'login', label: 'Log in' },
  { id: 'signup', label: 'Sign up' },
  { id: 'profile', label: 'Profile' },
]

// Pages in the top navigation, in display order.
export const NAV_PAGES = [
  { id: 'home', label: 'Home' },
  { id: 'community', label: 'Community' },
  { id: 'blends', label: 'Movie Blend' },
]

// Shortcuts in the Profile menu (the semicircle under the Profile button).
export const PROFILE_SHORTCUTS = [
  { id: 'friends', label: 'Friends' },
  { id: 'my-list', label: 'My List' },
  { id: 'rank', label: 'Rank Movies' },
  { id: 'profile', label: 'Bio' },
]

// 'community' is the Reviews and Leaderboard tabs (#/community, #/community/leaderboard); the old #/leaderboard address opens the second one.
// 'user' is someone else's profile (#/u/name, see route.js); it has no tab.
// 'review' is one review and its comments (#/u/name/review/id); it has no tab, and anyone can read it.
// 'blend' is one Movie Blend (#/blends/id); it has no tab either, and needs an account.
// Pages anyone can see without logging in. Everything else needs an account.
export const PUBLIC_PAGES = new Set(['home', 'community', 'login', 'signup', 'user', 'user-list', 'review'])

export const DEFAULT_PAGE = 'home'
