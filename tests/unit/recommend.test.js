import { describe, it, expect } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import {
  buildRecommendations,
  FRIEND_WEIGHT,
  friendAffinity,
  friendSignals,
  mergeTmdbRecs,
  pickSeeds,
  positionWeights,
  qualityPrior,
  rankWeights,
  saturate,
  recLabel,
  RECS_UNLOCK,
  relatedness,
  scoreCandidates,
  tasteSimilarity,
} from '../../src/features/recommendations/recommend.js'

const movie = (id, genres = [], similar = []) => ({ id, title: id, genres, similar })
const singles = (movies) => movies.map((m) => [m])
const ids = (items) => items.map((s) => s.movie.id)

describe('positionWeights', () => {
  it('runs from +1 at the top to -1 at the bottom', () => {
    const w = positionWeights(singles([movie('a'), movie('b'), movie('c')]))
    expect([...w.values()]).toEqual([1, 0, -1])
  })

  it('gives tied movies the weight of their shared position', () => {
    const w = positionWeights([[movie('a')], [movie('b'), movie('c')], [movie('d')]])
    expect(w.get('b')).toBeCloseTo(w.get('c'))
    expect(w.get('b')).toBeGreaterThan(w.get('d'))
    expect(w.get('b')).toBeLessThan(w.get('a'))
  })

  it('treats a single movie as a favorite', () => {
    expect(positionWeights([[movie('a')]]).get('a')).toBe(1)
  })
})

describe('relatedness', () => {
  it('is strongest for a TMDb recommendation link, in either direction', () => {
    const a = movie('a', ['Drama'], ['b'])
    const b = movie('b', ['Comedy'])
    expect(relatedness(a, b)).toBe(1)
    expect(relatedness(b, a)).toBe(1)
  })

  it('adds genre overlap on top', () => {
    expect(relatedness(movie('a', ['Drama', 'Romance']), movie('b', ['Drama', 'Romance']))).toBe(0.5)
    expect(relatedness(movie('a', ['Drama']), movie('b', ['Drama', 'Romance']))).toBe(0.25)
  })

  it('is zero for unrelated movies or missing data', () => {
    expect(relatedness(movie('a', ['Horror']), movie('b', ['Family']))).toBe(0)
    expect(relatedness({ id: 'a' }, { id: 'b' })).toBe(0)
  })
})

describe('scoreCandidates', () => {
  // Liked: space movies. Disliked: horror.
  const liked = movie('liked', ['Science Fiction'], ['space-2'])
  const middle = movie('middle', ['Comedy'])
  const disliked = movie('disliked', ['Horror'], ['scary-2'])
  const catalog = [
    liked,
    middle,
    disliked,
    movie('space-2', ['Science Fiction']),
    movie('scary-2', ['Horror']),
    movie('other-scifi', ['Science Fiction', 'Drama']),
    movie('unrelated', ['Documentary']),
  ]
  const tiers = singles([liked, middle, disliked])

  it('never recommends a movie that is already ranked', () => {
    const recommended = ids(scoreCandidates(tiers, catalog))
    for (const id of ['liked', 'middle', 'disliked']) expect(recommended).not.toContain(id)
  })

  it('ranks relatives of top movies first and drops relatives of bottom ones', () => {
    const recommended = ids(scoreCandidates(tiers, catalog))
    expect(recommended[0]).toBe('space-2')
    expect(recommended).toContain('other-scifi')
    expect(recommended).not.toContain('scary-2')
    expect(recommended).not.toContain('unrelated')
  })

  it('names the ranked movie that contributed most', () => {
    const top = scoreCandidates(tiers, catalog)[0]
    expect(top.because.id).toBe('liked')
  })

  it('still works from genres alone when there is no TMDb data', () => {
    const plain = catalog.map(({ similar: _similar, ...m }) => m)
    const plainTiers = singles(plain.slice(0, 3))
    expect(ids(scoreCandidates(plainTiers, plain))[0]).toBe('space-2')
  })

  it('is stable between calls', () => {
    expect(ids(scoreCandidates(tiers, catalog))).toEqual(ids(scoreCandidates(tiers, catalog)))
  })
})

