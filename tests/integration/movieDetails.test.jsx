import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent } from '@testing-library/react'
import MOVIES from '../../src/data/movies.json'
import { formatVotes } from '../../src/lib/movieDetails.js'
import { FakeBackend, launch, ready, screen, skipReview, waitFor, within } from './helpers/harness.js'

const DUNE = MOVIES.find((m) => m.id === 'dune-part-two-2024')
const ids = (n) => MOVIES.filter((m) => m.id !== DUNE.id).slice(0, n).map((m) => m.id)

let backend
let alice
let bob

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
  bob = backend.addUser({ username: 'bob' })
  backend.tmdbKnows(DUNE.id)
  // Scores always come from the live lookup, for catalog movies too.
  backend.addOmdbScores(DUNE.imdb_id, { imdb: 8.4, votes: DUNE.ratings.imdb_votes, rt: 92 })
  backend.addTmdbMovie({ id: 940001, title: 'Quokka Road', year: 2022, genres: ['Adventure', 'Comedy'], runtime: 100, director: 'Ana Auteur', cast: ['Cast One', 'Cast Two', 'Cast Three'], overview: 'A quokka drives across Australia.' })
})

async function open({ as = alice } = {}) {
  const app = await launch({ backend, as, hash: '#/home' })
  await ready({ loggedIn: Boolean(as) })
  return app
}

// Opens a movie's details from the header search.
async function showDetails(user, query, name = query) {
  const box = within(screen.getByRole('search')).getByRole('searchbox', { name: 'Search movies' })
  await user.type(box, query)
  await user.click(await screen.findByRole('option', { name: new RegExp(name, 'i') }))
  return screen.findByRole('dialog', { name })
}
const dune = (user) => showDetails(user, 'Dune: Part Two', 'Dune: Part Two')
// The stat box with this label ("IMDb" is also a link, so match the label element).
const stat = (dialog, label) => [...dialog.querySelectorAll('.gstat__label')].find((el) => el.textContent === label)?.closest('.gstat') ?? null

describe('a catalog movie', () => {
  it('shows its facts, tagline, overview and credits', async () => {
    const { user } = await open()
    const dialog = await dune(user)

    expect(within(dialog).getByText('2024 · 2h 47m · Science Fiction, Adventure')).toBeTruthy()
    expect(within(dialog).getByText(DUNE.tagline)).toBeTruthy()
    expect(within(dialog).getByText(DUNE.overview)).toBeTruthy()
    expect(within(dialog).getByText('Director')).toBeTruthy()
    expect(within(dialog).getByText('Denis Villeneuve')).toBeTruthy()
    expect(within(dialog).getByText(DUNE.cast.join(', '))).toBeTruthy()
  })

  it('shows its IMDb and Rotten Tomatoes scores', async () => {
    const { user } = await open()
    const dialog = await dune(user)

    await waitFor(() => expect(stat(dialog, 'IMDb')).not.toBeNull())
    expect(stat(dialog, 'IMDb').textContent).toContain('8.4')
    expect(stat(dialog, 'IMDb').textContent).toContain(formatVotes(DUNE.ratings.imdb_votes))
    expect(stat(dialog, 'Rotten Tomatoes').textContent).toContain('92%')
  })

  it('links to IMDb and TMDB', async () => {
    const { user } = await open()
    const dialog = await dune(user)

    expect(within(dialog).getByRole('link', { name: 'IMDb' }).getAttribute('href')).toBe(`https://www.imdb.com/title/${DUNE.imdb_id}/`)
    expect(within(dialog).getByRole('link', { name: 'TMDB' }).getAttribute('href')).toBe(`https://www.themoviedb.org/movie/${DUNE.tmdb_id}`)
  })

  it('does not fetch details from the API (the catalog already has them)', async () => {
    const { user } = await open()
    await dune(user)
    await new Promise((r) => setTimeout(r, 200))
    expect(backend.callsTo(`fetch:GET /api/movies/${DUNE.tmdb_id}`)).toHaveLength(0)
  })
})

