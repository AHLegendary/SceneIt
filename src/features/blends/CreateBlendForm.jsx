import { useState } from 'react'

// Friend picker used for creating a blend and for inviting someone to one.
// onSubmit(friendIds) may throw an Error with a user-facing message, which is
// shown here with the button turned into a retry.
export default function CreateBlendForm({ title, friends, maxSelect, submitLabel, onSubmit, onCancel }) {
  const [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const atMax = selected.length >= maxSelect

  function toggle(id) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(selected)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <form className="blend-form" onSubmit={submit}>
      <h2 className="recs__title">{title}</h2>
      <p className="friends__hint">
        Pick up to {maxSelect} {maxSelect === 1 ? 'friend' : 'friends'}.
      </p>
      <ul className="board friends__list">
        {friends.map((friend) => {
          const checked = selected.includes(friend.id)
          return (
            <li key={friend.id}>
              <label className="frow blend-form__pick">
                <span className="frow__avatar" aria-hidden="true">{friend.username.charAt(0).toUpperCase()}</span>
                <span className="frow__info">
                  <span className="frow__name">{friend.username}</span>
                </span>
                <span className="frow__actions">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy || (atMax && !checked)}
                    onChange={() => toggle(friend.id)}
                  />
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      {error && <div className="notice notice--error" role="alert"><span>{error}</span></div>}
      <div className="blend-form__actions">
        <button type="submit" className="btn btn--sm" disabled={busy || selected.length === 0}>
          {busy ? 'Sending…' : error ? 'Try again' : submitLabel}
        </button>
        <button type="button" className="row__btn" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
