// Movie Blend recommendations: movies the whole group should like.
//
// Runs on the server (api/blends/recommendations.js), because it reads every
// member's rankings and members don't have to be friends with each other.
// Only group-level facts leave it: a score, how many members loved a movie,
// and which group favorite a discovery is like. Never who ranked what.
//
// Every member gets an opinion of every candidate, -1 to 1:
//   * ranked it: their rank weight (rankWeights, as on the For You page), so
//     "Loved it" counts a lot and "It was okay" barely counts
//   * didn't rank it: a guess from TMDb links to the movies they did rank,
//     a bit weaker than a real opinion (PREDICTED_WEIGHT)
// The group score is the average opinion, so one person loving a movie never
// beats the whole group liking it. Anyone who put it in "Not a fan" vetoes it,
// and a movie every member already ranked is left out (nothing new to watch).
//
// Candidates are the members' own ranked movies plus TMDb's recommendations
// for the group's favorites (pickBlendSeeds), so a blend can suggest movies
// nobody in it has ranked yet.
//
// Pure functions: no fetching, no storage.

import {
  DISLIKE_WEIGHT,
  FAVORITE_WEIGHT,
  linkStrength,
  qualityPrior,
  rankWeights,
  saturate,
} from '../recommendations/recommend.js'

// A guessed opinion counts this much of a real one.
const PREDICTED_WEIGHT = 0.8
// Group scores at or below this aren't worth suggesting.
const MIN_BLEND_SCORE = 0.1
export const BLEND_REC_LIMIT = 20

// The group's favorites to ask TMDb about, best first: movies members loved,
// ordered by their summed weight, so a movie two people loved beats one only
// one person loved. Only movies with a TMDb id count.
export function pickBlendSeeds(memberTiers, max = 10) {
  const totals = new Map()
  const movies = new Map()
  for (const tiers of memberTiers) {
    const weights = rankWeights(tiers)
    for (const movie of tiers.flat()) {
      const w = weights.get(movie.id)
      if (w < FAVORITE_WEIGHT || !Number.isInteger(movie.tmdb_id)) continue
      totals.set(movie.id, (totals.get(movie.id) ?? 0) + w)
      movies.set(movie.id, movie)
    }
  }
  return [...totals]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([id]) => movies.get(id))
}

// Scores candidates for a group.
//   memberTiers  one ranked list (tiers) per member
//   candidates   extra movies to consider (TMDb's, from mergeTmdbRecs)
//   links        link map from mergeTmdbRecs
// Returns [{ movie, score, lovedCount, memberCount, because }], best first:
//   lovedCount  members who put it in "Loved it"
//   because     the group favorite with the strongest link to it, or null
export function scoreBlend(memberTiers, candidates = [], { links } = {}) {
  const members = memberTiers.map((tiers) => ({ ranked: tiers.flat(), weights: rankWeights(tiers) }))
  const n = members.length
  if (n < 2) return []

  const pool = new Map()
  for (const m of members) for (const movie of m.ranked) if (!pool.has(movie.id)) pool.set(movie.id, movie)
  for (const movie of candidates) if (!pool.has(movie.id)) pool.set(movie.id, movie)

  const results = []
  for (const movie of pool.values()) {
    let total = 0
    let rankedBy = 0
    let lovedCount = 0
    let vetoed = false
    let because = null
    let best = 0
    for (const m of members) {
      const w = m.weights.get(movie.id)
      if (w !== undefined) {
        rankedBy++
        if (w <= DISLIKE_WEIGHT) {
          vetoed = true
          break
        }
        if (w >= FAVORITE_WEIGHT) lovedCount++
        total += w
        continue
      }
      let linkSum = 0
      for (const r of m.ranked) {
        const strength = linkStrength(r, movie, links)
        if (!strength) continue
        const contribution = m.weights.get(r.id) * strength
        linkSum += contribution
        if (contribution > best) {
          best = contribution
          because = r
        }
      }
      total += PREDICTED_WEIGHT * saturate(linkSum)
    }
    if (vetoed || rankedBy === n) continue
    const score = total / n
    if (score <= MIN_BLEND_SCORE) continue
    results.push({ movie, score, lovedCount, memberCount: n, because })
  }

  // Ties: better rated first, then title so the order is stable.
  return results.sort(
    (a, b) =>
      b.score - a.score || qualityPrior(b.movie) - qualityPrior(a.movie) || a.movie.title.localeCompare(b.movie.title),
  )
}

// The small line under a blend recommendation. Group-level only.
export function blendRecLabel({ lovedCount, memberCount, because }) {
  if (lovedCount > 0) return `Loved by ${lovedCount} of ${memberCount}`
  if (because) return `Like ${because}, a group favorite`
  return 'Your group should like this'
}
