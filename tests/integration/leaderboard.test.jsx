import { beforeEach, describe, expect, it } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, launch, ready, screen, skipReview, useMenu, waitFor, within } from './helpers/harness.js'

const [A, B, C, D, E] = MOVIES.slice(0, 5).map((m) => m.id)
const title = (id) => MOVIES.find((m) => m.id === id).title

const LEADERBOARD_ERROR = "Couldn't load the leaderboard. Check your connection and try again."

let backend
let alice
let bob
let cara
let dave

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
  bob = backend.addUser({ username: 'bob' })
  cara = backend.addUser({ username: 'cara' })
  dave = backend.addUser({ username: 'dave' })
})

async function open({ as = null, hash = '#/leaderboard' } = {}) {
  const app = await launch({ backend, as, hash })
  await ready({ loggedIn: Boolean(as) })
  await screen.findByRole('heading', { level: 1, name: 'Leaderboard' })
  return app
}
const rowTitles = () => [...document.querySelectorAll('.board .row .row__title')].map((n) => n.textContent)
const values = () => [...document.querySelectorAll('.board .row .row__value')].map((n) => n.textContent)
const podium = () => screen.queryByRole('list', { name: 'Top three' })
const radio = (group, name) => within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name })

describe('the leaderboard', () => {
  it('is open to logged-out visitors and explains what it shows', async () => {
    backend.seedList(bob, [A])
    await open()

    expect(screen.getByText('What the SceneIt community is ranking right now.')).toBeTruthy()
    await waitFor(() => expect(rowTitles()).toEqual([title(A)]))
  })

  it('offers a time period and a sort order', async () => {
    await open()
    const periods = within(screen.getByRole('radiogroup', { name: 'Time period' })).getAllByRole('radio')
    const sorts = within(screen.getByRole('radiogroup', { name: 'Sort by' })).getAllByRole('radio')

    expect(periods.map((r) => r.textContent)).toEqual(['This week', 'This month'])
    expect(sorts.map((r) => r.textContent)).toEqual(['Highest ranked', 'Most watched'])
    expect(periods[0].getAttribute('aria-checked')).toBe('true')
    expect(sorts[0].getAttribute('aria-checked')).toBe('true')
  })

  it('shows a loading message, then the board', async () => {
    backend.seedList(bob, [A])
    const gate = backend.hold('rpc:get_leaderboard')
    await launch({ backend, hash: '#/leaderboard' })

    expect(await screen.findByText('Loading the leaderboard…')).toBeTruthy()
    gate.release()
    await waitFor(() => expect(rowTitles()).toEqual([title(A)]))
    expect(screen.queryByText('Loading the leaderboard…')).toBeNull()
  })

  it('says when nobody has ranked anything, for the week and for the month', async () => {
    const { user } = await open()

    expect(await screen.findByRole('heading', { name: 'Nothing here yet' })).toBeTruthy()
    expect(screen.getByText("No one's ranked anything this week yet. Rank a few movies to get it started.")).toBeTruthy()

    await user.click(radio('Time period', 'This month'))
    expect(await screen.findByText("No one's ranked anything this month yet. Rank a few movies to get it started.")).toBeTruthy()
  })

  it('shows an error with a retry when it can\'t load', async () => {
    backend.seedList(bob, [A])
    backend.failRpc('get_leaderboard', 'boom', { times: 1 })
    const { user } = await open()

    expect((await screen.findByRole('alert')).textContent).toContain(LEADERBOARD_ERROR)
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(rowTitles()).toEqual([title(A)]))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('scores and order', () => {
  it('averages everyone\'s score for a movie and sorts the best first', async () => {
    backend.seedList(bob, [A, B]) // A 10.0, B 6.0
    backend.seedList(cara, [A]) // A 8.0
    await open()

    await waitFor(() => expect(rowTitles()).toEqual([title(A), title(B)]))
    expect(values()).toEqual(['9.0', '6.0'])
  })

  it('numbers the rows from 1', async () => {
    backend.seedList(bob, [A, B, C])
    await open()
    await waitFor(() => expect(rowTitles()).toHaveLength(3))
    expect([...document.querySelectorAll('.board .row .row__rank')].map((n) => n.textContent)).toEqual(['1', '2', '3'])
  })

  it('shows the year under each title', async () => {
    backend.seedList(bob, [A])
    await open()
    await waitFor(() => expect(rowTitles()).toHaveLength(1))
    expect(document.querySelector('.board .row .row__meta').textContent).toBe(String(MOVIES.find((m) => m.id === A).year))
  })

  it('shows only the top ten', async () => {
    backend.seedList(bob, MOVIES.slice(0, 12).map((m) => m.id))
    await open()
    await waitFor(() => expect(rowTitles()).toHaveLength(10))
  })

  it('sorts by number of rankers under "Most watched"', async () => {
    backend.seedList(bob, [A, B, C])
    backend.seedList(cara, [B, C])
    backend.seedList(dave, [C])
    const { user } = await open()
    await waitFor(() => expect(rowTitles()).toEqual([title(A), title(B), title(C)]))

    await user.click(radio('Sort by', 'Most watched'))

    await waitFor(() => expect(rowTitles()).toEqual([title(C), title(B), title(A)]))
    expect(values()).toEqual(['3', '2', '1'])
    expect(screen.getAllByText('rankers').length).toBeGreaterThan(0)
  })

  it('labels the numbers "score" under "Highest ranked"', async () => {
    backend.seedList(bob, [A])
    await open()
    await waitFor(() => expect(rowTitles()).toHaveLength(1))
    expect(screen.getAllByText('score').length).toBeGreaterThan(0)
  })

  it('includes movies outside the built-in catalog, with the title and year from the database', async () => {
    backend.addTmdbMovie({ id: 950001, title: 'Okapi Express', year: 2020, saved: true })
    backend.seedList(bob, [950001])
    await open()

    await waitFor(() => expect(rowTitles()).toEqual(['Okapi Express']))
    expect(document.querySelector('.board .row .row__meta').textContent).toBe('2020')
  })
})

describe('this week and this month', () => {
  beforeEach(() => {
    backend.seedList(bob, [
      { movie: A, createdAt: backend.daysAgo(2) },
      { movie: B, createdAt: backend.daysAgo(15) },
      { movie: C, createdAt: backend.daysAgo(60) },
    ])
  })

  it('counts a movie in the window where it was first ranked', async () => {
    const { user } = await open()
    await waitFor(() => expect(rowTitles()).toEqual([title(A)]))

    await user.click(radio('Time period', 'This month'))

    await waitFor(() => expect(rowTitles().sort()).toEqual([title(A), title(B)].sort()))
    expect(rowTitles()).not.toContain(title(C))
  })

  it('shows "Loading" after a change, not the previous board', async () => {
    const { user } = await open()
    await waitFor(() => expect(rowTitles()).toHaveLength(1))
    const gate = backend.hold('rpc:get_leaderboard')

    await user.click(radio('Time period', 'This month'))

    expect(await screen.findByText('Loading the leaderboard…')).toBeTruthy()
    expect(rowTitles()).toEqual([])
    gate.release()
    await waitFor(() => expect(rowTitles()).toHaveLength(2))
  })

  it('asks the database for the period and sort you picked', async () => {
    const { user } = await open()
    await user.click(radio('Time period', 'This month'))
    await user.click(radio('Sort by', 'Most watched'))

    await waitFor(() => {
      const last = backend.callsTo('rpc:get_leaderboard').at(-1).args
      expect(last).toMatchObject({ p_period: 'monthly', p_category: 'watched' })
    })
  })
})

describe('the podium', () => {
  it('shows the top three as a podium, with the winner in the middle', async () => {
    backend.seedList(bob, [A, B, C, D])
    await open()

    const spots = await within(await screen.findByRole('list', { name: 'Top three' })).findAllByRole('listitem')
    expect(spots.map((li) => li.querySelector('.podium__title').textContent)).toEqual([title(B), title(A), title(C)])
    expect(spots[1].querySelector('.podium__value').textContent).toMatch(/^10\.0 score$/)
  })

  it('shows rankers on the podium under "Most watched"', async () => {
    backend.seedList(bob, [A, B, C])
    backend.seedList(cara, [A, B])
    backend.seedList(dave, [A])
    const { user } = await open()
    await user.click(radio('Sort by', 'Most watched'))

    await waitFor(() => expect(document.querySelector('.podium__value')?.textContent).toMatch(/rankers$/))
    const spots = within(screen.getByRole('list', { name: 'Top three' })).getAllByRole('listitem')
    expect(spots[1].querySelector('.podium__value').textContent).toBe('3 rankers')
  })

  it('needs at least three movies', async () => {
    backend.seedList(bob, [A, B])
    await open()
    await waitFor(() => expect(rowTitles()).toHaveLength(2))
    expect(podium()).toBeNull()
  })

  it('marks the top three rows', async () => {
    backend.seedList(bob, [A, B, C, D, E])
    await open()
    await waitFor(() => expect(rowTitles()).toHaveLength(5))
    expect([...document.querySelectorAll('.board .row')].map((r) => r.classList.contains('is-top'))).toEqual([true, true, true, false, false])
  })
})

describe('opening a movie', () => {
  it.each([
    ['its title', async (user) => user.click(screen.getByRole('button', { name: title(D) }))],
    ['its row', async (user) => user.click(document.querySelectorAll('.board .row')[3])],
    ['the podium', async (user) => user.click(within(screen.getByRole('list', { name: 'Top three' })).getAllByRole('button')[1])],
  ])('opens the details from %s', async (_name, click) => {
    backend.seedList(bob, [A, B, C, D])
    const { user } = await open()
    await waitFor(() => expect(rowTitles()).toHaveLength(4))

    await click(user)

    expect(await screen.findByRole('dialog')).toBeTruthy()
  })
})

describe('when you rank something', () => {
  it('shows your own ranking straight away', async () => {
    backend.tmdbKnows(A)
    const { user } = await open({ as: alice })
    expect(await screen.findByRole('heading', { name: 'Nothing here yet' })).toBeTruthy()

    await useMenu(user, 'Rank Movies')
    const dialog = await screen.findByRole('dialog', { name: 'Rank a movie' })
    await user.type(within(dialog).getByRole('searchbox'), title(A))
    await user.click(await within(dialog).findByRole('button', { name: `Rank ${title(A)}` }))
    await user.click(await screen.findByRole('button', { name: /^Loved it/ }))
    await skipReview(user)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rank another' }).disabled).toBe(false))

    await waitFor(() => expect(rowTitles()).toEqual([title(A)]))
    expect(values()).toEqual(['8.0'])
  })
})