describe('buildRecommendations', () => {
  it(`stays locked until ${RECS_UNLOCK} movies are ranked, counting tied movies`, () => {
    expect(RECS_UNLOCK).toBe(15)
    expect(buildRecommendations(singles(MOVIES.slice(0, 14)), MOVIES)).toEqual({ locked: true, remaining: 1 })
    const withTie = [[MOVIES[0], MOVIES[1]], ...singles(MOVIES.slice(2, 15))]
    expect(buildRecommendations(withTie, MOVIES).locked).toBe(false)
  })

  it('builds a top-picks row and "because" rows from the real catalog', () => {
    const result = buildRecommendations(singles(MOVIES.slice(0, 15)), MOVIES)
    expect(result.locked).toBe(false)
    expect(result.rows[0].id).toBe('top')
    expect(result.rows[0].items.length).toBeGreaterThan(0)
    expect(result.rows.some((r) => r.title.startsWith('Because you ranked'))).toBe(true)
  })

  it('never repeats a movie across rows or recommends a ranked one', () => {
    const ranked = MOVIES.slice(0, 15)
    const result = buildRecommendations(singles(ranked), MOVIES)
    const shown = result.rows.flatMap((r) => ids(r.items))
    expect(new Set(shown).size).toBe(shown.length)
    for (const m of ranked) expect(shown).not.toContain(m.id)
  })

  it('respects the row size', () => {
    const result = buildRecommendations(singles(MOVIES.slice(0, 15)), MOVIES, { perRow: 3 })
    for (const row of result.rows) expect(row.items.length).toBeLessThanOrEqual(3)
  })

  it('returns no rows when everything has been ranked', () => {
    expect(buildRecommendations(singles(MOVIES), MOVIES)).toEqual({ locked: false, rows: [] })
  })
})

describe('pickSeeds', () => {
  const withTmdb = (n) => Array.from({ length: n }, (_, i) => ({ ...movie(`m${i}`), tmdb_id: i + 1 }))

  it('takes the top movies as likes and the bottom ones as dislikes, worst first', () => {
    const { likes, dislikes } = pickSeeds(singles(withTmdb(20)), { top: 3, bottom: 2 })
    expect(likes.map((m) => m.id)).toEqual(['m0', 'm1', 'm2'])
    expect(dislikes.map((m) => m.id)).toEqual(['m19', 'm18'])
  })

  it('skips movies without a TMDb id', () => {
    const list = withTmdb(5)
    delete list[0].tmdb_id
    expect(pickSeeds(singles(list), { top: 1 }).likes[0].id).toBe('m1')
  })

  it('never uses a middle movie as a seed', () => {
    const { likes, dislikes } = pickSeeds(singles(withTmdb(3)), { top: 5, bottom: 5 })
    expect(likes.map((m) => m.id)).toEqual(['m0'])
    expect(dislikes.map((m) => m.id)).toEqual(['m2'])
  })
})

describe('mergeTmdbRecs', () => {
  const seed = { ...movie('seed', ['Drama']), tmdb_id: 1 }
  const row = (tmdb_id, extra = {}) => ({ tmdb_id, title: `T${tmdb_id}`, genres: ['Drama'], tmdb_votes: 500, ...extra })
  const toMovie = (r) => ({ id: `tmdb-${r.tmdb_id}`, title: r.title, genres: r.genres, tmdb_id: r.tmdb_id })
  const seeds = new Map([[1, seed]])

  it('links each recommendation to its seed both ways, stronger for higher picks', () => {
    const { candidates, links } = mergeTmdbRecs([{ seed: 1, movies: [row(10), row(11), row(12)] }], seeds, toMovie)
    expect(candidates.map((m) => m.id)).toEqual(['tmdb-10', 'tmdb-11', 'tmdb-12'])
    expect(links.get('seed').get('tmdb-10')).toBe(1)
    expect(links.get('seed').get('tmdb-12')).toBe(0.5)
    expect(links.get('tmdb-11').get('seed')).toBeCloseTo(0.75)
  })

  it('drops obscure titles, unknown seeds and rows toMovie rejects', () => {
    const { candidates } = mergeTmdbRecs(
      [{ seed: 1, movies: [row(10, { tmdb_votes: 3 }), row(11), row(12)] }, { seed: 99, movies: [row(20)] }],
      seeds,
      (r) => (r.tmdb_id === 12 ? null : toMovie(r)),
    )
    expect(candidates.map((m) => m.id)).toEqual(['tmdb-11'])
  })

  it('keeps one candidate when two seeds recommend the same movie, with the stronger link', () => {
    const other = { ...movie('other'), tmdb_id: 2 }
    const { candidates, links } = mergeTmdbRecs(
      [{ seed: 1, movies: [row(5), row(10)] }, { seed: 2, movies: [row(10)] }],
      new Map([[1, seed], [2, other]]),
      toMovie,
    )
    expect(candidates).toHaveLength(2)
    expect(links.get('tmdb-10').get('seed')).toBe(0.5)
    expect(links.get('tmdb-10').get('other')).toBe(1)
  })
})

