import { scoreTiers } from '../ranking/scores.js'

// Two averages closer than this count as equal (scores are tenths, but sums of
// floats aren't exact).
const EPSILON = 1e-9

// The genre a user has ranked the most movies in, for the profile's "Top
// Genre" card. tiers: ranked list, best first (same shape as everywhere else).
//
//   * A movie with several genres counts toward each of them.
//   * Ties go to the genre with the higher average score, then to the first
//     one alphabetically so the answer never flickers between renders.
//   * The card's poster is the highest-ranked movie in that genre that is NOT
//     the user's #1 (the Top Movie card already shows that one). If #1 is the
//     only movie in the genre, it is shown after all.
//
// Scores are computed here even when the list is too short to show them: the
// tie-break only needs the order, and the UI decides separately whether to
// display a score.
//
// Returns { genre, count, movie } or null when nothing is ranked or none of
// the ranked movies has a genre.
export function topGenre(tiers) {
  const ranked = tiers.flat()
  if (!ranked.length) return null

  const scores = scoreTiers(tiers, 1)
  const stats = new Map() // genre -> { count, total }
  for (const movie of ranked) {
    for (const genre of new Set(movie.genres ?? [])) {
      const entry = stats.get(genre) ?? { count: 0, total: 0 }
      entry.count += 1
      entry.total += scores.get(movie.id) ?? 0
      stats.set(genre, entry)
    }
  }
  if (!stats.size) return null

  const better = (a, b) => {
    if (a.count !== b.count) return a.count > b.count
    const avgA = a.total / a.count
    const avgB = b.total / b.count
    if (Math.abs(avgA - avgB) > EPSILON) return avgA > avgB
    return a.genre < b.genre
  }
  let best = null
  for (const [genre, { count, total }] of stats) {
    const candidate = { genre, count, total }
    if (!best || better(candidate, best)) best = candidate
  }

  const inGenre = ranked.filter((movie) => movie.genres?.includes(best.genre))
  const movie = inGenre.find((m) => m.id !== ranked[0].id) ?? ranked[0]
  return { genre: best.genre, count: best.count, movie }
}
