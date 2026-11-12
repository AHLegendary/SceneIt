import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import ReviewCard from './ReviewCard.jsx'
import Segmented from './Segmented.jsx'
import { useNavMemory } from '../lib/navMemory.js'
import { FEED_MAX, FEED_PAGE, fetchReviewFeed } from '../lib/reviewFeed.js'
import { reviewHref, userHref } from '../lib/route.js'
import { useNearBottom } from '../lib/useNearBottom.js'

const SCOPE_OPTIONS = [
  { id: 'friends', label: 'Friends' },
  { id: 'everyone', label: 'Everyone' },
]
const SORT_OPTIONS = [
  { id: 'recent', label: 'Recent' },
  { id: 'discussed', label: 'Most discussed' },
]

const EMPTY_TEXT = {
  everyone: 'No reviews yet. Rank a movie and write the first one.',
  friends: 'No reviews from your friends yet. Switch to Everyone, or add some friends.',
}

// The Community page's Reviews tab: one centered column of review cards from
// the whole community, or just your friends, newest or most discussed first.
// Only people whose profile you may see appear (the database decides), and
// only reviews, so every card has text. It grows as you scroll, 20 at a time.
//
// Logged out you see public profiles' reviews and there is no Friends filter.
// After Back (see lib/navMemory.js) the filters and the loaded cards come back
// as you left them, and the list is quietly reloaded so counts are fresh.
export default function ReviewsFeed({ account, onOpen }) {
  const viewerId = account.user?.id ?? null
  const signedIn = account.status === 'ready'
  const accountLoading = account.status === 'loading'
  const { recalled, save } = useNavMemory('community-reviews')
  const [scope, setScope] = useState(recalled?.scope ?? 'everyone')
  const [sort, setSort] = useState(recalled?.sort ?? 'recent')
  // The loaded pages: { key, items, hasMore }. `key` says which filters (and
  // which viewer) they are for, so a change shows "Loading" instead of the
  // previous list.
  const [feed, setFeed] = useState(recalled?.feed ?? null)
  const [firstError, setFirstError] = useState(null) // { key, message }
  const [more, setMore] = useState({ key: null, status: 'idle', message: null })
  const [attempt, setAttempt] = useState(0) // bumped by "Try again"
  const feedRef = useRef(feed)
  useEffect(() => {
    feedRef.current = feed
  })

  // Logged out there is only "Everyone".
  const activeScope = signedIn ? scope : 'everyone'
  const key = `${activeScope}|${sort}|${viewerId}|${attempt}`
  const loaded = feed?.key === key ? feed : null

  // Hold the state for Back.
  useEffect(() => {
    save({ scope, sort, feed })
  }, [save, scope, sort, feed])

  // The first page. Waits for the login check: what you may see depends on it.
  // When the same list is already on screen (restored after Back), it asks for
  // as many reviews as are showing instead, to refresh them in place.
  useEffect(() => {
    if (accountLoading) return undefined
    let current = true
    const cached = feedRef.current?.key === key ? feedRef.current : null
    const limit = cached ? Math.min(Math.max(cached.items.length, FEED_PAGE), FEED_MAX) : FEED_PAGE
    fetchReviewFeed({ scope: activeScope, sort, limit, offset: 0 }).then(
      ({ items, count }) => {
        if (!current) return
        setFeed({ key, items, hasMore: count >= limit })
        setFirstError(null)
      },
      (error) => current && setFirstError({ key, message: error.message }),
    )
    return () => {
      current = false
    }
  }, [key, accountLoading, activeScope, sort])

  const loadMore = useCallback(() => {
    const showing = feedRef.current
    if (!showing || showing.key !== key || !showing.hasMore) return
    setMore({ key, status: 'loading', message: null })
    fetchReviewFeed({ scope: activeScope, sort, limit: FEED_PAGE, offset: showing.items.length }).then(
      ({ items, count }) => {
        // Ignore the answer if the filters changed while it was on its way.
        setFeed((previous) => {
          if (!previous || previous.key !== key) return previous
          const seen = new Set(previous.items.map((item) => item.review.id))
          return { ...previous, items: [...previous.items, ...items.filter((item) => !seen.has(item.review.id))], hasMore: count >= FEED_PAGE }
        })
        setMore({ key, status: 'idle', message: null })
      },
      (error) => setMore({ key, status: 'error', message: error.message }),
    )
  }, [key, activeScope, sort])

  const moreStatus = more.key === key ? more.status : 'idle'
  const sentinel = useNearBottom(loadMore, Boolean(loaded?.hasMore) && moreStatus === 'idle', loaded?.items.length ?? 0)

  let body
  if (loaded) {
    body = loaded.items.length === 0 ? (
      <p className="uprofile__muted">{EMPTY_TEXT[activeScope]}</p>
    ) : (
      <ul className="feed__list">
        {loaded.items.map(({ review, author, movie, score }) => (
          <li key={review.id}>
            <ReviewCard
              movie={movie}
              score={score}
              review={review}
              author={{ id: author.id, username: author.username, href: author.id === viewerId ? '#/profile' : userHref(author.username) }}
              onOpenMovie={onOpen}
              commentsHref={reviewHref(author.username, review.id)}
            />
          </li>
        ))}
      </ul>
    )
  } else if (firstError?.key === key) {
    body = (
      <div className="profile__alert" role="alert">
        {firstError.message}{' '}
        <button type="button" className="profile__link" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    )
  } else {
    body = <p className="uprofile__muted">Loading reviews…</p>
  }

  return (
    <section className="page feed">
      <header className="page__head">
        <div>
          <h1 className="page__title"><Icon name="clapper" size={30} />Reviews</h1>
          <p className="page__sub">What the SceneIt community is saying about the movies they rank.</p>
        </div>
        <div className="page__controls">
          {signedIn && <Segmented label="Show reviews from" options={SCOPE_OPTIONS} value={scope} onChange={setScope} />}
          <Segmented label="Sort reviews by" options={SORT_OPTIONS} value={sort} onChange={setSort} />
        </div>
      </header>

      {body}

      {moreStatus === 'loading' && <p className="uprofile__muted">Loading more…</p>}
      {moreStatus === 'error' && (
        <div className="notice notice--error" role="alert">
          <span>{more.message}</span>
          <button type="button" className="row__btn" onClick={() => setMore({ key, status: 'idle', message: null })}>Try again</button>
        </div>
      )}
      {loaded?.hasMore && <div ref={sentinel} className="recent__more" aria-hidden="true" />}
    </section>
  )
}