describe('scoring with TMDb links', () => {
  const ranked = Array.from({ length: 15 }, (_, i) => ({ ...movie(`r${i}`, ['Drama']), tmdb_id: i + 1 }))
  const tiers = singles(ranked)
  const toMovie = (r) => ({ id: `tmdb-${r.tmdb_id}`, title: r.title, genres: r.genres, tmdb_id: r.tmdb_id })
  const seedsByTmdb = new Map(ranked.map((m) => [m.tmdb_id, m]))

  it('recommends movies outside the catalog that TMDb links to favorites', () => {
    const { candidates, links } = mergeTmdbRecs(
      [{ seed: 1, movies: [{ tmdb_id: 500, title: 'Fresh', genres: ['Comedy'], tmdb_votes: 1000 }] }],
      seedsByTmdb,
      toMovie,
    )
    const scored = scoreCandidates(tiers, candidates, { links })
    expect(scored[0].movie.id).toBe('tmdb-500')
    expect(scored[0].because.id).toBe('r0')
  })

  it('pushes down movies TMDb links to disliked ones', () => {
    const { candidates, links } = mergeTmdbRecs(
      [{ seed: 15, movies: [{ tmdb_id: 600, title: 'Nope', genres: ['Comedy'], tmdb_votes: 1000 }] }],
      seedsByTmdb,
      toMovie,
    )
    expect(ids(scoreCandidates(tiers, candidates, { links }))).not.toContain('tmdb-600')
  })

  it('fills "because" rows with movies linked to that favorite first', () => {
    const linked = [700, 701, 702].map((tmdb_id) => ({ tmdb_id, title: `L${tmdb_id}`, genres: ['Comedy'], tmdb_votes: 1000 }))
    const { candidates, links } = mergeTmdbRecs([{ seed: 2, movies: linked }], seedsByTmdb, toMovie)
    const genreMatches = Array.from({ length: 6 }, (_, i) => movie(`g${i}`, ['Drama']))
    // The top row takes the two strongest links; r1's row should get the third, not a genre match.
    const result = buildRecommendations(tiers, [...genreMatches, ...candidates], { links, perRow: 2 })
    const row = result.rows.find((r) => r.id === 'because-r1')
    expect(ids(row.items)[0]).toBe('tmdb-702')
  })
})

describe('tasteSimilarity', () => {
  const list = Array.from({ length: 10 }, (_, i) => movie(`m${i}`))

  it('is positive for the same order and negative for the reverse', () => {
    const same = tasteSimilarity(singles(list), singles(list))
    const reversed = tasteSimilarity(singles(list), singles([...list].reverse()))
    expect(same.shared).toBe(10)
    expect(same.similarity).toBeGreaterThan(0.6)
    expect(reversed.similarity).toBeCloseTo(-same.similarity)
  })

  it('trusts a few shared movies less than many', () => {
    const few = tasteSimilarity(singles(list.slice(0, 3)), singles(list.slice(0, 3)))
    const many = tasteSimilarity(singles(list), singles(list))
    expect(few.similarity).toBeLessThan(many.similarity)
  })

  it('is zero with nothing in common', () => {
    expect(tasteSimilarity(singles([movie('a')]), singles([movie('b')]))).toEqual({ similarity: 0, shared: 0 })
  })
})

