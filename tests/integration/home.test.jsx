import { beforeEach, describe, expect, it } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, goTo, launch, ready, screen, useMenu, waitFor, within } from './helpers/harness.js'

const ids = (n) => MOVIES.slice(0, n).map((m) => m.id)
const title = (id) => MOVIES.find((m) => m.id === id).title
const LEADERBOARD_ERROR = "Couldn't load the leaderboard. Check your connection and try again."

let backend
let alice
let bob
let cara

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
  bob = backend.addUser({ username: 'bob' })
  cara = backend.addUser({ username: 'cara' })
  backend.addTmdbMovie({ id: 970001, title: 'Trend One', year: 2025, trending: true })
  backend.addTmdbMovie({ id: 970002, title: 'Trend Two', year: 2024, trending: true })
})

async function open({ as = alice, hash = '#/home' } = {}) {
  const app = await launch({ backend, as, hash })
  await ready({ loggedIn: Boolean(as) })
  return app
}
// A row of the homepage, by its title ("Trending Now").
const rowEl = (name) => document.querySelector(`section.row-section[aria-label="${name}"]`)
const row = (name) => within(rowEl(name))
const cardTitles = (name) => [...rowEl(name).querySelectorAll('.card:not(.card--skeleton) .card__title')].map((n) => n.textContent)
const captions = (name) => [...rowEl(name).querySelectorAll('.card:not(.card--skeleton) .card__caption')].map((n) => n.textContent)
const rowNames = () => [...document.querySelectorAll('section.row-section')].map((s) => s.getAttribute('aria-label'))

describe('the welcome strip', () => {
  it('welcomes you, with nothing rotating and no idle button', async () => {
    await open({ as: null })

    expect(screen.getByRole('heading', { level: 1, name: 'Welcome to SceneIt' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Play Head-to-Head/ })).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(document.querySelector('.hero')).toBeNull()
  })
})

describe('Trending Now', () => {
  it('shows what TMDb says is trending, with years', async () => {
    await open({ as: null })

    await waitFor(() => expect(cardTitles('Trending Now')).toEqual(['Trend One', 'Trend Two']))
    expect(captions('Trending Now')).toEqual(['2025', '2024'])
    expect(row('Trending Now').queryByText('Popular on SceneIt')).toBeNull()
  })

  it('shows placeholders while it loads', async () => {
    const gate = backend.hold('GET /api/movies/trending')
    await launch({ backend, hash: '#/home' })

    await waitFor(() => expect(rowEl('Trending Now').querySelector('[aria-busy="true"]')).not.toBeNull())
    expect(rowEl('Trending Now').querySelectorAll('.card--skeleton')).toHaveLength(8)
    gate.release()
    await waitFor(() => expect(cardTitles('Trending Now')).toHaveLength(2))
  })

  it('falls back to popular catalog movies, and says so, when TMDb is down', async () => {
    backend.tmdbDown()
    await open({ as: null })

    expect(await row('Trending Now').findByText('Popular on SceneIt')).toBeTruthy()
    expect(cardTitles('Trending Now')).toHaveLength(12)
    expect(cardTitles('Trending Now').every((name) => MOVIES.some((m) => m.title === name))).toBe(true)
  })

  it('falls back the same way if the request fails', async () => {
    backend.failApi('GET /api/movies/trending', { network: true })
    await open({ as: null })
    expect(await row('Trending Now').findByText('Popular on SceneIt')).toBeTruthy()
  })

  it('falls back when TMDb has nothing trending', async () => {
    backend.tmdb.trending = []
    await open({ as: null })
    expect(await row('Trending Now').findByText('Popular on SceneIt')).toBeTruthy()
  })

  it('opens a movie\'s details from its card', async () => {
    const { user } = await open({ as: null })
    await waitFor(() => expect(cardTitles('Trending Now')).toHaveLength(2))

    await user.click(within(rowEl('Trending Now')).getByRole('button', { name: 'Trend One (2025)' }))

    expect(await screen.findByRole('dialog', { name: 'Trend One' })).toBeTruthy()
  })

  it('marks movies that are already in your list', async () => {
    backend.addTmdbMovie({ id: 970003, title: 'Trend Three', year: 2023, trending: true, saved: true })
    backend.seedList(alice, [970003])
    await open()

    await waitFor(() => expect(cardTitles('Trending Now')).toContain('Trend Three'))
    const card = within(rowEl('Trending Now')).getByRole('button', { name: 'Trend Three (2023)' })
    await waitFor(() => expect(card.querySelector('.card__ranked')).not.toBeNull())
    expect(within(rowEl('Trending Now')).getByRole('button', { name: 'Trend One (2025)' }).querySelector('.card__ranked')).toBeNull()
  })
})

