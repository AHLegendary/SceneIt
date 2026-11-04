import { describe, it, expect } from 'vitest'
import {
  categoryOf,
  categoryOfMovie,
  categoryOffset,
  countByCategory,
  isCategory,
  moviesUntilScores,
  scoreTiers,
  SCORE_UNLOCK,
  tiersInCategory,
  TIER_LIST,
  tierListOf,
} from '../../src/features/ranking/scores.js'


// n singleton tiers in one category: [[m0], [m1], ...]
const cat = (category, n, prefix = category) =>
  Array.from({ length: n }, (_, i) => [{ id: `${prefix}${i}`, category }])

describe('scoreTiers', () => {
  it('stays locked below 10 movies', () => {
    expect(SCORE_UNLOCK).toBe(10)
    expect(scoreTiers([])).toBeNull()
    expect(scoreTiers(cat('loved', 9))).toBeNull()
  })

  it('unlocks at exactly 10 movies, counting tied movies individually', () => {
    expect(scoreTiers(cat('loved', 10))).not.toBeNull()
    const tied = [...cat('loved', 8), [{ id: 'x', category: 'okay' }, { id: 'y', category: 'okay' }]]
    expect(scoreTiers(tied)).not.toBeNull()
  })

  it('spreads each category across its own band, top to bottom', () => {
    const scores = scoreTiers([...cat('loved', 5), ...cat('okay', 2), ...cat('meh', 4)])
    expect(['loved0', 'loved1', 'loved2', 'loved3', 'loved4'].map((id) => scores.get(id))).toEqual([10, 9, 8, 7, 6])
    expect([scores.get('okay0'), scores.get('okay1')]).toEqual([5.9, 4])
    expect(['meh0', 'meh1', 'meh2', 'meh3'].map((id) => scores.get(id))).toEqual([3.9, 2.6, 1.3, 0])
  })

  it('gives a movie alone in its category the middle of the band', () => {
    const scores = scoreTiers([...cat('loved', 8), ...cat('okay', 1), ...cat('meh', 1)])
    expect(scores.get('okay0')).toBe(5)
    expect(scores.get('meh0')).toBe(2)
    const onlyLoved = scoreTiers([...cat('okay', 9), ...cat('loved', 1)])
    expect(onlyLoved.get('loved0')).toBe(8)
  })

  it('keeps every score inside its category band', () => {
    const tiers = [...cat('loved', 13), ...cat('okay', 7), ...cat('meh', 9)]
    const scores = scoreTiers(tiers)
    for (const [id, score] of scores) {
      if (id.startsWith('loved')) expect(score).toBeGreaterThanOrEqual(6)
      if (id.startsWith('okay')) expect(score >= 4 && score <= 5.9).toBe(true)
      if (id.startsWith('meh')) expect(score >= 0 && score <= 3.9).toBe(true)
    }
  })

  it('never increases going down a list ordered loved -> okay -> meh', () => {
    const tiers = [...cat('loved', 6), ...cat('okay', 4), ...cat('meh', 5)]
    const v = tiers.flat().map((m) => scoreTiers(tiers).get(m.id))
    for (let i = 1; i < v.length; i += 1) expect(v[i]).toBeLessThanOrEqual(v[i - 1])
  })

  it('gives tied movies the same score, averaged over their positions', () => {
    // Loved: a, (b, c tied), d, e -> 10, 8, 8, 7... (5 movies, steps of 1.0)
    const tiers = [
      [{ id: 'a', category: 'loved' }],
      [{ id: 'b', category: 'loved' }, { id: 'c', category: 'loved' }],
      ...cat('loved', 2),
      ...cat('meh', 5),
    ]
    const scores = scoreTiers(tiers)
    expect(scores.get('a')).toBe(10)
    expect(scores.get('b')).toBe(8.5)
    expect(scores.get('c')).toBe(8.5)
  })

  it('handles a category that is entirely one tie (middle of the band)', () => {
    const allTied = [Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, category: 'okay' }))]
    expect(new Set(scoreTiers(allTied).values())).toEqual(new Set([5]))
  })

  it('rounds to one decimal place', () => {
    for (const s of scoreTiers([...cat('loved', 7), ...cat('okay', 6)]).values()) expect(Math.round(s * 10) / 10).toBe(s)
  })

  it('treats movies without a category as "It was okay"', () => {
    const scores = scoreTiers(Array.from({ length: 10 }, (_, i) => [{ id: `m${i}` }]))
    expect(scores.get('m0')).toBe(5.9)
    expect(scores.get('m9')).toBe(4)
  })
})

