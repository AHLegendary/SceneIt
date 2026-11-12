import { useState } from 'react'
import ReviewEditor from './ReviewEditor.jsx'
import { MAX_REPORT_REASON_LENGTH } from '../lib/reviews.js'

// "Report" for a review or a comment: a link that opens a small form asking
// why, then thanks the person. Reports are never shown to other users, so
// after sending there is nothing to undo.
//
//   what      what is being reported, for the accessible names ("review",
//             "comment by bob")
//   onReport  async (reason): files the report, throws an Error with a
//             readable message on failure (including "already reported")
export default function ReportControl({ what, onReport }) {
  // 'idle' | 'open' | 'sent'
  const [phase, setPhase] = useState('idle')
  const [reason, setReason] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function send() {
    if (!reason.trim()) return setError('Tell us what is wrong first.')
    setBusy(true)
    try {
      await onReport(reason)
      setPhase('sent')
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
    return undefined
  }

  if (phase === 'sent') return <span className="report__thanks" role="status">Reported. Thanks, we'll take a look.</span>

  if (phase === 'idle') {
    return (
      <button type="button" className="linkbtn" onClick={() => setPhase('open')} aria-label={`Report ${what}`}>
        Report
      </button>
    )
  }

  return (
    <div className="report" role="group" aria-label={`Report ${what}`}>
      <ReviewEditor
        label={`Why are you reporting this ${what.split(' ')[0]}?`}
        value={reason}
        onChange={(text) => {
          setError(null)
          setReason(text)
        }}
        max={MAX_REPORT_REASON_LENGTH}
        rows={3}
        error={error}
        disabled={busy}
        autoFocus
      />
      <div className="composer__actions">
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setPhase('idle'); setError(null) }} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn--sm btn--accent" onClick={send} disabled={busy}>
          {busy ? 'Sending…' : 'Send report'}
        </button>
      </div>
    </div>
  )
}
