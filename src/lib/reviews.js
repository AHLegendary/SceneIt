// Reviews, comments and reports, stored in Supabase.
//
// Same rules as the rest of the data layer: UI code calls these functions
// instead of talking to Supabase, errors are thrown as Errors with a message
// the user can read, and movie ids are converted at this boundary (the UI
// uses "dune-part-two-2024" / "tmdb-12345", the database uses TMDb ids).
//
// Unlike the ranked list, nothing here is kept in memory: reviews and
// comments are loaded when a page asks for them. Who may read or write what
// is decided by RLS (see supabase/README.md); these functions only shape the
// calls and the errors.

import { getMovie, getMovieByTmdbId, movieFromDb } from './localStore.js'
import { moderateText } from './moderation.js'
import { getState as getAccount } from './supabaseStore.js'
import { supabase } from './supabase.js'

export const MAX_REVIEW_LENGTH = 2000
export const MAX_COMMENT_LENGTH = 2000
export const MAX_REPORT_REASON_LENGTH = 500

export const REVIEW_LOAD_ERROR = "Couldn't load the review. Check your connection and try again."
export const REVIEW_SAVE_ERROR = "Couldn't save your review. Check your connection and try again."
export const REVIEW_DELETE_ERROR = "Couldn't delete your review. Check your connection and try again."
export const COMMENT_LOAD_ERROR = "Couldn't load the comments. Check your connection and try again."
export const COMMENT_SAVE_ERROR = "Couldn't post your comment. Check your connection and try again."
export const COMMENT_DELETE_ERROR = "Couldn't delete that comment. Check your connection and try again."
export const REPORT_ERROR = "Couldn't send your report. Check your connection and try again."
export const ALREADY_REPORTED = "You've already reported that."

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const REVIEW_COLUMNS = 'id, user_id, movie_id, body, is_spoiler, created_at, updated_at'
// Same, plus how many comments each review has (PostgREST counts the rows).
const REVIEW_WITH_COUNT = `${REVIEW_COLUMNS}, review_comments(count)`
const COMMENT_COLUMNS = 'id, review_id, user_id, parent_id, body, created_at, updated_at'

// ------------------------------------------------------------------ shapes