describe('moviesUntilScores', () => {
  it('counts down to zero', () => {
    expect(moviesUntilScores(0)).toBe(10)
    expect(moviesUntilScores(7)).toBe(3)
    expect(moviesUntilScores(10)).toBe(0)
    expect(moviesUntilScores(40)).toBe(0)
  })
})

describe('score categories', () => {
  it('puts scores in the right category at the edges', () => {
    expect(categoryOf(10)).toBe('loved')
    expect(categoryOf(6)).toBe('loved')
    expect(categoryOf(5.9)).toBe('okay')
    expect(categoryOf(4)).toBe('okay')
    expect(categoryOf(3.9)).toBe('meh')
    expect(categoryOf(0)).toBe('meh')
  })

  it('counts movies per stored category, with tied movies counted once each', () => {
    const tiers = [...cat('loved', 3), ...cat('okay', 1), ...cat('meh', 2)]
    tiers[0].push({ id: 'tied', category: 'loved' })
    expect(countByCategory(tiers)).toEqual({ loved: 4, okay: 1, meh: 2 })
  })

  it('is all zeros for an empty list', () => {
    expect(countByCategory([])).toEqual({ loved: 0, okay: 0, meh: 0 })
    expect(countByCategory(null)).toEqual({ loved: 0, okay: 0, meh: 0 })
  })

  it('validates category ids', () => {
    expect(isCategory('loved')).toBe(true)
    expect(isCategory('great')).toBe(false)
    expect(categoryOfMovie({ category: 'meh' })).toBe('meh')
    expect(categoryOfMovie({})).toBe('okay')
  })
})

describe('category slices of a list', () => {
  const tiers = [...cat('loved', 2), ...cat('okay', 3), ...cat('meh', 1)]

  it('picks out one category, best first', () => {
    expect(tiersInCategory(tiers, 'okay').flat().map((m) => m.id)).toEqual(['okay0', 'okay1', 'okay2'])
    expect(tiersInCategory(tiers, 'meh')).toHaveLength(1)
    expect(tiersInCategory(cat('loved', 3), 'meh')).toEqual([])
  })

  it('finds where each category starts in the whole list', () => {
    expect(categoryOffset(tiers, 'loved')).toBe(0)
    expect(categoryOffset(tiers, 'okay')).toBe(2)
    expect(categoryOffset(tiers, 'meh')).toBe(5)
    // Empty categories still have a place: an "okay" movie in a loved/meh list
    // goes between them.
    expect(categoryOffset([...cat('loved', 2), ...cat('meh', 2)], 'okay')).toBe(2)
  })
})

describe('tierListOf', () => {
  const m = (id, category = 'okay') => ({ id, title: id, category })
  it('always returns every row S to F, in order', () => {
    const rows = tierListOf([])
    expect(rows.map((r) => r.id)).toEqual(TIER_LIST.map((t) => t.id))
    expect(rows.every((r) => r.movies.length === 0)).toBe(true)
  })
  it('puts the top of Loved it in S and the bottom of Not a fan in F, even before scores unlock', () => {
    const tiers = [[m('a', 'loved')], [m('b', 'loved')], [m('c')], [m('d', 'meh')], [m('e', 'meh')]]
    const rows = Object.fromEntries(tierListOf(tiers).map((r) => [r.id, r.movies.map((x) => x.id)]))
    expect(rows.S).toEqual(['a'])
    expect(rows.F).toEqual(['d', 'e'])
  })
  it('keeps tied movies in the same row', () => {
    const tiers = Array.from({ length: 12 }, (_, i) => [m(`m${i}`)])
    tiers[0] = [m('x'), m('y')]
    const rows = tierListOf(tiers)
    const row = rows.find((r) => r.movies.some((v) => v.id === 'x'))
    expect(row.movies.map((v) => v.id)).toContain('y')
    expect(rows.flatMap((r) => r.movies)).toHaveLength(13)
  })
  it('a lone movie sits in the middle of its category band', () => {
    expect(tierListOf([[m('only', 'loved')]]).find((r) => r.id === 'A').movies).toHaveLength(1)
  })
})
