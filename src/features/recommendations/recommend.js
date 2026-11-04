// Personalized recommendations from a user's ranked list.
//
// Every candidate movie gets a score from how related it is to the movies the
// user has ranked, weighted by where they ranked them: relatives of top
// movies count for it, relatives of bottom movies count against it.
//
// Candidates come from two places:
//   * the local catalog (src/data/movies.json), always available
//   * TMDb's recommendations for a handful of the user's top and bottom
//     movies (pickSeeds -> /api/movies/recommendations -> mergeTmdbRecs),
//     which reaches any movie on TMDb, not just the catalog
//
// Two movies are related when TMDb recommends one for the other (a "link",
// stronger the higher TMDb lists it) and, more weakly, when they share
// genres. Links come from TMDb responses and from the catalog's `similar`
// field (filled by npm run movie-data), so scoring still works offline.
//
// Pure functions: no React, no storage, no fetching. Recommendations unlock
// at 15 ranked movies, matching the design doc.

export const RECS_UNLOCK = 15
const SIMILAR_WEIGHT = 1
const GENRE_WEIGHT = 0.5
// TMDb's last-listed recommendation keeps this fraction of the link weight.
const LAST_LINK_STRENGTH = 0.5
// TMDb recommendations with fewer votes than this are too obscure to suggest.
export const MIN_TMDB_VOTES = 100

// Weight of each ranked movie from its position: +1 at the top, -1 at the
// bottom, 0 in the middle. Tied movies share the weight of their tier.
export function positionWeights(tiers) {
  const total = tiers.reduce((n, tier) => n + tier.length, 0)
  const weights = new Map()
  let start = 0
  for (const tier of tiers) {
    const middle = start + (tier.length - 1) / 2
    const w = total > 1 ? 1 - (2 * middle) / (total - 1) : 1
    for (const movie of tier) weights.set(movie.id, w)
    start += tier.length
  }
  return weights
}

// Which ranked movies to ask TMDb about: the top `top` and, when the list is
// long enough to have real dislikes, the bottom `bottom`. Only movies with a
// TMDb id count. Returns { likes, dislikes }, each a list of movies.
export function pickSeeds(tiers, { top = 8, bottom = 4 } = {}) {
  const weights = positionWeights(tiers)
  const ranked = tiers.flat().filter((m) => Number.isInteger(m.tmdb_id) && m.tmdb_id > 0)
  const likes = ranked.filter((m) => weights.get(m.id) > 0).slice(0, top)
  const dislikes = ranked.filter((m) => weights.get(m.id) < 0).slice(-bottom).reverse()
  return { likes, dislikes: bottom > 0 ? dislikes : [] }
}

// Turns /api/movies/recommendations results into scoring input.
//   results    [{ seed: tmdbId, movies: [row, ...] }] from getRecommendations
//   seedsByTmdb  Map of TMDb id -> the ranked movie it was asked for
//   toMovie    row -> app movie object (movieFromDb), so ids match the rest
//              of the app; returning null drops the row
// Returns { candidates, links }, where links maps movie id -> Map of related
// movie id -> link strength (1 for TMDb's first pick, down to 0.5 for its
// last). Links go both ways.
export function mergeTmdbRecs(results, seedsByTmdb, toMovie, { minVotes = MIN_TMDB_VOTES } = {}) {
  const candidates = new Map()
  const links = new Map()
  const addLink = (a, b, strength) => {
    if (a === b) return
    if (!links.has(a)) links.set(a, new Map())
    const current = links.get(a).get(b) ?? 0
    links.get(a).set(b, Math.max(current, strength))
  }

  for (const { seed, movies = [] } of results ?? []) {
    const seedMovie = seedsByTmdb.get(seed)
    if (!seedMovie) continue
    const n = movies.length
    movies.forEach((row, i) => {
      if (row.tmdb_votes != null && row.tmdb_votes < minVotes) return
      const movie = toMovie(row)
      if (!movie) return
      if (row.tmdb_rating != null && movie.tmdb_rating == null) movie.tmdb_rating = row.tmdb_rating
      if (row.tmdb_votes != null && movie.tmdb_votes == null) movie.tmdb_votes = row.tmdb_votes
      const strength = n > 1 ? 1 - ((1 - LAST_LINK_STRENGTH) * i) / (n - 1) : 1
      addLink(seedMovie.id, movie.id, strength)
      addLink(movie.id, seedMovie.id, strength)
      candidates.set(movie.id, movie)
    })
  }
  return { candidates: [...candidates.values()], links }
}

