// Builds the demo data for scripts/seed-demo-users.mjs: which movies each
// demo account ranks and in what order, and who is friends with whom.
//
// Pure and deterministic (seeded random), so the same seed always gives the
// same data and the tests can check it without a database.
//
// Each demo user has favorite genres. They mostly rank movies in those
// genres, and rank them higher, plus some noise and a shared "the movie is
// just good" pull from its IMDb rating. That gives the leaderboard some
// consensus and gives friends overlapping (but not identical) taste, which
// is what friend-based recommendations need to be worth testing.

// Two are private, so only their friends can see their rankings (handy for
// the privacy checks in the test plan).
export const DEMO_USERS = [
  { username: 'john_sceneit', likes: ['Science Fiction', 'Action'] },
  { username: 'maria_sceneit', likes: ['Romance', 'Drama'] },
  { username: 'kevin_sceneit', likes: ['Thriller', 'Horror', 'Crime'], private: true },
  { username: 'priya_sceneit', likes: ['Animation', 'Family'] },
  { username: 'sam_sceneit', likes: ['Comedy', 'Music'] },
  { username: 'lena_sceneit', likes: ['Drama', 'Mystery', 'Crime'], private: true },
  { username: 'omar_sceneit', likes: ['Adventure', 'Fantasy', 'Science Fiction'] },
  { username: 'grace_sceneit', likes: ['Drama', 'History', 'Music'] },
]

export const MIN_RANKED = 15
export const MAX_RANKED = 25
const TIE_CHANCE = 0.08
const DAY_MS = 24 * 60 * 60 * 1000

// Small seeded random number generator (mulberry32). Returns 0 <= x < 1.
export function seededRandom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Share of a movie's genres the user likes, 0 to 1.
export function affinity(likes, movie) {
  const genres = movie.genres ?? []
  if (!genres.length) return 0
  return genres.filter((g) => likes.includes(g)).length / genres.length
}

// Picks `count` movies without repeats, favoring ones the user likes.
function pickMovies(likes, catalog, count, rand) {
  const pool = catalog.map((movie) => ({ movie, weight: 1 + 4 * affinity(likes, movie) }))
  const picked = []
  while (picked.length < count && pool.length) {
    let r = rand() * pool.reduce((sum, p) => sum + p.weight, 0)
    let i = 0
    while (r >= pool[i].weight && i < pool.length - 1) r -= pool[i++].weight
    picked.push(pool.splice(i, 1)[0].movie)
  }
  return picked
}

// One user's ranked list: [{ tmdb_id, position, category, created_at }], best
// first, positions dense from 0, tied movies sharing a position, and
// categories in blocks: 'loved', then 'okay', then 'meh' (same shape the
// database's save_ranking keeps). Roughly the top 45% of tiers are loved and
// the bottom 30% not a fan.
export function buildRankings(user, catalog, rand, now = Date.now()) {
  const count = Math.min(catalog.length, MIN_RANKED + Math.floor(rand() * (MAX_RANKED - MIN_RANKED + 1)))
  const taste = (movie) =>
    2 * affinity(user.likes, movie) + // their genres
    ((movie.ratings?.imdb ?? 7) - 7) / 1.5 + // generally good movies do well
    1.2 * rand() // personal noise
  const ordered = pickMovies(user.likes, catalog, count, rand)
    .map((movie) => ({ movie, taste: taste(movie) }))
    .sort((a, b) => b.taste - a.taste)

  let position = -1
  const rows = ordered.map(({ movie }, i) => {
    if (i === 0 || rand() >= TIE_CHANCE) position += 1
    // About 40% ranked this week, the rest earlier this month, so the weekly
    // and monthly leaderboards differ.
    const daysAgo = rand() < 0.4 ? rand() * 6.5 : 7 + rand() * 22
    return { tmdb_id: movie.tmdb_id, position, created_at: new Date(now - daysAgo * DAY_MS).toISOString() }
  })
  const tierCount = position + 1
  for (const row of rows) row.category = categoryForTier(row.position, tierCount)
  return rows
}

// Category for the tier at `position` out of `tierCount`, by how far down it is.
export function categoryForTier(position, tierCount) {
  const fraction = position / tierCount
  return fraction < 0.45 ? 'loved' : fraction < 0.7 ? 'okay' : 'meh'
}

// Friendships among demo users, plus with real accounts.
// Returns [{ requester, addressee, status }] using usernames for demo users
// and ids for real users (whatever the caller passes in `realUsers`).
//   * each pair of demo users: 45% chance of a friendship, 80% of those accepted
//   * every demo user ends up with at least one accepted friend
//   * each real user: accepted friends with 3 demo users, plus 1 pending
//     request from another demo user so the Requests list has something in it
export function buildFriendships(demoNames, realUsers, rand) {
  const rows = []
  const key = (a, b) => [a, b].sort().join('|')
  const used = new Set()
  const add = (requester, addressee, status) => {
    used.add(key(requester, addressee))
    rows.push({ requester, addressee, status })
  }

  for (let i = 0; i < demoNames.length; i++) {
    for (let j = i + 1; j < demoNames.length; j++) {
      if (rand() >= 0.45) continue
      const [a, b] = rand() < 0.5 ? [demoNames[i], demoNames[j]] : [demoNames[j], demoNames[i]]
      add(a, b, rand() < 0.8 ? 'accepted' : 'pending')
    }
  }

  // Nobody left without a friend.
  for (const name of demoNames) {
    if (rows.some((r) => r.status === 'accepted' && (r.requester === name || r.addressee === name))) continue
    const other = demoNames.find((n) => n !== name && !used.has(key(name, n)))
    if (other) {
      add(name, other, 'accepted')
    } else {
      // Every pair is taken, so accept one of this user's pending requests.
      const pending = rows.find((r) => r.status === 'pending' && (r.requester === name || r.addressee === name))
      if (pending) pending.status = 'accepted'
    }
  }

  for (const real of realUsers) {
    const shuffled = shuffle(demoNames, rand)
    for (const name of shuffled.slice(0, 3)) add(name, real, 'accepted')
    if (shuffled[3]) add(shuffled[3], real, 'pending')
  }
  return rows
}

function shuffle(list, rand) {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// The whole plan: { users: [{ username, likes, rankings }], friendships }.
export function buildDemoPlan(catalog, realUsers = [], { seed = 403, now = Date.now() } = {}) {
  const rand = seededRandom(seed)
  const users = DEMO_USERS.map((user) => ({ ...user, rankings: buildRankings(user, catalog, rand, now) }))
  const friendships = buildFriendships(users.map((u) => u.username), realUsers, rand)
  return { users, friendships }
}
