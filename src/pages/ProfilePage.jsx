import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import ProfileHighlights from '../components/ProfileHighlights.jsx'
import RecentlyRanked from '../components/RecentlyRanked.jsx'
import { imageUrl } from '../lib/localStore.js'
import { profileImageUrl, removeProfileImage, uploadProfileImage } from '../lib/profileMedia.js'
import { fetchProfile, saveProfile } from '../lib/profileQueries.js'
import { useFriendGroups } from '../lib/useFriends.js'
import {
  BIO_MAX,
  PRONOUNS_MAX,
  charCount,
  toProfileUpdate,
  validateProfile,
} from '../lib/profileValidation.js'
import { useMyTiers } from '../lib/useMyList.js'
import './ProfilePage.css'

const LOAD_ERROR = "Couldn't load your profile. Check your connection and try again."
const SAVE_ERROR = "Couldn't save your profile. Check your connection and try again."

const VISIBILITY = [
  { value: true, label: 'Public', help: 'Anyone can see your profile and ranked list.' },
  { value: false, label: 'Private', help: 'Only you and your friends can see your profile and ranked list.' },
]

function toForm(profile) {
  return {
    bio: profile.bio ?? '',
    pronouns: profile.pronouns ?? '',
    isPublic: profile.is_public,
  }
}

function sameForm(a, b) {
  return a.bio.trim() === b.bio.trim() && a.pronouns.trim() === b.pronouns.trim() && a.isPublic === b.isPublic
}

