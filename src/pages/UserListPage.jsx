import FriendAction from '../components/FriendAction.jsx'
import MovieRows from '../components/MovieRows.jsx'
import { listRows } from '../features/ranking/listRows.js'
import { scoreTiers } from '../features/ranking/scores.js'
import { userHref } from '../lib/route.js'
import { useProfileLookup } from '../lib/useProfileLookup.js'
import { useUserTiers } from '../lib/useUserTiers.js'
import './ProfilePage.css'

// Someone else's full ranked list, read-only, at #/u/<username>/my-list.
// Uses the same visibility rules as their profile: you only see the list if
// you can see the profile (public, or you're friends).
export default function UserListPage({ username, account, onOpen }) {
  const { view, relation, friendsReady, retry } = useProfileLookup(username, account, '/my-list')
  const list = useUserTiers(view.kind === 'profile' ? view.profile.id : null)
  const name = view.profile?.username ?? view.user?.username ?? username
  const count = list.tiers.reduce((n, tier) => n + tier.length, 0)

  const heading = (
    <header className="page__head">
      <div>
        <a className="profile__link uprofile__back" href={userHref(name)}>
          ← Back to {name}'s profile
        </a>
        <h1 className="page__title profile__name">{name}'s list</h1>
        {view.kind === 'profile' && list.status === 'ready' && (
          <p className="page__sub">
            {count ? `${count} ranked ${count === 1 ? 'movie' : 'movies'}` : 'No ranked movies yet.'}
          </p>
        )}
      </div>
    </header>
  )

  if (view.kind === 'loading') {
    return (
      <section className="page">
        {heading}
        <p className="page__sub">Loading list…</p>
      </section>
    )
  }

  if (view.kind === 'error') {
    return (
      <section className="page">
        {heading}
        <div className="profile__alert" role="alert">
          Couldn't load this list. Check your connection and try again.{' '}
          <button type="button" className="profile__link" onClick={retry}>
            Try again
          </button>
        </div>
      </section>
    )
  }

  if (view.kind === 'missing') {
    return (
      <section className="page">
        {heading}
        <p className="page__sub">No one on SceneIt goes by that username.</p>
      </section>
    )
  }

  if (view.kind === 'hidden') {
    return (
      <section className="page">
        {heading}
        <div className="uprofile">
          <p className="uprofile__muted">
            This list is private, or the user doesn't exist. Log in to find out and to add friends.
          </p>
          <button type="button" className="btn" onClick={() => (window.location.hash = '/login')}>
            Log in
          </button>
        </div>
      </section>
    )
  }

  if (view.kind === 'private') {
    return (
      <section className="page">
        {heading}
        <div className="uprofile">
          <span className="uprofile__tag">Private profile</span>
          <p>This list is private. Add them as a friend to see their list.</p>
          <FriendAction user={view.user} relation={relation} ready={friendsReady} />
        </div>
      </section>
    )
  }

  if (list.status === 'error') {
    return (
      <section className="page">
        {heading}
        <div className="profile__alert" role="alert">
          Couldn't load this list. Check your connection and try again.{' '}
          <button type="button" className="profile__link" onClick={list.retry}>
            Try again
          </button>
        </div>
      </section>
    )
  }

  if (list.status !== 'ready') {
    return (
      <section className="page">
        {heading}
        <p className="page__sub">Loading list…</p>
      </section>
    )
  }

  return (
    <section className="page">
      {heading}
      {count > 0 && <MovieRows rows={listRows(list.tiers)} scores={scoreTiers(list.tiers)} onOpen={onOpen} />}
    </section>
  )
}
