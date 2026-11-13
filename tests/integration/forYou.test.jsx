import { beforeEach, describe, expect, it } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, goTo, launch, ready, screen, waitFor, within } from './helpers/harness.js'

const ids = (n) => MOVIES.slice(0, n).map((m) => m.id)
const title = (id) => MOVIES.find((m) => m.id === id).title
const tmdbId = (id) => MOVIES.find((m) => m.id === id).tmdb_id

let backend
let alice
let bob

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
  bob = backend.addUser({ username: 'bob' })
})

async function open(hash = '#/for-you') {
  const app = await launch({ backend, as: alice, hash })
  await ready({ loggedIn: true })
  await screen.findByRole('heading', { level: 1, name: 'For You' })
  return app
}
const rowTitles = () => screen.queryAllByRole('region').map((r) => r.getAttribute('aria-label')).filter(Boolean)
const row = (name) => within(screen.getByRole('region', { name }))
const cards = (name) => row(name).getAllByRole('button').map((b) => b.querySelector('.rec__title').textContent)

describe('before recommendations unlock', () => {
  it('counts down to 15 movies, with a progress bar', async () => {
    backend.seedList(alice, ids(11))
    await open()

    expect(await screen.findByRole('heading', { name: 'Rank 4 more movies to unlock recommendations' })).toBeTruthy()
    const bar = screen.getByRole('progressbar', { name: 'Movies ranked toward recommendations' })
    expect(bar.getAttribute('aria-valuenow')).toBe('11')
    expect(bar.getAttribute('aria-valuemax')).toBe('15')
    expect(screen.getByText('11 of 15 ranked')).toBeTruthy()
  })

  it('says "1 more movie" in the singular', async () => {
    backend.seedList(alice, ids(14))
    await open()
    expect(await screen.findByRole('heading', { name: 'Rank 1 more movie to unlock recommendations' })).toBeTruthy()
  })

  it('starts at zero', async () => {
    await open()
    expect(await screen.findByRole('heading', { name: 'Rank 15 more movies to unlock recommendations' })).toBeTruthy()
    expect(screen.getByText('0 of 15 ranked')).toBeTruthy()
  })

  it('explains what unlocking gives you, and opens the ranking dialog', async () => {
    const { user } = await open()
    expect(await screen.findByText(/SceneIt suggests movies like the ones you loved/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Rank a movie' }))

    expect(await screen.findByRole('dialog', { name: 'Rank a movie' })).toBeTruthy()
  })

  it('does not ask TMDb or friends for anything yet', async () => {
    backend.seedList(alice, ids(5))
    await open()
    await screen.findByRole('heading', { name: /to unlock recommendations/ })
    await new Promise((r) => setTimeout(r, 200))
    expect(backend.callsTo('fetch:GET /api/movies/recommendations')).toHaveLength(0)
  })
})

describe('once unlocked', () => {
  beforeEach(() => backend.seedList(alice, ids(15)))

  // TMDb has nothing for these seeds in the fake, so these picks come from the catalog fallback.
  it('shows picks, never movies you have ranked', async () => {
    await open()

    expect(await screen.findByRole('region', { name: 'Top picks for you' })).toBeTruthy()
    const picks = cards('Top picks for you')
    expect(picks.length).toBeGreaterThan(0)
    expect(picks.length).toBeLessThanOrEqual(6)
    const ranked = new Set(ids(15).map(title))
    for (const name of picks) expect(ranked.has(name)).toBe(false)
  })

  it('adds a "Because you ranked … highly" row for your favorites', async () => {
    await open()
    await screen.findByRole('region', { name: 'Top picks for you' })

    expect(rowTitles().some((name) => name.startsWith('Because you ranked '))).toBe(true)
    expect(rowTitles().filter((name) => name.startsWith('Because you ranked ')).length).toBeLessThanOrEqual(3)
  })

  it('never shows the same movie in two rows', async () => {
    await open()
    await screen.findByRole('region', { name: 'Top picks for you' })

    const all = rowTitles().flatMap((name) => cards(name))
    expect(new Set(all).size).toBe(all.length)
  })

  it('labels each pick with its year or why it was picked', async () => {
    await open()
    await screen.findByRole('region', { name: 'Top picks for you' })
    const labels = [...row('Top picks for you').getAllByRole('button')].map((b) => b.querySelector('.rec__meta').textContent)
    for (const label of labels) expect(label).toMatch(/^(\d{4}|Because you liked .+|.+ loved it)$/)
  })

  it('opens a pick\'s details when you click it', async () => {
    const { user } = await open()
    await screen.findByRole('region', { name: 'Top picks for you' })

    await user.click(row('Top picks for you').getAllByRole('button')[0])

    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('stops showing a movie once you rank it', async () => {
    const { user } = await open()
    await screen.findByRole('region', { name: 'Top picks for you' })
    const first = cards('Top picks for you')[0]
    await user.click(row('Top picks for you').getAllByRole('button')[0])
    const details = await screen.findByRole('dialog')
    await user.click(within(details).getByRole('button', { name: 'Rank it' }))
    await user.click(await screen.findByRole('button', { name: /^Loved it/ }))
    await user.keyboard('{ArrowRight}'.repeat(5))
    await waitFor(() => expect(backend.rankings.filter((r) => r.user_id === alice.id).length).toBe(16))
    await user.keyboard('{Escape}')
    await goTo('#/leaderboard')
    await goTo('#/for-you')

    await screen.findByRole('region', { name: 'Top picks for you' })
    expect(rowTitles().flatMap((name) => cards(name))).not.toContain(first)
  })
})

describe('with TMDb\'s recommendations', () => {
  beforeEach(() => {
    backend.seedList(alice, ids(15))
  })

  it('asks TMDb about your top movies', async () => {
    await open()
    await waitFor(() => expect(backend.callsTo('fetch:GET /api/movies/recommendations')).toHaveLength(1))

    const asked = new URL(backend.callsTo('fetch:GET /api/movies/recommendations')[0].args.url).searchParams.get('ids').split(',').map(Number)
    expect(asked).toContain(tmdbId(ids(15)[0]))
    expect(asked.length).toBeLessThanOrEqual(12)
  })

  it('shows what TMDb recommends for your favorite, and no catalog movies', async () => {
    const pick = backend.addTmdbMovie({ id: 960001, title: 'Gnu Gone Wild', year: 2023, vote_count: 9000 })
    backend.setTmdbRecommendations(tmdbId(ids(15)[0]), [pick])
    await open()

    await waitFor(() => expect(rowTitles().flatMap((name) => cards(name))).toEqual(['Gnu Gone Wild']))
  })

  it('says it is finding picks while TMDb answers', async () => {
    backend.hold('GET /api/movies/recommendations')
    await open()
    expect(await screen.findByText('Finding picks for you…')).toBeTruthy()
    expect(rowTitles()).toEqual([])
  })

  it('ignores movies TMDb recommends that hardly anyone has rated', async () => {
    const obscure = backend.addTmdbMovie({ id: 960002, title: 'Nobody Saw This', year: 2023, vote_count: 3 })
    backend.setTmdbRecommendations(tmdbId(ids(15)[0]), [obscure])
    await open()
    await waitFor(() => expect(backend.callsTo('fetch:GET /api/movies/recommendations')).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 200))

    expect(rowTitles().flatMap((name) => cards(name))).not.toContain('Nobody Saw This')
  })

  it('falls back to the catalog, quietly, if TMDb recommendations fail', async () => {
    backend.failApi('GET /api/movies/recommendations', { status: 502, body: { error: 'down' } })
    await open()

    expect(await screen.findByRole('region', { name: 'Top picks for you' })).toBeTruthy()
    await waitFor(() => expect(backend.callsTo('fetch:GET /api/movies/recommendations')).toHaveLength(1))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('with friends\' rankings', () => {
  beforeEach(() => {
    backend.seedList(alice, ids(15))
    backend.addFriendship(alice, bob, 'accepted')
  })
  const FRIEND_PICK = MOVIES[30].id

  it('adds a row of movies your friends loved', async () => {
    // bob agrees with you on your top movies, and loves something you haven't ranked.
    backend.seedList(bob, [...ids(6), FRIEND_PICK])
    await open()

    expect(await screen.findByRole('region', { name: 'Your friends loved these' })).toBeTruthy()
    expect(cards('Your friends loved these')).toContain(title(FRIEND_PICK))
    const label = [...row('Your friends loved these').getAllByRole('button')].find((b) => b.textContent.includes(title(FRIEND_PICK)))
    expect(label.querySelector('.rec__meta').textContent).toBe('Loved by bob')
  })

  it('leaves the row out when no friend has anything new to suggest', async () => {
    backend.seedList(bob, ids(4))
    await open()
    await screen.findByRole('region', { name: 'Top picks for you' })
    await new Promise((r) => setTimeout(r, 200))
    expect(screen.queryByRole('region', { name: 'Your friends loved these' })).toBeNull()
  })

  it('doesn\'t use people who are not yet your friends', async () => {
    const cara = backend.addUser({ username: 'cara' })
    backend.addFriendship(cara, alice, 'pending')
    backend.seedList(cara, [...ids(6), FRIEND_PICK])
    await open()
    await screen.findByRole('region', { name: 'Top picks for you' })
    await new Promise((r) => setTimeout(r, 200))
    expect(screen.queryByRole('region', { name: 'Your friends loved these' })).toBeNull()
  })

  it('goes without friends\' picks, quietly, if their rankings can\'t be loaded', async () => {
    backend.seedList(bob, [...ids(6), FRIEND_PICK])
    const { user } = await launch({ backend, as: alice, hash: '#/home' })
    await ready({ loggedIn: true })
    void user
    backend.failQuery('rankings', 'select', 'boom', { times: 1 })
    await goTo('#/for-you')

    expect(await screen.findByRole('region', { name: 'Top picks for you' })).toBeTruthy()
    await waitFor(() => expect(backend.failures.find((f) => f.key === 'from:rankings:select').times).toBe(0)) // the failure was hit
    expect(screen.queryByRole('region', { name: 'Your friends loved these' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
