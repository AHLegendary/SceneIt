import { useState } from 'react'
import Avatar from './Avatar.jsx'
import ReportControl from './ReportControl.jsx'
import ReviewEditor from './ReviewEditor.jsx'
import { moderateText } from '../lib/moderation.js'
import { MAX_COMMENT_LENGTH, threadComments } from '../lib/reviews.js'
import { userHref } from '../lib/route.js'

// The comments under a review: a box to write one, then each comment with its
// replies (one level: a reply can't be replied to). Everything is shown, the
// parent owns the data and the saving:
//
//   comments        flat list from fetchComments(), with usernames
//   viewerId        who is looking, or null when logged out
//   reviewAuthorId  the review's author, who may delete any comment
//   canWrite        logged in: can comment, reply and report
//   onAdd           async (text, parentId | null)
//   onEdit          async (comment, text)
//   onDelete        async (comment)
//   flashId         id of a comment to highlight for a moment (a notification link), or null
//   onReport        async (comment, reason)
//   onLogin         what the "Log in" button does when logged out
//
// The handlers throw an Error with a readable message on failure; the form
// that called them shows it and keeps what was typed.
export default function Comments({ comments, viewerId, reviewAuthorId, canWrite, flashId = null, onAdd, onEdit, onDelete, onReport, onLogin }) {
  const thread = threadComments(comments)

  return (
    <section className="comments" aria-labelledby="comments-title">
      <h2 className="recs__title" id="comments-title">
        {comments.length === 0 ? 'Comments' : `Comments (${comments.length})`}
      </h2>

      {canWrite ? (
        <Composer label="Add a comment" placeholder="Join the discussion" submitLabel="Comment" onSubmit={(text) => onAdd(text, null)} />
      ) : (
        onLogin && (
          <div className="notice">
            <span>Log in to join the discussion.</span>
            <button type="button" className="btn btn--sm btn--light" onClick={onLogin}>Log in</button>
          </div>
        )
      )}

      {thread.length === 0 ? (
        <p className="uprofile__muted">No comments yet.{canWrite ? ' Be the first.' : ''}</p>
      ) : (
        <ul className="comments__list">
          {thread.map((comment) => (
            <li key={comment.id}>
              <Comment
                comment={comment}
                viewerId={viewerId}
                reviewAuthorId={reviewAuthorId}
                canWrite={canWrite}
                canReply
                flashing={flashId === comment.id}
                onAdd={onAdd}
                onEdit={onEdit}
                onDelete={onDelete}
                onReport={onReport}
              />
              {comment.replies.length > 0 && (
                <ul className="comments__replies" aria-label={`Replies to ${comment.username ?? 'this comment'}`}>
                  {comment.replies.map((reply) => (
                    <li key={reply.id}>
                      <Comment
                        comment={reply}
                        viewerId={viewerId}
                        reviewAuthorId={reviewAuthorId}
                        canWrite={canWrite}
                        flashing={flashId === reply.id}
                        onAdd={onAdd}
                        onEdit={onEdit}
                        onDelete={onDelete}
                        onReport={onReport}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function formatDate(iso) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// One comment or reply, with what the viewer may do to it:
//   Reply   top-level comments only, when logged in
//   Edit    your own
//   Delete  your own, or any comment on a review you wrote
//   Report  other people's, when logged in
function Comment({ comment, viewerId, reviewAuthorId, canWrite, canReply = false, flashing = false, onAdd, onEdit, onDelete, onReport }) {
  // 'view' | 'edit' | 'reply' | 'delete'
  const [mode, setMode] = useState('view')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const name = comment.username ?? 'Someone'
  const mine = viewerId !== null && comment.userId === viewerId
  const canDelete = mine || (viewerId !== null && viewerId === reviewAuthorId)
  const edited = comment.updatedAt !== comment.createdAt

  async function remove() {
    setBusy(true)
    try {
      await onDelete(comment)
    } catch (e) {
      setError(e.message)
      setMode('view')
      setBusy(false)
    }
  }

  return (
    // The id is what a notification link scrolls to (#/u/<name>/review/<id>/c/<commentId>).
    <article id={`comment-${comment.id}`} className={flashing ? 'comment is-flash' : 'comment'} aria-label={`Comment by ${name}`}>
      <Avatar userId={comment.userId} username={comment.username} size={32} />
      <div className="comment__main">
        <header className="comment__head">
          {comment.username ? (
            <a className="comment__name" href={mine ? '#/profile' : userHref(comment.username)}>{name}</a>
          ) : (
            <span className="comment__name">{name}</span>
          )}
          <span>{formatDate(comment.createdAt)}</span>
          {edited && <span>(edited)</span>}
        </header>

        {mode === 'edit' ? (
          <Composer
            label="Edit your comment"
            initial={comment.body}
            submitLabel="Save"
            onSubmit={async (text) => {
              await onEdit(comment, text)
              setMode('view')
            }}
            onCancel={() => setMode('view')}
            rows={3}
          />
        ) : (
          <p className="comment__body">{comment.body}</p>
        )}

        {error && <p className="reviewbox__error" role="alert">{error}</p>}

        {mode === 'delete' && (
          <div className="rcard__confirm" role="alertdialog" aria-label="Delete comment">
            <span>Delete this comment{comment.parentId ? '' : ' and its replies'}?</span>
            <span className="rcard__actions">
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setMode('view')} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn--sm btn--accent" onClick={remove} disabled={busy}>
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </span>
          </div>
        )}

        {mode !== 'edit' && mode !== 'delete' && (
          <div className="comment__actions">
            {canWrite && canReply && (
              <button type="button" className="linkbtn" onClick={() => { setError(null); setMode(mode === 'reply' ? 'view' : 'reply') }} aria-label={`Reply to ${name}`}>
                Reply
              </button>
            )}
            {mine && (
              <button type="button" className="linkbtn" onClick={() => { setError(null); setMode('edit') }} aria-label={`Edit comment by ${name}`}>
                Edit
              </button>
            )}
            {canDelete && (
              <button type="button" className="linkbtn linkbtn--danger" onClick={() => { setError(null); setMode('delete') }} aria-label={`Delete comment by ${name}`}>
                Delete
              </button>
            )}
            {canWrite && !mine && (
              <ReportControl what={`comment by ${name}`} onReport={(reason) => onReport(comment, reason)} />
            )}
          </div>
        )}

        {mode === 'reply' && (
          <Composer
            label={`Reply to ${name}`}
            placeholder={`Reply to ${name}`}
            submitLabel="Reply"
            onSubmit={async (text) => {
              await onAdd(text, comment.id)
              setMode('view')
            }}
            onCancel={() => setMode('view')}
            rows={3}
            autoFocus
          />
        )}
      </div>
    </article>
  )
}

// A textarea with a counter and a submit button. The text stays when saving
// fails or the content check blocks it, and clears after a successful new
// comment (the parent closes it for edits and replies).
function Composer({ label, placeholder, submitLabel, initial = '', onSubmit, onCancel, rows = 3, autoFocus = false }) {
  const [text, setText] = useState(initial)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!text.trim()) return setError('Write something first.')
    const verdict = moderateText(text)
    if (!verdict.ok) return setError(verdict.reason)
    setBusy(true)
    try {
      await onSubmit(text)
      setText(initial)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
    return undefined
  }

  return (
    <div className="composer">
      <ReviewEditor
        label={label}
        labelHidden
        placeholder={placeholder}
        value={text}
        onChange={(next) => {
          setError(null)
          setText(next)
        }}
        max={MAX_COMMENT_LENGTH}
        rows={rows}
        error={error}
        disabled={busy}
        autoFocus={autoFocus}
      />
      <div className="composer__actions">
        {onCancel && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        )}
        <button type="button" className="btn btn--sm btn--accent" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  )
}