// TMDb link strength between two movies, 0 to 1: from fetched links when
// there are any, otherwise from the catalog's `similar` lists.
export function linkStrength(a, b, links) {
  const fetched = Math.max(links?.get(a.id)?.get(b.id) ?? 0, links?.get(b.id)?.get(a.id) ?? 0)
  const catalog = a.similar?.includes(b.id) || b.similar?.includes(a.id) ? 1 : 0
  return Math.max(fetched, catalog)
}

// How related two movies are, from 0 (not at all) up to 1.5.
export function relatedness(a, b, links) {
  const link = linkStrength(a, b, links)
  const ga = new Set(a.genres ?? [])
  const gb = new Set(b.genres ?? [])
  const shared = [...ga].filter((g) => gb.has(g)).length
  const union = new Set([...ga, ...gb]).size
  const genre = union ? shared / union : 0
  return SIMILAR_WEIGHT * link + GENRE_WEIGHT * genre
}

// Scores every unranked candidate. `links` is the map from mergeTmdbRecs
// (optional). Returns [{ movie, score, because }] sorted best first, where
// `because` is the ranked movie that helped most. Only movies with a
// positive score are returned, and each movie at most once.
export function scoreCandidates(tiers, candidates, links) {
  const ranked = tiers.flat()
  const rankedIds = new Set(ranked.map((m) => m.id))
  const weights = positionWeights(tiers)
  const results = []
  const seen = new Set()

  for (const movie of candidates) {
    if (rankedIds.has(movie.id) || seen.has(movie.id)) continue
    seen.add(movie.id)
    let score = 0
    let because = null
    let best = 0
    for (const r of ranked) {
      const contribution = weights.get(r.id) * relatedness(r, movie, links)
      score += contribution
      if (contribution > best) {
        best = contribution
        because = r
      }
    }
    if (score > 0) results.push({ movie, score, because })
  }

  // Ties broken by title so the order is stable between renders.
  return results.sort((a, b) => b.score - a.score || a.movie.title.localeCompare(b.movie.title))
}

// The recommendations page: a top-picks row plus "Because you ranked X
// highly" rows for the user's favorites. Movies don't repeat across rows.
// `candidates` is the catalog plus any TMDb candidates; `links` comes from
// mergeTmdbRecs. Returns { locked: true, remaining } until RECS_UNLOCK
// movies are ranked.
export function buildRecommendations(
  tiers,
  candidates,
  { links, unlockAt = RECS_UNLOCK, perRow = 6, becauseRows = 3 } = {},
) {
  const count = tiers.reduce((n, tier) => n + tier.length, 0)
  if (count < unlockAt) return { locked: true, remaining: unlockAt - count }

  const scored = scoreCandidates(tiers, candidates, links)
  const used = new Set()
  const take = (items) => {
    const picked = items.filter((s) => !used.has(s.movie.id)).slice(0, perRow)
    picked.forEach((s) => used.add(s.movie.id))
    return picked
  }

  const rows = []
  const top = take(scored)
  if (top.length) rows.push({ id: 'top', title: 'Top picks for you', items: top })

  // Favorites = the user's top-ranked movies, best first.
  for (const fav of tiers.flat().slice(0, becauseRows)) {
    // Movies TMDb links to this favorite first, then genre relatives.
    const linked = scored.filter((s) => linkStrength(fav, s.movie, links) > 0)
    const genreOnly = scored.filter((s) => !linkStrength(fav, s.movie, links) && relatedness(fav, s.movie, links) > 0)
    const items = take([...linked, ...genreOnly])
    if (items.length) rows.push({ id: `because-${fav.id}`, title: `Because you ranked ${fav.title} highly`, items, because: fav })
  }

  return { locked: false, rows }
}
