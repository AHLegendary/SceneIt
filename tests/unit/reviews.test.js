import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fake Supabase client and account store. Tests queue results in `db.results`
// (one per awaited query, in order) and read back what was called.
const db = vi.hoisted(() => ({
  account: { user: { id: '00000000-0000-0000-0000-00000000000a' } },
  results: [],
  calls: [],
}))

vi.mock('../../src/lib/supabaseStore.js', () => ({
  getState: () => db.account,
}))

vi.mock('../../src/lib/supabase.js', () => {
  // A chainable query that records every step and resolves to the next queued result.
  function from(table) {
    const call = { table, ops: [] }
    db.calls.push(call)
    const chain = {}
    for (const op of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'single', 'maybeSingle']) {
      chain[op] = (...args) => {
        call.ops.push([op, ...args])
        return chain
      }
    }
    chain.then = (resolve, reject) => Promise.resolve(db.results.shift() ?? { data: null, error: null }).then(resolve, reject)
    return chain
  }
  return { supabase: { from } }
})

const ME = '00000000-0000-0000-0000-00000000000a'
const REVIEW_ID = '11111111-1111-1111-1111-111111111111'
const COMMENT_ID = '22222222-2222-2222-2222-222222222222'
const PARENT_ID = '33333333-3333-3333-3333-333333333333'

const REVIEW_ROW = {
  id: REVIEW_ID,
  user_id: ME,
  movie_id: 693134, // Dune: Part Two, in the catalog
  body: 'Loved it',
  is_spoiler: false,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
}
const COMMENT_ROW = {
  id: COMMENT_ID,
  review_id: REVIEW_ID,
  user_id: ME,
  parent_id: null,
  body: 'Agreed',
  created_at: '2026-11-02T00:00:00Z',
  updated_at: '2026-11-02T00:00:00Z',
}

const ok = (data) => ({ data, error: null })
const fail = (extra = {}) => ({ data: null, error: { message: 'boom', ...extra } })
const opsOf = (call) => call.ops.map(([op]) => op)

let reviews
let errorSpy

beforeEach(async () => {
  db.account = { user: { id: ME } }
  db.results = []
  db.calls = []
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.resetModules()
  reviews = await import('../../src/lib/reviews.js')
})