describe('friendAffinity', () => {
  it('starts friends at a base weight and moves with similarity', () => {
    expect(friendAffinity(0)).toBe(0.25)
    expect(friendAffinity(1)).toBe(1)
    expect(friendAffinity(-1)).toBe(0)
    expect(friendAffinity(0.5)).toBeGreaterThan(friendAffinity(0))
  })
})

describe('friend recommendations', () => {
  // I like sci-fi; my list has 15 movies so recommendations unlock.
  const mine = Array.from({ length: 15 }, (_, i) => movie(`me${i}`, ['Science Fiction']))
  const tiers = singles(mine)
  const hit = movie('hit', ['Comedy'])
  const flop = movie('flop', ['Comedy'])
  // Alex agrees with me on my movies, loves `hit`, hates `flop`.
  const alex = { id: 'u1', username: 'alex', tiers: singles([mine[0], hit, mine[1], mine[13], flop, mine[14]]) }

  it('turns friends\' top-half movies into candidates', () => {
    const signals = friendSignals(tiers, [alex])
    expect(signals.candidates.map((m) => m.id)).toContain('hit')
    expect(signals.candidates.map((m) => m.id)).not.toContain('flop')
    expect(signals.friends[0]).toMatchObject({ username: 'alex', shared: 4 })
    expect(signals.friends[0].affinity).toBeGreaterThan(0.25)
  })

  it('boosts what friends love, sinks what they dislike, and credits the friend', () => {
    const signals = friendSignals(tiers, [alex])
    const scored = scoreCandidates(tiers, [hit, flop], { friends: signals })
    expect(ids(scored)).toEqual(['hit'])
    expect(scored[0]).toMatchObject({ becauseFriend: 'alex', fans: ['alex'] })
    expect(scored[0].friendScore).toBeGreaterThan(0)
    expect(scored[0].friendScore).toBeLessThanOrEqual(FRIEND_WEIGHT)
  })

  it('ignores friends with opposite taste', () => {
    const contrarian = { id: 'u2', username: 'cole', tiers: singles([...mine].reverse().concat(hit)) }
    const signals = friendSignals(tiers, [contrarian])
    expect(signals.friends[0].affinity).toBeLessThan(0.25)
  })

  it('never recommends something I already ranked, even if a friend loves it', () => {
    const signals = friendSignals(tiers, [alex])
    expect(ids(scoreCandidates(tiers, mine, { friends: signals }))).toEqual([])
  })

  it('adds a "Your friends loved these" row', () => {
    const others = Array.from({ length: 6 }, (_, i) => movie(`sf${i}`, ['Science Fiction']))
    const result = buildRecommendations(tiers, others, { friends: friendSignals(tiers, [alex]), perRow: 2 })
    const row = result.rows.find((r) => r.id === 'friends')
    expect(row.title).toBe('Your friends loved these')
    const shown = result.rows.flatMap((r) => ids(r.items))
    expect(shown).toContain('hit')
    expect(new Set(shown).size).toBe(shown.length)
  })

  it('works the same as before with no friends', () => {
    expect(buildRecommendations(tiers, [hit], { friends: friendSignals(tiers, []) })).toEqual(
      buildRecommendations(tiers, [hit]),
    )
  })
})

describe('recLabel', () => {
  const m = { id: 'x', title: 'X', year: 2020 }
  it('names friends in the friends row', () => {
    expect(recLabel({ movie: m, fans: ['a'] }, 'friends')).toBe('Loved by a')
    expect(recLabel({ movie: m, fans: ['a', 'b'] }, 'friends')).toBe('Loved by a and b')
    expect(recLabel({ movie: m, fans: ['a', 'b', 'c'] }, 'friends')).toBe('Loved by a +2')
  })
  it('explains top picks by friend or by movie, else shows the year', () => {
    expect(recLabel({ movie: m, becauseFriend: 'a', because: { title: 'Y' } }, 'top')).toBe('a loved it')
    expect(recLabel({ movie: m, because: { title: 'Y' } }, 'top')).toBe('Because you liked Y')
    expect(recLabel({ movie: m, because: { title: 'Y' } }, 'because-y')).toBe(2020)
  })
})

