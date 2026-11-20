// Movie Blend recommendations: movies the whole group should like.
//
// Runs on the server (api/blends/recommendations.js), because it reads every
// member's rankings and members don't have to be friends with each other.
// What leaves it: a score, which members loved a movie, and which group
// favorite a discovery is like. Blend members chose to share a blend, so who
// loved a movie is shown to them; nothing else about anyone's list is.
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
const MIN_BLEND_SCORE = 0.05
export const BLEND_REC_LIMIT = 40

// Catalog movies listed as similar to a group favorite become candidates too,
// linked at full strength. They cost no TMDb request. Adds the links to `links`
// (the map from mergeTmdbRecs) and returns the candidates.
export function addCatalogLinks(seeds, catalog, links) {
  const byId = new Map(catalog.map((m) => [m.id, m]))
  const candidates = new Map()
  const link = (a, b) => {
    if (!links.has(a)) links.set(a, new Map())
    links.get(a).set(b, 1)
  }
  for (const seed of seeds) {
    const source = catalog.find((m) => m.tmdb_id === seed.tmdb_id)
    for (const id of source?.similar ?? []) {
      const m = byId.get(id)
      if (!m || !Number.isInteger(m.tmdb_id)) continue
      const movie = { ...m, id: m.tmdb_id }
      candidates.set(movie.id, movie)
      link(seed.id, movie.id)
      link(movie.id, seed.id)
    }
  }
  return [...candidates.values()]
}

// The group's favorites to ask TMDb about, best first: movies members loved,
// ordered by their summed weight, so a movie two people loved beats one only
// one person loved. Only movies with a TMDb id count.
export function pickBlendSeeds(memberTiers, max = 15) {
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
// Returns [{ movie, score, lovedCount, lovedBy, memberCount, because }], best first:
//   lovedCount  members who put it in "Loved it"
//   lovedBy     their positions in memberTiers
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
    const lovedBy = []
    let vetoed = false
    let because = null
    let best = 0
    for (const [i, m] of members.entries()) {
      const w = m.weights.get(movie.id)
      if (w !== undefined) {
        rankedBy++
        if (w <= DISLIKE_WEIGHT) {
          vetoed = true
          break
        }
        if (w >= FAVORITE_WEIGHT) lovedBy.push(i)
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
    results.push({ movie, score, lovedCount: lovedBy.length, lovedBy, memberCount: n, because })
  }

  // Ties: better rated first, then title so the order is stable.
  return results.sort(
    (a, b) =>
      b.score - a.score || qualityPrior(b.movie) - qualityPrior(a.movie) || a.movie.title.localeCompare(b.movie.title),
  )
}

// The small line under a blend recommendation. members: [{ id, username }]
// turns lovedBy ids into names, like the For You page's "Loved by Ana and Ben".
export function blendRecLabel({ lovedCount, lovedBy = [], memberCount, because }, members = []) {
  const names = lovedBy.map((id) => members.find((m) => m.id === id)?.username).filter(Boolean)
  if (names.length === 1) return `Loved by ${names[0]}`
  if (names.length === 2) return `Loved by ${names[0]} and ${names[1]}`
  if (names.length > 2) return `Loved by ${names[0]} +${names.length - 1}`
  if (lovedCount > 0) return `Loved by ${lovedCount} of ${memberCount}`
  if (because) return `Like ${because}, a group favorite`
  return 'Your group should like this'
}

// Splits recommendations (scoreBlend order kept inside each section) into
// titled sections by how many members loved the movie: several, one, or
// nobody (discoveries). Empty sections are left out.
export function groupRecs(recs) {
  return [
    { id: 'several', title: 'Loved by several of you', items: recs.filter((r) => r.lovedCount >= 2) },
    { id: 'one', title: 'Loved by one of you', items: recs.filter((r) => r.lovedCount === 1) },
    { id: 'new', title: 'Discoveries for your group', items: recs.filter((r) => r.lovedCount === 0) },
  ].filter((s) => s.items.length)
}
