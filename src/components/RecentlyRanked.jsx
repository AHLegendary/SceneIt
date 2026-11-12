import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import ReviewCard from './ReviewCard.jsx'
import { scoreTiers } from '../features/ranking/scores.js'
import { fetchRankingOrder } from '../lib/rankingsQueries.js'
import { deleteReview, fetchReviewsForMovies, updateReview } from '../lib/reviews.js'
import { useNearBottom } from '../lib/useNearBottom.js'

// How many cards each "page" adds.
export const PAGE_SIZE = 20

const ORDER_ERROR = "Couldn't load this list. Check your connection and try again."
const REVIEWS_ERROR = "Couldn't load some of the reviews. Check your connection and try again."

// A user's ranked movies, most recently ranked first, as ReviewCards. It
// grows as you scroll (about 20 at a time, no inner scroll box) and a search
// box narrows it by title. Only ranked movies appear.
//
// Everything about the movies (titles, genres, scores) is already in `tiers`,
// so the search and the paging happen here. What this component loads is the
// ranking order, and, for the cards currently shown, their reviews.
//
// Give it `key={userId}`: all of its state belongs to one user's list.
//
//   userId        whose list this is
//   tiers         that user's ranked list
//   isOwner       your own profile: reviews can be edited and deleted
//   fullListHref  link to the plain ranked list
//   onOpen        opens a movie's details (movie id)
export default function RecentlyRanked({ userId, tiers, isOwner = false, fullListHref, onOpen }) {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  // TMDb ids, newest first. null until the first load finishes; after that a
  // failed reload keeps the old order and just reports the error.
  const [order, setOrder] = useState(null)
  const [orderError, setOrderError] = useState(false)
  const [orderAttempt, setOrderAttempt] = useState(0)
  // Reviews by movie id, and the movies whose review lookup has finished
  // (found or not). `asked` remembers which movies a request was sent for, so
  // each page is requested once.
  const [reviews, setReviews] = useState(() => new Map())
  const [settled, setSettled] = useState(() => new Set())
  const [reviewsError, setReviewsError] = useState(false)
  const asked = useRef(new Set())

  // The ranking order. Reloaded when the list changes (your own list reloads
  // after you rank something), while the old order stays on screen.
  useEffect(() => {
    let current = true
    fetchRankingOrder(userId).then(
      (ids) => {
        if (!current) return
        setOrder(ids)
        setOrderError(false)
      },
      () => current && setOrderError(true),
    )
    return () => {
      current = false
    }
  }, [userId, tiers, orderAttempt])

  const total = useMemo(() => tiers.reduce((n, tier) => n + tier.length, 0), [tiers])

  // Newest first. A movie that's in the list but not in the order yet (just
  // ranked, order still reloading) is the newest, so it goes on top.
  const items = useMemo(() => {
    if (!order) return []
    const byTmdb = new Map(tiers.flat().map((movie) => [movie.tmdb_id, movie]))
    const listed = new Set(order)
    const fresh = [...byTmdb.values()].filter((movie) => !listed.has(movie.tmdb_id))
    return [...fresh, ...order.map((id) => byTmdb.get(id)).filter(Boolean)]
  }, [tiers, order])

  const needle = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (needle ? items.filter((movie) => movie.title.toLowerCase().includes(needle)) : items),
    [items, needle],
  )
  const visible = filtered.slice(0, limit)
  const scores = useMemo(() => scoreTiers(tiers), [tiers])

  // Fetch the reviews for the cards that are showing and haven't been asked
  // about. Results are keyed by movie, so a response is useful even if more
  // cards appeared while it was on its way. A failure stops further loading
  // until Try again, which clears the error and so runs this again.
  const visibleKey = visible.map((movie) => movie.id).join(',')
  useEffect(() => {
    if (!visibleKey || reviewsError) return
    const ids = visibleKey.split(',').filter((id) => !asked.current.has(id))
    if (!ids.length) return
    ids.forEach((id) => asked.current.add(id))
    fetchReviewsForMovies(userId, ids).then(
      (found) => {
        setReviews((previous) => new Map([...previous, ...found]))
        setSettled((previous) => new Set([...previous, ...ids]))
      },
      () => {
        ids.forEach((id) => asked.current.delete(id))
        setReviewsError(true)
      },
    )
  }, [visibleKey, userId, reviewsError])

  // Only ask for the next page once the cards on screen have their reviews.
  const loadingReviews = visible.some((movie) => !settled.has(movie.id))
  const hasMore = visible.length < filtered.length
  const loadMore = useCallback(() => setLimit((n) => n + PAGE_SIZE), [])
  const sentinel = useNearBottom(loadMore, hasMore && !loadingReviews && !reviewsError, limit)

  async function saveReview(review, { body, isSpoiler }) {
    const saved = await updateReview(review.id, { body, isSpoiler })
    setReviews((previous) => new Map(previous).set(saved.movieId, { ...saved, commentCount: review.commentCount }))
  }

  async function removeReview(review) {
    await deleteReview(review.id)
    setReviews((previous) => {
      const next = new Map(previous)
      next.delete(review.movieId)
      return next
    })
  }

  let body
  if (total === 0) {
    body = <p className="uprofile__muted">Nothing ranked yet. Movies show up here as they're ranked.</p>
  } else if (!order) {
    body = orderError ? (
      <div className="profile__alert" role="alert">
        {ORDER_ERROR}{' '}
        <button type="button" className="profile__link" onClick={() => setOrderAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    ) : (
      <p className="uprofile__muted">Loading movies…</p>
    )
  } else if (filtered.length === 0) {
    body = <p className="uprofile__muted">No ranked movies match “{query.trim()}”.</p>
  } else {
    body = (
      <ul className="rlist">
        {visible.map((movie) => (
          <li key={movie.id}>
            <ReviewCard
              movie={movie}
              score={scores?.get(movie.id) ?? null}
              review={reviews.get(movie.id) ?? null}
              isOwner={isOwner}
              onOpenMovie={onOpen}
              onSaveReview={saveReview}
              onDeleteReview={removeReview}
            />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section className="recent" aria-label="Recently ranked">
      <div className="recent__head">
        <h2 className="recs__title"><Icon name="clapper" size={20} /> Recently ranked</h2>
        {fullListHref && total > 0 && (
          <a className="profile__link" href={fullListHref}>View full list</a>
        )}
      </div>

      {total > 0 && (
        <div className="recent__search">
          <Icon name="search" size={16} />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setLimit(PAGE_SIZE)
            }}
            placeholder="Search ranked movies"
            aria-label="Search ranked movies"
          />
        </div>
      )}

      {orderError && order && (
        <div className="notice notice--error" role="alert">
          <span>{ORDER_ERROR}</span>
          <button type="button" className="row__btn" onClick={() => setOrderAttempt((n) => n + 1)}>Try again</button>
        </div>
      )}
      {reviewsError && (
        <div className="notice notice--error" role="alert">
          <span>{REVIEWS_ERROR}</span>
          <button type="button" className="row__btn" onClick={() => setReviewsError(false)}>Try again</button>
        </div>
      )}

      {body}
      {hasMore && <div ref={sentinel} className="recent__more" aria-hidden="true" />}
    </section>
  )
}
