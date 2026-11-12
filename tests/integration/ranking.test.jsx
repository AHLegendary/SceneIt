import { beforeEach, describe, expect, it } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, launch, ready, screen, skipReview, waitFor, within } from './helpers/harness.js'

const ids = (n) => MOVIES.slice(0, n).map((m) => m.id)
const title = (id) => MOVIES.find((m) => m.id === id).title
const tmdbId = (id) => MOVIES.find((m) => m.id === id).tmdb_id

const SAVE_ERROR = "Couldn't save your ranking. Check your connection and try again."
const REMOVE_ERROR = "Couldn't remove that movie. Check your connection and try again."
const SESSION_ERROR = 'Your login session has expired. Log in again and your ranking will be saved.'

let backend
let alice

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
})

async function open(hash = '#/my-list') {
  const app = await launch({ backend, as: alice, hash })
  await ready({ loggedIn: true })
  return app
}

const rowTitles = () => [...document.querySelectorAll('.board .row .row__title')].map((n) => n.textContent)
const ranks = () => [...document.querySelectorAll('.board .row .row__rank')].map((n) => n.textContent)
const searchDialog = () => screen.findByRole('dialog', { name: 'Rank a movie' })

// Searches in the "Rank a movie" dialog and starts ranking the movie.
async function startRanking(user, id) {
  backend.tmdbKnows(id)
  const dialog = await searchDialog()
  await user.type(within(dialog).getByRole('searchbox', { name: 'Search movies' }), title(id))
  await user.click(await within(dialog).findByRole('button', { name: `Rank ${title(id)}` }))
}
const feeling = (user, label) => user.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))
const compare = () => document.querySelector('.compare')

// Answers the head-to-head questions: 'new' (←), 'old' (→) or 'tie' (space).
async function answer(user, ...picks) {
  const key = { new: '{ArrowLeft}', old: '{ArrowRight}', tie: ' ' }
  for (const pick of picks) await user.keyboard(key[pick])
}
// Waits for the save, skips the review step, and waits for the result screen.
async function waitSaved() {
  await skipReview()
  await waitFor(() => expect(screen.getByRole('button', { name: /See my list|Done/ }).disabled).toBe(false))
}
// The whole flow for one movie.
async function rank(user, id, category, ...picks) {
  await startRanking(user, id)
  await feeling(user, category)
  await answer(user, ...picks)
  await waitSaved()
}

describe('My List', () => {
  it('invites you to rank your first movie', async () => {
    const { user } = await open()

    expect(await screen.findByRole('heading', { name: 'Your list is empty' })).toBeTruthy()
    expect(screen.getByText('Every movie you rank lands here, best at the top.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Rank a movie' }))
    expect(await searchDialog()).toBeTruthy()
  })

  it('shows your movies best first with a count', async () => {
    backend.seedList(alice, ids(4))
    await open()

    expect(await screen.findByText('4 ranked movies')).toBeTruthy()
    expect(rowTitles()).toEqual(ids(4).map(title))
    expect(ranks()).toEqual(['1', '2', '3', '4'])
  })

  it('says "1 ranked movie" in the singular, and has no Rerank button for a lone movie', async () => {
    backend.seedList(alice, ids(1))
    await open()

    expect(await screen.findByText('1 ranked movie')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Rerank/ })).toBeNull()
    expect(screen.getByRole('button', { name: `Remove ${title(ids(1)[0])}` })).toBeTruthy()
  })

  it('shows tied movies with a shared rank', async () => {
    backend.seedList(alice, [ids(1)[0], { movie: ids(2)[1], tied: true }, ids(3)[2]])
    await open()

    await waitFor(() => expect(rowTitles()).toHaveLength(3))
    expect(ranks()).toEqual(['1', '1', '3'])
    expect(screen.getAllByText('Tied')).toHaveLength(2)
  })

  it('counts down to scores below ten movies, with a progress bar', async () => {
    backend.seedList(alice, ids(7))
    await open()

    expect(await screen.findByText('Rank 3 more movies to unlock scores')).toBeTruthy()
    const bar = screen.getByRole('progressbar', { name: 'Movies ranked toward scores' })
    expect(bar.getAttribute('aria-valuenow')).toBe('7')
    expect(bar.getAttribute('aria-valuemax')).toBe('10')
    expect(screen.queryByText('score')).toBeNull()
  })

  it('says "1 more movie" in the singular', async () => {
    backend.seedList(alice, ids(9))
    await open()
    expect(await screen.findByText('Rank 1 more movie to unlock scores')).toBeTruthy()
  })

  it('shows a score on every movie from ten movies on, and drops the countdown', async () => {
    backend.seedList(alice, ids(10))
    await open()

    await waitFor(() => expect(rowTitles()).toHaveLength(10))
    expect(screen.getAllByText('score')).toHaveLength(10)
    expect(screen.queryByText(/to unlock scores/)).toBeNull()
    expect(document.querySelector('.board .row .row__value').textContent).toBe('10.0')
  })

  it('opens a movie\'s details from its title or its row', async () => {
    backend.seedList(alice, ids(2))
    const { user } = await open()
    await waitFor(() => expect(rowTitles()).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: title(ids(1)[0]) }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('shows a loading message while your account loads', async () => {
    const gate = backend.hold('from:rankings:select')
    await launch({ backend, as: alice, hash: '#/my-list' })
    expect(await screen.findByText('Loading your account…')).toBeTruthy()
    gate.release()
    expect(await screen.findByRole('heading', { name: 'Your list is empty' })).toBeTruthy()
  })

  it('shows an error with a retry if your list can\'t be loaded', async () => {
    backend.failQuery('rankings', 'select', 'boom', { times: 1 })
    backend.seedList(alice, ids(2))
    const { user } = await launch({ backend, as: alice, hash: '#/my-list' })

    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load your list. Check your connection and try again.")
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(rowTitles()).toHaveLength(2))
  })
})

