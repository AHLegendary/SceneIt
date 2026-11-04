import { useState } from 'react'
import { acceptFriendRequest, sendFriendRequest, SEND_RESULTS } from '../lib/friends.js'

// The button that matches how you're already connected to this person.
// `relation` is 'friends' | 'outgoing' | 'incoming' | null; `ready` is whether
// the friends list has loaded (the button waits for it).
export default function FriendAction({ user, relation, ready }) {
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  async function run(action, success) {
    setBusy(true)
    setFlash(null)
    try {
      const result = await action(user.id)
      setFlash({ text: success(result), error: false })
    } catch (e) {
      setFlash({ text: e.message, error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="uprofile__action">
      {relation === 'friends' ? (
        <span className="friends__tag">Friends</span>
      ) : relation === 'outgoing' ? (
        <span className="friends__tag">Requested</span>
      ) : relation === 'incoming' ? (
        <button
          type="button"
          className="btn btn--sm"
          disabled={busy || !ready}
          onClick={() => run(acceptFriendRequest, () => `You and ${user.username} are now friends`)}
        >
          Accept request
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--sm"
          disabled={busy || !ready}
          onClick={() => run(sendFriendRequest, (result) => SEND_RESULTS[result] ?? 'Done')}
        >
          {busy ? 'Sending…' : 'Add friend'}
        </button>
      )}
      {flash && (
        <div className={`notice${flash.error ? ' notice--error' : ''}`} role={flash.error ? 'alert' : 'status'}>
          <span>{flash.text}</span>
        </div>
      )}
    </div>
  )
}
