import { Component } from 'react'

// Last-resort screen: a render error (or a page chunk that failed to load)
// shows a reload prompt instead of a blank page.
export default class ErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error(error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" style={{ maxWidth: 480, margin: '20vh auto', padding: '0 16px', textAlign: 'center', color: 'var(--ink)' }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ color: 'var(--ink-2)', marginBottom: 20 }}>SceneIt hit an unexpected error. Reloading usually fixes it.</p>
        <button type="button" className="btn btn--accent" onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}