describe('filtering and the tier list', () => {
  beforeEach(() => {
    backend.seedList(alice, [
      ...ids(4).map((movie) => ({ movie, category: 'loved' })),
      ...ids(7).slice(4).map((movie) => ({ movie, category: 'okay' })),
      ...ids(10).slice(7).map((movie) => ({ movie, category: 'meh' })),
    ])
  })

  it('offers a filter by category once scores unlock, with counts', async () => {
    await open()
    const filter = await screen.findByRole('radiogroup', { name: 'Filter or view' })

    expect(within(filter).getAllByRole('radio').map((r) => r.textContent)).toEqual(['All · 10', 'Loved it · 4', 'It was okay · 3', 'Not a fan · 3', 'Tier list'])
  })

  it('shows only the movies in the category you pick, with its score range', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('radio', { name: 'It was okay · 3' }))

    expect(rowTitles()).toEqual(ids(7).slice(4).map(title))
    expect(screen.getByText('Scores 4.0–5.9')).toBeTruthy()
  })

  it('says so when a category is empty, and lets you go back to all', async () => {
    // Ten movies, none of them "Not a fan".
    backend.rankings = []
    backend.seedList(alice, ids(10).map((movie, i) => ({ movie, category: i < 6 ? 'loved' : 'okay' })))
    const { user } = await open()

    await user.click(await screen.findByRole('radio', { name: 'Not a fan · 0' }))

    expect(screen.getByText('No movies in “Not a fan” yet.')).toBeTruthy()
    expect(rowTitles()).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Show all' }))
    expect(rowTitles()).toHaveLength(10)
  })

  it('shows a tier list, cut by score once scores unlock', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('radio', { name: 'Tier list' }))

    const tiers = screen.getByRole('list', { name: 'Tier list' })
    expect(within(tiers).getAllByRole('listitem')).toHaveLength(6)
    expect(['S', 'A', 'B', 'C', 'D', 'F'].map((t) => within(tiers).getByLabelText(`Tier ${t}`).textContent)).toEqual(['S', 'A', 'B', 'C', 'D', 'F'])
    expect(screen.getByText('Rows cut by score')).toBeTruthy()
    expect(within(tiers).getByRole('button', { name: title(ids(1)[0]) })).toBeTruthy()
  })

  it('opens a movie from the tier list', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('radio', { name: 'Tier list' }))
    await user.click(within(screen.getByRole('list', { name: 'Tier list' })).getByRole('button', { name: title(ids(1)[0]) }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })
})