describe('community rows', () => {
  const [A, B] = ids(2)

  it('shows the month\'s top ranked movies with their community scores', async () => {
    backend.seedList(bob, [A, B])
    backend.seedList(cara, [A])
    await open({ as: null })

    await waitFor(() => expect(cardTitles('Top Ranked by the Community')).toEqual([title(A), title(B)]))
    expect(captions('Top Ranked by the Community')).toEqual(['9.0 community score', '6.0 community score'])
    expect([...rowEl('Top Ranked by the Community').querySelectorAll('.card__rank')].map((n) => n.textContent)).toEqual(['1', '2'])
  })

  it('shows the most watched movies with how many people ranked them', async () => {
    backend.seedList(bob, [A, B])
    backend.seedList(cara, [B])
    await open({ as: null })

    await waitFor(() => expect(cardTitles('Most Watched This Month')).toEqual([title(B), title(A)]))
    expect(captions('Most Watched This Month')).toEqual(['2 rankers', '1 ranker'])
  })

  it('counts movies ranked in the last month, not older ones', async () => {
    backend.seedList(bob, [{ movie: A, createdAt: backend.daysAgo(20) }, { movie: B, createdAt: backend.daysAgo(45) }])
    await open({ as: null })
    await waitFor(() => expect(cardTitles('Top Ranked by the Community')).toEqual([title(A)]))
  })

  it('invites you to be first when nothing has been ranked, and hides the most watched row', async () => {
    await open({ as: null })

    expect(await row('Top Ranked by the Community').findByText('Nobody has ranked anything this month yet. Be the first.')).toBeTruthy()
    expect(rowEl('Most Watched This Month')).toBeNull()
  })

  it('shows an error with a retry, and recovers', async () => {
    backend.seedList(bob, [A])
    backend.failRpc('get_leaderboard', 'boom', { times: 2 })
    const { user } = await open({ as: null })

    const alert = await row('Top Ranked by the Community').findByRole('alert')
    expect(alert.textContent).toContain(LEADERBOARD_ERROR)
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(cardTitles('Top Ranked by the Community')).toEqual([title(A)]))
  })

  it('opens a movie from its card', async () => {
    backend.seedList(bob, [A])
    const { user } = await open({ as: null })
    await waitFor(() => expect(cardTitles('Top Ranked by the Community')).toHaveLength(1))

    await user.click(within(rowEl('Top Ranked by the Community')).getByRole('button', { name: new RegExp(title(A)) }))

    expect(await screen.findByRole('dialog', { name: title(A) })).toBeTruthy()
  })

  it('updates when you rank something yourself', async () => {
    const { user } = await open()
    await row('Top Ranked by the Community').findByText(/Be the first/)

    await useMenu(user, 'Rank Movies')
    const dialog = await screen.findByRole('dialog', { name: 'Rank a movie' })
    backend.tmdbKnows(A)
    await user.type(within(dialog).getByRole('searchbox'), title(A))
    await user.click(await within(dialog).findByRole('button', { name: `Rank ${title(A)}` }))
    await user.click(await screen.findByRole('button', { name: /^Loved it/ }))

    await waitFor(() => expect(cardTitles('Top Ranked by the Community')).toEqual([title(A)]))
  })
})

