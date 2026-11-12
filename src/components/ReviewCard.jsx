import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Avatar from './Avatar.jsx'
import Icon from './Icon.jsx'
import Poster from './Poster.jsx'
import ReviewEditor from './ReviewEditor.jsx'
import { posterUrl } from '../lib/localStore.js'
import { moderateText } from '../lib/moderation.js'

// A ranked movie as a card: poster, title, genres, the score (top right, once
// scores exist) and the user's review of it, if they wrote one. Used for the
// profile's "Recently ranked" list, and by the Community feed.
//
// The card only shows things; the parent owns the data:
//   movie        the movie object
//   score        number, or null while scores are locked (nothing is shown then)
//   review       { id, body, isSpoiler, commentCount } or null
//   author       { id, username, href } to show who wrote it, top left, linking
//                to their profile (the Community feed; a profile's own list
//                leaves it out, since everything on it is theirs)
//   isOwner      true on your own cards: the review gets a "..." menu
//   onOpenMovie  called with the movie id when the poster or title is clicked
//   onSaveReview async (review, { body, isSpoiler }): saves an edit, throws
//                an Error with a readable message on failure
//   onDeleteReview async (review): deletes the review, throws on failure
//   commentsHref where the comments live (the review's discussion page). The
//                row at the bottom only shows when this is given: "See 3
//                comments", or "Comment" when there are none (on your own
//                cards it's hidden until someone has commented)
export default function ReviewCard({ movie, score, review, author, isOwner = false, onOpenMovie, onSaveReview, onDeleteReview, commentsHref }) {
  const genres = movie.genres ?? []
  const count = review?.commentCount ?? 0
  const showComments = Boolean(review && commentsHref && (!isOwner || count > 0))

  return (
    <article className="rcard">
      {author && (
        <a className="rcard__author" href={author.href}>
          <Avatar userId={author.id} username={author.username} size={26} />
          <span>{author.username}</span>
        </a>
      )}
      <div className="rcard__inner">
        <button type="button" className="rcard__poster" onClick={() => onOpenMovie?.(movie.id)} aria-label={`Open ${movie.title}`}>
          <Poster title={movie.title} src={posterUrl(movie, 'w185')} size="md" />
        </button>
        <div className="rcard__main">
          <header className="rcard__head">
            <button type="button" className="rcard__title" onClick={() => onOpenMovie?.(movie.id)}>
              {movie.title}
              {movie.year ? <span className="rcard__year"> ({movie.year})</span> : null}
            </button>
            {score != null && (
              <span className="rcard__score" aria-label={`Score ${score.toFixed(1)}`}>{score.toFixed(1)}</span>
            )}
          </header>
          {genres.length > 0 && <p className="rcard__genres">{genres.join(' · ')}</p>}

          {review && (
            <ReviewSection
              key={review.id}
              review={review}
              isOwner={isOwner}
              onSave={onSaveReview}
              onDelete={onDeleteReview}
            />
          )}

          {showComments && (
            <a className="rcard__comments" href={commentsHref}>
              {count === 0 ? 'Comment' : `See ${count} ${count === 1 ? 'comment' : 'comments'}`}
            </a>
          )}
        </div>
      </div>
    </article>
  )
}