describe('the tier list before scores unlock', () => {
  it('cuts rows by position and has no category filter', async () => {
    backend.seedList(alice, ids(4))
    const { user } = await open()

    const filter = await screen.findByRole('radiogroup', { name: 'Filter or view' })
    expect(within(filter).getAllByRole('radio').map((r) => r.textContent)).toEqual(['All · 4', 'Tier list'])
    await user.click(within(filter).getByRole('radio', { name: 'Tier list' }))
    expect(screen.getByText('Rows cut by position until scores unlock')).toBeTruthy()
  })
})

describe('removing a movie', () => {
  it('removes it and closes the gap', async () => {
    backend.seedList(alice, ids(3))
    const { user } = await open()
    await waitFor(() => expect(rowTitles()).toHaveLength(3))

    await user.click(screen.getByRole('button', { name: `Remove ${title(ids(2)[1])}` }))

    await waitFor(() => expect(rowTitles()).toEqual([title(ids(1)[0]), title(ids(3)[2])]))
    expect(ranks()).toEqual(['1', '2'])
    expect(backend.listOf(alice)).toEqual([[ids(1)[0]], [ids(3)[2]]])
    expect(await screen.findByText('2 ranked movies')).toBeTruthy()
  })

  it('shows "Removing…" and disables the other Remove buttons meanwhile', async () => {
    backend.seedList(alice, ids(2))
    const gate = backend.hold('rpc:remove_ranking')
    const { user } = await open()
    await waitFor(() => expect(rowTitles()).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: `Remove ${title(ids(1)[0])}` }))

    expect(await screen.findByRole('button', { name: `Remove ${title(ids(1)[0])}` })).toHaveProperty('textContent', 'Removing…')
    expect(screen.getByRole('button', { name: `Remove ${title(ids(2)[1])}` }).disabled).toBe(true)
    gate.release()
    await waitFor(() => expect(rowTitles()).toHaveLength(1))
  })

  it('shows an error and keeps the movie when removing fails, and lets you dismiss it', async () => {
    backend.seedList(alice, ids(2))
    backend.failRpc('remove_ranking', 'boom', { times: 1 })
    const { user } = await open()
    await waitFor(() => expect(rowTitles()).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: `Remove ${title(ids(1)[0])}` }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(REMOVE_ERROR)
    expect(rowTitles()).toHaveLength(2)
    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('returns to the empty state after the last movie', async () => {
    backend.seedList(alice, ids(1))
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: `Remove ${title(ids(1)[0])}` }))
    expect(await screen.findByRole('heading', { name: 'Your list is empty' })).toBeTruthy()
  })
})

describe('ranking your first movie', () => {
  it('asks how you felt, needs no comparison, and starts your list', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))

    await startRanking(user, ids(1)[0])
    expect(await screen.findByRole('heading', { name: `How did you feel about ${title(ids(1)[0])}?` })).toBeTruthy()
    expect(screen.getByText("Then we'll compare it with others you felt the same about.")).toBeTruthy()
    await feeling(user, 'Loved it')

    await waitSaved()
    expect(await screen.findByText('First movie added')).toBeTruthy()
    expect(screen.getByText(`${title(ids(1)[0])} starts your list. Add another and SceneIt will ask you to compare them.`)).toBeTruthy()
    expect(screen.getByRole('heading', { name: /#1\s*of 1/ })).toBeTruthy()
    expect(backend.listOf(alice)).toEqual([[ids(1)[0]]])
    expect(backend.rankingOf(alice, tmdbId(ids(1)[0])).category).toBe('loved')
  })

  it('offers all three feelings, with their score ranges', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, ids(1)[0])

    expect(screen.getByRole('button', { name: /^Loved it\s*6\.0–10/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^It was okay\s*4\.0–5\.9/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Not a fan\s*0\.0–3\.9/ })).toBeTruthy()
  })

  it.each([
    ['Loved it', 'loved'],
    ['It was okay', 'okay'],
    ['Not a fan', 'meh'],
  ])('saves the "%s" feeling as the %s category', async (label, category) => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, ids(1)[0])
    await feeling(user, label)
    await waitSaved()

    expect(backend.rankingOf(alice, tmdbId(ids(1)[0])).category).toBe(category)
  })

  it('picks the feeling with the 1, 2 and 3 keys', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, ids(1)[0])

    await user.keyboard('3')

    await waitSaved()
    expect(backend.rankingOf(alice, tmdbId(ids(1)[0])).category).toBe('meh')
  })
})

