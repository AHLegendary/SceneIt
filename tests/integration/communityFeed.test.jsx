import { beforeEach, describe, expect, it, vi } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, goTo, launch, ready, scrollToEnd, screen, waitFor, within } from './helpers/harness.js'

const ids = (n) => MOVIES.slice(0, n).map((m) => m.id)
const movie = (id) => MOVIES.find((m) => m.id === id)
const [A, B, C] = ids(3)

const FEED_ERROR = "Couldn't load reviews. Check your connection and try again."

let backend
let alice // the viewer
let bob // public
let cara // public
let dave // private

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
  bob = backend.addUser({ username: 'bob' })
  cara = backend.addUser({ username: 'cara' })
  dave = backend.addUser({ username: 'dave', is_public: false })
})

async function open(hash = '#/community', { as = alice } = {}) {
  const app = await launch({ backend, as, hash })
  await ready({ loggedIn: Boolean(as) })
  return app
}
// A user ranks the movies, then reviews each (newest last unless dates are given).
function review(user, id, body, options) {
  if (!backend.rankingOf(user, movie(id).tmdb_id)) backend.seedList(user, [id])
  return backend.addReview(user, id, { body, ...options })
}
const cards = () => [...document.querySelectorAll('.rcard')]
const bodies = () => cards().map((card) => card.querySelector('.rcard__text')?.textContent)
const authors = () => cards().map((card) => card.querySelector('.rcard__author')?.textContent)
const feedCalls = () => backend.callsTo('rpc:get_review_feed').map((call) => call.args)
const tabs = () => within(screen.getByRole('radiogroup', { name: 'Community sections' }))

async function scrollUntil(count) {
  await waitFor(async () => {
    await scrollToEnd()
    expect(cards()).toHaveLength(count)
  })
}

describe('the Community tabs', () => {
  it('opens on Reviews, with Reviews and Leaderboard tabs', async () => {
    await open('#/community')
    expect(await screen.findByRole('heading', { level: 1, name: 'Reviews' })).toBeTruthy()
    expect(tabs().getByRole('radio', { name: 'Reviews' }).getAttribute('aria-checked')).toBe('true')
    expect(tabs().getByRole('radio', { name: 'Leaderboard' }).getAttribute('aria-checked')).toBe('false')
  })

  it('switches to the existing Leaderboard, and back', async () => {
    const { user } = await open('#/community')
    await screen.findByRole('heading', { level: 1, name: 'Reviews' })

    await user.click(tabs().getByRole('radio', { name: 'Leaderboard' }))

    expect(window.location.hash).toBe('#/community/leaderboard')
    expect(await screen.findByRole('heading', { level: 1, name: 'Leaderboard' })).toBeTruthy()
    // The leaderboard page is the original one, with its own filters.
    expect(screen.getByRole('radiogroup', { name: 'Time period' })).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: 'Sort by' })).toBeTruthy()
    expect(tabs().getByRole('radio', { name: 'Leaderboard' }).getAttribute('aria-checked')).toBe('true')

    await user.click(tabs().getByRole('radio', { name: 'Reviews' }))
    expect(window.location.hash).toBe('#/community')
    expect(await screen.findByRole('heading', { level: 1, name: 'Reviews' })).toBeTruthy()
  })

  it.each(['#/community/leaderboard', '#/leaderboard'])('opens the Leaderboard tab at %s', async (hash) => {
    await open(hash)
    expect(await screen.findByRole('heading', { level: 1, name: 'Leaderboard' })).toBeTruthy()
    expect(tabs().getByRole('radio', { name: 'Leaderboard' }).getAttribute('aria-checked')).toBe('true')
  })

  it('is open to everyone, logged in or not', async () => {
    await open('#/community', { as: null })
    expect(await screen.findByRole('heading', { level: 1, name: 'Reviews' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /sign in|log in to see/i })).toBeNull()
  })
})

