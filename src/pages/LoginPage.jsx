import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { isEmail, validateLogin, validateSignUp } from '../lib/validation.js'
import './LoginPage.css'

const NETWORK_ERROR = "Couldn't reach SceneIt. Check your connection and try again."
const SERVER_ERROR = 'Something went wrong on our end. Try again in a moment, or log in with your email.'
const DEV_API_MISSING =
  'Username login needs the API server. Log in with your email, or run the app with "npx vercel dev".'

export default function LoginPage({ onSuccess }) {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [username, setUsername] = useState('')
  const [identifier, setIdentifier] = useState('') // email or username, login only
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isSignUp = mode === 'signup'

  function switchMode(next) {
    setMode(next)
    setFieldErrors({})
    setFormError('')
    setNotice('')
    setPassword('')
  }

  async function logIn() {
    const value = identifier.trim()
    const badCredentials = 'Email, username, or password is incorrect. Check them and try again.'

    if (isEmail(value)) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: value, password })
      if (error) {
        setFormError(error.status === 400 ? badCredentials : NETWORK_ERROR)
        return
      }
      onSuccess?.(data.session)
      return
    }

    // Usernames are resolved to an email on the server (see api/login.js).
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: value, password }),
    })
    if (response.status === 401) {
      setFormError(badCredentials)
      return
    }
    if (!response.ok) {
      // 404 means the function isn't running: only expected in local dev without vercel dev.
      setFormError(response.status === 404 && import.meta.env.DEV ? DEV_API_MISSING : SERVER_ERROR)
      return
    }
    const { session } = await response.json()
    const { data, error } = await supabase.auth.setSession(session)
    if (error) {
      setFormError(SERVER_ERROR)
      return
    }
    onSuccess?.(data.session)
  }

  async function signUp() {
    // The username goes in metadata; a database trigger creates the profile.
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { username: username.trim() } },
    })

    if (error) {
      if (error.status === 429) {
        setFormError('Too many attempts. Wait a minute and try again.')
      } else if (/database error/i.test(error.message)) {
        // The profile insert failed, so the username is already taken.
        setFieldErrors({ username: 'That username is taken. Try another.' })
      } else if (/already registered/i.test(error.message)) {
        setFieldErrors({ email: 'An account with this email already exists. Log in instead.' })
      } else if (error.status === 422 || error.status === 400) {
        setFormError(error.message)
      } else {
        setFormError(NETWORK_ERROR)
      }
      return
    }

    // With email confirmation on, Supabase hides existing emails by returning
    // a user with no identities instead of an error.
    if (data.user && data.user.identities?.length === 0) {
      setFieldErrors({ email: 'An account with this email already exists. Log in instead.' })
      return
    }

    // No session yet means the project requires email confirmation.
    if (!data.session) {
      setNotice('Account created. Check your email for a link to confirm it, then log in.')
      setMode('login')
      setPassword('')
      return
    }
    onSuccess?.(data.session)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError('')
    setNotice('')

    const errors = isSignUp
      ? validateSignUp({ username, email, password })
      : validateLogin({ identifier, password })
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      await (isSignUp ? signUp() : logIn())
    } catch {
      setFormError(NETWORK_ERROR)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="page">
      <div className="login">
        <section className="login-hero" aria-hidden="true">
          <div className="versus">
            <div className="versus-side versus-a">
              <span className="versus-poster" />
              <span className="versus-poster versus-poster-back" />
            </div>
            <div className="versus-side versus-b">
              <span className="versus-poster" />
              <span className="versus-poster versus-poster-back" />
            </div>
          </div>
          <p className="login-hero-line">Which did you like more?</p>
        </section>

        <section className="login-panel">
          <h2 className="login-title">
            {isSignUp ? 'Create your SceneIt account' : 'Log in to SceneIt'}
          </h2>
          <p className="login-subtitle">
            {isSignUp
              ? 'Save your rankings and get recommendations on any device.'
              : 'Pick up your rankings where you left off.'}
          </p>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            {notice && (
              <div className="login-notice" role="status">
                {notice}
              </div>
            )}
            {formError && (
              <div className="login-alert" role="alert">
                {formError}
              </div>
            )}

            {isSignUp && (
              <div className="field">
                <label htmlFor="auth-username">Username</label>
                <input
                  id="auth-username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.username)}
                  aria-describedby="auth-username-hint"
                  disabled={submitting}
                />
                <p
                  id="auth-username-hint"
                  className={fieldErrors.username ? 'field-error' : 'field-hint'}
                >
                  {fieldErrors.username || '3 to 20 letters, numbers, or underscores.'}
                </p>
              </div>
            )}

            {isSignUp ? (
              <div className="field">
                <label htmlFor="auth-email">Email</label>
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined}
                  disabled={submitting}
                />
                {fieldErrors.email && (
                  <p id="auth-email-error" className="field-error">
                    {fieldErrors.email}
                  </p>
                )}
              </div>
            ) : (
              <div className="field">
                <label htmlFor="auth-identifier">Email or username</label>
                <input
                  id="auth-identifier"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.identifier)}
                  aria-describedby={fieldErrors.identifier ? 'auth-identifier-error' : undefined}
                  disabled={submitting}
                />
                {fieldErrors.identifier && (
                  <p id="auth-identifier-error" className="field-error">
                    {fieldErrors.identifier}
                  </p>
                )}
              </div>
            )}

            <div className="field">
              <label htmlFor="auth-password">Password</label>
              <div className="password-wrap">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? 'auth-password-error' : undefined}
                  disabled={submitting}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {fieldErrors.password && (
                <p id="auth-password-error" className="field-error">
                  {fieldErrors.password}
                </p>
              )}
            </div>

            <button type="submit" className="login-submit" disabled={submitting}>
              {submitting
                ? isSignUp ? 'Creating account…' : 'Logging in…'
                : isSignUp ? 'Create account' : 'Log in'}
            </button>
          </form>

          <p className="login-switch">
            {isSignUp ? 'Already have an account? ' : 'New to SceneIt? '}
            <button
              type="button"
              className="link-button"
              onClick={() => switchMode(isSignUp ? 'login' : 'signup')}
            >
              {isSignUp ? 'Log in' : 'Create an account'}
            </button>
          </p>
        </section>
      </div>
    </section>
  )
}