describe('comparing head to head', () => {
  beforeEach(() => backend.seedList(alice, ids(1)))
  const [A, B] = ids(2)

  it('asks "Which did you like more?" and shows your progress', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, B)
    await feeling(user, 'Loved it')

    expect(await screen.findByRole('heading', { name: 'Which did you like more?' })).toBeTruthy()
    expect(screen.getByText(/Loved it · Comparison 1 of up to \d+/)).toBeTruthy()
    expect(screen.getByRole('button', { name: `I liked ${title(B)} more` })).toBeTruthy()
    expect(screen.getByRole('button', { name: `I liked ${title(A)} more` })).toBeTruthy()
    expect(screen.getByText('Just watched')).toBeTruthy()
  })

  it('puts the new movie above when you pick it', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await rank(user, B, 'Loved it', 'new')

    expect(screen.getByText(`${title(B)} is now #1 in your list.`)).toBeTruthy()
    expect(backend.listOf(alice)).toEqual([[B], [A]])
  })

  it('puts the new movie below when you pick the other one', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await rank(user, B, 'Loved it', 'old')

    expect(screen.getByText(`${title(B)} is now #2 in your list.`)).toBeTruthy()
    expect(backend.listOf(alice)).toEqual([[A], [B]])
  })

  it('can be answered by clicking the posters', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, B)
    await feeling(user, 'Loved it')

    await user.click(await screen.findByRole('button', { name: `I liked ${title(A)} more` }))

    await waitSaved()
    expect(backend.listOf(alice)).toEqual([[A], [B]])
  })

  it('ties the two movies with "It\'s a tie" or the space bar', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, B)
    await feeling(user, 'Loved it')
    await user.click(await screen.findByRole('button', { name: /It's a tie/ }))

    await waitSaved()
    await waitFor(() => expect(document.querySelector('.placed__eyebrow').textContent).toBe('Tied'))
    expect(screen.getByText(new RegExp(`${title(B)} shares #1 with ${title(A)}`))).toBeTruthy()
    expect(backend.listOf(alice)).toHaveLength(1)
    expect(backend.listOf(alice)[0].sort()).toEqual([A, B].sort())
  })

  it('goes back to the feeling question from the first comparison', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, B)
    await feeling(user, 'Loved it')

    await user.click(await screen.findByRole('button', { name: 'Back' }))

    expect(await screen.findByRole('heading', { name: `How did you feel about ${title(B)}?` })).toBeTruthy()
  })

  it('lets you undo an answer when there are several comparisons', async () => {
    backend.seedList(alice, ids(6).slice(1))
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, ids(7)[6])
    await feeling(user, 'Loved it')
    const first = screen.getByText(/Comparison 1 of up to/).textContent

    await answer(user, 'new')
    expect(screen.getByText(/Comparison 2 of up to/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Undo' }))

    expect(screen.getByText(first)).toBeTruthy()
  })

  it('closes without saving when you press Escape or the close button', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, B)
    await feeling(user, 'Loved it')
    await screen.findByRole('heading', { name: 'Which did you like more?' })

    await user.keyboard('{Escape}')

    await waitFor(() => expect(compare()).toBeNull())
    expect(backend.listOf(alice)).toEqual([[A]])
    expect(backend.callsTo('rpc:save_ranking')).toHaveLength(0)
  })

  it('also closes from the "Close without saving" button', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, B)
    await user.click(await screen.findByRole('button', { name: 'Close without saving' }))
    await waitFor(() => expect(compare()).toBeNull())
    expect(backend.callsTo('rpc:save_ranking')).toHaveLength(0)
  })

  it('only compares with movies you felt the same about', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, B)
    await feeling(user, 'Not a fan')

    // A is "Loved it"; B is the first "Not a fan", so there is nothing to compare.
    await waitSaved()
    expect(await screen.findByText(`${title(B)} is your first “Not a fan” movie, so there was nothing to compare it with.`)).toBeTruthy()
    expect(backend.listOf(alice)).toEqual([[A], [B]])
    expect(backend.rankingOf(alice, tmdbId(B)).category).toBe('meh')
  })

  it('places a "Loved it" movie above everything in a worse category without asking', async () => {
    backend.seedList(alice, [])
    backend.rankings = []
    backend.seedList(alice, [{ movie: A, category: 'meh' }])
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await rank(user, B, 'Loved it')

    expect(backend.listOf(alice)).toEqual([[B], [A]])
  })
})