describe('the reviews feed', () => {
  it('shows each review as a card with who wrote it, the movie and the text', async () => {
    review(bob, A, 'A masterpiece.')
    await open()

    await waitFor(() => expect(cards()).toHaveLength(1))
    const card = within(cards()[0])
    expect(card.getByRole('link', { name: 'bob' }).getAttribute('href')).toBe('#/u/bob')
    expect(card.getByRole('button', { name: new RegExp(`^${movie(A).title}`) })).toBeTruthy()
    expect(card.getByText(movie(A).genres.join(' · '))).toBeTruthy()
    expect(card.getByText('A masterpiece.')).toBeTruthy()
  })

  it('puts the avatar and username in the top left, linking to the profile (your own bio if it is you)', async () => {
    review(bob, A, 'Bob review', { createdAt: '2026-01-01T00:00:00.000Z' })
    review(alice, B, 'Alice review', { createdAt: '2026-02-01T00:00:00.000Z' })
    await open()

    await waitFor(() => expect(cards()).toHaveLength(2))
    const [mine, theirs] = cards() // newest first
    expect(within(mine).getByRole('link', { name: 'Alice_99' }).getAttribute('href')).toBe('#/profile')
    expect(within(theirs).getByRole('link', { name: 'bob' }).getAttribute('href')).toBe('#/u/bob')
    // It is the first thing in the card, ahead of the poster.
    expect(theirs.firstElementChild.classList.contains('rcard__author')).toBe(true)
    expect(theirs.querySelector('.rcard__author .avatar')).toBeTruthy()
  })

  it('opens that profile when you click the name', async () => {
    review(bob, A, 'Hello')
    const { user } = await open()
    await user.click(await screen.findByRole('link', { name: 'bob' }))
    expect(window.location.hash).toBe('#/u/bob')
    expect(await screen.findByRole('heading', { level: 1, name: 'bob' })).toBeTruthy()
  })

  it('shows only movies with a review, not every ranked movie', async () => {
    backend.seedList(bob, [A, B, C])
    backend.addReview(bob, B, { body: 'Only this one.' })
    await open()

    await waitFor(() => expect(cards()).toHaveLength(1))
    expect(bodies()).toEqual(['Only this one.'])
  })

  it('has a Comment / See X comments link on every card, to the discussion page', async () => {
    const quiet = review(bob, A, 'Quiet', { createdAt: '2026-01-01T00:00:00.000Z' })
    const busy = review(cara, B, 'Busy', { createdAt: '2026-02-01T00:00:00.000Z' })
    const mine = review(alice, C, 'Mine', { createdAt: '2026-03-01T00:00:00.000Z' })
    backend.addComment(bob, busy)
    backend.addComment(alice, busy)
    await open()

    await waitFor(() => expect(cards()).toHaveLength(3))
    const [mineCard, busyCard, quietCard] = cards().map((c) => within(c))
    expect(quietCard.getByRole('link', { name: 'Comment' }).getAttribute('href')).toBe(`#/u/bob/review/${quiet.id}`)
    expect(busyCard.getByRole('link', { name: 'See 2 comments' }).getAttribute('href')).toBe(`#/u/cara/review/${busy.id}`)
    // Your own review too, even with no comments yet (the feed has no edit menu).
    expect(mineCard.getByRole('link', { name: 'Comment' }).getAttribute('href')).toBe(`#/u/Alice_99/review/${mine.id}`)
    expect(mineCard.queryByRole('button', { name: 'Review options' })).toBeNull()
  })

  it('opens the discussion from the link', async () => {
    const r = review(bob, A, 'Talk about it')
    const { user } = await open()
    await user.click(await screen.findByRole('link', { name: 'Comment' }))
    expect(window.location.hash).toBe(`#/u/bob/review/${r.id}`)
    expect(await screen.findByRole('heading', { level: 1, name: `Review of ${movie(A).title}` })).toBeTruthy()
  })

  it('blurs spoiler reviews until clicked', async () => {
    review(bob, A, 'The twist is…', { isSpoiler: true })
    const { user } = await open()
    const text = await screen.findByText('The twist is…')
    expect(text.classList.contains('is-blurred')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Spoiler: click to show' }))
    expect(text.classList.contains('is-blurred')).toBe(false)
  })

  it('opens the movie from a card', async () => {
    review(bob, A, 'Hello')
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: `Open ${movie(A).title}` }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('shows the score once the author has ranked enough movies for scores to exist', async () => {
    backend.seedList(bob, ids(12))
    backend.addReview(bob, ids(12)[0], { body: 'Top of the list.' })
    await open()
    await waitFor(() => expect(document.querySelector('.rcard__score')?.textContent).toBe('10.0'))
  })

  it('has no score for an author below that line', async () => {
    review(bob, A, 'Few movies ranked.')
    await open()
    await waitFor(() => expect(cards()).toHaveLength(1))
    expect(document.querySelector('.rcard__score')).toBeNull()
  })

  it('says so when nobody has written a review', async () => {
    await open()
    expect(await screen.findByText('No reviews yet. Rank a movie and write the first one.')).toBeTruthy()
  })
})

describe('who appears in the feed', () => {
  it('leaves out reviews from private profiles you may not see, and includes friends\' private ones', async () => {
    review(bob, A, 'Public', { createdAt: '2026-01-01T00:00:00.000Z' })
    review(dave, B, 'Private', { createdAt: '2026-02-01T00:00:00.000Z' })
    await open()
    await waitFor(() => expect(bodies()).toEqual(['Public']))

    backend.addFriendship(alice, dave, 'accepted')
    await goTo('#/home') // leave and come back to load the feed again
    await goTo('#/community')
    await waitFor(() => expect(bodies()).toEqual(['Private', 'Public']))
  })

  it('shows a logged-out visitor public reviews only, with no Friends filter', async () => {
    review(bob, A, 'Public')
    review(dave, B, 'Private')
    await open('#/community', { as: null })

    await waitFor(() => expect(bodies()).toEqual(['Public']))
    expect(screen.queryByRole('radiogroup', { name: 'Show reviews from' })).toBeNull()
    expect(screen.getByRole('radiogroup', { name: 'Sort reviews by' })).toBeTruthy()
    expect(feedCalls()[0]).toMatchObject({ p_scope: 'everyone' })
  })
})

describe('the filters', () => {
  const scope = () => screen.getByRole('radiogroup', { name: 'Show reviews from' })
  const sort = () => screen.getByRole('radiogroup', { name: 'Sort reviews by' })

  it('starts on Everyone and Recent', async () => {
    await open()
    await screen.findByRole('heading', { level: 1, name: 'Reviews' })
    expect(within(scope()).getByRole('radio', { name: 'Everyone' }).getAttribute('aria-checked')).toBe('true')
    expect(within(scope()).getByRole('radio', { name: 'Friends' }).getAttribute('aria-checked')).toBe('false')
    expect(within(sort()).getByRole('radio', { name: 'Recent' }).getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(feedCalls()[0]).toMatchObject({ p_scope: 'everyone', p_sort: 'recent', p_limit: 20, p_offset: 0 }))
  })

  it('Friends shows only your friends\' reviews, not yours or strangers\'', async () => {
    review(alice, A, 'Mine', { createdAt: '2026-01-01T00:00:00.000Z' })
    review(bob, A, 'From a friend', { createdAt: '2026-02-01T00:00:00.000Z' })
    review(cara, B, 'From a stranger', { createdAt: '2026-03-01T00:00:00.000Z' })
    backend.addFriendship(alice, bob, 'accepted')
    const { user } = await open()
    await waitFor(() => expect(cards()).toHaveLength(3))

    await user.click(within(scope()).getByRole('radio', { name: 'Friends' }))

    await waitFor(() => expect(bodies()).toEqual(['From a friend']))
    expect(authors()).toEqual(['bob'])
    expect(feedCalls().at(-1)).toMatchObject({ p_scope: 'friends' })
  })

  it('says so when your friends have not reviewed anything', async () => {
    review(cara, A, 'Stranger')
    const { user } = await open()
    await waitFor(() => expect(cards()).toHaveLength(1))
    await user.click(within(scope()).getByRole('radio', { name: 'Friends' }))
    expect(await screen.findByText('No reviews from your friends yet. Switch to Everyone, or add some friends.')).toBeTruthy()
  })

  it('sorts by Most discussed, newest breaking ties, and back to Recent', async () => {
    const oldBusy = review(bob, A, 'old, busy', { createdAt: '2026-01-01T00:00:00.000Z' })
    review(bob, B, 'middle, quiet', { createdAt: '2026-02-01T00:00:00.000Z' })
    review(cara, C, 'new, quiet', { createdAt: '2026-03-01T00:00:00.000Z' })
    backend.addComment(alice, oldBusy)
    backend.addComment(cara, oldBusy)
    const { user } = await open()
    await waitFor(() => expect(bodies()).toEqual(['new, quiet', 'middle, quiet', 'old, busy']))

    await user.click(within(sort()).getByRole('radio', { name: 'Most discussed' }))
    await waitFor(() => expect(bodies()).toEqual(['old, busy', 'new, quiet', 'middle, quiet']))
    expect(feedCalls().at(-1)).toMatchObject({ p_sort: 'discussed' })

    await user.click(within(sort()).getByRole('radio', { name: 'Recent' }))
    await waitFor(() => expect(bodies()).toEqual(['new, quiet', 'middle, quiet', 'old, busy']))
  })

  it('shows "Loading" instead of the old list while a filter change loads', async () => {
    review(bob, A, 'Hello')
    const { user } = await open()
    await waitFor(() => expect(cards()).toHaveLength(1))
    const gate = backend.hold('rpc:get_review_feed')

    await user.click(within(sort()).getByRole('radio', { name: 'Most discussed' }))

    expect(await screen.findByText('Loading reviews…')).toBeTruthy()
    expect(cards()).toHaveLength(0)
    gate.release()
    await waitFor(() => expect(cards()).toHaveLength(1))
  })
})

describe('loading more as you scroll', () => {
  beforeEach(() => {
    // One author, 45 reviews, a day apart so the order is clear.
    backend.seedList(bob, ids(45))
    ids(45).forEach((id, i) => {
      const day = String(i + 1).padStart(2, '0')
      backend.addReview(bob, id, { body: `review ${i + 1}`, createdAt: `2026-02-${day}T00:00:00.000Z` })
    })
  })

  it('shows 20 at first, then 20 more each time you reach the bottom, then stops', async () => {
    await open()
    await waitFor(() => expect(cards()).toHaveLength(20))
    expect(bodies()[0]).toBe('review 45') // newest first

    await scrollUntil(40)
    await scrollUntil(45)
    await scrollToEnd()
    expect(cards()).toHaveLength(45)
    expect(feedCalls().map((a) => [a.p_limit, a.p_offset])).toEqual([[20, 0], [20, 20], [20, 40]])
  })

  it('does not repeat a review that moved to a later page while you were reading', async () => {
    await open()
    await waitFor(() => expect(cards()).toHaveLength(20))
    // Someone posts a newer review: everything shifts down by one.
    backend.seedList(cara, [A])
    backend.addReview(cara, A, { body: 'brand new', createdAt: '2026-03-01T00:00:00.000Z' })

    await scrollUntil(45) // every review exactly once: the shift repeats two rows, which are dropped

    const seen = bodies()
    expect(new Set(seen).size).toBe(seen.length)
    expect([...seen].sort()).toEqual(ids(45).map((_, i) => `review ${i + 1}`).sort()) // nothing lost either
  })

  it('shows an error with a retry when a later page fails, and keeps what you have', async () => {
    const { user } = await open()
    await waitFor(() => expect(cards()).toHaveLength(20))
    backend.failRpc('get_review_feed', 'boom', { times: 1 })

    await waitFor(async () => {
      await scrollToEnd()
      expect(screen.getByText(FEED_ERROR)).toBeTruthy()
    })
    expect(cards()).toHaveLength(20)

    await user.click(within(screen.getByText(FEED_ERROR).closest('[role="alert"]')).getByRole('button', { name: 'Try again' }))
    await scrollUntil(40)
  })
})

describe('when the feed will not load', () => {
  it('shows an error with a retry', async () => {
    review(bob, A, 'Eventually.')
    backend.failRpc('get_review_feed', 'boom', { times: 1 })
    const { user } = await open()

    const alert = await screen.findByText(FEED_ERROR)
    await user.click(within(alert.closest('[role="alert"]')).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Eventually.')).toBeTruthy()
  })
})

describe('going back to the feed', () => {
  let scrollY

  beforeEach(() => {
    // jsdom has no layout: fake the scroll position and a tall page.
    scrollY = 0
    vi.spyOn(window, 'scrollTo').mockImplementation((arg, y) => {
      scrollY = typeof arg === 'object' ? arg.top : y
      window.dispatchEvent(new Event('scroll'))
    })
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(10000)
    backend.seedList(bob, ids(45))
    ids(45).forEach((id, i) => {
      backend.addReview(bob, id, { body: `review ${i + 1}`, createdAt: `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` })
    })
    backend.addFriendship(alice, bob, 'accepted')
  })

  it('restores the filters, the loaded cards and the scroll position', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('radio', { name: 'Most discussed' }))
    await waitFor(() => expect(cards()).toHaveLength(20))
    await scrollUntil(40)
    scrollY = 1500
    window.dispatchEvent(new Event('scroll'))
    await user.click(within(cards()[2]).getByRole('link', { name: 'Comment' }))
    await screen.findByRole('heading', { level: 1, name: /^Review of / })
    expect(scrollY).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => expect(scrollY).toBe(1500))
    await waitFor(() => expect(cards()).toHaveLength(40))
    expect(screen.getByRole('radio', { name: 'Most discussed' }).getAttribute('aria-checked')).toBe('true')
  })

  it('shows fresh comment counts when you come back', async () => {
    const { user } = await open()
    await waitFor(() => expect(cards()).toHaveLength(20))
    await user.click(within(cards()[0]).getByRole('link', { name: 'Comment' }))
    await user.type(await screen.findByRole('textbox', { name: 'Add a comment' }), 'First!')
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    await screen.findByText('First!', { selector: '.comment__body' })

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(await within(await waitFor(() => cards()[0] ?? Promise.reject(new Error('no card')))).findByRole('link', { name: 'See 1 comment' })).toBeTruthy()
  })

  it('starts fresh when you open the page by a link', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('radio', { name: 'Most discussed' }))
    await waitFor(() => expect(cards()).toHaveLength(20))
    await scrollUntil(40)
    await user.click(within(cards()[0]).getByRole('link', { name: 'Comment' }))
    await screen.findByRole('heading', { level: 1, name: /^Review of / })

    await goTo('#/community') // a new visit, not Back

    await waitFor(() => expect(cards()).toHaveLength(20))
    expect(screen.getByRole('radio', { name: 'Recent' }).getAttribute('aria-checked')).toBe('true')
    expect(scrollY).toBe(0)
  })
})
