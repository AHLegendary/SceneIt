import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/supabase.js', () => ({ supabase: {} }))
vi.mock('../../src/lib/movies.js', () => ({ saveMovie: async () => ({}) }))

const { groupRowsByUser } = await import('../../src/lib/rankingsQueries.js')

const row = (user_id, tmdb, position) => ({
  user_id, movie_id: tmdb, position, movies: { tmdb_id: tmdb, title: `T${tmdb}`, genres: [] },
})

describe('groupRowsByUser', () => {
  it("splits rows into each user's tiers, keeping ties", () => {
    const byUser = groupRowsByUser([row('a', 9001, 0), row('a', 9002, 0), row('a', 9003, 1), row('b', 9004, 0)])
    expect(byUser.get('a').map((t) => t.map((m) => m.tmdb_id))).toEqual([[9001, 9002], [9003]])
    expect(byUser.get('b')[0][0].tmdb_id).toBe(9004)
  })

  it('handles no rows', () => {
    expect(groupRowsByUser(null).size).toBe(0)
  })
})
