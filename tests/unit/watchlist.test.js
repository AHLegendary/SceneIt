import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fake Supabase: records writes, answers reads from `db.rows`, and fails the
// next write with `db.writeError`.
const db = vi.hoisted(() => ({ rows: [], writeError: null, inserts: [], deletes: [] }))

vi.mock('../../src/lib/supabaseStore.js', () => ({
  getState: () => ({ user: { id: 'u1' } }),
  subscribe: () => () => {},
  ensureSaved: vi.fn(async () => {}),
  requireFreshSession: vi.fn(async () => {}),
}))

vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    from: () => {
      const chain = {
        select: () => chain,
        order: () => Promise.resolve({ data: db.rows, error: null }),
        eq: (column, value) => {
          chain.filters.push([column, value])
          return chain.filters.length === 2 ? Promise.resolve({ error: db.writeError }) : chain
        },
        filters: [],
        insert: async (row) => {
          db.inserts.push(row)
          return { error: db.writeError }
        },
        delete: () => {
          chain.filters = []
          db.deletes.push(chain.filters)
          return chain
        },
        // select().eq() is awaited by fetchWatchlist
      }
      chain.select = () => ({ eq: () => ({ order: chain.order }) })
      return chain
    },
  },
}))

const { addToWatchlist, getWatchlist, removeFromWatchlist, rowsToMovies, SAVE_ERROR, REMOVE_ERROR } = await import('../../src/lib/watchlist.js')

const movie = { id: 'tmdb-99', tmdb_id: 99, title: 'Some Movie' }

beforeEach(() => {
  db.rows = []
  db.writeError = null
  db.inserts = []
  db.deletes = []
})

describe('rowsToMovies', () => {
  it('builds movies from joined rows and skips unusable ones', () => {
    const movies = rowsToMovies([
      { movie_id: 4242, movies: { tmdb_id: 4242, title: 'Found', year: 2020, genres: [], poster_path: null, overview: null } },
      { movie_id: 5151, movies: null },
    ])
    expect(movies.map((m) => m.title)).toEqual(['Found'])
  })
  it('handles no rows', () => {
    expect(rowsToMovies(null)).toEqual([])
  })
})

describe('addToWatchlist', () => {
  it('inserts the signed-in user and movie, then reloads', async () => {
    db.rows = [{ movie_id: 99, movies: { tmdb_id: 99, title: 'Some Movie' } }]
    await addToWatchlist(movie)
    expect(db.inserts).toEqual([{ user_id: 'u1', movie_id: 99 }])
    expect(getWatchlist().movies.map((m) => m.tmdb_id)).toEqual([99])
  })
  it('treats an already-saved movie as success', async () => {
    db.writeError = { code: '23505' }
    await expect(addToWatchlist(movie)).resolves.toBeUndefined()
  })
  it('throws a friendly error when the insert fails', async () => {
    db.writeError = { code: '500', message: 'boom' }
    await expect(addToWatchlist(movie)).rejects.toThrow(SAVE_ERROR)
  })
})

describe('removeFromWatchlist', () => {
  it('deletes only this user and movie', async () => {
    await removeFromWatchlist(movie)
    expect(db.deletes[0]).toEqual([['user_id', 'u1'], ['movie_id', 99]])
  })
  it('throws a friendly error when the delete fails', async () => {
    db.writeError = { message: 'boom' }
    await expect(removeFromWatchlist(movie)).rejects.toThrow(REMOVE_ERROR)
  })
})