describe('placing a movie among many', () => {
  it('finds its spot in a few comparisons (binary insertion), top when you always pick it', async () => {
    backend.seedList(alice, ids(8).slice(1))
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    const target = ids(8)[0]

    await rank(user, target, 'Loved it', 'new', 'new', 'new', 'new', 'new')

    expect(backend.listOf(alice)[0]).toEqual([target])
    expect(backend.listOf(alice)).toHaveLength(8)
  })

  it('puts it last when you always pick the other movie', async () => {
    backend.seedList(alice, ids(8).slice(0, 7))
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    const target = ids(8)[7]

    await rank(user, target, 'Loved it', 'old', 'old', 'old', 'old', 'old')

    expect(backend.listOf(alice).at(-1)).toEqual([target])
  })

  it('asks no more than the shown maximum number of questions', async () => {
    backend.seedList(alice, ids(8).slice(1))
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, ids(8)[0])
    await feeling(user, 'Loved it')
    const max = Number(/up to (\d+)/.exec(screen.getByText(/Comparison 1 of up to/).textContent)[1])

    let asked = 0
    while (document.querySelector('.duel')) {
      asked += 1
      await answer(user, 'old')
      if (asked > 20) break
    }

    expect(asked).toBeLessThanOrEqual(max)
    expect(max).toBeLessThan(7)
  })
})

describe('after ranking', () => {
  it('counts down to scores until you reach ten', async () => {
    backend.seedList(alice, ids(4))
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))

    await rank(user, ids(5)[4], 'Loved it', 'old', 'old')

    expect(document.querySelector('.placed__unlock').textContent).toBe('Rank 5 more movies to unlock scores')
  })

  it('shows the new movie\'s score once you have ranked ten', async () => {
    backend.seedList(alice, ids(9))
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))

    await rank(user, ids(10)[9], 'Loved it', 'old', 'old', 'old', 'old')

    expect(await screen.findByText('Score')).toBeTruthy()
    expect(document.querySelector('.placed__score strong').textContent).toMatch(/^\d+\.\d$/)
    expect(screen.queryByText(/to unlock scores/)).toBeNull()
  })

  it('takes you to My List with the new movie marked, from "See my list"', async () => {
    backend.seedList(alice, ids(2))
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await rank(user, ids(3)[2], 'Loved it', 'old', 'old')

    await user.click(screen.getByRole('button', { name: 'See my list' }))

    await waitFor(() => expect(compare()).toBeNull())
    expect(window.location.hash).toBe('#/my-list')
    await waitFor(() => expect(rowTitles()).toHaveLength(3))
    expect(document.querySelector('.row.is-new .row__title').textContent).toBe(title(ids(3)[2]))
  })

  it('lets you rank another movie straight away', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await rank(user, ids(1)[0], 'Loved it')

    await user.click(screen.getByRole('button', { name: 'Rank another' }))

    expect(await searchDialog()).toBeTruthy()
    expect(compare()).toBeNull()
  })

  it('shows no review or result buttons until the ranking is saved', async () => {
    const gate = backend.hold('rpc:save_ranking')
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, ids(1)[0])
    await feeling(user, 'Loved it')

    expect((await screen.findByRole('status')).textContent).toBe('Saving…')
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'See my list' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Rank another' })).toBeNull()

    gate.release()
    await waitSaved()
    expect(screen.queryByText('Saving…')).toBeNull()
  })
})

