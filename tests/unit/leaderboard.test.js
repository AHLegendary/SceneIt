import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fake Supabase client: tests set `db.boards[period]` to the rows
// get_leaderboard should return, or `db.fail` to make every call fail.
const db = vi.hoisted(() => ({ boards: {}, fail: false, calls: [] }))

vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    rpc: async (name, args) => {
      db.calls.push({ name, args })
      if (db.fail) return { data: null, error: { message: 'network down' } }
      return { data: db.boards[args.p_period] ?? [], error: null }
    },
  },
}))

const {
  fetchCommunityStats,
  fetchLeaderboard,
  LEADERBOARD_ERROR,
  rowsToLeaderboard,
} = await import('../../src/lib/leaderboard.js')

// TMDb ids of a few catalog movies (see src/data/movies.json).
const DUNE = 693134 // dune-part-two-2024
const PAST_LIVES = 666277 // past-lives-2023
const NOT_IN_CATALOG = 1 // shows up as 'tmdb-1'

// Rows shaped like get_leaderboard's output. Supabase returns bigint and
// numeric columns as numbers or strings depending on size, so mix both.
const WEEKLY = [
  { movie_id: DUNE, title: 'Dune: Part Two', year: 2024, poster_path: '/d.jpg', score: 9.2, rankers: 3, rank: 1 },
  { movie_id: NOT_IN_CATALOG, title: 'Mystery', year: 2020, poster_path: null, score: '8.0', rankers: '2', rank: 2 },
  { movie_id: PAST_LIVES, title: 'Past Lives', year: 2023, poster_path: '/p.jpg', score: '7.5', rankers: '1', rank: 3 },
]

beforeEach(() => {
  db.boards = {}
  db.fail = false
  db.calls = []
})

describe('rowsToLeaderboard', () => {
  it('turns database rows into movies with numeric stats', () => {
    const rows = rowsToLeaderboard(WEEKLY)
    expect(rows.map((r) => r.id)).toEqual(['dune-part-two-2024', 'tmdb-1', 'past-lives-2023'])
    expect(rows[2]).toMatchObject({ title: 'Past Lives', score: 7.5, rankers: 1, rank: 3 })
  })

  it('uses the database title, year and poster for movies outside the catalog', () => {
    expect(rowsToLeaderboard(WEEKLY)[1]).toMatchObject({ title: 'Mystery', year: 2020, poster_path: null, score: 8, rankers: 2 })
  })

  it('skips rows it cannot build a movie for and keeps ranks 1, 2, 3...', () => {
    const rows = rowsToLeaderboard([{ movie_id: null, title: 'Broken' }, ...WEEKLY])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3])
  })

  it('handles an empty or missing result', () => {
    expect(rowsToLeaderboard([])).toEqual([])
    expect(rowsToLeaderboard(null)).toEqual([])
  })
})

describe('fetchLeaderboard', () => {
  it('calls get_leaderboard with the period, category and limit', async () => {
    db.boards.monthly = WEEKLY
    const rows = await fetchLeaderboard('monthly', 'watched')
    expect(db.calls).toEqual([
      { name: 'get_leaderboard', args: { p_period: 'monthly', p_category: 'watched', p_limit: 10 } },
    ])
    expect(rows).toHaveLength(3)
  })

  it('defaults to this week, highest ranked', async () => {
    await fetchLeaderboard()
    expect(db.calls[0].args).toMatchObject({ p_period: 'weekly', p_category: 'highest' })
  })

  it('throws a user-facing message when the request fails', async () => {
    db.fail = true
    await expect(fetchLeaderboard()).rejects.toThrow(LEADERBOARD_ERROR)
  })

  it('rejects unknown filters without calling the database', async () => {
    await expect(fetchLeaderboard('yearly')).rejects.toThrow()
    await expect(fetchLeaderboard('weekly', 'loudest')).rejects.toThrow()
    expect(db.calls).toEqual([])
  })
})

describe('fetchCommunityStats', () => {
  it('reports rank and score for each period the movie is on', async () => {
    db.boards.weekly = WEEKLY
    db.boards.monthly = [WEEKLY[2]]
    const stats = await fetchCommunityStats('past-lives-2023')
    expect(stats.weekly).toEqual({ rank: 3, score: 7.5, rankers: 1 })
    expect(stats.monthly).toEqual({ rank: 1, score: 7.5, rankers: 1 })
    expect(db.calls.every((c) => c.args.p_limit === 100)).toBe(true)
  })

  it('is null for periods where the movie is not listed', async () => {
    db.boards.weekly = WEEKLY
    expect(await fetchCommunityStats('up-2009')).toEqual({ weekly: null, monthly: null })
  })

  it('throws when the database is unreachable', async () => {
    db.fail = true
    await expect(fetchCommunityStats('dune-part-two-2024')).rejects.toThrow(LEADERBOARD_ERROR)
  })
})
