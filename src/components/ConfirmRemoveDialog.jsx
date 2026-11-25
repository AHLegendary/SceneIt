import { useEffect, useId } from 'react'
import useFocusTrap from '../lib/useFocusTrap.js'

// Asks before removing a ranked movie, since removing also deletes its review (issue #92).
export default function ConfirmRemoveDialog({ title, onConfirm, onCancel }) {
  const titleId = useId()
  const trapRef = useFocusTrap()

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="overlay overlay--top overlay--center" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={trapRef} className="dialog unlocked" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="unlocked__title">Remove {title}?</h2>
        <p className="unlocked__text">
          This removes <strong>{title}</strong> from your ranked list and deletes your review of it. You can't undo this.
        </p>
        <div className="unlocked__actions">
          <button type="button" className="btn btn--light" onClick={onCancel} autoFocus>Cancel</button>
          <button type="button" className="btn btn--danger" onClick={onConfirm}>Remove</button>
        </div>
      </div>
    </div>
  )
}
