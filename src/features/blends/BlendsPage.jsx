import { useEffect, useState } from 'react'
import { loadFriends } from '../../lib/friends.js'
import { blendHref } from '../../lib/route.js'
import { useFriendGroups, useFriends } from '../../lib/useFriends.js'
import { useMyList } from '../../lib/useMyList.js'
import {
  BLEND_MAX_MEMBERS,
  BLEND_MIN_RANKINGS,
  createBlend,
  loadBlends,
  respondToInvite,
  setBlendNotice,
} from './blends.js'
import CreateBlendForm from './CreateBlendForm.jsx'
import { useBlends } from './useBlends.js'

function openBlend(blendId) {
  window.location.hash = blendHref(blendId)
}

// The Movie Blend widget: invites waiting for you, your blends, and a way to
// start a new one.
export default function BlendsPage() {
  const { status, blends, invites, error, notice } = useBlends()
  const { status: friendsStatus, error: friendsError } = useFriends()
  const { friends } = useFriendGroups()
  const rankedCount = useMyList().length
  const [creating, setCreating] = useState(false)
  const [busyInvite, setBusyInvite] = useState(null)
  // { text, retry } shown after an invite answer fails
  const [flash, setFlash] = useState(null)

  const needsRankings = rankedCount < BLEND_MIN_RANKINGS
  const needsFriends = friendsStatus === 'ready' && friends.length === 0
  const canCreate = !needsRankings && friendsStatus === 'ready' && friends.length > 0

  // Someone may have invited you, or joined one of your blends, since the last
  // load. Blends already on screen stay there while this runs.
  useEffect(() => {
    loadBlends()
  }, [])

  async function respond(invite, accept) {
    setBusyInvite(invite.id)
    setFlash(null)
    try {
      const blendId = await respondToInvite(invite.id, accept)
      if (accept) openBlend(blendId)
    } catch (e) {
      // Only connection failures are worth retrying. A full or expired invite won't change.
      setFlash({ text: e.message, retry: e.code ? null : () => respond(invite, accept) })
    } finally {
      setBusyInvite(null)
    }
  }

  async function create(friendIds) {
    openBlend(await createBlend(friendIds))
  }

  return (
    <section className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Movie Blend</h1>
          <p className="page__sub">
            Blend your rankings with up to {BLEND_MAX_MEMBERS - 1} friends and find something to watch together.
          </p>
        </div>
        {canCreate && !creating && (
          <div className="page__controls">
            <button type="button" className="btn" onClick={() => setCreating(true)}>New blend</button>
          </div>
        )}
      </header>

      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button type="button" className="row__btn" onClick={() => setBlendNotice(null)}>Dismiss</button>
        </div>
      )}

      {flash && (
        <div className="notice notice--error" role="alert">
          <span>{flash.text}</span>
          {flash.retry ? (
            <button type="button" className="btn btn--sm" onClick={flash.retry}>Try again</button>
          ) : (
            <button type="button" className="row__btn" onClick={() => setFlash(null)}>Dismiss</button>
          )}
        </div>
      )}

      {needsRankings ? (
        <div className="notice" role="status">
          <span>
            You've ranked {rankedCount} of the {BLEND_MIN_RANKINGS} movies needed to create a blend. You can still join a friend's.
          </span>
          <a className="btn btn--sm" href="#/my-list">Rank more movies</a>
        </div>
      ) : friendsStatus === 'loading' ? (
        <div className="notice" role="status"><span>Loading your friends…</span></div>
      ) : friendsStatus === 'error' ? (
        <div className="notice notice--error" role="alert">
          <span>{friendsError}</span>
          <button type="button" className="btn btn--sm" onClick={loadFriends}>Try again</button>
        </div>
      ) : needsFriends ? (
        <div className="notice" role="status">
          <span>You need at least one friend to create a blend.</span>
          <a className="btn btn--sm" href="#/friends">Find friends</a>
        </div>
      ) : null}

      {creating && canCreate && (
        <CreateBlendForm
          title="New blend"
          friends={friends}
          maxSelect={BLEND_MAX_MEMBERS - 1}
          submitLabel="Create and invite"
          onSubmit={create}
          onCancel={() => setCreating(false)}
        />
      )}

      {status === 'loading' ? (
        <div className="notice" role="status"><span>Loading your blends…</span></div>
      ) : status === 'error' ? (
        <div className="notice notice--error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn--sm" onClick={loadBlends}>Try again</button>
        </div>
      ) : (
        <>
          {invites.length > 0 && (
            <section className="friends__section" aria-label="Invites">
              <h2 className="recs__title">
                Invites <span className="friends__count">{invites.length}</span>
              </h2>
              <ul className="board friends__list">
                {invites.map((invite) => (
                  <li className="frow" key={invite.id}>
                    <span className="frow__avatar" aria-hidden="true">{invite.inviterUsername.charAt(0).toUpperCase()}</span>
                    <span className="frow__info">
                      <span className="frow__name">{invite.inviterUsername} invited you</span>
                      <span className="frow__meta">
                        {invite.memberCount} of {BLEND_MAX_MEMBERS} people · Expires {formatDate(invite.expiresAt)}
                      </span>
                    </span>
                    <span className="frow__actions">
                      <button type="button" className="btn btn--sm" disabled={busyInvite === invite.id} onClick={() => respond(invite, true)}>
                        Accept
                      </button>
                      <button type="button" className="row__btn" disabled={busyInvite === invite.id} onClick={() => respond(invite, false)}>
                        Decline
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="friends__section" aria-label="Your blends">
            <h2 className="recs__title">
              Your blends <span className="friends__count">{blends.length}</span>
            </h2>
            <ul className="board friends__list">
              {blends.length === 0 ? (
                <li className="friends__empty">No blends yet.</li>
              ) : (
                blends.map((blend) => (
                  <li className="frow" key={blend.id}>
                    <span className="frow__avatar" aria-hidden="true">{blend.memberCount}</span>
                    <span className="frow__info">
                      <a className="frow__name frow__link" href={blendHref(blend.id)}>
                        {blend.memberUsernames.join(', ')}
                      </a>
                      <span className="frow__meta">
                        {blend.memberCount} of {BLEND_MAX_MEMBERS} people · Owner: {blend.ownerUsername}
                      </span>
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>
        </>
      )}
    </section>
  )
}

function formatDate(iso) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'soon' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