describe('your rank', () => {
  it('says "Not ranked" and offers Rank it', async () => {
    const { user } = await open()
    const dialog = await dune(user)

    expect(stat(dialog, 'Your rank').textContent).toContain('Not ranked')
    expect(within(dialog).getByRole('button', { name: 'Rank it' })).toBeTruthy()
    expect(stat(dialog, 'Your score')).toBeNull()
  })

  it('starts ranking from Rank it', async () => {
    const { user } = await open()
    const dialog = await dune(user)

    await user.click(within(dialog).getByRole('button', { name: 'Rank it' }))

    expect(await screen.findByRole('heading', { name: `How did you feel about ${DUNE.title}?` })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: DUNE.title })).toBeNull()
  })

  it('shows your rank, and says scores come at ten movies', async () => {
    backend.seedList(alice, [DUNE.id, ...ids(2)])
    const { user } = await open()
    const dialog = await dune(user)

    await waitFor(() => expect(stat(dialog, 'Your rank').textContent).toContain('#1'))
    expect(stat(dialog, 'Your rank').textContent).toContain('of 3')
    expect(stat(dialog, 'Your score').textContent).toContain('At 10 movies')
    expect(within(dialog).getByText('Ranked #1')).toBeTruthy()
  })

  it('shows your score once you have ranked ten', async () => {
    backend.seedList(alice, [DUNE.id, ...ids(9)])
    const { user } = await open()
    const dialog = await dune(user)

    await waitFor(() => expect(stat(dialog, 'Your score').textContent).toBe('Your score10.0'))
  })

  it('marks a tie', async () => {
    backend.seedList(alice, [ids(1)[0], { movie: DUNE.id, tied: true }])
    const { user } = await open()
    const dialog = await dune(user)

    await waitFor(() => expect(stat(dialog, 'Your rank').textContent).toContain('tied'))
  })

  it('offers Rerank when you have more than one movie, and starts it', async () => {
    backend.seedList(alice, [DUNE.id, ...ids(1)])
    const { user } = await open()
    const dialog = await dune(user)

    await user.click(await within(dialog).findByRole('button', { name: 'Rerank' }))

    expect(await screen.findByText('Keep your answer, or change it.')).toBeTruthy()
  })

  it('has no Rerank when it is your only movie', async () => {
    backend.seedList(alice, [DUNE.id])
    const { user } = await open()
    const dialog = await dune(user)

    await within(dialog).findByText('Ranked #1')
    expect(within(dialog).queryByRole('button', { name: 'Rerank' })).toBeNull()
  })
})

describe('community rank', () => {
  it('shows the weekly score and rank when others have ranked it this week', async () => {
    backend.seedList(bob, [DUNE.id])
    const { user } = await open()
    const dialog = await dune(user)

    await waitFor(() => expect(stat(dialog, 'Community').textContent).toContain('8.0'))
    expect(stat(dialog, 'Community').textContent).toContain('#1 this week')
  })

  it('falls back to the monthly board when it was ranked earlier this month', async () => {
    backend.seedList(bob, [{ movie: DUNE.id, createdAt: backend.daysAgo(15) }])
    const { user } = await open()
    const dialog = await dune(user)

    await waitFor(() => expect(stat(dialog, 'Community').textContent).toContain('this month'))
    expect(stat(dialog, 'Community').textContent).not.toContain('this week')
  })

  it('shows your own ranking in it too', async () => {
    backend.seedList(alice, [DUNE.id])
    const { user } = await open()
    const dialog = await dune(user)
    await waitFor(() => expect(stat(dialog, 'Community').textContent).toContain('#1 this week'))
  })

  it('is left out when nobody has ranked the movie', async () => {
    const { user } = await open()
    const dialog = await dune(user)

    await waitFor(() => expect(backend.callsTo('rpc:get_leaderboard').length).toBeGreaterThan(1))
    expect(stat(dialog, 'Community')).toBeNull()
  })

  it('is quietly left out if the leaderboard can\'t be loaded, and the rest still works', async () => {
    backend.seedList(bob, [DUNE.id])
    backend.failRpc('get_leaderboard', 'boom')
    const { user } = await open()
    const dialog = await dune(user)

    await waitFor(() => expect(backend.callsTo('rpc:get_leaderboard').length).toBeGreaterThan(0))
    expect(stat(dialog, 'Community')).toBeNull()
    expect(within(dialog).queryByRole('alert')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Rank it' })).toBeTruthy()
  })

  it('updates after you rank the movie yourself', async () => {
    const { user } = await open()
    const dialog = await dune(user)
    await waitFor(() => expect(backend.callsTo('rpc:get_leaderboard').length).toBeGreaterThan(1))
    expect(stat(dialog, 'Community')).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'Rank it' }))
    await user.click(await screen.findByRole('button', { name: /^Loved it/ }))
    await skipReview(user)
    await waitFor(() => expect(screen.getByRole('button', { name: 'See my list' }).disabled).toBe(false))
    expect(backend.rankingOf(alice, DUNE.tmdb_id)).not.toBeNull()
  })
})

