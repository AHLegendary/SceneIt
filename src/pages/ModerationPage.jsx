import { useEffect, useState } from 'react'
import Segmented from '../components/Segmented.jsx'
import { MAX_HIDE_REASON_LENGTH, loadReports, moderate } from '../lib/moderationQueue.js'
import { reviewCommentHref, reviewHref } from '../lib/route.js'
import { timeAgo } from '../lib/timeAgo.js'
import { useModerationQueue } from '../lib/useModerationQueue.js'
import './ProfilePage.css'

const TABS = [
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
]

const EMPTY = { open: 'No open reports.', resolved: 'Nothing resolved yet.' }

// The moderation queue, at #/moderation: one card per reported review or
// comment, with what was reported, why, and what you can do about it.
// Moderators only. The database checks that again on every call, so this page
// is a convenience, not the lock.
export default function ModerationPage({ account }) {
  if (!account.profileLoaded) {
    return (
      <section className="page modq">
        <p className="page__sub">Loading…</p>
      </section>
    )
  }
  if (!account.isModerator) {
    return (
      <section className="page modq">
        <h1 className="page__title">Moderation</h1>
        <p className="page__sub">You don't have access to this page.</p>
      </section>
    )
  }
  return <Queue />
}

function Queue() {
  const [tab, setTab] = useState('open')
  const queue = useModerationQueue()

  useEffect(() => {
    loadReports(tab)
  }, [tab])

  return (
    <section className="page modq">
      <h1 className="page__title">Moderation</h1>
      <div className="community__tabs">
        <Segmented label="Moderation sections" options={TABS} value={tab} onChange={setTab} />
      </div>

      {queue.status === 'error' ? (
        <div className="profile__alert" role="alert">
          {queue.error}{' '}
          <button type="button" className="profile__link" onClick={() => loadReports(tab)}>Try again</button>
        </div>
      ) : queue.status !== 'ready' || queue.filter !== tab ? (
        <p className="uprofile__muted">Loading reports…</p>
      ) : queue.list.length === 0 ? (
        <p className="uprofile__muted">{EMPTY[tab]}</p>
      ) : (
        <ul className="modq__list">
          {queue.list.map((report) => (
            <li key={report.key}>
              <ReportCard report={report} tab={tab} error={queue.rowErrors[report.key]} busy={Boolean(queue.busy[report.key])} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ReportCard({ report, tab, error, busy }) {
  const [hiding, setHiding] = useState(false)
  const [reason, setReason] = useState('')

  const kind = report.targetType === 'review' ? 'Review' : 'Comment'
  const author = report.targetAuthorUsername ?? 'a deleted user'
  const contextHref = report.reviewAuthorUsername
    ? report.targetType === 'review'
      ? reviewHref(report.reviewAuthorUsername, report.reviewId)
      : reviewCommentHref(report.reviewAuthorUsername, report.reviewId, report.targetId)
    : null
  const changed = !report.isDeleted && report.currentBody !== report.reportedBody
  const canHide = !report.isDeleted && !report.isHidden
  const canRestore = report.isHidden && !report.isDeleted

  async function hide() {
    if (await moderate(report.targetType, report.targetId, 'hide', reason)) setHiding(false)
  }

  return (
    <article className="modq__card" aria-label={`${kind} by ${author}`}>
      <header className="modq__head">
        <h2 className="modq__title">
          {kind} by <strong>{author}</strong>
        </h2>
        {report.isHidden && <span className="comment__hidden">Hidden</span>}
        {contextHref && <a className="profile__link" href={contextHref}>View in context</a>}
      </header>

      <div className="modq__text">
        <span className="modq__label">Reported text</span>
        <blockquote className="modq__quote">{report.reportedBody ?? '(not saved)'}</blockquote>
        {changed && (
          <>
            <span className="modq__label">Now:</span>
            <blockquote className="modq__quote">{report.currentBody}</blockquote>
          </>
        )}
        {report.isDeleted && <p className="modq__deleted">Deleted by the author</p>}
      </div>

      <div className="modq__reports">
        <span className="modq__label">{report.reportCount === 1 ? '1 report' : `${report.reportCount} reports`}</span>
        <ul>
          {report.reports.map((r, i) => (
            <li key={i}>
              “{r.reason}” <span className="modq__by">{r.reporter ?? 'someone'} · {timeAgo(r.createdAt)}</span>
            </li>
          ))}
        </ul>
      </div>

      {tab === 'resolved' && (
        <p className="modq__outcome">
          {report.status === 'hidden' ? 'Hidden' : 'Dismissed'} by {report.resolvedByUsername ?? 'a moderator'}
          {report.resolvedAt ? ` · ${timeAgo(report.resolvedAt)}` : ''}
        </p>
      )}

      {error && <p className="reviewbox__error" role="alert">{error}</p>}

      {hiding ? (
        <div className="modq__hide">
          <label className="modq__label" htmlFor={`reason-${report.key}`}>Reason (optional)</label>
          <textarea
            id={`reason-${report.key}`}
            className="reviewbox__input"
            rows={2}
            maxLength={MAX_HIDE_REASON_LENGTH}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Shown to the author and other moderators"
          />
          <span className="rcard__actions">
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setHiding(false)}>Cancel</button>
            <button type="button" className="btn btn--sm btn--accent" onClick={hide}>Hide it</button>
          </span>
        </div>
      ) : (
        <div className="modq__actions">
          {tab === 'open' && canHide && (
            <button type="button" className="btn btn--sm btn--accent" onClick={() => setHiding(true)}>Hide</button>
          )}
          {tab === 'open' && (
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => moderate(report.targetType, report.targetId, 'dismiss')}>
              Dismiss
            </button>
          )}
          {canRestore && (
            <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => moderate(report.targetType, report.targetId, 'restore')}>
              Restore
            </button>
          )}
        </div>
      )}
    </article>
  )
}
