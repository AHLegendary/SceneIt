import { useEffect, useState } from 'react'
import Avatar from '../components/Avatar.jsx'
import Comments from '../components/Comments.jsx'
import Icon from '../components/Icon.jsx'
import ReportControl from '../components/ReportControl.jsx'
import ReviewCard from '../components/ReviewCard.jsx'
import { scoreTiers } from '../features/ranking/scores.js'
import { cancelScrollRestore, goBack } from '../lib/navMemory.js'
import {
  addComment,
  deleteComment,
  deleteReview,
  fetchComments,
  fetchReviewPage,
  reportContent,
  updateComment,
  updateReview,
} from '../lib/reviews.js'
import { userHref } from '../lib/route.js'
import { useUserTiers } from '../lib/useUserTiers.js'
import './ProfilePage.css'

const LOAD_ERROR = "Couldn't load this review. Check your connection and try again."
const COMMENTS_ERROR = "Couldn't load the comments. Check your connection and try again."

// What the "Log in" button does: the login page.
function toLogin() {
  window.location.hash = '/login'
}

// One review and the discussion under it, at #/u/<username>/review/<id>.
// Anyone can read it if they could see the author's profile (the database
// decides; a review you can't see looks the same as one that doesn't exist).
// Logged in, you can comment, reply to a comment, edit or delete your own
// comments, and report the review or a comment. The review's author can
// delete any comment on it.
//
// The username in the address is only for readable links: what's shown comes
// from the review itself.
export default function ReviewPage({ reviewId, commentId = null, account, onOpen }) {
  const viewerId = account.user?.id ?? null
  const signedIn = account.status === 'ready'
  const accountLoading = account.status === 'loading'

  // { status: 'loading' | 'ready' | 'missing' | 'error', page }
  const [load, setLoad] = useState({ status: 'loading', page: null })
  const [attempt, setAttempt] = useState(0)
  // { status: 'loading' | 'ready' | 'error', list }
  const [thread, setThread] = useState({ status: 'loading', list: [] })

  // The comment whose highlight has already faded (see the effect below).
  const [flashedId, setFlashedId] = useState(null)

  const author = load.page?.author ?? null
  const authorTiers = useUserTiers(author?.id ?? null)

  // Load the review, and then its comments. Waits for the login check, since
  // what you may see depends on it (a friend's private review, for one).
  useEffect(() => {
    if (accountLoading) return undefined
    let current = true
    fetchReviewPage(reviewId).then(
      (page) => {
        if (!current) return undefined
        setLoad(page ? { status: 'ready', page } : { status: 'missing', page: null })
        if (!page) return undefined
        // The comments load after the review, and failing to load them
        // doesn't hide it.
        return fetchComments(reviewId).then(
          (list) => current && setThread({ status: 'ready', list }),
          () => current && setThread({ status: 'error', list: [] }),
        )
      },
      () => current && setLoad({ status: 'error', page: null }),
    )
    return () => {
      current = false
    }
  }, [reviewId, viewerId, accountLoading, attempt])

  // Opened from a comment link (a notification): once the comments are on the
  // page, scroll to that comment and flash it for a moment. This is a
  // deliberate scroll, so it first cancels any saved-position restore that is
  // still waiting for the page to grow (navMemory), or that would win later.
  // If the comment isn't there (deleted since the link was made), the page
  // just shows normally.
  useEffect(() => {
    if (!commentId || thread.status !== 'ready') return undefined
    const element = document.getElementById(`comment-${commentId}`)
    if (!element) return undefined
    cancelScrollRestore()
    element.scrollIntoView({ block: 'center' })
    const timer = setTimeout(() => setFlashedId(commentId), 2000)
    return () => clearTimeout(timer)
  }, [commentId, thread.status])
  // Highlighted from when the comments show until the timer above fires.
  const flashId = commentId && thread.status === 'ready' && flashedId !== commentId ? commentId : null

  const retry = () => {
    setLoad({ status: 'loading', page: null })
    setThread({ status: 'loading', list: [] })
    setAttempt((n) => n + 1)
  }

  const back = (
    <button type="button" className="btn btn--sm btn--ghost discuss__back" onClick={() => goBack(author?.username ? userHref(author.username) : '#/home')}>
      <Icon name="arrow" size={16} className="discuss__backicon" />
      Back
    </button>
  )

  if (load.status === 'loading' || accountLoading) {
    return (
      <section className="page discuss">
        {back}
        <p className="page__sub">Loading review…</p>
      </section>
    )
  }

  if (load.status === 'error') {
    return (
      <section className="page discuss">
        {back}
        <div className="profile__alert" role="alert">
          {LOAD_ERROR}{' '}
          <button type="button" className="profile__link" onClick={retry}>Try again</button>
        </div>
      </section>
    )
  }

  if (load.status === 'missing') {
    return (
      <section className="page discuss">
        {back}
        <h1 className="page__title">Review not found</h1>
        <p className="page__sub">This review doesn't exist, or it's on a private profile.</p>
      </section>
    )
  }

  const { review, movie } = load.page
  const mine = viewerId !== null && review.userId === viewerId
  const score = scoreTiers(authorTiers.tiers)?.get(review.movieId) ?? null
  const profileHref = mine ? '#/profile' : author.username ? userHref(author.username) : null
  const fallbackHref = mine ? '#/profile' : author.username ? userHref(author.username) : '#/home'

  async function saveReview(_review, { body, isSpoiler }) {
    const saved = await updateReview(review.id, { body, isSpoiler })
    setLoad((previous) => ({ ...previous, page: { ...previous.page, review: { ...review, ...saved } } }))
  }

  async function removeReview() {
    await deleteReview(review.id)
    goBack(fallbackHref)
  }

  async function add(text, parentId) {
    const saved = await addComment(review.id, text, parentId)
    setThread((previous) => ({ ...previous, list: [...previous.list, { ...saved, username: account.username ?? null }] }))
  }

  async function edit(comment, text) {
    const saved = await updateComment(comment.id, text)
    setThread((previous) => ({
      ...previous,
      list: previous.list.map((c) => (c.id === comment.id ? { ...c, body: saved.body, updatedAt: saved.updatedAt } : c)),
    }))
  }

  async function remove(comment) {
    await deleteComment(comment.id)
    // Deleting a comment deletes its replies too.
    setThread((previous) => ({
      ...previous,
      list: previous.list.filter((c) => c.id !== comment.id && c.parentId !== comment.id),
    }))
  }

  return (
    <section className="page discuss">
      {back}
      <header className="discuss__head">
        <h1 className="page__title">Review{movie ? ` of ${movie.title}` : ''}</h1>
        <p className="discuss__by">
          <Avatar userId={author.id} username={author.username} size={28} />
          <span>
            by{' '}
            {profileHref ? <a className="profile__link" href={profileHref}>{mine ? 'you' : author.username}</a> : 'someone'}
          </span>
        </p>
      </header>

      {movie ? (
        <ReviewCard
          movie={movie}
          score={score}
          review={review}
          isOwner={mine}
          onOpenMovie={onOpen}
          onSaveReview={saveReview}
          onDeleteReview={removeReview}
        />
      ) : (
        <p className="uprofile__muted">This movie isn't available any more.</p>
      )}
      {signedIn && !mine && (
        <div className="discuss__report">
          <ReportControl what="review" onReport={(reason) => reportContent('review', review.id, reason)} />
        </div>
      )}

      {thread.status === 'error' ? (
        <div className="profile__alert" role="alert">
          {COMMENTS_ERROR}{' '}
          <button type="button" className="profile__link" onClick={retry}>Try again</button>
        </div>
      ) : thread.status === 'loading' ? (
        <p className="uprofile__muted">Loading comments…</p>
      ) : (
        <Comments
          comments={thread.list}
          viewerId={viewerId}
          reviewAuthorId={review.userId}
          canWrite={signedIn}
          flashId={flashId}
          onAdd={add}
          onEdit={edit}
          onDelete={remove}
          onReport={(comment, reason) => reportContent('comment', comment.id, reason)}
          onLogin={toLogin}
        />
      )}
    </section>
  )
}
