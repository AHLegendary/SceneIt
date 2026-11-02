// Shown in place of pages that need an account when nobody is logged in.
//
// TODO(login form): the signup/login form goes here. It must sign up with
//   supabase.auth.signUp({ email, password, options: { data: { username } } })
// (the database creates the profile from that username) and log in with
//   supabase.auth.signInWithPassword({ email, password }).
// Nothing else is needed: supabaseStore notices the login and loads the list.
export function SignInPrompt() {
  return (
    <section className="page">
      <div className="empty">
        <div className="empty__stack" aria-hidden="true">
          <span /><span /><span />
        </div>
        <h2 className="empty__title">Log in to start ranking</h2>
        <p className="empty__text">
          Your ranked list, scores and recommendations are saved to your SceneIt account,
          so they follow you to any device. The leaderboard is open to everyone.
        </p>
        <button type="button" className="btn" onClick={() => { window.location.hash = '/login' }}>
          Log in
        </button>
      </div>
    </section>
  )
}

// Loading or error message in place of a page. Pass onRetry to show a retry button.
export function PageStatus({ children, error = false, onRetry }) {
  return (
    <section className="page">
      <div className={`notice${error ? ' notice--error' : ''}`} role={error ? 'alert' : 'status'}>
        <span>{children}</span>
        {onRetry && (
          <button type="button" className="btn btn--sm" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </section>
  )
}
