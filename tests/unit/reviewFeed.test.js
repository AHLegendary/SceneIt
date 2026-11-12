import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fake Supabase client: tests queue one result per rpc call and read back the calls.
const db = vi.hoisted(() => ({ results: [], calls: [] }))

vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    rpc: (name, args) => {
      db.calls.push({ name, args })
      return Promise.resolve(db.results.shift() ?? { data: [], error: null })
    },
  },
}))

const ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  user_id: '00000000-0000-0000-0000-00000000000b',
  username: 'bob',
  movie_id: 693134, // Dune: Part Two, in the catalog
  title: 'Dune: Part Two',
  year: 2024,
  poster_path: '/p.jpg',
  genres: ['Science Fiction'],
  overview: '',
  body: 'Loved it',
  is_spoiler: true,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  comment_count: 3,
  score: '9.2',
}

let feed

beforeEach(async () => {
  db.results = []
  db.calls = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.resetModules()
  feed = await import('../../src/lib/reviewFeed.js')
})

describe('rowToFeedItem', () => {
  it('builds the review, author, movie and score', () => {
    const item = feed.rowToFeedItem(ROW)
    expect(item.review).toMatchObject({ id: ROW.id, userId: ROW.user_id, body: 'Loved it', isSpoiler: true, commentCount: 3 })
    expect(item.review.movieId).toBe('dune-part-two-2024') // the catalog's id, not tmdb-693134
    expect(item.author).toEqual({ id: ROW.user_id, username: 'bob' })
    expect(item.movie.title).toBe('Dune: Part Two')
    expect(item.score).toBe(9.2)
  })

  it('has no score until the database says so', () => {
    expect(feed.rowToFeedItem({ ...ROW, score: null }).score).toBeNull()
    expect(feed.rowToFeedItem({ ...ROW, score: undefined }).score).toBeNull()
  })

  it('keeps a score of 0', () => {
    expect(feed.rowToFeedItem({ ...ROW, score: 0 }).score).toBe(0)
  })

  it('builds a movie outside the catalog from the row', () => {
    const item = feed.rowToFeedItem({ ...ROW, movie_id: 424242, title: 'Obscure', year: 2001, genres: ['Drama'] })
    expect(item.movie).toMatchObject({ id: 'tmdb-424242', title: 'Obscure', genres: ['Drama'] })
    expect(item.review.movieId).toBe('tmdb-424242')
  })

  it('skips a row it cannot build a movie for', () => {
    expect(feed.rowToFeedItem({ ...ROW, movie_id: 424242, title: null })).toBeNull()
  })
})

describe('fetchReviewFeed', () => {
  it('asks get_review_feed with the defaults: everyone, recent, one page from the start', async () => {
    db.results = [{ data: [ROW], error: null }]
    const { items, count } = await feed.fetchReviewFeed()
    expect(db.calls).toEqual([{ name: 'get_review_feed', args: { p_scope: 'everyone', p_sort: 'recent', p_limit: 20, p_offset: 0 } }])
    expect(items).toHaveLength(1)
    expect(count).toBe(1)
  })

  it('passes the filters, sort and paging on', async () => {
    await feed.fetchReviewFeed({ scope: 'friends', sort: 'discussed', limit: 5, offset: 40 })
    expect(db.calls[0].args).toEqual({ p_scope: 'friends', p_sort: 'discussed', p_limit: 5, p_offset: 40 })
  })

  it('counts the rows the database returned, including ones it skipped, so paging stays right', async () => {
    db.results = [{ data: [ROW, { ...ROW, id: 'x', movie_id: 424242, title: null }], error: null }]
    const { items, count } = await feed.fetchReviewFeed()
    expect(items).toHaveLength(1)
    expect(count).toBe(2)
  })

  it('treats no data as an empty page', async () => {
    db.results = [{ data: null, error: null }]
    expect(await feed.fetchReviewFeed()).toEqual({ items: [], count: 0 })
  })

  it('throws a readable error when the request fails', async () => {
    db.results = [{ data: null, error: { message: 'boom' } }]
    await expect(feed.fetchReviewFeed()).rejects.toThrow(feed.FEED_ERROR)
  })
})
