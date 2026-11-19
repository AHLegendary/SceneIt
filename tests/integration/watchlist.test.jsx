import { beforeEach, describe, expect, it } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, launch, ready, screen, waitFor, within } from './helpers/harness.js'

const DUNE = MOVIES.find((m) => m.id === 'dune-part-two-2024')

let backend
let alice
let bob

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
  bob = backend.addUser({ username: 'bob' })
  backend.tmdbKnows(DUNE.id)
})

async function open(hash, as = alice) {
  const app = await launch({ backend, as, hash })
  await ready({ loggedIn: true })
  return app
}

async function dune(user) {
  const box = within(screen.getByRole('search')).getByRole('searchbox', { name: 'Search movies' })
  await user.type(box, 'Dune: Part Two')
  await user.click(await screen.findByRole('option', { name: /Dune: Part Two/i }))
  return screen.findByRole('dialog', { name: 'Dune: Part Two' })
}

describe('saving from the movie details', () => {
  it('saves and removes a movie, and the profile shows it', async () => {
    const { user } = await open('#/home')
    const dialog = await dune(user)

    await user.click(within(dialog).getByRole('button', { name: 'Save to watchlist' }))
    const saved = await within(dialog).findByRole('button', { name: 'On your watchlist' })
    expect(saved.getAttribute('aria-pressed')).toBe('true')
    expect(backend.watchlist).toEqual([expect.objectContaining({ user_id: alice.id, movie_id: DUNE.tmdb_id })])

    await user.click(saved)
    await within(dialog).findByRole('button', { name: 'Save to watchlist' })
    expect(backend.watchlist).toHaveLength(0)
  })

  it('is not offered for a movie you already ranked', async () => {
    backend.seedList(alice, [DUNE.id])
    const { user } = await open('#/home')
    const dialog = await dune(user)
    await within(dialog).findByText(/Ranked #1/)
    expect(within(dialog).queryByRole('button', { name: /watchlist/i })).toBeNull()
  })

  it('is not offered when signed out', async () => {
    const app = await launch({ backend, as: null, hash: '#/home' })
    await ready({ loggedIn: false })
    const dialog = await dune(app.user)
    expect(within(dialog).queryByRole('button', { name: /watchlist/i })).toBeNull()
  })

  it('shows an error and keeps the button when saving fails', async () => {
    const { user } = await open('#/home')
    const dialog = await dune(user)
    // The database refuses the insert when there's no movies row to point at.
    backend.movies = backend.movies.filter((m) => m.tmdb_id !== DUNE.tmdb_id)
    await user.click(within(dialog).getByRole('button', { name: 'Save to watchlist' }))
    expect(await within(dialog).findByRole('alert')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Save to watchlist' })).toBeTruthy()
  })
})

describe('on profiles', () => {
  it('lists your watchlist, lets you remove a movie, and hides ranked ones', async () => {
    const other = MOVIES.find((m) => m.id !== DUNE.id)
    backend.watchlist.push(
      { user_id: alice.id, movie_id: DUNE.tmdb_id, added_at: backend.now() },
      { user_id: alice.id, movie_id: other.tmdb_id, added_at: backend.now() },
    )
    backend.seedList(alice, [other.id])
    const { user } = await open('#/profile')

    const region = await screen.findByRole('region', { name: 'Watchlist' })
    await within(region).findByRole('button', { name: `Open ${DUNE.title}` })
    expect(within(region).queryByRole('button', { name: `Open ${other.title}` })).toBeNull()

    await user.click(within(region).getByRole('button', { name: `Remove ${DUNE.title} from watchlist` }))
    await waitFor(() => expect(backend.watchlist.filter((r) => r.user_id === alice.id && r.movie_id === DUNE.tmdb_id)).toHaveLength(0))
    expect(await within(region).findByText(/Nothing saved yet/)).toBeTruthy()
  })

  it("shows someone else's watchlist without remove buttons", async () => {
    backend.watchlist.push({ user_id: bob.id, movie_id: DUNE.tmdb_id, added_at: backend.now() })
    await open('#/u/bob')

    const region = await screen.findByRole('region', { name: 'Watchlist' })
    await within(region).findByRole('button', { name: `Open ${DUNE.title}` })
    expect(within(region).queryByRole('button', { name: /Remove/ })).toBeNull()
  })

  it("doesn't show a private profile's watchlist to a stranger", async () => {
    const quiet = backend.addUser({ username: 'quiet', is_public: false })
    backend.watchlist.push({ user_id: quiet.id, movie_id: DUNE.tmdb_id, added_at: backend.now() })
    await open('#/u/quiet')
    await screen.findByText(/This profile is private/)
    expect(screen.queryByRole('region', { name: 'Watchlist' })).toBeNull()
  })
})

describe('the full watchlist pages', () => {
  const seed = (user, movies) => {
    for (const m of movies) backend.watchlist.push({ user_id: user.id, movie_id: m.tmdb_id, added_at: backend.now() })
  }
  const posters = (region) => within(region).queryAllByRole('button', { name: /^Open / })

  it('shows six on your profile and links to all of them', async () => {
    seed(alice, MOVIES.slice(0, 9))
    const { user } = await open('#/profile')

    const region = await screen.findByRole('region', { name: 'Watchlist' })
    await waitFor(() => expect(posters(region)).toHaveLength(6))
    await user.click(within(region).getByRole('link', { name: 'View all (9)' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Your watchlist' })).toBeTruthy()
    await waitFor(() => expect(posters(screen.getByRole('region', { name: 'Watchlist' }))).toHaveLength(9))
    expect(screen.getAllByRole('button', { name: /from watchlist$/ })).toHaveLength(9)
  })

  it("shows all of someone else's watchlist, read-only", async () => {
    seed(bob, MOVIES.slice(0, 8))
    const { user } = await open('#/u/bob')

    const region = await screen.findByRole('region', { name: 'Watchlist' })
    await waitFor(() => expect(posters(region)).toHaveLength(6))
    await user.click(within(region).getByRole('link', { name: 'View all (8)' }))

    expect(await screen.findByRole('heading', { level: 1, name: "bob's watchlist" })).toBeTruthy()
    await waitFor(() => expect(posters(screen.getByRole('region', { name: 'Watchlist' }))).toHaveLength(8))
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
  })

  it("keeps a private user's watchlist page from strangers", async () => {
    const quiet = backend.addUser({ username: 'quiet', is_public: false })
    seed(quiet, MOVIES.slice(0, 2))
    await open('#/u/quiet/watchlist')
    expect(await screen.findByText(/This list is private/)).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Watchlist' })).toBeNull()
  })

  it('sends you to your own page when you open your username', async () => {
    await open('#/u/Alice_99/watchlist')
    expect(await screen.findByRole('heading', { level: 1, name: 'Your watchlist' })).toBeTruthy()
  })
})
