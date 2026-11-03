import { describe, it, expect } from 'vitest'
import { categoryOf, countByCategory, moviesUntilScores, scoreTiers, SCORE_UNLOCK } from '../../src/features/ranking/scores.js'

// n singleton tiers: [[m0], [m1], ...]
const singles = (n) => Array.from({ length: n }, (_, i) => [{ id: `m${i}` }])
const values = (scores) => [...scores.values()]

describe('scoreTiers', () => {
  it('stays locked below 10 movies', () => {
    expect(SCORE_UNLOCK).toBe(10)
    expect(scoreTiers([])).toBeNull()
    expect(scoreTiers(singles(9))).toBeNull()
  })

  it('unlocks at exactly 10 movies, counting tied movies individually', () => {
    expect(scoreTiers(singles(10))).not.toBeNull()
    const tied = [...singles(8), [{ id: 'x' }, { id: 'y' }]]
    expect(scoreTiers(tied)).not.toBeNull()
  })

  it('scores the top 10.0 and the bottom 1.0', () => {
    for (const n of [10, 25, 100, 500]) {
      const scores = scoreTiers(singles(n))
      expect(scores.get('m0')).toBe(10)
      expect(scores.get(`m${n - 1}`)).toBe(1)
    }
  })

  it('never increases going down the list and stays within 1-10', () => {
    const v = values(scoreTiers(singles(37)))
    for (let i = 1; i < v.length; i += 1) expect(v[i]).toBeLessThanOrEqual(v[i - 1])
    expect(Math.min(...v)).toBeGreaterThanOrEqual(1)
    expect(Math.max(...v)).toBeLessThanOrEqual(10)
  })

  it('spreads 10 movies evenly in steps of 1.0', () => {
    expect(values(scoreTiers(singles(10)))).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('gives tied movies the same score, averaged over their positions', () => {
    // 10 movies; positions 1 and 2 (0-based) are tied -> average of 9 and 8.
    const tiers = [[{ id: 'a' }], [{ id: 'b' }, { id: 'c' }], ...singles(7)]
    const scores = scoreTiers(tiers)
    expect(scores.get('b')).toBe(8.5)
    expect(scores.get('c')).toBe(8.5)
    expect(scores.get('a')).toBe(10)
  })

  it('rounds to one decimal place', () => {
    for (const s of values(scoreTiers(singles(13)))) expect(Math.round(s * 10) / 10).toBe(s)
  })

  it('handles a list that is entirely one tie', () => {
    const allTied = [Array.from({ length: 10 }, (_, i) => ({ id: `t${i}` }))]
    expect(new Set(values(scoreTiers(allTied)))).toEqual(new Set([5.5]))
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
    expect(categoryOf(1)).toBe('meh')
  })

  it('counts movies per category, with ties counted once each', () => {
    const tiers = Array.from({ length: 10 }, (_, i) => [{ id: `m${i}` }])
    tiers[0].push({ id: 'tied' }) // 11 movies, the top two tied
    const counts = countByCategory(scoreTiers(tiers))
    expect(counts.loved + counts.okay + counts.meh).toBe(11)
    // Scores: 9.6 (tied pair), 8.2, 7.3, 6.4 | 5.5, 4.6 | 3.7, 2.8, 1.9, 1.0
    expect(counts).toEqual({ loved: 5, okay: 2, meh: 4 })
  })

  it('is all zeros when scores are still locked', () => {
    expect(countByCategory(null)).toEqual({ loved: 0, okay: 0, meh: 0 })
  })
})