describe('when saving fails', () => {
  it('shows the error with Try again, and saves on the retry', async () => {
    backend.failRpc('save_ranking', 'boom', { times: 1 })
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, ids(1)[0])
    await feeling(user, 'Loved it')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(`${SAVE_ERROR} (boom)`)
    expect(screen.getByRole('button', { name: 'See my list' }).disabled).toBe(true)
    expect(backend.listOf(alice)).toEqual([])

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    await waitSaved()
    expect(backend.listOf(alice)).toEqual([[ids(1)[0]]])
  })

  it('tells you to log in again when the server says your session expired', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, ids(1)[0])
    backend.invalidateTokens(alice)
    await feeling(user, 'Loved it')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(SESSION_ERROR)
    expect(within(alert).getByRole('button', { name: 'Log in' })).toBeTruthy()
    expect(backend.listOf(alice)).toEqual([])
  })

  it('takes you to the login page from "Log in" after the server rejects your session while saving', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, ids(1)[0])
    backend.invalidateTokens(alice)
    await feeling(user, 'Loved it')

    const alert = await screen.findByRole('alert')
    expect(backend.browser.session).toBeNull()
    await user.click(within(alert).getByRole('button', { name: 'Log in' }))

    expect(await screen.findByLabelText('Email or username')).toBeTruthy()
    expect(window.location.hash).toBe('#/login')
  })

  it('logs you out and asks you to log in when your session can\'t be refreshed', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, ids(1)[0])
    backend.browser.session.expires_at = Math.floor(Date.now() / 1000) - 60
    backend.failRefresh = true
    await feeling(user, 'Loved it')

    expect((await screen.findByRole('alert')).textContent).toContain(SESSION_ERROR)
    expect(backend.browser.session).toBeNull()
    expect(backend.listOf(alice)).toEqual([])
  })

  it('refreshes an expired access token by itself and saves', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startRanking(user, ids(1)[0])
    backend.browser.session.expires_at = Math.floor(Date.now() / 1000) - 60
    await feeling(user, 'Loved it')

    await waitSaved()
    expect(backend.callsTo('auth:refreshSession')).toHaveLength(1)
    expect(backend.listOf(alice)).toEqual([[ids(1)[0]]])
  })
})

