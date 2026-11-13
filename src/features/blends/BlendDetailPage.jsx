import { useEffect, useMemo, useState } from 'react'
import Poster from '../../components/Poster.jsx'
import { loadFriends } from '../../lib/friends.js'
import { posterUrl } from '../../lib/localStore.js'
import { userHref } from '../../lib/route.js'
import { useFriendGroups, useFriends } from '../../lib/useFriends.js'
import { useAccount } from '../../lib/useMyList.js'
import {
  BLEND_GONE,
  BLEND_MAX_MEMBERS,
  fetchBlendDetail,
  inviteToBlend,
  leaveBlend,
  loadBlends,
  setBlendNotice,
} from './blends.js'
import { blendRecLabel } from './blendRecs.js'
import CreateBlendForm from './CreateBlendForm.jsx'

const INVITE_LABELS = { pending: 'Invited', declined: 'Declined', expired: 'Expired' }

// Back to the widget, explaining why. Used when the blend has been deleted or
// the user is no longer in it.
function returnToBlends() {
  setBlendNotice(BLEND_GONE)
  loadBlends()
  window.location.hash = '/blends'
}

// One blend: who's in it, inviting (owner only), leaving, and recommendations.
export default function BlendDetailPage({ blendId, onOpen }) {
  const userId = useAccount().user?.id ?? null
  const { status: friendsStatus, error: friendsError } = useFriends()
  const { friends } = useFriendGroups()
  const [attempt, setAttempt] = useState(0) // bumped to reload
  // { blendId, detail, error }: says which blend the result is for, so moving
  // between blends shows "Loading" instead of the previous one.
  const [result, setResult] = useState(null)
  const [inviting, setInviting] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [leaving, setLeaving] = useState(false)
  // { text, retry } shown after leaving fails
  const [flash, setFlash] = useState(null)

  useEffect(() => {
    let current = true
    fetchBlendDetail(blendId).then(
      (detail) => {
        if (!current) return
        if (detail) setResult({ blendId, detail, error: null })
        else returnToBlends()
      },
      (error) => {
        if (!current) return
        if (error.code === 'blend_not_found') returnToBlends()
        else setResult({ blendId, detail: null, error: error.message })
      },
    )
    return () => {
      current = false
    }
  }, [blendId, attempt])

  const loaded = result?.blendId === blendId ? result : null
  const detail = loaded?.detail ?? null

  // Friends who aren't in the blend and don't have an open invite.
  const invitable = useMemo(() => {
    if (!detail) return []
    const taken = new Set(detail.members.map((m) => m.id))
    for (const invite of detail.sentInvites) if (invite.status === 'pending') taken.add(invite.inviteeId)
    return friends.filter((friend) => !taken.has(friend.id))
  }, [detail, friends])

  async function invite([friendId]) {
    try {
      await inviteToBlend(blendId, friendId)
    } catch (e) {
      if (e.code === 'blend_not_found') return returnToBlends()
      throw e
    }
    setInviting(false)
    setAttempt((n) => n + 1)
  }

  async function leave() {
    setLeaving(true)
    setFlash(null)
    try {
      await leaveBlend(blendId)
      window.location.hash = '/blends'
    } catch (e) {
      if (e.code === 'blend_not_found') return returnToBlends()
      setFlash({ text: e.message, retry: e.code ? null : leave })
      setLeaving(false)
    }
  }

  if (!loaded) {
    return (
      <section className="page">
        <div className="notice" role="status"><span>Loading this blend…</span></div>
      </section>
    )
  }

  if (loaded.error) {
    return (
      <section className="page">
        <div className="notice notice--error" role="alert">
          <span>{loaded.error}</span>
          <button type="button" className="btn btn--sm" onClick={() => { setResult(null); setAttempt((n) => n + 1) }}>
            Try again
          </button>
        </div>
        <a className="frow__link" href="#/blends">Back to Movie Blend</a>
      </section>
    )
  }

  const { members, sentInvites, recommendations } = detail
  const isOwner = members.some((m) => m.id === userId && m.isOwner)
  const full = members.length >= BLEND_MAX_MEMBERS

  return (
    <section className="page">
      <header className="page__head">
        <div>
          <a className="frow__meta frow__link" href="#/blends">‹ Movie Blend</a>
          <h1 className="page__title">{members.map((m) => m.username).join(', ')}</h1>
          <p className="page__sub">{members.length} of {BLEND_MAX_MEMBERS} people</p>
        </div>
        <div className="page__controls">
          {confirmLeave ? (
            <>
              {isOwner && <span className="frow__meta">You own this blend. Leaving disbands it for everyone.</span>}
              <button type="button" className="btn btn--sm btn--danger" disabled={leaving} onClick={leave}>
                {leaving ? 'Leaving…' : isOwner ? 'Disband blend' : 'Leave blend'}
              </button>
              <button type="button" className="row__btn" disabled={leaving} onClick={() => setConfirmLeave(false)}>Stay</button>
            </>
          ) : (
            <button type="button" className="row__btn" onClick={() => setConfirmLeave(true)}>
              {isOwner ? 'Disband blend' : 'Leave blend'}
            </button>
          )}
        </div>
      </header>

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

      <section className="recs" aria-label="Recommendations">
        <h2 className="recs__title">Recommended for your group</h2>
        {recommendations.length > 0 ? (
          <ul className="recs__grid">
            {recommendations.map((rec) => (
              <li key={rec.movie.id}>
                <button type="button" className="rec" onClick={() => onOpen(rec.movie.id)}>
                  <Poster title={rec.movie.title} src={posterUrl(rec.movie)} size="md" />
                  <span className="rec__title">{rec.movie.title}</span>
                  <span className="rec__meta">{blendRecLabel(rec)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : members.length < 2 ? (
          <div className="notice" role="status">
            <span>Recommendations appear once a friend joins this blend.</span>
          </div>
        ) : (
          <div className="notice" role="status">
            <span>Not enough ranking data yet. Recommendations need movies your group likes that someone hasn't seen.</span>
            <a className="btn btn--sm" href="#/my-list">Rank more movies</a>
          </div>
        )}
      </section>

      <section className="friends__section" aria-label="Members">
        <h2 className="recs__title">
          Members <span className="friends__count">{members.length}</span>
        </h2>
        <ul className="board friends__list">
          {members.map((member) => (
            <li className="frow" key={member.id}>
              <span className="frow__avatar" aria-hidden="true">{member.username.charAt(0).toUpperCase()}</span>
              <span className="frow__info">
                <a className="frow__name frow__link" href={userHref(member.username)}>{member.username}</a>
                {member.isOwner && <span className="frow__meta">Owner</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {isOwner && (
        <section className="friends__section" aria-label="Invites">
          <h2 className="recs__title">Invites</h2>

          {sentInvites.length > 0 && (
            <ul className="board friends__list">
              {sentInvites.map((sent) => (
                <li className="frow" key={sent.id}>
                  <span className="frow__avatar" aria-hidden="true">{sent.username.charAt(0).toUpperCase()}</span>
                  <span className="frow__info">
                    <span className="frow__name">{sent.username}</span>
                  </span>
                  <span className="frow__actions">
                    <span className="friends__tag">{INVITE_LABELS[sent.status] ?? sent.status}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {full ? (
            <div className="notice" role="status">
              <span>This blend is full. A blend can have up to {BLEND_MAX_MEMBERS} people.</span>
            </div>
          ) : inviting ? (
            <CreateBlendForm
              title="Invite a friend"
              friends={invitable}
              maxSelect={1}
              submitLabel="Send invite"
              onSubmit={invite}
              onCancel={() => setInviting(false)}
            />
          ) : invitable.length > 0 ? (
            <div>
              <button type="button" className="btn btn--sm" onClick={() => setInviting(true)}>Invite a friend</button>
            </div>
          ) : friendsStatus === 'loading' ? (
            <p className="friends__hint">Loading your friends…</p>
          ) : friendsStatus === 'error' ? (
            <div className="notice notice--error" role="alert">
              <span>{friendsError}</span>
              <button type="button" className="btn btn--sm" onClick={loadFriends}>Try again</button>
            </div>
          ) : friends.length === 0 ? (
            <div className="notice" role="status">
              <span>You need a friend to invite.</span>
              <a className="btn btn--sm" href="#/friends">Find friends</a>
            </div>
          ) : (
            <p className="friends__hint">All your friends are already in this blend or invited.</p>
          )}
        </section>
      )}
    </section>
  )
}