// The review itself: truncated text with Show more, spoilers blurred until
// clicked, and, for the author, the "..." menu with Edit and Delete.
function ReviewSection({ review, isOwner, onSave, onDelete }) {
  // 'view' | 'edit' | 'delete' (asking "are you sure?")
  const [mode, setMode] = useState('view')
  const [menuOpen, setMenuOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [draft, setDraft] = useState({ body: review.body, isSpoiler: review.isSpoiler })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef(null)

  // Close the menu on Escape or a click anywhere else.
  useEffect(() => {
    if (!menuOpen) return undefined
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false)
    const onClick = (e) => !menuRef.current?.contains(e.target) && setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [menuOpen])

  function startEdit() {
    setDraft({ body: review.body, isSpoiler: review.isSpoiler })
    setError(null)
    setMenuOpen(false)
    setMode('edit')
  }

  function startDelete() {
    setError(null)
    setMenuOpen(false)
    setMode('delete')
  }

  function cancel() {
    setError(null)
    setMode('view')
  }

  async function save() {
    if (!draft.body.trim()) return setError('Write something, or delete the review.')
    const verdict = moderateText(draft.body)
    if (!verdict.ok) return setError(verdict.reason)
    setBusy(true)
    try {
      await onSave(review, draft)
      setMode('view')
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
    return undefined
  }

  async function remove() {
    setBusy(true)
    try {
      await onDelete(review)
      // The parent drops the review, which unmounts this section.
    } catch (e) {
      setError(e.message)
      setMode('view')
      setBusy(false)
    }
  }

  if (mode === 'edit') {
    return (
      <section className="rcard__review" aria-label="Edit your review">
        <ReviewEditor
          label="Edit your review"
          labelHidden
          value={draft.body}
          onChange={(body) => {
            setError(null)
            setDraft((d) => ({ ...d, body }))
          }}
          isSpoiler={draft.isSpoiler}
          onSpoilerChange={(isSpoiler) => setDraft((d) => ({ ...d, isSpoiler }))}
          error={error}
          disabled={busy}
          rows={4}
          autoFocus
        />
        <div className="rcard__actions">
          <button type="button" className="btn btn--sm btn--ghost" onClick={cancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn--sm btn--accent" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>
    )
  }

  const hidden = review.isSpoiler && !revealed

  return (
    <section className="rcard__review" aria-label="Review">
      {isOwner && (
        <div className="rcard__menu" ref={menuRef}>
          <button
            type="button"
            className="rcard__more"
            aria-label="Review options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name="more" size={18} strokeWidth={3} />
          </button>
          {menuOpen && (
            <div className="rcard__menulist" role="menu" aria-label="Review options">
              <button type="button" role="menuitem" onClick={startEdit}>Edit</button>
              <button type="button" role="menuitem" onClick={startDelete}>Delete</button>
            </div>
          )}
        </div>
      )}

      {review.isSpoiler && revealed && <span className="rcard__tag">Spoiler</span>}

      <ClampedText
        text={review.body}
        expanded={expanded}
        onToggle={() => setExpanded((open) => !open)}
        blurred={hidden}
        onReveal={() => setRevealed(true)}
      />

      {error && <p className="reviewbox__error" role="alert">{error}</p>}

      {mode === 'delete' && (
        <div className="rcard__confirm" role="alertdialog" aria-label="Delete review">
          <span>Delete this review? This can't be undone.</span>
          <span className="rcard__actions">
            <button type="button" className="btn btn--sm btn--ghost" onClick={cancel} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn--sm btn--accent" onClick={remove} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </span>
        </div>
      )}
    </section>
  )
}

// Review text cut to about 4 lines. "Show more" appears only when something is
// actually cut off (measured, since it depends on the width), and expands the
// text in place. A blurred (spoiler) review shows a button instead of the
// toggle and can't be read until it's clicked.
function ClampedText({ text, expanded, onToggle, blurred, onReveal }) {
  const ref = useRef(null)
  const [overflowing, setOverflowing] = useState(false)

  // While collapsed, check whether the full text is taller than the box.
  // Once expanded the answer is kept, so "Show less" stays available.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || expanded) return undefined
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, expanded])

  return (
    <div className="rcard__body">
      <p
        ref={ref}
        className={`rcard__text${expanded ? '' : ' is-clamped'}${blurred ? ' is-blurred' : ''}`}
        aria-hidden={blurred ? 'true' : undefined}
      >
        {text}
      </p>
      {blurred ? (
        <button type="button" className="rcard__reveal" onClick={onReveal}>
          Spoiler: click to show
        </button>
      ) : (
        (overflowing || expanded) && (
          <button type="button" className="rcard__toggle" onClick={onToggle} aria-expanded={expanded}>
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )
      )}
    </div>
  )
}