describe('when you are logged out', () => {
  it('shows only the outside scores, and "Log in to rank"', async () => {
    backend.seedList(bob, [DUNE.id])
    const { user } = await open({ as: null })
    const dialog = await dune(user)

    await waitFor(() => expect(stat(dialog, 'IMDb')).not.toBeNull())
    expect(stat(dialog, 'IMDb').textContent).toContain('8.4')
    expect(stat(dialog, 'Your rank')).toBeNull()
    expect(stat(dialog, 'Community')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Log in to rank' })).toBeTruthy()
  })
})

describe('a movie from live search', () => {
  it('fills in the runtime, tagline and credits from the API, next to the overview search already gave', async () => {
    const { user } = await open()
    const dialog = await showDetails(user, 'Quokka Road')

    expect(within(dialog).getByText('A quokka drives across Australia.')).toBeTruthy()
    expect(await within(dialog).findByText('Ana Auteur')).toBeTruthy()
    expect(within(dialog).getByText('The tagline of Quokka Road')).toBeTruthy()
    expect(within(dialog).getByText('2022 · 1h 40m · Adventure, Comedy')).toBeTruthy()
    expect(within(dialog).getByText('Ana Auteur')).toBeTruthy()
    expect(within(dialog).getByText('Cast One, Cast Two, Cast Three')).toBeTruthy()
  })

  it('shows "Loading details…" for a movie that arrives without an overview, then the details', async () => {
    backend.addTmdbMovie({ id: 940002, title: 'Bare Bones', year: 2018, overview: '', runtime: 95 })
    const gate = backend.hold('GET /api/movies/940002')
    const { user } = await open()
    const dialog = await showDetails(user, 'Bare Bones')

    expect(within(dialog).getByText('Loading details…').getAttribute('aria-busy')).toBe('true')
    gate.release()

    await waitFor(() => expect(within(dialog).queryByText('Loading details…')).toBeNull())
    expect(within(dialog).getByText('Jane Director')).toBeTruthy()
    expect(within(dialog).getByText(/1h 35m/)).toBeTruthy()
  })

  it('links to TMDB only, since it has no IMDb id', async () => {
    const { user } = await open()
    const dialog = await showDetails(user, 'Quokka Road')

    expect(within(dialog).getByRole('link', { name: 'TMDB' }).getAttribute('href')).toBe('https://www.themoviedb.org/movie/940001')
    expect(within(dialog).queryByRole('link', { name: 'IMDb' })).toBeNull()
    // With no IMDb id there are no scores to find, and the panel says so once it knows.
    await waitFor(() => expect(stat(dialog, 'IMDb')).not.toBeNull())
    expect(stat(dialog, 'IMDb').textContent).toBe('IMDbNot available')
  })

  it('stops loading and leaves the credits out if the details can\'t be fetched', async () => {
    backend.addTmdbMovie({ id: 940003, title: 'Lost Details', year: 2017, overview: '' })
    backend.failApi('GET /api/movies/940003', { status: 502, body: { error: 'down' } })
    const { user } = await open()
    const dialog = await showDetails(user, 'Lost Details')

    await waitFor(() => expect(within(dialog).queryByText('Loading details…')).toBeNull())
    expect(dialog.querySelector('.glass__credits')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Rank it' })).toBeTruthy()
  })

  it('still shows what search already knew if the extra details can\'t be fetched', async () => {
    backend.failApi('GET /api/movies/940001', { status: 502, body: { error: 'down' } })
    const { user } = await open()
    const dialog = await showDetails(user, 'Quokka Road')

    expect(within(dialog).getByText('A quokka drives across Australia.')).toBeTruthy()
    await waitFor(() => expect(backend.callsTo('fetch:GET /api/movies/940001')).toHaveLength(1))
    expect(dialog.querySelector('.glass__credits')).toBeNull()
  })

  it('fetches the details once, however often you open it', async () => {
    const { user } = await open()
    const dialog = await showDetails(user, 'Quokka Road')
    await within(dialog).findByText('A quokka drives across Australia.')
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    const box = within(screen.getByRole('search')).getByRole('searchbox', { name: 'Search movies' })
    await user.clear(box)
    await user.type(box, 'Quokka Road')
    await user.click(await screen.findByRole('option', { name: /Quokka Road/ }))

    expect(await screen.findByRole('dialog', { name: 'Quokka Road' })).toBeTruthy()
    expect(backend.callsTo('fetch:GET /api/movies/940001')).toHaveLength(1)
  })
})

describe('outside scores for a movie from live search', () => {
  beforeEach(() => {
    backend.addTmdbMovie({ id: 990001, title: 'Scored Film', year: 2022, imdb_id: 'tt9900010' })
    backend.addOmdbScores('tt9900010', { imdb: 8.1, votes: 1234567, rt: 91 })
  })
  const ratingsCalls = () => backend.callsTo('fetch:GET /api/movies/ratings')
  const waitForScores = (dialog) => waitFor(() => expect(stat(dialog, 'IMDb')).not.toBeNull())

  it('shows IMDb and Rotten Tomatoes scores once they arrive', async () => {
    const { user } = await open()
    const dialog = await showDetails(user, 'Scored Film')

    await waitForScores(dialog)
    expect(stat(dialog, 'IMDb').textContent).toContain('8.1')
    expect(stat(dialog, 'IMDb').textContent).toContain(formatVotes(1234567))
    expect(stat(dialog, 'Rotten Tomatoes').textContent).toContain('91%')
  })

  it('adds an IMDb link, since the server found the IMDb id', async () => {
    const { user } = await open()
    const dialog = await showDetails(user, 'Scored Film')

    await waitForScores(dialog)
    expect(within(dialog).getByRole('link', { name: 'IMDb' }).getAttribute('href')).toBe('https://www.imdb.com/title/tt9900010/')
  })

  it('works for logged-out visitors too', async () => {
    const { user } = await open({ as: null })
    const dialog = await showDetails(user, 'Scored Film')

    await waitForScores(dialog)
    expect(stat(dialog, 'Rotten Tomatoes').textContent).toContain('91%')
  })

  it('keeps the panel usable while the scores load, and fills them in afterwards', async () => {
    const gate = backend.hold('GET /api/movies/ratings')
    const { user } = await open()
    const dialog = await showDetails(user, 'Scored Film')

    expect(within(dialog).getByRole('button', { name: 'Rank it' })).toBeTruthy()
    expect(stat(dialog, 'IMDb')).toBeNull()
    gate.release()

    await waitForScores(dialog)
  })

  it('says "Not available" for Rotten Tomatoes when it has no score', async () => {
    backend.addOmdbScores('tt9900010', { imdb: 6.4, votes: 900, rt: null })
    const { user } = await open()
    const dialog = await showDetails(user, 'Scored Film')

    await waitForScores(dialog)
    expect(stat(dialog, 'IMDb').textContent).toContain('6.4')
    expect(stat(dialog, 'Rotten Tomatoes').textContent).toBe('Rotten TomatoesNot available')
  })

  it('says "Not available" for IMDb when it has no score', async () => {
    backend.addOmdbScores('tt9900010', { imdb: null, votes: null, rt: 55 })
    const { user } = await open()
    const dialog = await showDetails(user, 'Scored Film')

    await waitFor(() => expect(stat(dialog, 'Rotten Tomatoes')).not.toBeNull())
    expect(stat(dialog, 'IMDb').textContent).toBe('IMDbNot available')
    expect(stat(dialog, 'Rotten Tomatoes').textContent).toContain('55%')
  })

  it('says "Not available" for both, with no error, when no scores exist', async () => {
    backend.omdb.ratings.clear()
    const { user } = await open()
    const dialog = await showDetails(user, 'Scored Film')

    await waitFor(() => expect(stat(dialog, 'IMDb')).not.toBeNull())
    expect(stat(dialog, 'IMDb').textContent).toBe('IMDbNot available')
    expect(stat(dialog, 'Rotten Tomatoes').textContent).toBe('Rotten TomatoesNot available')
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })

  it('says "Not available" to logged-out visitors too', async () => {
    backend.addOmdbScores('tt9900010', { imdb: 7.0, votes: 500, rt: null })
    const { user } = await open({ as: null })
    const dialog = await showDetails(user, 'Scored Film')

    await waitFor(() => expect(stat(dialog, 'Rotten Tomatoes')).not.toBeNull())
    expect(stat(dialog, 'Rotten Tomatoes').textContent).toContain('Not available')
  })

  it('says nothing about the scores until it knows: not while loading', async () => {
    const gate = backend.hold('GET /api/movies/ratings')
    const { user } = await open()
    const dialog = await showDetails(user, 'Scored Film')

    expect(stat(dialog, 'IMDb')).toBeNull()
    expect(stat(dialog, 'Rotten Tomatoes')).toBeNull()
    expect(within(dialog).queryByText('Not available')).toBeNull()
    gate.release()
    await waitForScores(dialog)
  })

  it('says nothing, rather than "Not available", when the daily OMDb budget is used up', async () => {
    backend.setOmdbUsage(900)
    const { user } = await open()
    const dialog = await showDetails(user, 'Scored Film')

    await waitFor(() => expect(ratingsCalls()).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 150))
    expect(stat(dialog, 'IMDb')).toBeNull()
    expect(stat(dialog, 'Rotten Tomatoes')).toBeNull()
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })

  it('leaves the scores out, quietly, when they can\'t be loaded, and tries again next time', async () => {
    backend.failApi('GET /api/movies/ratings', { status: 502, body: { error: 'down' } }, { times: 1 })
    const { user } = await open()
    const dialog = await showDetails(user, 'Scored Film')

    await waitFor(() => expect(ratingsCalls()).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 150))
    expect(stat(dialog, 'IMDb')).toBeNull()
    expect(stat(dialog, 'Rotten Tomatoes')).toBeNull()
    expect(within(dialog).queryByRole('alert')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Rank it' })).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    const again = await showDetails(user, 'Scored Film')
    await waitForScores(again)
    expect(ratingsCalls()).toHaveLength(2)
  })

  it('asks the server once, however often you open the movie', async () => {
    const { user } = await open()
    const dialog = await showDetails(user, 'Scored Film')
    await waitForScores(dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    const box = within(screen.getByRole('search')).getByRole('searchbox', { name: 'Search movies' })
    await user.clear(box)
    await user.type(box, 'Scored Film')
    await user.click(await screen.findByRole('option', { name: /Scored Film/ }))
    const reopened = await screen.findByRole('dialog', { name: 'Scored Film' })

    await waitForScores(reopened)
    expect(ratingsCalls()).toHaveLength(1)
  })

  it('doesn\'t depend on the other details loading', async () => {
    backend.failApi('GET /api/movies/990001', { status: 502, body: { error: 'down' } })
    const { user } = await open()
    const dialog = await showDetails(user, 'Scored Film')

    await waitForScores(dialog)
    expect(stat(dialog, 'IMDb').textContent).toContain('8.1')
  })

  it('asks for catalog movies too, and shows the live scores rather than the built-in ones', async () => {
    backend.addOmdbScores(DUNE.imdb_id, { imdb: 7.2, votes: 4321, rt: 64 })
    const { user } = await open()
    const dialog = await dune(user)

    await waitFor(() => expect(stat(dialog, 'IMDb')).not.toBeNull())
    expect(stat(dialog, 'IMDb').textContent).toContain('7.2')
    expect(stat(dialog, 'IMDb').textContent).not.toContain(String(DUNE.ratings.imdb))
    expect(stat(dialog, 'Rotten Tomatoes').textContent).toContain('64%')
    expect(ratingsCalls()).toHaveLength(1)
  })

  it('says "Not available" for a catalog movie OMDb has no scores for, ignoring the built-in ones', async () => {
    backend.omdb.ratings.clear()
    const { user } = await open()
    const dialog = await dune(user)

    await waitFor(() => expect(stat(dialog, 'IMDb')).not.toBeNull())
    expect(stat(dialog, 'IMDb').textContent).toBe('IMDbNot available')
    expect(stat(dialog, 'Rotten Tomatoes').textContent).toBe('Rotten TomatoesNot available')
  })
})

describe('closing', () => {
  it('moves focus to the close button and stops the page scrolling', async () => {
    const { user } = await open()
    const dialog = await dune(user)

    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }))
    expect(document.body.style.overflow).toBe('hidden')
  })

  it.each([
    ['the close button', async (user, dialog) => user.click(within(dialog).getByRole('button', { name: 'Close' }))],
    ['Escape', async (user) => user.keyboard('{Escape}')],
    ['clicking the backdrop', async (user, dialog) => user.click(dialog.parentElement)],
  ])('closes with %s, and lets the page scroll again', async (_name, close) => {
    const { user } = await open()
    const dialog = await dune(user)

    await close(user, dialog)

    await waitFor(() => expect(screen.queryByRole('dialog', { name: DUNE.title })).toBeNull())
    expect(document.body.style.overflow).toBe('')
  })

  it('stays open when you click inside the card', async () => {
    const { user } = await open()
    const dialog = await dune(user)
    await user.click(within(dialog).getByText(DUNE.overview))
    expect(screen.getByRole('dialog', { name: DUNE.title })).toBeTruthy()
  })

  it('stays open if you start a click inside the card and release on the backdrop', async () => {
    const { user } = await open()
    const dialog = await dune(user)

    fireEvent.pointerDown(dialog)
    fireEvent.click(dialog.parentElement)

    expect(screen.getByRole('dialog', { name: DUNE.title })).toBeTruthy()
  })
})