// Review row -> { id, userId, movieId, body, isSpoiler, createdAt, updatedAt,
// commentCount }. movieId is the UI id (catalog slug when there is one, else
// "tmdb-<id>"). commentCount is 0 unless the row came with the comment count
// (review_comments(count) from a table query, or comment_count from the feed).
export function rowToReview(row) {
  return {
    commentCount: row.comment_count ?? row.review_comments?.[0]?.count ?? 0,
    id: row.id,
    userId: row.user_id,
    movieId: getMovieByTmdbId(row.movie_id)?.id ?? `tmdb-${row.movie_id}`,
    body: row.body,
    isSpoiler: Boolean(row.is_spoiler),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// Comment row -> { id, reviewId, userId, parentId, body, createdAt, updatedAt,
// username }. username is only there when the row came from
// get_review_comments (null otherwise).
export function rowToComment(row) {
  return {
    username: row.username ?? null,
    id: row.id,
    reviewId: row.review_id,
    userId: row.user_id,
    parentId: row.parent_id ?? null,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// Top-level comments oldest first, each with its replies (oldest first):
//   [{ ...comment, replies: [...] }]
// A reply whose parent isn't in the list (it was deleted, or we only loaded
// part of the thread) is dropped rather than shown with no context.
// Pure, so it's easy to test.
export function threadComments(comments) {
  const byDate = (a, b) => a.createdAt.localeCompare(b.createdAt)
  const top = comments.filter((c) => !c.parentId).sort(byDate).map((c) => ({ ...c, replies: [] }))
  const byId = new Map(top.map((c) => [c.id, c]))
  for (const reply of comments.filter((c) => c.parentId).sort(byDate)) byId.get(reply.parentId)?.replies.push(reply)
  return top
}

// ------------------------------------------------------------------ guards

function requireUserId() {
  const id = getAccount().user?.id
  if (!id) throw new Error('Log in to write reviews and comments.')
  return id
}

function requireId(id, what) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error(`Unknown ${what}: ${id}`)
}

function tmdbIdOf(movieId) {
  const movie = getMovie(movieId)
  if (!movie?.tmdb_id) throw new Error(`Unknown movie: ${movieId}`)
  return movie.tmdb_id
}

// Trims and checks the text. Throws a message the user can read.
function cleanBody(text, max, what) {
  const body = (text ?? '').trim()
  if (!body) throw new Error(`Write something first.`)
  if (body.length > max) throw new Error(`That ${what} is too long (${max} characters at most).`)
  return body
}

// cleanBody, plus the content check. For anything other people will read
// (reviews, edits, comments), so every write path goes through it even if a
// form forgot to check first. Throws the moderation message when flagged.
function cleanPublicBody(text, max, what) {
  const body = cleanBody(text, max, what)
  const verdict = moderateText(body)
  if (!verdict.ok) throw new Error(verdict.reason)
  return body
}

// ------------------------------------------------------------------ reviews

// Creates or replaces the signed-in user's review of a movie (one per movie).
// The movie has to be ranked already; the database enforces that. Returns the
// saved review.
export async function saveReview(movieId, { body, isSpoiler = false }) {
  const userId = requireUserId()
  const movie = tmdbIdOf(movieId)
  const text = cleanPublicBody(body, MAX_REVIEW_LENGTH, 'review')
  const fields = { body: text, is_spoiler: Boolean(isSpoiler) }

  // Not an upsert: edits may only touch body and is_spoiler (column grants),
  // and an upsert's update half would also set user_id and movie_id.
  const updated = await supabase
    .from('reviews')
    .update(fields)
    .eq('user_id', userId)
    .eq('movie_id', movie)
    .select(REVIEW_COLUMNS)
  if (updated.error) {
    console.error('saveReview failed', updated.error)
    throw new Error(REVIEW_SAVE_ERROR)
  }
  if (updated.data?.length) return rowToReview(updated.data[0])

  const inserted = await supabase
    .from('reviews')
    .insert({ user_id: userId, movie_id: movie, ...fields })
    .select(REVIEW_COLUMNS)
    .single()
  if (inserted.error) {
    console.error('saveReview failed', inserted.error)
    throw new Error(REVIEW_SAVE_ERROR)
  }
  return rowToReview(inserted.data)
}

// Edits the text and spoiler flag of one of your reviews. Returns the review.
export async function updateReview(reviewId, { body, isSpoiler = false }) {
  requireUserId()
  requireId(reviewId, 'review')
  const text = cleanPublicBody(body, MAX_REVIEW_LENGTH, 'review')
  const { data, error } = await supabase
    .from('reviews')
    .update({ body: text, is_spoiler: Boolean(isSpoiler) })
    .eq('id', reviewId)
    .select(REVIEW_COLUMNS)
  if (error || !data?.length) {
    if (error) console.error('updateReview failed', error)
    throw new Error(REVIEW_SAVE_ERROR)
  }
  return rowToReview(data[0])
}

// Deletes one of your reviews (its comments go with it).
export async function deleteReview(reviewId) {
  requireUserId()
  requireId(reviewId, 'review')
  const { error } = await supabase.from('reviews').delete().eq('id', reviewId)
  if (error) {
    console.error('deleteReview failed', error)
    throw new Error(REVIEW_DELETE_ERROR)
  }
}

// One review by id, or null if it doesn't exist or you aren't allowed to see
// it (RLS hides it, so the two look the same).
export async function fetchReview(reviewId) {
  requireId(reviewId, 'review')
  const { data, error } = await supabase.from('reviews').select(REVIEW_COLUMNS).eq('id', reviewId).maybeSingle()
  if (error) {
    console.error('fetchReview failed', error)
    throw new Error(REVIEW_LOAD_ERROR)
  }
  return data ? rowToReview(data) : null
}

// Everything the review's discussion page shows: { review, author, movie }, or
// null when the review doesn't exist or you aren't allowed to see it (those
// look the same on purpose). `author` is { id, username }; `movie` is the movie
// object (the catalog's, or one built from the `movies` table).
export async function fetchReviewPage(reviewId) {
  requireId(reviewId, 'review')
  const { data: row, error } = await supabase.from('reviews').select(REVIEW_COLUMNS).eq('id', reviewId).maybeSingle()
  if (error) {
    console.error('fetchReviewPage failed', error)
    throw new Error(REVIEW_LOAD_ERROR)
  }
  if (!row) return null

  let movie = getMovieByTmdbId(row.movie_id)
  if (!movie) {
    const found = await supabase
      .from('movies')
      .select('tmdb_id, title, year, poster_path, genres, overview')
      .eq('tmdb_id', row.movie_id)
      .maybeSingle()
    if (found.error) {
      console.error('fetchReviewPage failed', found.error)
      throw new Error(REVIEW_LOAD_ERROR)
    }
    movie = found.data ? movieFromDb(found.data) : null
  }

  const profile = await supabase.from('profiles').select('id, username').eq('id', row.user_id).maybeSingle()
  if (profile.error) {
    console.error('fetchReviewPage failed', profile.error)
    throw new Error(REVIEW_LOAD_ERROR)
  }
  return {
    review: rowToReview(row),
    author: { id: row.user_id, username: profile.data?.username ?? null },
    movie,
  }
}

// A user's review of one movie, or null. Used to pre-fill the review step
// when someone re-ranks a movie.
export async function fetchMyReview(movieId) {
  const userId = requireUserId()
  const { data, error } = await supabase
    .from('reviews')
    .select(REVIEW_COLUMNS)
    .eq('user_id', userId)
    .eq('movie_id', tmdbIdOf(movieId))
    .maybeSingle()
  if (error) {
    console.error('fetchMyReview failed', error)
    throw new Error(REVIEW_LOAD_ERROR)
  }
  return data ? rowToReview(data) : null
}

// A user's reviews of some of their movies, as a Map of UI movie id -> review
// (with commentCount). Movies without a review are simply absent. Only reviews
// you're allowed to see come back (RLS), so for a hidden profile the Map is
// empty rather than an error. Used by the profile's "Recently ranked" list,
// a page of movies at a time.
export async function fetchReviewsForMovies(userId, movieIds) {
  requireId(userId, 'user')
  const tmdbIds = movieIds.map((id) => getMovie(id)?.tmdb_id).filter(Boolean)
  if (!tmdbIds.length) return new Map()
  const { data, error } = await supabase
    .from('reviews')
    .select(REVIEW_WITH_COUNT)
    .eq('user_id', userId)
    .in('movie_id', tmdbIds)
  if (error) {
    console.error('fetchReviewsForMovies failed', error)
    throw new Error(REVIEW_LOAD_ERROR)
  }
  const reviews = (data ?? []).map(rowToReview)
  return new Map(reviews.map((review) => [review.movieId, review]))
}

// ------------------------------------------------------------------ comments

// Every comment on a review, oldest first, as a flat list with each
// commenter's username (see threadComments to nest it). Goes through
// get_review_comments rather than the table: a commenter's profile may be
// private, and then their username can't be read from `profiles` directly.
export async function fetchComments(reviewId) {
  requireId(reviewId, 'review')
  const { data, error } = await supabase.rpc('get_review_comments', { p_review_id: reviewId })
  if (error) {
    console.error('fetchComments failed', error)
    throw new Error(COMMENT_LOAD_ERROR)
  }
  return (data ?? []).map(rowToComment)
}

// Adds a comment, or a reply when parentId is given. Returns the comment.
// TODO: notifications. When they exist, notify the review's author here (and
// the parent comment's author for a reply).
export async function addComment(reviewId, body, parentId = null) {
  const userId = requireUserId()
  requireId(reviewId, 'review')
  if (parentId !== null) requireId(parentId, 'comment')
  const text = cleanPublicBody(body, MAX_COMMENT_LENGTH, 'comment')
  const { data, error } = await supabase
    .from('review_comments')
    .insert({ review_id: reviewId, user_id: userId, parent_id: parentId, body: text })
    .select(COMMENT_COLUMNS)
    .single()
  if (error) {
    console.error('addComment failed', error)
    throw new Error(COMMENT_SAVE_ERROR)
  }
  return rowToComment(data)
}

// Edits one of your comments. Returns the comment.
export async function updateComment(commentId, body) {
  requireUserId()
  requireId(commentId, 'comment')
  const text = cleanPublicBody(body, MAX_COMMENT_LENGTH, 'comment')
  const { data, error } = await supabase
    .from('review_comments')
    .update({ body: text })
    .eq('id', commentId)
    .select(COMMENT_COLUMNS)
  if (error || !data?.length) {
    if (error) console.error('updateComment failed', error)
    throw new Error(COMMENT_SAVE_ERROR)
  }
  return rowToComment(data[0])
}

// Deletes a comment (and its replies). Allowed for the commenter and for the
// review's author.
export async function deleteComment(commentId) {
  requireUserId()
  requireId(commentId, 'comment')
  const { error } = await supabase.from('review_comments').delete().eq('id', commentId)
  if (error) {
    console.error('deleteComment failed', error)
    throw new Error(COMMENT_DELETE_ERROR)
  }
}

// ------------------------------------------------------------------ reports

// Reports a review or a comment. type is 'review' or 'comment'. Reporting the
// same thing twice throws ALREADY_REPORTED.
export async function reportContent(type, targetId, reason) {
  const userId = requireUserId()
  if (type !== 'review' && type !== 'comment') throw new Error(`Unknown report type: ${type}`)
  requireId(targetId, type)
  const text = cleanBody(reason, MAX_REPORT_REASON_LENGTH, 'reason')
  const { error } = await supabase
    .from('reports')
    .insert({ reporter_id: userId, target_type: type, target_id: targetId, reason: text })
  if (error?.code === '23505') throw new Error(ALREADY_REPORTED) // unique violation
  if (error) {
    console.error('reportContent failed', error)
    throw new Error(REPORT_ERROR)
  }
}