describe('rankWeights (categories)', () => {
  const cat = (id, category, genres = []) => ({ ...movie(id, genres), category })

  it('spreads each category across its own weight band', () => {
    const tiers = singles([cat('l1', 'loved'), cat('l2', 'loved'), cat('o1', 'okay'), cat('o2', 'okay'), cat('m1', 'meh'), cat('m2', 'meh')])
    const w = rankWeights(tiers)
    expect(w.get('l1')).toBe(1)
    expect(w.get('l2')).toBe(0.5)
    expect(w.get('o1')).toBeCloseTo(0.2)
    expect(w.get('o2')).toBeCloseTo(-0.2)
    expect(w.get('m1')).toBe(-0.5)
    expect(w.get('m2')).toBe(-1)
  })

  it("doesn't punish a list that's mostly loved", () => {
    // 9 loved, 1 meh: the 9th loved movie still counts strongly for.
    const loved = Array.from({ length: 9 }, (_, i) => cat(`l${i}`, 'loved'))
    const w = rankWeights(singles([...loved, cat('m', 'meh')]))
    expect(w.get('l8')).toBe(0.5)
    expect(positionWeights(singles([...loved, cat('m', 'meh')])).get('l8')).toBeLessThan(0)
  })

  it('gives a movie alone in its category the middle of the band, and ties a shared weight', () => {
    const w = rankWeights([[cat('l', 'loved')], [cat('o1', 'okay'), cat('o2', 'okay')], [cat('m', 'meh')]])
    expect(w.get('l')).toBe(0.75)
    expect(w.get('o1')).toBe(0)
    expect(w.get('o2')).toBe(0)
    expect(w.get('m')).toBe(-0.75)
  })

  it('falls back to position weights for lists without categories', () => {
    const tiers = singles([movie('a'), movie('b'), movie('c')])
    expect([...rankWeights(tiers).values()]).toEqual([1, 0, -1])
  })

  it('seeds TMDb with loved movies and only real dislikes', () => {
    const list = [cat('l', 'loved'), cat('o1', 'okay'), cat('o2', 'okay'), cat('m', 'meh')].map((m, i) => ({ ...m, tmdb_id: i + 1 }))
    const { likes, dislikes } = pickSeeds(singles(list), { top: 8, bottom: 4 })
    expect(likes.map((m) => m.id)).toEqual(['l', 'o1'])
    expect(dislikes.map((m) => m.id)).toEqual(['m'])
  })

  it('scores by category: relatives of loved movies up, of "Not a fan" ones out', () => {
    const tiers = singles([
      ...Array.from({ length: 12 }, (_, i) => cat(`l${i}`, 'loved', ['Science Fiction'])),
      cat('o', 'okay', ['Comedy']),
      cat('m1', 'meh', ['Horror']),
      cat('m2', 'meh', ['Horror']),
    ])
    const scored = scoreCandidates(tiers, [movie('sf', ['Science Fiction']), movie('scary', ['Horror'])])
    expect(ids(scored)).toEqual(['sf'])
  })

  it('only treats a friend\'s "Loved it" movies as their picks', () => {
    const mine = Array.from({ length: 15 }, (_, i) => cat(`me${i}`, 'loved'))
    const friend = { id: 'u', username: 'alex', tiers: singles([cat('fav', 'loved'), cat('fine', 'okay'), cat('bad', 'meh')]) }
    const signals = friendSignals(singles(mine), [friend])
    expect(signals.candidates.map((m) => m.id)).toEqual(['fav'])
    const scored = scoreCandidates(singles(mine), [movie('fav'), movie('fine')], { friends: signals })
    expect(scored.find((s) => s.movie.id === 'fav').fans).toEqual(['alex'])
    expect(scored.find((s) => s.movie.id === 'fine')?.fans ?? []).toEqual([])
  })

  it('builds "Because you ranked" rows only from loved movies', () => {
    const tiers = singles([
      cat('fav', 'loved', ['Drama']),
      ...Array.from({ length: 14 }, (_, i) => cat(`o${i}`, 'okay', ['Drama'])),
    ])
    const result = buildRecommendations(tiers, [movie('d1', ['Drama']), movie('d2', ['Drama'])], { perRow: 1 })
    const because = result.rows.filter((r) => r.id.startsWith('because-')).map((r) => r.id)
    expect(because.every((id) => id === 'because-fav')).toBe(true)
  })
})

