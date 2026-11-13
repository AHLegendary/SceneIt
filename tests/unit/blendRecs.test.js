import { describe, expect, it } from 'vitest'
import { blendRecLabel, pickBlendSeeds, scoreBlend } from '../../src/features/blends/blendRecs.js'
import { mergeTmdbRecs } from '../../src/features/recommendations/recommend.js'

const movie = (id, category, extra = {}) => ({ id, tmdb_id: id, title: `Movie ${id}`, genres: [], category, ...extra })
// A ranked list from [id, category] pairs, best first, one movie per tier.
const list = (...entries) => entries.map(([id, category]) => [movie(id, category)])
const ids = (results) => results.map((r) => r.movie.id)

describe('scoreBlend', () => {
  it('needs at least two members', () => {
    expect(scoreBlend([list([1, 'loved'])])).toEqual([])
  })

  it('leaves out movies every member ranked, and movies anyone marked "Not a fan"', () => {
    const ana = list([1, 'loved'], [2, 'loved'], [3, 'loved'])
    const ben = list([1, 'loved'], [4, 'loved'], [2, 'meh'])
    const results = scoreBlend([ana, ben])
    expect(ids(results)).not.toContain(1) // both ranked it
    expect(ids(results)).not.toContain(2) // Ben's veto
    expect(ids(results)).toEqual(expect.arrayContaining([3, 4]))
  })

  it('ranks one person loving a movie above two people finding it okay', () => {
    const ana = list([10, 'loved'], [20, 'okay'])
    const ben = list([30, 'loved'], [20, 'okay'])
    const cat = list([40, 'loved'], [10, 'okay'])
    // Two "okay"s average out to about nothing; the old SQL put 20 first.
    const results = scoreBlend([ana, ben, cat])
    expect(ids(results)).toContain(30)
    expect(ids(results)).not.toContain(20)
  })

  it('counts only "Loved it" in lovedCount', () => {
    const ana = list([1, 'loved'], [2, 'okay'])
    const ben = list([3, 'loved'], [2, 'loved'])
    const cat = list([4, 'loved'])
    const rec = scoreBlend([ana, ben, cat]).find((r) => r.movie.id === 2)
    expect(rec).toMatchObject({ lovedCount: 1, memberCount: 3 })
  })

  it("discovers movies nobody ranked through TMDb links to the group's favorites", () => {
    const ana = list([1, 'loved'], [2, 'okay'])
    const ben = list([3, 'loved'], [4, 'okay'])
    const seeds = [movie(1, 'loved'), movie(3, 'loved')]
    const tmdb = [
      { seed: 1, movies: [{ tmdb_id: 100, title: 'Linked to both' }, { tmdb_id: 101, title: 'Linked to one' }] },
      { seed: 3, movies: [{ tmdb_id: 100, title: 'Linked to both' }] },
    ]
    const { candidates, links } = mergeTmdbRecs(tmdb, new Map(seeds.map((m) => [m.tmdb_id, m])), (row) => ({ ...row, id: row.tmdb_id }))
    const results = scoreBlend([ana, ben], candidates, { links })
    const both = results.find((r) => r.movie.id === 100)
    const one = results.find((r) => r.movie.id === 101)
    expect(both).toMatchObject({ lovedCount: 0 })
    expect(both.because.id).toBe(1)
    expect(both.score).toBeGreaterThan(one.score)
  })

  it("lets a member's dislike of a linked movie count against a discovery", () => {
    const ana = list([1, 'loved'])
    const benLikes = list([5, 'loved'])
    const benHates = list([5, 'loved'], [1, 'meh'])
    const links = new Map([[1, new Map([[100, 1]])], [100, new Map([[1, 1]])]])
    const candidate = { id: 100, tmdb_id: 100, title: 'Discovery' }
    const liked = scoreBlend([ana, benLikes], [candidate], { links }).find((r) => r.movie.id === 100)
    const disliked = scoreBlend([ana, benHates], [candidate], { links }).find((r) => r.movie.id === 100)
    expect(liked.score).toBeGreaterThan(disliked?.score ?? -Infinity)
  })
})

describe('pickBlendSeeds', () => {
  it('puts movies several members loved first, and skips the rest', () => {
    const ana = list([1, 'loved'], [2, 'loved'], [3, 'okay'])
    const ben = list([2, 'loved'], [4, 'loved'], [5, 'meh'])
    const seeds = pickBlendSeeds([ana, ben])
    expect(seeds[0].id).toBe(2)
    expect(seeds.map((m) => m.id).sort()).toEqual([1, 2, 4])
  })
})

describe('blendRecLabel', () => {
  it('only gives group-level reasons', () => {
    expect(blendRecLabel({ lovedCount: 2, memberCount: 4, because: 'Inception' })).toBe('Loved by 2 of 4')
    expect(blendRecLabel({ lovedCount: 0, memberCount: 4, because: 'Inception' })).toBe('Like Inception, a group favorite')
    expect(blendRecLabel({ lovedCount: 0, memberCount: 4, because: null })).toBe('Your group should like this')
  })
})
