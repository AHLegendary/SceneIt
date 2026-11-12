// Starts the real app against a FakeBackend.
//
//   const { backend, user, screen } = await launch({ hash: '#/friends', as: alice })
//
// Every launch re-imports the app, because its stores (supabaseStore.js,
// friends.js) are module-level singletons: a fresh copy per test means no
// state leaks between tests. React and Testing Library are node_modules, which
// vi.resetModules() leaves alone, so they stay one shared instance.

import { createElement } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { FakeBackend, OMDB_KEY, PUBLISHABLE_KEY, SERVICE_KEY, SUPABASE_URL, TMDB_TOKEN } from './fakeBackend.js'

export { act, screen, waitFor, within }

// options:
//   hash     where the URL starts, e.g. '#/friends'
//   as       a user from backend.addUser(): start with a saved session for them
//   backend  a FakeBackend you've already seeded (default: an empty one)
export async function launch({ hash = '', as = null, backend = new FakeBackend() } = {}) {
  globalThis.__sceneit = { backend }
  if (as) backend.signInAs(as)

  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE_URL)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE_KEY)
  vi.stubEnv('SUPABASE_URL', SUPABASE_URL)
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY)
  vi.stubEnv('TMDB_READ_TOKEN', TMDB_TOKEN)
  vi.stubEnv('OMDB_API_KEY', OMDB_KEY)
  vi.stubGlobal('fetch', backend.fetch)

  window.location.hash = hash
  sessionStorage.clear()

  // What src/main.jsx does at startup.
  const store = await import('../../../src/lib/supabaseStore.js')
  const friends = await import('../../../src/lib/friends.js')
  store.startAuth()
  friends.startFriends()
  const blends = await import('../../../src/features/blends/blends.js')
  blends.startBlends()
  const { default: App } = await import('../../../src/App.jsx')

  const user = userEvent.setup()
  const view = render(createElement(App))
  return { backend, user, view, store, friends }
}

// Starts the app again against the same backend, as a different user or after a
// reload, with the previous app removed from the page first. (Two apps in one
// page would answer each other's queries and hide real failures.)
export async function relaunch(previous, options = {}) {
  previous.view.unmount()
  return launch({ backend: previous.backend, ...options })
}

// Waits until the saved session has been checked and the account is loaded:
// the Profile button (logged in) or the Log in button (logged out).
export async function ready({ loggedIn }) {
  if (loggedIn) await screen.findByRole('button', { name: /^profile/i }, { timeout: 4000 })
  else await screen.findByRole('button', { name: /^log in$/i }, { timeout: 4000 })
}

// Changes the URL hash the way a link or the back button does.
export async function goTo(hash) {
  await act(async () => {
    window.location.hash = hash
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

// Opens the Profile menu and clicks one of its shortcuts.
export async function openProfileMenu(user) {
  await user.click(screen.getByRole('button', { name: /^profile/i }))
  return screen.getByRole('menu', { name: /profile menu/i })
}

export async function useMenu(user, name) {
  const menu = await openProfileMenu(user)
  await user.click(within(menu).getByRole('menuitem', { name }))
}

// The review step comes right after a ranking saves, before the result screen
// ("See my list" / "Done" / "Rank another"). Most tests don't care about it:
// this waits for it and skips it. Pass the test's `user`, or leave it out.
export async function skipReview(user = userEvent.setup()) {
  const step = await screen.findByRole('button', { name: 'Skip' })
  await user.click(step)
}

export { FakeBackend }
