import { useId } from 'react'
import { MAX_REVIEW_LENGTH } from '../lib/reviews.js'

// The counter turns red once this much of the limit is used.
const WARN_AT = 0.9

// Textarea with a live "142 / 2000" counter and, optionally, a "Contains
// spoilers" toggle. Controlled: the parent owns the text and the flag, so it
// can save them however it likes. Used by the ranking flow's review step, and
// by editing a review and writing comments later.
//
// `error` is a message to show under the box (a moderation block, a failed
// save). `label` is the visible label; pass `labelHidden` to keep it for
// screen readers only.
export default function ReviewEditor({
  value,
  onChange,
  isSpoiler = false,
  onSpoilerChange,
  max = MAX_REVIEW_LENGTH,
  label,
  labelHidden = false,
  placeholder,
  error,
  disabled = false,
  rows = 5,
  autoFocus = false,
}) {
  const id = useId()
  const errorId = `${id}-error`
  const length = value.length
  const near = length >= max * WARN_AT

  return (
    <div className="reviewbox">
      <label className={labelHidden ? 'sr-only' : 'reviewbox__label'} htmlFor={id}>{label}</label>
      <textarea
        id={id}
        className="reviewbox__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={max}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      <div className="reviewbox__foot">
        {onSpoilerChange ? (
          <label className="reviewbox__spoiler">
            <input
              type="checkbox"
              checked={isSpoiler}
              onChange={(e) => onSpoilerChange(e.target.checked)}
              disabled={disabled}
            />
            Contains spoilers
          </label>
        ) : <span />}
        <span
          className={`reviewbox__count${near ? ' is-near' : ''}`}
          aria-label={`${length} of ${max} characters`}
        >
          {length} / {max}
        </span>
      </div>
      {error && <p className="reviewbox__error" id={errorId} role="alert">{error}</p>}
    </div>
  )
}