describe('threadComments', () => {
  const c = (id, parentId, createdAt) => ({ id, parentId, createdAt, body: id })

  it('nests replies under their parent, oldest first', () => {
    const thread = reviews.threadComments([
      c('r2', 'a', '2026-11-04'),
      c('b', null, '2026-11-03'),
      c('a', null, '2026-11-01'),
      c('r1', 'a', '2026-11-02'),
    ])
    expect(thread.map((t) => t.id)).toEqual(['a', 'b'])
    expect(thread[0].replies.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(thread[1].replies).toEqual([])
  })

  it('drops replies whose parent is missing', () => {
    const thread = reviews.threadComments([c('a', null, '2026-11-01'), c('orphan', 'gone', '2026-11-02')])
    expect(thread).toHaveLength(1)
    expect(thread[0].replies).toEqual([])
  })

  it('handles an empty list', () => {
    expect(reviews.threadComments([])).toEqual([])
  })
})

describe('rowToReview / rowToComment', () => {
  it('converts a review row and maps the TMDb id to the catalog id', () => {
    const review = reviews.rowToReview(REVIEW_ROW)
    expect(review).toMatchObject({ id: REVIEW_ID, userId: ME, body: 'Loved it', isSpoiler: false })
    expect(review.movieId).toBe('dune-part-two-2024') // catalog slug, not tmdb-693134
  })

  it('uses tmdb-<id> for movies outside the catalog', () => {
    expect(reviews.rowToReview({ ...REVIEW_ROW, movie_id: 999999999 }).movieId).toBe('tmdb-999999999')
  })

  it('converts a comment row', () => {
    expect(reviews.rowToComment(COMMENT_ROW)).toEqual({
      id: COMMENT_ID, reviewId: REVIEW_ID, userId: ME, parentId: null, body: 'Agreed',
      createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z',
    })
  })
})

describe('saveReview', () => {
  it('updates the existing review when there is one', async () => {
    db.results = [ok([REVIEW_ROW])]
    const saved = await reviews.saveReview('dune-part-two-2024', { body: '  Loved it  ', isSpoiler: true })
    expect(saved.id).toBe(REVIEW_ID)
    expect(db.calls).toHaveLength(1)
    const [update] = db.calls[0].ops.find(([op]) => op === 'update').slice(1)
    expect(update).toEqual({ body: 'Loved it', is_spoiler: true }) // trimmed, nothing else touched
  })

  it('inserts when there is nothing to update', async () => {
    db.results = [ok([]), ok(REVIEW_ROW)]
    await reviews.saveReview('dune-part-two-2024', { body: 'Loved it' })
    expect(db.calls).toHaveLength(2)
    expect(opsOf(db.calls[1])).toContain('insert')
    const [row] = db.calls[1].ops.find(([op]) => op === 'insert').slice(1)
    expect(row).toMatchObject({ user_id: ME, movie_id: 693134, body: 'Loved it', is_spoiler: false })
  })

  it('rejects empty and too-long text before calling the database', async () => {
    await expect(reviews.saveReview('dune-part-two-2024', { body: '   ' })).rejects.toThrow('Write something')
    await expect(reviews.saveReview('dune-part-two-2024', { body: 'x'.repeat(2001) })).rejects.toThrow('too long')
    expect(db.calls).toHaveLength(0)
  })

  it('accepts exactly the limit', async () => {
    db.results = [ok([REVIEW_ROW])]
    await expect(reviews.saveReview('dune-part-two-2024', { body: 'ab'.repeat(1000) })).resolves.toBeTruthy()
  })

  it('needs a login', async () => {
    db.account = { user: null }
    await expect(reviews.saveReview('dune-part-two-2024', { body: 'hi' })).rejects.toThrow('Log in')
  })

  it('throws a readable error when the database refuses', async () => {
    db.results = [fail()]
    await expect(reviews.saveReview('dune-part-two-2024', { body: 'hi' })).rejects.toThrow(reviews.REVIEW_SAVE_ERROR)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('throws a readable error when the insert is refused (movie not ranked)', async () => {
    db.results = [ok([]), fail({ code: '42501' })]
    await expect(reviews.saveReview('dune-part-two-2024', { body: 'hi' })).rejects.toThrow(reviews.REVIEW_SAVE_ERROR)
  })
})

describe('updateReview / deleteReview / fetchReview', () => {
  it('updateReview changes only text and the spoiler flag', async () => {
    db.results = [ok([REVIEW_ROW])]
    await reviews.updateReview(REVIEW_ID, { body: 'New', isSpoiler: true })
    const [update] = db.calls[0].ops.find(([op]) => op === 'update').slice(1)
    expect(update).toEqual({ body: 'New', is_spoiler: true })
  })

  it('updateReview fails when no row changed (not yours, or gone)', async () => {
    db.results = [ok([])]
    await expect(reviews.updateReview(REVIEW_ID, { body: 'New' })).rejects.toThrow(reviews.REVIEW_SAVE_ERROR)
  })

  it('rejects ids that are not UUIDs', async () => {
    await expect(reviews.updateReview('nope', { body: 'x' })).rejects.toThrow('Unknown review')
    await expect(reviews.deleteReview('nope')).rejects.toThrow('Unknown review')
    await expect(reviews.fetchReview('nope')).rejects.toThrow('Unknown review')
  })

  it('deleteReview deletes by id', async () => {
    db.results = [ok(null)]
    await reviews.deleteReview(REVIEW_ID)
    expect(db.calls[0].table).toBe('reviews')
    expect(db.calls[0].ops).toContainEqual(['eq', 'id', REVIEW_ID])
  })

  it('deleteReview surfaces failures', async () => {
    db.results = [fail()]
    await expect(reviews.deleteReview(REVIEW_ID)).rejects.toThrow(reviews.REVIEW_DELETE_ERROR)
  })

  it('fetchReview returns null when hidden or missing', async () => {
    db.results = [ok(null)]
    expect(await reviews.fetchReview(REVIEW_ID)).toBeNull()
  })

  it('fetchReview works signed out (public reviews)', async () => {
    db.account = { user: null }
    db.results = [ok(REVIEW_ROW)]
    expect((await reviews.fetchReview(REVIEW_ID)).id).toBe(REVIEW_ID)
  })

  it('fetchMyReview looks up by user and movie', async () => {
    db.results = [ok(REVIEW_ROW)]
    const review = await reviews.fetchMyReview('dune-part-two-2024')
    expect(review.body).toBe('Loved it')
    expect(db.calls[0].ops).toContainEqual(['eq', 'user_id', ME])
    expect(db.calls[0].ops).toContainEqual(['eq', 'movie_id', 693134])
  })
})

describe('commentCount', () => {
  it('is 0 unless the row came with the comment count', () => {
    expect(reviews.rowToReview(REVIEW_ROW).commentCount).toBe(0)
  })

  it('reads PostgREST\'s review_comments(count) shape', () => {
    expect(reviews.rowToReview({ ...REVIEW_ROW, review_comments: [{ count: 3 }] }).commentCount).toBe(3)
    expect(reviews.rowToReview({ ...REVIEW_ROW, review_comments: [] }).commentCount).toBe(0)
  })
})

describe('fetchReviewsForMovies', () => {
  it('returns a Map of UI movie id -> review, with comment counts', async () => {
    db.results = [ok([{ ...REVIEW_ROW, review_comments: [{ count: 2 }] }])]
    const found = await reviews.fetchReviewsForMovies(ME, ['dune-part-two-2024', 'inception-2010'])
    expect([...found.keys()]).toEqual(['dune-part-two-2024'])
    expect(found.get('dune-part-two-2024')).toMatchObject({ id: REVIEW_ID, body: 'Loved it', commentCount: 2 })
    expect(db.calls[0].table).toBe('reviews')
    expect(db.calls[0].ops).toContainEqual(['eq', 'user_id', ME])
    const [, column, tmdbIds] = db.calls[0].ops.find(([op]) => op === 'in')
    expect(column).toBe('movie_id')
    expect(tmdbIds).toContain(693134)
  })

  it('does not ask the database when there is nothing to look up', async () => {
    expect((await reviews.fetchReviewsForMovies(ME, [])).size).toBe(0)
    expect((await reviews.fetchReviewsForMovies(ME, ['not-a-movie'])).size).toBe(0)
    expect(db.calls).toHaveLength(0)
  })

  it('works signed out, and surfaces failures', async () => {
    db.account = { user: null }
    db.results = [ok([]), fail()]
    expect((await reviews.fetchReviewsForMovies(ME, ['dune-part-two-2024'])).size).toBe(0)
    await expect(reviews.fetchReviewsForMovies(ME, ['dune-part-two-2024'])).rejects.toThrow(reviews.REVIEW_LOAD_ERROR)
  })

  it('rejects a user id that is not a UUID', async () => {
    await expect(reviews.fetchReviewsForMovies('nope', ['dune-part-two-2024'])).rejects.toThrow('Unknown user')
  })
})

describe('comments', () => {
  it('fetchComments returns a flat list oldest first', async () => {
    db.results = [ok([COMMENT_ROW])]
    const list = await reviews.fetchComments(REVIEW_ID)
    expect(list).toHaveLength(1)
    expect(db.calls[0].ops).toContainEqual(['order', 'created_at', { ascending: true }])
  })

  it('fetchComments surfaces failures', async () => {
    db.results = [fail()]
    await expect(reviews.fetchComments(REVIEW_ID)).rejects.toThrow(reviews.COMMENT_LOAD_ERROR)
  })

  it('addComment posts a top-level comment as you', async () => {
    db.results = [ok(COMMENT_ROW)]
    await reviews.addComment(REVIEW_ID, ' Agreed ')
    const [row] = db.calls[0].ops.find(([op]) => op === 'insert').slice(1)
    expect(row).toEqual({ review_id: REVIEW_ID, user_id: ME, parent_id: null, body: 'Agreed' })
  })

  it('addComment posts a reply with parent_id', async () => {
    db.results = [ok({ ...COMMENT_ROW, parent_id: PARENT_ID })]
    const reply = await reviews.addComment(REVIEW_ID, 'Same', PARENT_ID)
    expect(reply.parentId).toBe(PARENT_ID)
    const [row] = db.calls[0].ops.find(([op]) => op === 'insert').slice(1)
    expect(row.parent_id).toBe(PARENT_ID)
  })

  it('addComment surfaces a refused reply (reply to a reply)', async () => {
    db.results = [fail({ code: '23514' })]
    await expect(reviews.addComment(REVIEW_ID, 'x', PARENT_ID)).rejects.toThrow(reviews.COMMENT_SAVE_ERROR)
  })

  it('addComment validates text, ids and login', async () => {
    await expect(reviews.addComment(REVIEW_ID, '  ')).rejects.toThrow('Write something')
    await expect(reviews.addComment(REVIEW_ID, 'x'.repeat(2001))).rejects.toThrow('too long')
    await expect(reviews.addComment('bad', 'x')).rejects.toThrow('Unknown review')
    await expect(reviews.addComment(REVIEW_ID, 'x', 'bad')).rejects.toThrow('Unknown comment')
    db.account = { user: null }
    await expect(reviews.addComment(REVIEW_ID, 'x')).rejects.toThrow('Log in')
    expect(db.calls).toHaveLength(0)
  })

  it('updateComment changes only the body', async () => {
    db.results = [ok([COMMENT_ROW])]
    await reviews.updateComment(COMMENT_ID, ' Edited ')
    const [update] = db.calls[0].ops.find(([op]) => op === 'update').slice(1)
    expect(update).toEqual({ body: 'Edited' })
  })

  it('updateComment fails when no row changed', async () => {
    db.results = [ok([])]
    await expect(reviews.updateComment(COMMENT_ID, 'x')).rejects.toThrow(reviews.COMMENT_SAVE_ERROR)
  })

  it('deleteComment deletes by id and surfaces failures', async () => {
    db.results = [ok(null), fail()]
    await reviews.deleteComment(COMMENT_ID)
    expect(db.calls[0].ops).toContainEqual(['eq', 'id', COMMENT_ID])
    await expect(reviews.deleteComment(COMMENT_ID)).rejects.toThrow(reviews.COMMENT_DELETE_ERROR)
  })
})

describe('reportContent', () => {
  it('files a report as you', async () => {
    db.results = [ok(null)]
    await reviews.reportContent('review', REVIEW_ID, ' Spam ')
    expect(db.calls[0].table).toBe('reports')
    const [row] = db.calls[0].ops.find(([op]) => op === 'insert').slice(1)
    expect(row).toEqual({ reporter_id: ME, target_type: 'review', target_id: REVIEW_ID, reason: 'Spam' })
  })

  it('says so when you already reported it', async () => {
    db.results = [fail({ code: '23505' })]
    await expect(reviews.reportContent('comment', COMMENT_ID, 'Rude')).rejects.toThrow(reviews.ALREADY_REPORTED)
  })

  it('surfaces other failures', async () => {
    db.results = [fail()]
    await expect(reviews.reportContent('comment', COMMENT_ID, 'Rude')).rejects.toThrow(reviews.REPORT_ERROR)
  })

  it('validates type, id, reason and login', async () => {
    await expect(reviews.reportContent('user', REVIEW_ID, 'x')).rejects.toThrow('Unknown report type')
    await expect(reviews.reportContent('review', 'bad', 'x')).rejects.toThrow('Unknown review')
    await expect(reviews.reportContent('review', REVIEW_ID, ' ')).rejects.toThrow('Write something')
    db.account = { user: null }
    await expect(reviews.reportContent('review', REVIEW_ID, 'x')).rejects.toThrow('Log in')
    expect(db.calls).toHaveLength(0)
  })
})

describe('content check', () => {
  const FLAGGED = "That text can't be posted because it may break our community rules. Edit it and try again."

  it('blocks flagged text on every write path before calling the database', async () => {
    await expect(reviews.saveReview('dune-part-two-2024', { body: 'just kys' })).rejects.toThrow(FLAGGED)
    await expect(reviews.updateReview(REVIEW_ID, { body: 'just kys' })).rejects.toThrow(FLAGGED)
    await expect(reviews.addComment(REVIEW_ID, 'just kys')).rejects.toThrow(FLAGGED)
    await expect(reviews.addComment(REVIEW_ID, 'just kys', PARENT_ID)).rejects.toThrow(FLAGGED)
    await expect(reviews.updateComment(COMMENT_ID, 'just kys')).rejects.toThrow(FLAGGED)
    expect(db.calls).toHaveLength(0)
  })

  it('does not run on report reasons (people may quote what they are reporting)', async () => {
    db.results = [ok(null)]
    await expect(reviews.reportContent('comment', COMMENT_ID, 'They said "kys"')).resolves.toBeUndefined()
    expect(db.calls).toHaveLength(1)
  })
})