describe('normalized scoring', () => {
  const cat = (id, category, genres = []) => ({ ...movie(id, genres), category })
  const lovedSciFi = (n) => Array.from({ length: n }, (_, i) => cat(`l${i}`, 'loved', ['Science Fiction']))

  it('saturate squashes into -1..1 and keeps the sign', () => {
    expect(saturate(0)).toBe(0)
    expect(saturate(1)).toBeCloseTo(0.632, 3)
    expect(saturate(-1)).toBeCloseTo(-0.632, 3)
    expect(saturate(100)).toBeLessThanOrEqual(1)
    expect(saturate(2) - saturate(1)).toBeLessThan(saturate(1))
  })

  it('qualityPrior rewards well-rated movies and distrusts ratings with few votes', () => {
    expect(qualityPrior({ tmdb_rating: 8.5, tmdb_votes: 100000 })).toBeCloseTo(1, 1)
    expect(qualityPrior({ tmdb_rating: 6.5, tmdb_votes: 100000 })).toBeCloseTo(0)
    expect(qualityPrior({ tmdb_rating: 4.5, tmdb_votes: 100000 })).toBeCloseTo(-1, 1)
    expect(qualityPrior({ tmdb_rating: 9, tmdb_votes: 10 })).toBeLessThan(0.1)
    expect(qualityPrior({ ratings: { imdb: 8.5, imdb_votes: 900000 } })).toBeCloseTo(1, 1)
    expect(qualityPrior({})).toBe(0)
  })

  it('gives the same genre score for a short list and a long one', () => {
    const candidate = movie('sf', ['Science Fiction'])
    const short = scoreCandidates(singles(lovedSciFi(15)), [candidate])[0].score
    const long = scoreCandidates(singles(lovedSciFi(60)), [candidate])[0].score
    expect(long).toBeCloseTo(short, 5)
  })

  it("keeps friends' picks competitive with a long list of your own", () => {
    const mine = lovedSciFi(60)
    const friend = { id: 'u', username: 'alex', tiers: singles([...mine.slice(0, 10), cat('pick', 'loved', ['Comedy'])]) }
    const signals = friendSignals(singles(mine), [friend])
    const scored = scoreCandidates(singles(mine), [movie('pick', ['Comedy']), movie('sf', ['Science Fiction'])], { friends: signals })
    const pick = scored.find((s) => s.movie.id === 'pick')
    const sf = scored.find((s) => s.movie.id === 'sf')
    expect(pick).toBeTruthy()
    expect(pick.score).toBeGreaterThan(sf.score * 0.4)
  })

  it('keeps every part between -1 and 1', () => {
    const tiers = singles(lovedSciFi(15))
    const links = new Map([['x', new Map(tiers.flat().map((m) => [m.id, 1]))]])
    const [top] = scoreCandidates(tiers, [{ ...movie('x', ['Science Fiction']), tmdb_rating: 9, tmdb_votes: 1e6 }], { links })
    for (const value of Object.values(top.parts)) {
      expect(value).toBeGreaterThanOrEqual(-1)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('breaks ties with the better-rated movie', () => {
    const tiers = singles(lovedSciFi(15))
    const good = { ...movie('b-good', ['Science Fiction']), tmdb_rating: 8.4, tmdb_votes: 50000 }
    const meh = { ...movie('a-meh', ['Science Fiction']), tmdb_rating: 5.5, tmdb_votes: 50000 }
    expect(ids(scoreCandidates(tiers, [meh, good]))).toEqual(['b-good', 'a-meh'])
  })

  it('never recommends a movie on rating alone', () => {
    const tiers = singles(lovedSciFi(15))
    const acclaimed = { ...movie('doc', ['Documentary']), tmdb_rating: 9, tmdb_votes: 1e6 }
    expect(ids(scoreCandidates(tiers, [acclaimed]))).toEqual([])
  })
})
