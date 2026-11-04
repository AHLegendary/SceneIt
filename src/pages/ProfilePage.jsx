import { useEffect, useState } from 'react'
import TopMovies from '../components/TopMovies.jsx'
import { fetchProfile, saveProfile } from '../lib/profileQueries.js'
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

export default function ProfilePage({ account, onOpen }) {
  const userId = account.user.id
  const tiers = useMyTiers()
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [saved, setSaved] = useState(null) // form values as last stored
  const [form, setForm] = useState(null)
  const [username, setUsername] = useState(account.username)
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    setStatus('loading')
    try {
      const profile = await fetchProfile(userId)
      setUsername(profile.username)
      setSaved(toForm(profile))
      setForm(toForm(profile))
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => {
    load()
    // Reload only when a different user is logged in.
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const header = (
    <header className="page__head">
      <div>
        <h1 className="page__title profile__name">{username ?? 'Profile'}</h1>
        <p className="page__sub">Choose what other people see on your profile.</p>
      </div>
    </header>
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
          <button type="button" className="profile__link" onClick={load}>
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

      <form className="profile__form" onSubmit={handleSubmit} noValidate>
        {formError && (
          <div className="profile__alert" role="alert">
            {formError}
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
          {notice && (
            <span className="profile__notice" role="status">
              {notice}
            </span>
          )}
        </div>
      </form>

      <TopMovies tiers={tiers} viewAllHref="#/my-list" onOpen={onOpen} />
    </section>
  )
}
