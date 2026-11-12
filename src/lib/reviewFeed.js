// The Community page's reviews feed, from get_review_feed (see
// supabase/migrations). One request returns a page of reviews with everything
// a review card shows: the author, the movie, the comment count and the
// author's score. Public: signed-out visitors get reviews from public profiles.

import { movieFromDb } from './localStore.js'
import { rowToReview } from './reviews.js'
import { supabase } from './supabase.js'

// How many reviews each request returns.
export const FEED_PAGE = 20
// The database never returns more than this many in one request.
export const FEED_MAX = 200

export const SCOPES = ['everyone', 'friends']
export const SORTS = ['recent', 'discussed']
export const FEED_ERROR = "Couldn't load reviews. Check your connection and try again."

// get_review_feed row -> { review, author: { id, username }, movie, score }.
// score is null until the author has ranked enough movies for scores to exist.
// Returns null for a row we can't build a movie for (it is skipped).
export function rowToFeedItem(row) {
  const movie = movieFromDb({ ...row, tmdb_id: row.movie_id })
  if (!movie) return null
  return {
    review: rowToReview(row),
    author: { id: row.user_id, username: row.username },
    movie,
    score: row.score === null || row.score === undefined ? null : Number(row.score),
  }
}

// One page of the feed. scope: 'everyone' | 'friends' (friends needs a login:
// logged out it's empty). sort: 'recent' | 'discussed' (most comments first).
// Returns { items, count }: `count` is how many rows the database returned,
// which is less than `limit` only on the last page. Throws an Error with a
// user-facing message if the request fails.
export async function fetchReviewFeed({ scope = 'everyone', sort = 'recent', limit = FEED_PAGE, offset = 0 } = {}) {
  const { data, error } = await supabase.rpc('get_review_feed', {
    p_scope: scope,
    p_sort: sort,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) {
    console.error('fetchReviewFeed failed', error)
    throw new Error(FEED_ERROR)
  }
  const rows = data ?? []
  return { items: rows.map(rowToFeedItem).filter(Boolean), count: rows.length }
}
