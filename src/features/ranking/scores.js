// Score categories and numerical scores for a ranked list.
//
// Before comparing, the user says how they felt about a movie: "Loved it",
// "It was okay" or "Not a fan". That category is stored with the ranking and
// fixes the band the movie's score falls in. Head-to-head comparisons only
// order movies inside their own category, and the list is always kept as all
// "Loved it" movies, then "It was okay", then "Not a fan".
//
// Scores aren't stored: they come from where a movie sits inside its category
// at display time. The best movie in a category gets the top of the band and
// the worst gets the bottom, spread evenly in between. Tied movies share one
// score (the average of the positions they cover). A movie alone in its
// category gets the middle of the band. Scores only show once the list is long
// enough to mean something.

export const SCORE_UNLOCK = 10

// Best first. min/max are the band a category's scores are spread across.
export const SCORE_CATEGORIES = [
  { id: 'loved', label: 'Loved it', range: '6.0–10', min: 6, max: 10 },
  { id: 'okay', label: 'It was okay', range: '4.0–5.9', min: 4, max: 5.9 },
  { id: 'meh', label: 'Not a fan', range: '0.0–3.9', min: 0, max: 3.9 },
]

const CATEGORY_IDS = SCORE_CATEGORIES.map((c) => c.id)

// Rankings saved before categories existed are migrated in the database, so
// this fallback is only for movie objects built by hand (tests, demos).
export const DEFAULT_CATEGORY = 'okay'

export function isCategory(id) {
  return CATEGORY_IDS.includes(id)
}

export function getCategory(id) {
  return SCORE_CATEGORIES.find((c) => c.id === id) ?? null
}

// A ranked movie's category id.
export function categoryOfMovie(movie) {
  return isCategory(movie?.category) ? movie.category : DEFAULT_CATEGORY
}

// Category id for a score: 'loved' (6+), 'okay' (4 to 5.9) or 'meh' (under 4).
export function categoryOf(score) {
  return SCORE_CATEGORIES.find((c) => score >= c.min)?.id ?? 'meh'
}

// 0 for 'loved', 1 for 'okay', 2 for 'meh': the order categories sit in a list.
export function categoryOrder(id) {
  return CATEGORY_IDS.indexOf(id)
}

// A tier's category (tied movies always share one).
function tierCategory(tier) {
  return categoryOfMovie(tier[0])
}

// Just the tiers in one category, best first. This is the list a new movie is
// compared against.
export function tiersInCategory(tiers, category) {
  return tiers.filter((tier) => tier.length > 0 && tierCategory(tier) === category)
}

// Global tier index where a category's block starts: how many tiers belong to
// better categories. Add the index inside the category to get the index in the
// whole list.
export function categoryOffset(tiers, category) {
  const order = categoryOrder(category)
  return tiers.filter((tier) => tier.length > 0 && categoryOrder(tierCategory(tier)) < order).length
}

// Map of movie id -> score (one decimal), or null if fewer than SCORE_UNLOCK
// movies are ranked. tiers: [[movie], [movie, movie], ...], best first, each
// movie carrying its `category`.
export function scoreTiers(tiers, unlockAt = SCORE_UNLOCK) {
  const total = tiers.reduce((sum, tier) => sum + tier.length, 0)
  if (total < unlockAt || total === 0) return null

  const scores = new Map()
  for (const category of SCORE_CATEGORIES) {
    const group = tiersInCategory(tiers, category.id)
    const count = group.reduce((sum, tier) => sum + tier.length, 0)
    // Work in tenths so 4.0–5.9 lands on round numbers (middle = 5.0).
    const low = Math.round(category.min * 10)
    const high = Math.round(category.max * 10)
    let start = 0 // 0-based position of the tier's first movie, inside the category
    for (const tier of group) {
      const middle = start + (tier.length - 1) / 2
      const fromTop = count > 1 ? 1 - middle / (count - 1) : 0.5 // 1 at the top, 0 at the bottom
      const score = Math.round(low + (high - low) * fromTop) / 10
      for (const movie of tier) scores.set(movie.id, score)
      start += tier.length
    }
  }
  return scores
}

// How many more movies until scores unlock (0 once unlocked).
export function moviesUntilScores(count, unlockAt = SCORE_UNLOCK) {
  return Math.max(0, unlockAt - count)
}

// Map of category id -> number of movies in it, ties counted once each.
export function countByCategory(tiers) {
  const counts = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0]))
  for (const tier of tiers ?? []) for (const movie of tier) counts[categoryOfMovie(movie)] += 1
  return counts
}