// The signed-in user's profile: who they are on SceneIt (username, pronouns,
// bio, visibility), what their list says about them (counts, top movies),
// and the form to edit the parts stored in `profiles`.
export default function ProfilePage({ account, onOpen, onNavigate }) {
  const userId = account.user.id
  const tiers = useMyTiers()
  const { friends, incoming } = useFriendGroups()
  const [editing, setEditing] = useState(false)
  const [media, setMedia] = useState(null) // { kind, status: 'busy' | 'error', message }
  // Avatar/banner URLs are derived from the user id. `images` tracks which
  // exist (null = unknown until the image loads or fails) and a version to
  // bust the cache after an upload.
  const [images, setImages] = useState({ avatar: profileImageUrl(userId, 'avatar'), banner: profileImageUrl(userId, 'banner') })
  const avatarInput = useRef(null)
  const bannerInput = useRef(null)

  async function changeImage(kind, file) {
    if (!file) return
    setMedia({ kind, status: 'busy' })
    try {
      const url = await uploadProfileImage(kind, file)
      setImages((current) => ({ ...current, [kind]: url }))
      setMedia(null)
    } catch (e) {
      setMedia({ kind, status: 'error', message: e.message })
    }
  }

  async function clearImage(kind) {
    setMedia({ kind, status: 'busy' })
    try {
      await removeProfileImage(kind)
      setImages((current) => ({ ...current, [kind]: null }))
      setMedia(null)
    } catch (e) {
      setMedia({ kind, status: 'error', message: e.message })
    }
  }

  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [saved, setSaved] = useState(null) // form values as last stored
  const [form, setForm] = useState(null)
  const [username, setUsername] = useState(account.username)
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')

  const [attempt, setAttempt] = useState(0)

  // Loads when the page opens, for a different user, or on Try again. The state is
  // only set once the request has answered (the page starts out in 'loading').
  useEffect(() => {
    let current = true
    fetchProfile(userId).then(
      (profile) => {
        if (!current) return
        setUsername(profile.username)
        setSaved(toForm(profile))
        setForm(toForm(profile))
        setStatus('ready')
      },
      () => current && setStatus('error'),
    )
    return () => {
      current = false
    }
  }, [userId, attempt])

  function retry() {
    setStatus('loading')
    setAttempt((n) => n + 1)
  }

  function change(patch) {
    setForm((current) => ({ ...current, ...patch }))
    setNotice('')
    setFormError('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setNotice('')
    setFormError('')

    const errors = validateProfile(form)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSaving(true)
    try {
      const profile = await saveProfile(userId, toProfileUpdate(form))
      setSaved(toForm(profile))
      setForm(toForm(profile))
      setNotice('Profile saved.')
      setEditing(false)
    } catch {
      setFormError(SAVE_ERROR)
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    setForm(saved)
    setFieldErrors({})
    setFormError('')
    setNotice('')
  }

  const ranked = tiers.flat()
  const count = ranked.length
  const top = ranked.slice(0, 10)
  const banner = images.banner || imageUrl(top[0]?.backdrop_path, 'w1280')
  const initial = (username ?? 'U').charAt(0).toUpperCase()
  const busy = (kind) => media?.kind === kind && media.status === 'busy'

  const header = (
    <header className="profile-hero" style={banner ? { '--banner': `url(${banner})` } : undefined}>
      <div className="profile-hero__fade" aria-hidden="true" />
      {images.banner && (
        // invisible probe: if the banner doesn't exist yet, fall back to the top movie's backdrop
        <img src={images.banner} alt="" hidden onError={() => setImages((c) => ({ ...c, banner: null }))} />
      )}
      {status === 'ready' && (
        <div className="profile-hero__tools">
          <input ref={bannerInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { changeImage('banner', e.target.files?.[0]); e.target.value = '' }} />
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => bannerInput.current?.click()} disabled={busy('banner')}>
            <Icon name="film" size={15} />
            {busy('banner') ? 'Uploading…' : images.banner ? 'Change banner' : 'Add banner'}
          </button>
          {images.banner && (
            <button type="button" className="row__btn" onClick={() => clearImage('banner')} disabled={busy('banner')}>Remove</button>
          )}
        </div>
      )}
      <div className="profile-hero__body">
        <span className="profile-hero__avatar-wrap">
          <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { changeImage('avatar', e.target.files?.[0]); e.target.value = '' }} />
          {images.avatar ? (
            <img
              className="profile-hero__avatar profile-hero__avatar--img"
              src={images.avatar}
              alt=""
              onError={() => setImages((c) => ({ ...c, avatar: null }))}
            />
          ) : (
            <span className="profile-hero__avatar" aria-hidden="true">{initial}</span>
          )}
          {status === 'ready' && (
            <button
              type="button"
              className="profile-hero__avatar-btn"
              onClick={() => avatarInput.current?.click()}
              disabled={busy('avatar')}
              aria-label={images.avatar ? 'Change profile picture' : 'Add profile picture'}
              title={images.avatar ? 'Change profile picture' : 'Add profile picture'}
            >
              <Icon name={busy('avatar') ? 'sparkle' : 'plus'} size={14} strokeWidth={2.6} />
            </button>
          )}
        </span>
        <div className="profile-hero__who">
          <h1 className="page__title profile__name">{username ?? 'Profile'}</h1>
          <p className="profile-hero__handle">
            @{username ?? '…'}
            {saved?.pronouns && <span className="chip">{saved.pronouns}</span>}
            {saved && (
              <span className="profile-hero__vis">
                <Icon name={saved.isPublic ? 'people' : 'user'} size={14} />
                {saved.isPublic ? 'Public profile' : 'Private profile'}
              </span>
            )}
          </p>
          {saved?.bio ? (
            <p className="profile-hero__bio">{saved.bio}</p>
          ) : (
            status === 'ready' && <p className="profile-hero__bio profile-hero__bio--empty">No bio yet. Tell people what you like to watch.</p>
          )}
        </div>
        {status === 'ready' && (
          <button type="button" className={`btn btn--sm ${editing ? 'btn--ghost' : 'btn--light'}`} onClick={() => { setNotice(''); setEditing((v) => !v) }}>
            <Icon name={editing ? 'close' : 'card'} size={16} />
            {editing ? 'Close' : 'Edit profile'}
          </button>
        )}
      </div>
    </header>
  )

  const stats = (
    <section className="profile-stats" aria-label="Your stats">
      <button type="button" className="pstat" onClick={() => onNavigate?.('my-list')}>
        <span className="pstat__value">{count}</span>
        <span className="pstat__label">Movies ranked</span>
      </button>
      <button type="button" className="pstat" onClick={() => onNavigate?.('friends')}>
        <span className="pstat__value">{friends.length}</span>
        <span className="pstat__label">Friends{incoming.length ? ` · ${incoming.length} pending` : ''}</span>
      </button>
    </section>
  )

  if (status === 'loading') {
    return (
      <section className="page">
        {header}
        <p className="page__sub">Loading your profile…</p>
      </section>
    )
  }

  if (status === 'error') {
    return (
      <section className="page">
        {header}
        <div className="profile__alert" role="alert">
          {LOAD_ERROR}{' '}
          <button type="button" className="profile__link" onClick={retry}>
            Try again
          </button>
        </div>
      </section>
    )
  }

  const dirty = !sameForm(form, saved)
  const visibility = VISIBILITY.find((option) => option.value === form.isPublic)

  return (
    <section className="page">
      {header}
      {media?.status === 'error' && (
        <div className="notice notice--error" role="alert">
          <span>{media.message}</span>
          <button type="button" className="row__btn" onClick={() => setMedia(null)}>Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
        </div>
      )}
      {stats}
      {!editing && (
        <>
          <ProfileHighlights tiers={tiers} onOpen={onOpen} onStartRanking={() => onNavigate?.('my-list')} />
          <RecentlyRanked key={userId} userId={userId} tiers={tiers} isOwner fullListHref="#/my-list" onOpen={onOpen} />
        </>
      )}

      {editing && (
      <form className="profile__form" onSubmit={handleSubmit} noValidate>
        {formError && (
          <div className="profile__alert" role="alert">
            {formError}
          </div>
        )}

        {images.avatar && (
          <div className="profile__field">
            <span className="profile__label">Profile picture</span>
            <div className="profile__actions">
              <button type="button" className="row__btn" onClick={() => clearImage('avatar')} disabled={busy('avatar')}>Remove picture</button>
            </div>
          </div>
        )}

        <div className="profile__field">
          <label htmlFor="profile-pronouns">Pronouns</label>
          <input
            id="profile-pronouns"
            type="text"
            value={form.pronouns}
            onChange={(e) => change({ pronouns: e.target.value })}
            placeholder="e.g. she/her, he/him, they/them"
            autoComplete="off"
            aria-invalid={Boolean(fieldErrors.pronouns)}
            aria-describedby="profile-pronouns-note"
            disabled={saving}
          />
          <p id="profile-pronouns-note" className={fieldErrors.pronouns ? 'profile__error' : 'profile__hint'}>
            {fieldErrors.pronouns || `${charCount(form.pronouns)}/${PRONOUNS_MAX}`}
          </p>
        </div>

        <div className="profile__field">
          <label htmlFor="profile-bio">Bio</label>
          <textarea
            id="profile-bio"
            rows={4}
            value={form.bio}
            onChange={(e) => change({ bio: e.target.value })}
            placeholder="Tell people what you like to watch."
            aria-invalid={Boolean(fieldErrors.bio)}
            aria-describedby="profile-bio-note"
            disabled={saving}
          />
          <p id="profile-bio-note" className={fieldErrors.bio ? 'profile__error' : 'profile__hint'}>
            {fieldErrors.bio || `${charCount(form.bio)}/${BIO_MAX}`}
          </p>
        </div>

        <div className="profile__field">
          <span id="profile-visibility-label" className="profile__label">
            Profile visibility
          </span>
          <div className="seg" role="radiogroup" aria-labelledby="profile-visibility-label">
            {VISIBILITY.map((option) => (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={form.isPublic === option.value}
                className={`seg__opt${form.isPublic === option.value ? ' is-active' : ''}`}
                onClick={() => change({ isPublic: option.value })}
                disabled={saving}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="profile__hint">
            {visibility.help} Your username can still be found when someone sends a friend request.
          </p>
        </div>

        <div className="profile__actions">
          <button type="submit" className="btn" disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {dirty && !saving && (
            <button type="button" className="profile__link" onClick={discard}>
              Discard changes
            </button>
          )}
        </div>
      </form>
      )}
    </section>
  )
}