describe('when you are logged out', () => {
  it('shows only the public rows', async () => {
    backend.seedList(bob, ids(2))
    await open({ as: null })
    await waitFor(() => expect(cardTitles('Trending Now')).toHaveLength(2))

    expect(rowNames()).toEqual(['Trending Now', 'Top Ranked by the Community', 'Most Watched This Month'])
  })
})

describe('Picked for You', () => {
  it('counts down to recommendations, with a progress bar and a way to rank', async () => {
    backend.seedList(alice, ids(6))
    const { user } = await open()

    const unlock = await row('Picked for You').findByText('Rank 9 more movies to unlock recommendations')
    expect(unlock).toBeTruthy()
    expect(within(rowEl('Picked for You')).getByRole('progressbar', { name: 'Movies ranked toward recommendations' }).getAttribute('aria-valuenow')).toBe('6')
    await user.click(within(rowEl('Picked for You')).getByRole('button', { name: 'Rank a movie' }))
    expect(await screen.findByRole('dialog', { name: 'Rank a movie' })).toBeTruthy()
  })

  it('says "1 more movie" in the singular', async () => {
    backend.seedList(alice, ids(14))
    await open()
    expect(await row('Picked for You').findByText('Rank 1 more movie to unlock recommendations')).toBeTruthy()
  })

  it('shows picks instead once you have ranked fifteen', async () => {
    backend.seedList(alice, ids(15))
    await open()

    await waitFor(() => expect(rowEl('Top Picks for You')).not.toBeNull())
    expect(rowEl('Picked for You')).toBeNull()
    const ranked = new Set(ids(15).map(title))
    for (const name of cardTitles('Top Picks for You')) expect(ranked.has(name)).toBe(false)
  })

  it('adds a "Because You Ranked … Highly" row for a favorite', async () => {
    backend.seedList(alice, ids(15))
    await open()

    await waitFor(() => expect(rowNames().some((n) => n.startsWith('Because You Ranked '))).toBe(true))
    const name = rowNames().find((n) => n.startsWith('Because You Ranked '))
    expect(name.endsWith(' Highly')).toBe(true)
    expect(cardTitles(name).length).toBeGreaterThanOrEqual(4)
  })
})

