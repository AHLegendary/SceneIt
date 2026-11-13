import { beforeEach, describe, expect, it, vi } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, goTo, launch, ready, scrollToEnd, screen, waitFor } from './helpers/harness.js'

// jsdom has no layout, so scrolling is simulated: scrollTo moves a fake
// window.scrollY (and fires a scroll event, like a browser), and the page's
// height is whatever `pageHeight` says.
let scrollY
let pageHeight
let scrolledTo // elements scrollIntoView was called on

function mockScrolling() {
  scrollY = 0
  pageHeight = 10000
  vi.spyOn(window, 'scrollTo').mockImplementation((arg, y) => {
    scrollY = typeof arg === 'object' ? arg.top : y
    window.dispatchEvent(new Event('scroll'))
  })
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(() => pageHeight)
  // jsdom has no scrollIntoView. Pretend an element sits 500px down the page.
  scrolledTo = []
  Element.prototype.scrollIntoView = vi.fn(function scrollIntoView(options) {
    scrolledTo.push({ id: this.id, options })
    scrollY = 500
    window.dispatchEvent(new Event('scroll'))
  })
}
// The user scrolls.
function scrollBy(y) {
  scrollY = y
  window.dispatchEvent(new Event('scroll'))
}

let backend
let alice
let bob
// Bob has 45 movies, the most recently ranked last, so that one is the top card.
const MANY = MOVIES.slice(0, 45)
const NEWEST = MANY[44]

beforeEach(() => {
  mockScrolling()
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
  bob = backend.addUser({ username: 'bob' })
  backend.seedList(bob, MANY.map((m) => m.id))
  backend.addReview(bob, NEWEST.id, { body: 'The newest one.' })
})

const cards = () => document.querySelectorAll('.rcard')
const searchBox = () => screen.getByRole('searchbox', { name: 'Search ranked movies' })

async function scrollUntil(count) {
  await waitFor(async () => {
    await scrollToEnd()
    expect(cards()).toHaveLength(count)
  })
}

async function open(hash) {
  const app = await launch({ backend, as: alice, hash })
  await ready({ loggedIn: true })
  return app
}

// From bob's profile: load a second page of cards, scroll down, and open the
// discussion of his newest review.
async function scrollThenOpenReview(user) {
  await waitFor(() => expect(cards()).toHaveLength(20))
  await scrollUntil(40)
  scrollBy(1234)
  await user.click(await screen.findByRole('link', { name: 'Comment' }))
  await screen.findByRole('heading', { level: 1, name: `Review of ${NEWEST.title}` })
}

describe('opening a page by a link', () => {
  it('starts at the top', async () => {
    await open('#/home')
    scrollBy(800)
    await goTo('#/leaderboard')
    expect(scrollY).toBe(0)
  })

  it('starts at the top and starts clean, even for a page you were on before', async () => {
    const { user } = await open('#/u/bob')
    await scrollThenOpenReview(user)

    await goTo('#/u/bob') // a new visit, not Back

    expect(scrollY).toBe(0)
    await waitFor(() => expect(cards()).toHaveLength(20))
  })
})

