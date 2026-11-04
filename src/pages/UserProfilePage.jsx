import FriendAction from '../components/FriendAction.jsx'
import TopMovies from '../components/TopMovies.jsx'
import { userListHref } from '../lib/route.js'
import { useProfileLookup } from '../lib/useProfileLookup.js'
import { useUserTiers } from '../lib/useUserTiers.js'
import './ProfilePage.css'

const LOAD_ERROR = "Couldn't load this profile. Check your connection and try again."

// Someone else's profile, at #/u/<username>.
//   public (or you're friends)  -> pronouns, bio, and their top movies
//   private, you're logged in   -> a private notice with an Add friend button
//   private, logged out         -> can't tell it apart from a missing user
export default function UserProfilePage({ username, account, onOpen }) {
  const { view, relation, friendsReady, signedIn, retry } = useProfileLookup(username, account, '/profile')
  const list = useUserTiers(view.kind === 'profile' ? view.profile.id : null)
  const known = view.profile ?? view.user

  const heading = (
    <header className="page__head">
      <div>
        {signedIn && (
          <a className="profile__link uprofile__back" href="#/friends">
            ← Back to Friends
          </a>
        )}
        <h1 className="page__title profile__name">{known?.username ?? username}</h1>
        {view.kind === 'profile' && view.profile.pronouns && (
          <p className="uprofile__pronouns">{view.profile.pronouns}</p>
        )}
      </div>
    </header>
  )

  if (view.kind === 'loading') {
    return (
      <section className="page">
        {heading}
        <p className="page__sub">Loading profile…</p>
      </section>
    )
  }

  if (view.kind === 'error') {
    return (
      <section className="page">
        {heading}
        <div className="profile__alert" role="alert">
          {LOAD_ERROR}{' '}
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
            This profile is private, or the user doesn't exist. Log in to find out and to add friends.
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
          <p>This profile is private. Add them as a friend to see their profile.</p>
          <FriendAction user={view.user} relation={relation} ready={friendsReady} />
        </div>
      </section>
    )
  }

  const { profile } = view
  return (
    <section className="page">
      {heading}
      <div className="uprofile">
        {!profile.is_public && <span className="uprofile__tag">Private profile, shared with friends</span>}
        {profile.bio ? (
          <p className="uprofile__bio">{profile.bio}</p>
        ) : (
          <p className="uprofile__muted">No bio yet.</p>
        )}
        {signedIn ? (
          <FriendAction user={profile} relation={relation} ready={friendsReady} />
        ) : (
          <button type="button" className="btn" onClick={() => (window.location.hash = '/login')}>
            Log in to add friends
          </button>
        )}
      </div>
      <TopMovies
        tiers={list.tiers}
        status={list.status}
        onRetry={list.retry}
        viewAllHref={userListHref(profile.username)}
        onOpen={onOpen}
      />
    </section>
  )
}