describe('reranking', () => {
  const [A, B, C] = ids(3)
  beforeEach(() => backend.seedList(alice, [A, B, C]))

  async function openRerank(user, id) {
    await waitFor(() => expect(rowTitles()).toHaveLength(3))
    await user.click(screen.getByRole('button', { name: `Rerank ${title(id)}` }))
  }

  it('shows the movie\'s current feeling and lets you keep it', async () => {
    const { user } = await open()
    await openRerank(user, C)

    expect(await screen.findByText('Keep your answer, or change it.')).toBeTruthy()
    expect(within(screen.getByRole('button', { name: /^Loved it/ })).getByText('Current')).toBeTruthy()
    expect(within(screen.getByRole('button', { name: /^It was okay/ })).queryByText('Current')).toBeNull()
  })

  it('labels the movie "Reranking" in the comparison', async () => {
    const { user } = await open()
    await openRerank(user, C)
    await feeling(user, 'Loved it')
    expect(await screen.findByText('Reranking')).toBeTruthy()
    expect(screen.queryByText('Just watched')).toBeNull()
  })

  it('compares against everything except the movie itself, and moves it up', async () => {
    const { user } = await open()
    await openRerank(user, C)
    await feeling(user, 'Loved it')
    // two others, so at most two comparisons; picking the movie each time puts it first
    await answer(user, 'new', 'new')
    await waitSaved()

    expect(screen.getByText(`${title(C)} moved from #3 to #1.`)).toBeTruthy()
    expect(backend.listOf(alice)).toEqual([[C], [A], [B]])
  })

  it('says when it stays where it was', async () => {
    const { user } = await open()
    await openRerank(user, C)
    await feeling(user, 'Loved it')
    await answer(user, 'old', 'old')
    await waitSaved()

    expect(screen.getByText(`${title(C)} stays at #3.`)).toBeTruthy()
    expect(backend.listOf(alice)).toEqual([[A], [B], [C]])
  })

  it('moves it to another category when you change how you felt', async () => {
    const { user } = await open()
    await openRerank(user, A)
    await feeling(user, 'Not a fan')
    await waitSaved()

    expect(backend.rankingOf(alice, tmdbId(A)).category).toBe('meh')
    expect(backend.listOf(alice)).toEqual([[B], [C], [A]])
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
  })

  it('has a Done button, and no "Rank another", when reranking', async () => {
    const { user } = await open()
    await openRerank(user, C)
    await feeling(user, 'Loved it')
    await answer(user, 'old', 'old')
    await waitSaved()

    expect(screen.queryByRole('button', { name: 'Rank another' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(window.location.hash).toBe('#/my-list')
  })

  it('leaves everything alone if you close without finishing', async () => {
    const { user } = await open()
    await openRerank(user, C)
    await feeling(user, 'Loved it')
    await user.keyboard('{Escape}')

    await waitFor(() => expect(compare()).toBeNull())
    expect(backend.listOf(alice)).toEqual([[A], [B], [C]])
  })
})

describe('movies that are not in the built-in catalog (live search)', () => {
  beforeEach(() => {
    backend.addTmdbMovie({ id: 910001, title: 'Zed: The Unlisted Movie', year: 2023, genres: ['Thriller'] })
  })

  async function startLive(user, query = 'Zed') {
    const dialog = await searchDialog()
    await user.type(within(dialog).getByRole('searchbox', { name: 'Search movies' }), query)
    await user.click(await within(dialog).findByRole('button', { name: 'Rank Zed: The Unlisted Movie' }))
  }

  it('adds the movie to the database through the API, then ranks it', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))

    await startLive(user)
    await feeling(user, 'Loved it')
    await waitSaved()

    const post = backend.callsTo('fetch:POST /api/movies/910001')[0].args.init
    expect(post.headers.Authorization).toMatch(/^Bearer at-/)
    expect(backend.movies.find((m) => m.tmdb_id === 910001)).toMatchObject({ title: 'Zed: The Unlisted Movie', year: 2023, genres: ['Thriller'] })
    expect(backend.rankingOf(alice, 910001)).toMatchObject({ category: 'loved', position: 0 })
  })

  it('shows it in My List afterwards, with its title and year', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startLive(user)
    await feeling(user, 'Loved it')
    await waitSaved()
    await user.click(screen.getByRole('button', { name: 'See my list' }))

    await waitFor(() => expect(rowTitles()).toEqual(['Zed: The Unlisted Movie']))
    expect(document.querySelector('.board .row .row__meta').textContent).toContain('2023')
  })

  it('asks the server once per movie, even if you rank it again', async () => {
    backend.seedList(alice, [ids(1)[0]])
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startLive(user)
    await feeling(user, 'Loved it')
    await answer(user, 'new')
    await waitSaved()
    await user.click(screen.getByRole('button', { name: 'See my list' }))
    await waitFor(() => expect(rowTitles()).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: 'Rerank Zed: The Unlisted Movie' }))
    await feeling(user, 'It was okay')
    await waitSaved()

    expect(backend.callsTo('fetch:POST /api/movies/910001')).toHaveLength(1)
    expect(backend.rankingOf(alice, 910001).category).toBe('okay')
  })

  it('refreshes the session and tries again when the server rejects the token', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startLive(user)
    backend.invalidateTokens(alice) // the browser still holds a token the server no longer accepts
    await feeling(user, 'Loved it')

    await waitSaved()
    expect(backend.callsTo('fetch:POST /api/movies/910001')).toHaveLength(2)
    expect(backend.callsTo('auth:refreshSession')).toHaveLength(1)
    expect(backend.rankingOf(alice, 910001)).not.toBeNull()
  })

  it('asks you to log in again if the refresh fails too', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startLive(user)
    backend.invalidateTokens(alice)
    backend.failRefresh = true
    await feeling(user, 'Loved it')

    expect((await screen.findByRole('alert')).textContent).toContain(SESSION_ERROR)
    expect(backend.rankingOf(alice, 910001)).toBeNull()
  })

  it('shows an error and ranks nothing when the movie can\'t be saved', async () => {
    backend.failApi('POST /api/movies/910001', { status: 502, body: { error: "Couldn't save that movie, try again later." } }, { times: 1 })
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
    await startLive(user)
    await feeling(user, 'Loved it')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(SAVE_ERROR)
    expect(backend.rankingOf(alice, 910001)).toBeNull()

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitSaved()
    expect(backend.rankingOf(alice, 910001)).not.toBeNull()
  })
})