describe('going back', () => {
  it('restores the scroll position and the cards that were loaded', async () => {
    const { user } = await open('#/u/bob')
    await scrollThenOpenReview(user)
    expect(scrollY).toBe(0) // the discussion page opened at the top

    await user.click(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => expect(scrollY).toBe(1234))
    await waitFor(() => expect(cards()).toHaveLength(40))
  })

  it('works with the browser\'s back button too', async () => {
    const { user } = await open('#/u/bob')
    await waitFor(() => expect(cards()).toHaveLength(20))
    await scrollUntil(40)
    scrollBy(900)
    await user.click(await screen.findByRole('link', { name: 'Comment' }))
    await screen.findByRole('heading', { level: 1, name: `Review of ${NEWEST.title}` })

    window.history.back()

    await waitFor(() => expect(scrollY).toBe(900))
    await waitFor(() => expect(cards()).toHaveLength(40))
  })

  it('restores the search text and what it found', async () => {
    const { user } = await open('#/u/bob')
    await waitFor(() => expect(cards()).toHaveLength(20))
    await user.type(searchBox(), NEWEST.title)
    await waitFor(() => expect(cards().length).toBeLessThan(20))
    await user.click(await screen.findByRole('link', { name: 'Comment' }))
    await screen.findByRole('heading', { level: 1, name: `Review of ${NEWEST.title}` })

    await user.click(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => expect(searchBox().value).toBe(NEWEST.title))
    expect(cards().length).toBeLessThan(20)
    expect(document.querySelector('.rcard__title').firstChild.textContent).toBe(NEWEST.title)
  })

  it('shows fresh comment counts after you come back', async () => {
    const review = backend.reviews[0]
    const { user } = await open('#/u/bob')
    await user.click(await screen.findByRole('link', { name: 'Comment' }))
    await screen.findByRole('heading', { level: 1, name: `Review of ${NEWEST.title}` })
    await user.type(await screen.findByRole('textbox', { name: 'Add a comment' }), 'Hello bob.')
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    await screen.findByText('Hello bob.', { selector: '.comment__body' })
    expect(backend.review_comments).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(await screen.findByRole('link', { name: 'See 1 comment' })).toBeTruthy()
    expect(review).toBeTruthy()
  })

  it('waits for the page to be tall enough before scrolling', async () => {
    const { user } = await open('#/u/bob')
    await scrollThenOpenReview(user)

    pageHeight = 500 // the page is still loading: too short to scroll to 1234
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(window.location.hash).toBe('#/u/bob'))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(scrollY).toBe(0)

    pageHeight = 10000 // now it has grown
    await waitFor(() => expect(scrollY).toBe(1234))
  })

  it('stops trying if you start scrolling yourself', async () => {
    const { user } = await open('#/u/bob')
    await scrollThenOpenReview(user)

    pageHeight = 500
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(window.location.hash).toBe('#/u/bob'))
    window.dispatchEvent(new Event('wheel')) // the user takes over
    pageHeight = 10000
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(scrollY).toBe(0)
  })
})

describe('opening a link to one comment', () => {
  let review
  let top
  let reply

  beforeEach(() => {
    review = backend.reviews[0]
    top = backend.addComment(alice, review, { body: 'First thoughts.' })
    reply = backend.addComment(bob, review, { body: 'A reply.', parentId: top.id })
    backend.addComment(alice, review, { body: 'Something else.' })
  })

  const link = (comment) => `#/u/bob/review/${review.id}/c/${comment.id}`
  const flashing = () => [...document.querySelectorAll('.is-flash')].map((el) => el.id)

  it('scrolls to the comment and highlights it', async () => {
    await open('#/u/bob')
    scrollBy(1234)
    await goTo(link(top))

    await waitFor(() => expect(scrolledTo).toEqual([{ id: `comment-${top.id}`, options: { block: 'center' } }]))
    expect(flashing()).toEqual([`comment-${top.id}`])
  })

  it('does the same for a reply', async () => {
    await open(link(reply))

    await waitFor(() => expect(scrolledTo.map((t) => t.id)).toEqual([`comment-${reply.id}`]))
    expect(flashing()).toEqual([`comment-${reply.id}`])
  })

  it('shows the page normally when the comment is gone', async () => {
    await open(`#/u/bob/review/${review.id}/c/00000000-0000-4000-8000-0000000fffff`)

    await screen.findByText('First thoughts.', { selector: '.comment__body' })
    expect(scrolledTo).toEqual([])
    expect(flashing()).toEqual([])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('is not pulled away by a saved scroll position that is still waiting to be restored', async () => {
    const { user } = await open(link(top))
    await waitFor(() => expect(scrolledTo).toHaveLength(1))
    scrollBy(900) // the reader scrolls on
    await goTo('#/home')

    pageHeight = 500 // too short to restore 900 yet, so the restore waits
    window.history.back()
    await waitFor(() => expect(scrolledTo).toHaveLength(2)) // comments loaded, scrolled to the comment
    expect(scrollY).toBe(500)

    pageHeight = 10000 // now the page is tall enough
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(scrollY).toBe(500) // the restore was cancelled, not applied on top
    expect(user).toBeTruthy()
  })
})
