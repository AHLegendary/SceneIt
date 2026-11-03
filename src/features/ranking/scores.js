// Numerical scores from a ranked list.
//
// Scores aren't stored: they come from where a movie sits and how long the
// list is at display time. The top of the list scores 10.0 and the bottom 1.0,
// spread evenly in between. Tied movies share one score (the average of the
// positions they cover). Scores only show once the list is long enough to mean
// something.

export const SCORE_UNLOCK = 10
export const TOP_SCORE = 10
export const BOTTOM_SCORE = 1

// Map of movie id -> score (one decimal), or null if fewer than SCORE_UNLOCK
// movies are ranked. tiers: [[movie], [movie, movie], ...], best first.
export function scoreTiers(tiers, unlockAt = SCORE_UNLOCK) {
  const total = tiers.reduce((sum, tier) => sum + tier.length, 0)
  if (total < unlockAt || total < 2) return null

  const scores = new Map()
  let start = 0 // 0-based position of the tier's first movie
  for (const tier of tiers) {
    const middle = start + (tier.length - 1) / 2
    const fromTop = 1 - middle / (total - 1) // 1 at the top, 0 at the bottom
    const score = Math.round((BOTTOM_SCORE + (TOP_SCORE - BOTTOM_SCORE) * fromTop) * 10) / 10
    for (const movie of tier) scores.set(movie.id, score)
    start += tier.length
  }
  return scores
}

// How many more movies until scores unlock (0 once unlocked).
export function moviesUntilScores(count, unlockAt = SCORE_UNLOCK) {
  return Math.max(0, unlockAt - count)
}

// Score categories for filtering a ranked list. Scores come from position,
// so these are relative: about the top 44% of a list is "Loved it", the next
// 22% "It was okay" and the bottom 33% "Not a fan".
export const SCORE_CATEGORIES = [
  { id: 'loved', label: 'Loved it', range: '6.0–10', min: 6 },
  { id: 'okay', label: 'It was okay', range: '4.0–5.9', min: 4 },
  { id: 'meh', label: 'Not a fan', range: '0.0–3.9', min: -Infinity },
]

// Category id for a score: 'loved' (6+), 'okay' (4 to 5.9) or 'meh' (under 4).
export function categoryOf(score) {
  return SCORE_CATEGORIES.find((c) => score >= c.min).id
}

// Map of category id -> number of movies in it, from scoreTiers' result.
export function countByCategory(scores) {
  const counts = Object.fromEntries(SCORE_CATEGORIES.map((c) => [c.id, 0]))
  for (const score of scores?.values() ?? []) counts[categoryOf(score)] += 1
  return counts
}
