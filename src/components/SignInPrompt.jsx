// Shown in place of pages that need an account when nobody is logged in.
// Login and signup happen on LoginPage; App remembers which page the user
// wanted so they come back to it afterwards.
export function SignInPrompt({ onLogin, onSignUp }) {
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
        <div className="empty__actions">
          <button type="button" className="btn btn--accent" onClick={onLogin}>
            Log in
          </button>
          <button type="button" className="btn btn--ghost" onClick={onSignUp}>
            Create an account
          </button>
        </div>
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
