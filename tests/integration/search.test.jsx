import { beforeEach, describe, expect, it } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, launch, ready, screen, useMenu, waitFor, within } from './helpers/harness.js'

const LIVE_ERROR = "Live search isn't working right now, so these are only SceneIt's built-in movies."
const byId = (id) => MOVIES.find((m) => m.id === id)
const title = (id) => byId(id).title

let backend
let alice

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
  // Two movies only TMDb knows about, plus a few catalog ones for live search to find.
  backend.addTmdbMovie({ id: 920001, title: 'Zebra Crossing', year: 2021, genres: ['Drama', 'Mystery'] })
  backend.addTmdbMovie({ id: 920002, title: 'Zebra Nights', year: 2019, genres: ['Horror'] })
})

async function open({ as = alice, hash = '#/home' } = {}) {
  const app = await launch({ backend, as, hash })
  await ready({ loggedIn: Boolean(as) })
  return app
}
const bar = () => within(screen.getByRole('search'))
const box = () => bar().getByRole('searchbox', { name: 'Search movies' })
const options = () => within(screen.getByRole('listbox', { name: 'Search results' })).queryAllByRole('option')
const optionTitles = () => options().map((o) => o.querySelector('.sbar__title').textContent)

describe('header search', () => {
  it('stays closed until you type, then shows genre chips and results', async () => {
    const { user } = await open()
    await user.click(box())
    expect(screen.queryByRole('listbox')).toBeNull()

    await user.type(box(), 'zebra')

    expect(await screen.findByRole('group', { name: 'Filter by genre' })).toBeTruthy()
    await waitFor(() => expect(optionTitles()).toEqual(['Zebra Crossing', 'Zebra Nights']))
    expect(box().getAttribute('aria-expanded')).toBe('true')
  })

  it('shows "Searching…" while the live search is on its way', async () => {
    const gate = backend.hold('GET /api/movies/search')
    const { user } = await open()
    await user.type(box(), 'zebra')

    expect(await screen.findByText('Searching…')).toBeTruthy()
    gate.release()
    await waitFor(() => expect(optionTitles()).toHaveLength(2))
  })

  it('shows the year and genres under each result', async () => {
    const { user } = await open()
    await user.type(box(), 'zebra crossing')

    await waitFor(() => expect(options()).toHaveLength(1))
    expect(options()[0].querySelector('.sbar__meta').textContent).toBe('2021 · Drama, Mystery')
  })

  it('waits for you to stop typing and sends one request', async () => {
    const { user } = await open()
    await user.type(box(), 'zebra')
    await waitFor(() => expect(options()).toHaveLength(2))

    expect(backend.callsTo('fetch:GET /api/movies/search')).toHaveLength(1)
    expect(new URL(backend.callsTo('fetch:GET /api/movies/search')[0].args.url).searchParams.get('q')).toBe('zebra')
  })

  it('shows at most seven results', async () => {
    for (let i = 0; i < 9; i++) backend.addTmdbMovie({ id: 930000 + i, title: `Crowd ${i}`, year: 2000 + i })
    const { user } = await open()
    await user.type(box(), 'crowd')
    await waitFor(() => expect(options()).toHaveLength(7))
  })

  it('opens a movie\'s details when you click a result, and closes the list', async () => {
    const { user } = await open()
    await user.type(box(), 'zebra crossing')
    await waitFor(() => expect(options()).toHaveLength(1))

    await user.click(options()[0])

    expect(await screen.findByRole('dialog', { name: 'Zebra Crossing' })).toBeTruthy()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('moves through results with the arrow keys and opens the highlighted one with Enter', async () => {
    const { user } = await open()
    await user.type(box(), 'zebra')
    await waitFor(() => expect(options()).toHaveLength(2))

    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(options()[1].getAttribute('aria-selected')).toBe('true')
    await user.keyboard('{ArrowUp}')
    expect(options()[0].getAttribute('aria-selected')).toBe('true')
    await user.keyboard('{ArrowDown}{Enter}')

    expect(await screen.findByRole('dialog', { name: 'Zebra Nights' })).toBeTruthy()
  })

  it('opens the first result when you just press Enter', async () => {
    const { user } = await open()
    await user.type(box(), 'zebra')
    await waitFor(() => expect(options()).toHaveLength(2))

    await user.keyboard('{Enter}')

    expect(await screen.findByRole('dialog', { name: 'Zebra Crossing' })).toBeTruthy()
  })

  it('closes with Escape and when you click elsewhere', async () => {
    const { user } = await open()
    await user.type(box(), 'zebra')
    await waitFor(() => expect(options()).toHaveLength(2))

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())

    await user.click(box())
    await waitFor(() => expect(options()).toHaveLength(2))
    await user.pointer({ keys: '[MouseLeft]', target: document.body })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  })

  it('says nothing matched', async () => {
    const { user } = await open()
    await user.type(box(), 'qqqzzz')
    expect(await screen.findByText('No movies match “qqqzzz”.')).toBeTruthy()
  })

  it('clears the text and the results with the clear button', async () => {
    const { user } = await open()
    await user.type(box(), 'zebra')
    await waitFor(() => expect(options()).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(box().value).toBe('')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
  })

  it('works when you are logged out', async () => {
    const { user } = await open({ as: null })
    await user.type(box(), 'zebra crossing')
    await waitFor(() => expect(options()).toHaveLength(1))
    await user.click(options()[0])
    expect(await screen.findByRole('dialog', { name: 'Zebra Crossing' })).toBeTruthy()
  })
})

describe('header search genres', () => {
  it('lists the twelve genres', async () => {
    const { user } = await open()
    await user.type(box(), 'a')
    const chips = within(await screen.findByRole('group', { name: 'Filter by genre' })).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual(['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Drama', 'Fantasy', 'Horror', 'Mystery', 'Romance', 'Science Fiction', 'Thriller'])
  })

  it('narrows a search to one genre, and back again', async () => {
    const { user } = await open()
    await user.type(box(), 'zebra')
    await waitFor(() => expect(options()).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: 'Horror' }))
    expect(screen.getByRole('button', { name: 'Horror' }).getAttribute('aria-pressed')).toBe('true')
    expect(optionTitles()).toEqual(['Zebra Nights'])

    await user.click(screen.getByRole('button', { name: 'Horror' }))
    expect(optionTitles()).toEqual(['Zebra Crossing', 'Zebra Nights'])
  })

  it('names the genre when nothing matches', async () => {
    const { user } = await open()
    await user.type(box(), 'zebra')
    await waitFor(() => expect(options()).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: 'Romance' }))

    expect(await screen.findByText('No romance movies match “zebra”.')).toBeTruthy()
  })

  it('also lists catalog movies of that genre from just a chip, up to seven', async () => {
    const { user } = await open()
    await user.type(box(), 'a')
    await user.click(await screen.findByRole('button', { name: 'Drama' }))
    await user.clear(box())

    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    expect(options().length).toBeLessThanOrEqual(7)
    for (const li of options()) expect(byId([...MOVIES].find((m) => m.title === li.querySelector('.sbar__title').textContent).id).genres).toContain('Drama')
  })

  it('clears the chip with the clear button too', async () => {
    const { user } = await open()
    await user.type(box(), 'a')
    await user.click(await screen.findByRole('button', { name: 'Drama' }))
    await user.clear(box())
    await waitFor(() => expect(options().length).toBeGreaterThan(0))

    await user.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('header search when live search is down', () => {
  it('falls back to the built-in catalog and says so', async () => {
    backend.failApi('GET /api/movies/search', { status: 502, body: { error: 'down' } })
    const { user } = await open()
    await user.type(box(), 'dune')

    expect(await screen.findByText("Live search is unavailable, showing SceneIt's built-in movies.")).toBeTruthy()
    expect(optionTitles()).toContain(title('dune-part-two-2024'))
  })

  it('also falls back when TMDb itself is down', async () => {
    backend.tmdbDown()
    const { user } = await open()
    await user.type(box(), 'dune')
    expect(await screen.findByText(/Live search is unavailable/)).toBeTruthy()
  })

  it('falls back when the request never arrives', async () => {
    backend.failApi('GET /api/movies/search', { network: true })
    const { user } = await open()
    await user.type(box(), 'dune')
    expect(await screen.findByText(/Live search is unavailable/)).toBeTruthy()
  })
})

describe('the Rank a movie dialog', () => {
  const openDialog = async (user) => {
    await useMenu(user, 'Rank Movies')
    return screen.findByRole('dialog', { name: 'Rank a movie' })
  }

  it('opens with popular picks and the cursor in the search box', async () => {
    const { user } = await open()
    const dialog = await openDialog(user)

    expect(within(dialog).getByText('Popular picks')).toBeTruthy()
    expect(within(dialog).getAllByRole('button', { name: /^Rank / }).length).toBe(8)
    expect(document.activeElement).toBe(within(dialog).getByRole('searchbox', { name: 'Search movies' }))
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('shows a result count after searching', async () => {
    const { user } = await open()
    const dialog = await openDialog(user)

    await user.type(within(dialog).getByRole('searchbox'), 'zebra')

    expect(await within(dialog).findByText('2 results')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Rank Zebra Crossing' })).toBeTruthy()
  })

  it('says "1 result" in the singular, with year and genres', async () => {
    const { user } = await open()
    const dialog = await openDialog(user)

    await user.type(within(dialog).getByRole('searchbox'), 'zebra crossing')

    expect(await within(dialog).findByText('1 result')).toBeTruthy()
    expect(within(dialog).getByText('2021 · Drama, Mystery')).toBeTruthy()
  })

  it('says nothing matched', async () => {
    const { user } = await open()
    const dialog = await openDialog(user)
    await user.type(within(dialog).getByRole('searchbox'), 'qqqzzz')
    expect(await within(dialog).findByText('No movies match “qqqzzz”. Try another title.')).toBeTruthy()
  })

  it('falls back to the built-in catalog, with a warning, when live search fails', async () => {
    backend.failApi('GET /api/movies/search', { status: 502, body: { error: 'down' } })
    const { user } = await open()
    const dialog = await openDialog(user)

    await user.type(within(dialog).getByRole('searchbox'), 'dune')

    expect((await within(dialog).findByRole('alert')).textContent).toBe(LIVE_ERROR)
    expect(within(dialog).getByRole('button', { name: `Rank ${title('dune-part-two-2024')}` })).toBeTruthy()
  })

  it('marks movies you have already ranked, and disables their button', async () => {
    backend.seedList(alice, ['dune-part-two-2024'])
    backend.tmdbKnows('dune-part-two-2024')
    const { user } = await open()
    const dialog = await openDialog(user)

    await user.type(within(dialog).getByRole('searchbox'), 'dune')

    const done = await within(dialog).findByRole('button', { name: `${title('dune-part-two-2024')} is already ranked` })
    expect(done.disabled).toBe(true)
    expect(done.textContent).toBe('Ranked')
  })

  it('opens a movie\'s details from its title, on top of the dialog', async () => {
    const { user } = await open()
    const dialog = await openDialog(user)
    await user.type(within(dialog).getByRole('searchbox'), 'zebra crossing')
    await user.click(await within(dialog).findByRole('button', { name: 'Zebra Crossing' }))

    expect(await screen.findByRole('dialog', { name: 'Zebra Crossing' })).toBeTruthy()
    // Escape closes the details first, leaving the search open.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Zebra Crossing' })).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Rank a movie' })).toBeTruthy()
  })

  it.each([
    ['the close button', async (user) => user.click(screen.getByRole('button', { name: 'Close' }))],
    ['Escape', async (user) => user.keyboard('{Escape}')],
    ['clicking outside', async (user, dialog) => user.pointer({ keys: '[MouseLeft]', target: dialog.parentElement })],
  ])('closes with %s, and lets the page scroll again', async (_name, close) => {
    const { user } = await open()
    const dialog = await openDialog(user)

    await close(user, dialog)

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rank a movie' })).toBeNull())
    expect(document.body.style.overflow).toBe('')
  })

  it('stays open when you click inside it', async () => {
    const { user } = await open()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('searchbox'))
    expect(screen.getByRole('dialog', { name: 'Rank a movie' })).toBeTruthy()
  })
})

describe('the Rank a movie dialog when logged out', () => {
  const logIn = async (user) => {
    await user.type(await screen.findByLabelText('Email or username'), 'alice_99@example.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(within(screen.getByLabelText('Password').closest('form')).getByRole('button', { name: 'Log in' }))
    await ready({ loggedIn: true })
  }

  it('says "Log in to rank" on a movie\'s details, and sends you to log in', async () => {
    const { user } = await open({ as: null })
    await user.type(box(), 'zebra crossing')
    await waitFor(() => expect(options()).toHaveLength(1))
    await user.click(options()[0])
    const details = await screen.findByRole('dialog', { name: 'Zebra Crossing' })

    await user.click(within(details).getByRole('button', { name: 'Log in to rank' }))

    expect(window.location.hash).toBe('#/login')
    expect(screen.queryByRole('dialog', { name: 'Zebra Crossing' })).toBeNull()
    await logIn(user)
  })

  // Known gap: after logging in, App.jsx opens the remembered dialog from a setTimeout inside an
  // effect that also changes the page. The page change re-runs the effect and clears the timer
  // first, so the dialog never opens. (Returning to a remembered *page* works; see auth.test.jsx.)
  it.todo('reopens the movie\'s details after logging in from "Log in to rank"')
})

describe('from the Profile menu', () => {
  it('opens the same dialog from "Rank Movies"', async () => {
    const { user } = await open()
    await useMenu(user, 'Rank Movies')
    expect(await screen.findByRole('dialog', { name: 'Rank a movie' })).toBeTruthy()
  })
})