describe('Friends Are Watching', () => {
  it('invites you to add friends when you have none', async () => {
    const { user } = await open()

    expect(await row('Friends Are Watching').findByText("Add friends to see what they're watching")).toBeTruthy()
    await user.click(row('Friends Are Watching').getByRole('button', { name: 'Find friends' }))
    expect(window.location.hash).toBe('#/friends')
  })

  it('says so when your friends haven\'t ranked anything', async () => {
    backend.addFriendship(alice, bob, 'accepted')
    await open()
    expect(await row('Friends Are Watching').findByText("Your friends haven't ranked anything yet.")).toBeTruthy()
  })

  it('shows what friends ranked most recently, once per movie, who ranked it', async () => {
    backend.addFriendship(alice, bob, 'accepted')
    backend.addFriendship(alice, cara, 'accepted')
    backend.seedList(bob, ids(3))
    backend.seedList(cara, [ids(3)[2], MOVIES[10].id]) // cara ranks one movie bob ranked, and one more, later
    await open()

    await waitFor(() => expect(cardTitles('Friends Are Watching').length).toBe(4))
    // newest first: cara's latest, then the movie bob and cara both ranked (cara was last), then bob's others
    expect(cardTitles('Friends Are Watching')).toEqual([title(MOVIES[10].id), title(ids(3)[2]), title(ids(3)[1]), title(ids(3)[0])])
    expect(captions('Friends Are Watching')).toEqual(['cara ranked it', 'cara ranked it', 'bob ranked it', 'bob ranked it'])
  })

  it('names who is ranking, with their initials', async () => {
    backend.addFriendship(alice, bob, 'accepted')
    backend.addFriendship(alice, cara, 'accepted')
    backend.seedList(bob, ids(1))
    backend.seedList(cara, [MOVIES[10].id])
    await open()

    const note = await waitFor(() => {
      const el = rowEl('Friends Are Watching').querySelector('.row-note')
      expect(el).not.toBeNull()
      return el
    })
    expect(note.textContent).toBe('cara, bob are ranking')
    expect([...rowEl('Friends Are Watching').querySelectorAll('.row-avatar')].map((n) => n.textContent)).toEqual(['C', 'B'])
  })

  it('says "is ranking" for one friend', async () => {
    backend.addFriendship(alice, bob, 'accepted')
    backend.seedList(bob, ids(1))
    await open()
    await waitFor(() => expect(rowEl('Friends Are Watching').querySelector('.row-note')?.textContent).toBe('bob is ranking'))
  })

  it('summarises more than three friends', async () => {
    const extra = ['dana', 'erin', 'finn'].map((username) => backend.addUser({ username }))
    for (const [i, friend] of [bob, cara, ...extra].entries()) {
      backend.addFriendship(alice, friend, 'accepted')
      backend.seedList(friend, [MOVIES[20 + i].id])
    }
    await open()
    await waitFor(() => expect(rowEl('Friends Are Watching').querySelector('.row-note')?.textContent).toBe('and 2 others are ranking'))
    expect(rowEl('Friends Are Watching').querySelectorAll('.row-avatar')).toHaveLength(3)
  })

  it('ignores people who are not your friends yet', async () => {
    backend.addFriendship(alice, bob, 'pending')
    backend.seedList(bob, ids(2))
    await open()
    expect(await row('Friends Are Watching').findByText("Add friends to see what they're watching")).toBeTruthy()
  })

  it('marks movies you have ranked too', async () => {
    backend.addFriendship(alice, bob, 'accepted')
    backend.seedList(bob, ids(2))
    backend.seedList(alice, [ids(2)[0]])
    await open()

    await waitFor(() => expect(cardTitles('Friends Are Watching')).toHaveLength(2))
    const mine = within(rowEl('Friends Are Watching')).getByRole('button', { name: new RegExp(title(ids(2)[0])) })
    await waitFor(() => expect(mine.querySelector('.card__ranked')).not.toBeNull())
  })

  it('opens a movie from its card', async () => {
    backend.addFriendship(alice, bob, 'accepted')
    backend.seedList(bob, ids(1))
    const { user } = await open()
    await waitFor(() => expect(cardTitles('Friends Are Watching')).toHaveLength(1))

    await user.click(within(rowEl('Friends Are Watching')).getByRole('button', { name: new RegExp(title(ids(1)[0])) }))

    expect(await screen.findByRole('dialog', { name: title(ids(1)[0]) })).toBeTruthy()
  })

  it('shows an error with a retry when it can\'t load, and recovers', async () => {
    backend.addFriendship(alice, bob, 'accepted')
    backend.seedList(bob, ids(2))
    const { user } = await launch({ backend, as: alice, hash: '#/leaderboard' })
    await ready({ loggedIn: true })
    await waitFor(() => expect(backend.callsTo('rpc:get_friendships').length).toBeGreaterThan(0))
    backend.failQuery('rankings', 'select', 'boom', { times: 1 })
    await goTo('#/home')
    await waitFor(() => expect(rowEl('Friends Are Watching')).not.toBeNull())

    const alert = await row('Friends Are Watching').findByRole('alert')
    expect(alert.textContent).toContain("Couldn't load what your friends are watching.")
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(cardTitles('Friends Are Watching')).toHaveLength(2))
  })

  it('is left out altogether if your friends can\'t be loaded', async () => {
    backend.failRpc('get_friendships', 'boom')
    await open()
    await waitFor(() => expect(cardTitles('Trending Now')).toHaveLength(2))
    expect(rowEl('Friends Are Watching')).toBeNull()
  })

  it('keeps the order of the rows: trending, top ranked, picks, friends, most watched', async () => {
    backend.seedList(bob, ids(2))
    backend.addFriendship(alice, bob, 'accepted')
    await open()
    await waitFor(() => expect(cardTitles('Most Watched This Month').length).toBeGreaterThan(0))
    expect(rowNames()).toEqual(['Trending Now', 'Top Ranked by the Community', 'Picked for You', 'Friends Are Watching', 'Most Watched This Month'])
  })
})
