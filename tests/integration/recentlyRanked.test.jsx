import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, launch, mount, ready, scrollToEnd, screen, waitFor, within } from './helpers/harness.js'

const ids = (n) => MOVIES.slice(0, n).map((m) => m.id)
const title = (id) => MOVIES.find((m) => m.id === id).title

const REVIEWS_ERROR = "Couldn't load some of the reviews. Check your connection and try again."
const REVIEW_SAVE_ERROR = "Couldn't save your review. Check your connection and try again."
const REVIEW_DELETE_ERROR = "Couldn't delete your review. Check your connection and try again."
const FLAGGED = "That text can't be posted because it may break our community rules. Edit it and try again."

let backend
let alice
let bob

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
  bob = backend.addUser({ username: 'bob', bio: 'Horror fan.' })
})

async function open(hash = '#/profile', as = alice) {
  const app = await launch({ backend, as, hash })
  await ready({ loggedIn: true })
  await screen.findByRole('heading', { level: 1, name: hash === '#/profile' ? as.username : 'bob' })
  return app
}

const cards = () => [...document.querySelectorAll('.rcard')]
const cardTitles = () => [...document.querySelectorAll('.rcard__title')].map((n) => n.firstChild.textContent)
const cardFor = (id) => within(cards().find((card) => card.querySelector('.rcard__title').firstChild.textContent === title(id)))
const search = () => screen.findByRole('searchbox', { name: 'Search ranked movies' })

// Scrolls to the bottom until the list has `count` cards. Retries because a
// page only asks for the next one after its own reviews have loaded.
async function scrollUntil(count) {
  await waitFor(async () => {
    await scrollToEnd()
    expect(cards()).toHaveLength(count)
  })
}

describe('searching your ranked movies', () => {
  it('filters by title as you type, and shows everything again when cleared', async () => {
    backend.seedList(alice, ids(4))
    const { user } = await open()
    await waitFor(() => expect(cards()).toHaveLength(4))

    const box = await search()
    await user.type(box, title(ids(2)[1]).slice(0, 4).toLowerCase())

    await waitFor(() => expect(cardTitles()).toContain(title(ids(2)[1])))
    expect(cards().length).toBeLessThan(4)
    expect(cardTitles().every((t) => t.toLowerCase().includes(title(ids(2)[1]).slice(0, 4).toLowerCase()))).toBe(true)

    await user.clear(box)
    await waitFor(() => expect(cards()).toHaveLength(4))
  })

  it('says so when nothing matches', async () => {
    backend.seedList(alice, ids(3))
    const { user } = await open()
    await waitFor(() => expect(cards()).toHaveLength(3))

    await user.type(await search(), 'zzzzzz')

    expect(await screen.findByText('No ranked movies match “zzzzzz”.')).toBeTruthy()
    expect(cards()).toHaveLength(0)
  })

  it('only searches ranked movies', async () => {
    backend.seedList(alice, [ids(2)[0]])
    const { user } = await open()
    await waitFor(() => expect(cards()).toHaveLength(1))

    await user.type(await search(), title(ids(2)[1])) // in the catalog, but not ranked by alice

    expect(await screen.findByText(/No ranked movies match/)).toBeTruthy()
  })
})

describe('loading more as you scroll', () => {
  it('shows about 20 at first, then 20 more each time you reach the bottom', async () => {
    backend.seedList(alice, ids(45))
    await open()

    await waitFor(() => expect(cards()).toHaveLength(20))
    await scrollUntil(40)
    await scrollUntil(45)

    await scrollToEnd() // nothing left: no more cards
    expect(cards()).toHaveLength(45)
  })

  it('asks for reviews a page at a time, not all at once', async () => {
    backend.seedList(alice, ids(45))
    await open()
    await waitFor(() => expect(cards()).toHaveLength(20))
    await waitFor(() => expect(backend.callsTo('from:reviews:select')).toHaveLength(1))

    await scrollUntil(40)
    await waitFor(() => expect(backend.callsTo('from:reviews:select')).toHaveLength(2))
  })

  it('starts over at 20 when you search', async () => {
    backend.seedList(alice, ids(45))
    const { user } = await open()
    await waitFor(() => expect(cards()).toHaveLength(20))
    await scrollUntil(40)

    await user.type(await search(), 'a')
    const matches = MOVIES.slice(0, 45).filter((m) => m.title.toLowerCase().includes('a')).length
    await waitFor(() => expect(cards()).toHaveLength(Math.min(20, matches)))
  })
})

describe('reviews on the cards', () => {
  const [A, B] = ids(2)

  it('shows a review on its movie\'s card and nowhere else', async () => {
    backend.seedList(alice, [A, B])
    backend.addReview(alice, A, { body: 'Slow burn, worth it.' })
    await open()

    await waitFor(() => expect(cards()).toHaveLength(2))
    expect(await cardFor(A).findByText('Slow burn, worth it.')).toBeTruthy()
    expect(cardFor(B).queryByRole('region', { name: 'Review' })).toBeNull()
  })

  it('shows other people\'s reviews without any edit menu', async () => {
    backend.seedList(bob, [A])
    backend.addReview(bob, A, { body: 'Bob thinks it is great.' })
    await open('#/u/bob')

    expect(await screen.findByText('Bob thinks it is great.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Review options' })).toBeNull()
  })

  it('blurs a spoiler review until you click it', async () => {
    backend.seedList(alice, [A])
    backend.addReview(alice, A, { body: 'The ending twist!', isSpoiler: true })
    const { user } = await open()

    const text = await screen.findByText('The ending twist!')
    expect(text.classList.contains('is-blurred')).toBe(true)
    expect(text.getAttribute('aria-hidden')).toBe('true')

    await user.click(screen.getByRole('button', { name: 'Spoiler: click to show' }))

    expect(text.classList.contains('is-blurred')).toBe(false)
    expect(text.getAttribute('aria-hidden')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Spoiler: click to show' })).toBeNull()
    expect(screen.getByText('Spoiler')).toBeTruthy()
  })

  it('does not blur a review that is not a spoiler', async () => {
    backend.seedList(alice, [A])
    backend.addReview(alice, A, { body: 'No spoilers here.' })
    await open()
    expect((await screen.findByText('No spoilers here.')).classList.contains('is-blurred')).toBe(false)
  })

  it('has no Show more for a short review', async () => {
    backend.seedList(alice, [A])
    backend.addReview(alice, A, { body: 'Short.' })
    await open()
    await screen.findByText('Short.')
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('cuts a long review at four lines, and Show more expands it in place', async () => {
    // jsdom has no layout: say the text is taller than its box while it is clamped.
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(80)
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function scrollHeight() {
      return this.classList?.contains('rcard__text') && this.classList.contains('is-clamped') ? 240 : 80
    })
    backend.seedList(alice, [A])
    backend.addReview(alice, A, { body: 'A long review. '.repeat(40) })
    const { user } = await open()

    const text = await screen.findByText(/A long review\./)
    expect(text.classList.contains('is-clamped')).toBe(true)
    const more = await screen.findByRole('button', { name: 'Show more' })
    expect(more.getAttribute('aria-expanded')).toBe('false')

    await user.click(more)

    expect(text.classList.contains('is-clamped')).toBe(false)
    expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true')

    await user.click(screen.getByRole('button', { name: 'Show less' }))
    expect(text.classList.contains('is-clamped')).toBe(true)
  })

  it('does not offer Show more for a spoiler until you reveal it', async () => {
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(80)
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function scrollHeight() {
      return this.classList?.contains('rcard__text') && this.classList.contains('is-clamped') ? 240 : 80
    })
    backend.seedList(alice, [A])
    backend.addReview(alice, A, { body: 'Spoiler text. '.repeat(40), isSpoiler: true })
    const { user } = await open()

    await screen.findByRole('button', { name: 'Spoiler: click to show' })
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Spoiler: click to show' }))
    expect(await screen.findByRole('button', { name: 'Show more' })).toBeTruthy()
  })

  it('says so, and retries, when the reviews fail to load', async () => {
    backend.seedList(alice, [A])
    backend.addReview(alice, A, { body: 'Hello there.' })
    backend.failQuery('reviews', 'select', 'boom', { times: 1 })
    const { user } = await open()

    const alert = await screen.findByText(REVIEWS_ERROR)
    expect(screen.queryByText('Hello there.')).toBeNull()
    expect(cards()).toHaveLength(1) // the movies still show

    await user.click(within(alert.closest('[role="alert"]')).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Hello there.')).toBeTruthy()
    expect(screen.queryByText(REVIEWS_ERROR)).toBeNull()
  })
})

describe('editing and deleting your review', () => {
  const [A, B] = ids(2)
  beforeEach(() => {
    backend.seedList(alice, [A, B])
  })

  async function openMenu(user, id = A) {
    await waitFor(() => expect(cards()).toHaveLength(2))
    await cardFor(id).findByText(/./, { selector: '.rcard__text' })
    await user.click(cardFor(id).getByRole('button', { name: 'Review options' }))
  }

  it('puts a "..." menu on your own review, not on the whole card or on movies without one', async () => {
    backend.addReview(alice, A, { body: 'Mine.' })
    const { user } = await open()
    await waitFor(() => expect(cards()).toHaveLength(2))
    await cardFor(A).findByText('Mine.')

    expect(cardFor(B).queryByRole('button', { name: 'Review options' })).toBeNull()
    expect(document.querySelectorAll('.rcard > .rcard__menu')).toHaveLength(0)
    await user.click(cardFor(A).getByRole('button', { name: 'Review options' }))
    const menu = within(screen.getByRole('menu', { name: 'Review options' }))
    expect(menu.getByRole('menuitem', { name: 'Edit' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeTruthy()
  })

  it('closes the menu with Escape', async () => {
    backend.addReview(alice, A, { body: 'Mine.' })
    const { user } = await open()
    await openMenu(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Edit reopens the textbox with your text, the counter and the spoiler toggle, and saves', async () => {
    const review = backend.addReview(alice, A, { body: 'Before.', isSpoiler: false })
    const { user } = await open()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))

    const box = screen.getByRole('textbox', { name: 'Edit your review' })
    expect(box.value).toBe('Before.')
    expect(screen.getByText('7 / 2000')).toBeTruthy()
    const spoiler = screen.getByRole('checkbox', { name: 'Contains spoilers' })
    expect(spoiler.checked).toBe(false)

    fireEvent.change(box, { target: { value: 'After, rewritten.' } })
    await user.click(spoiler)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('After, rewritten.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Edit your review' })).toBeNull()
    expect(backend.reviews).toHaveLength(1)
    expect(backend.reviews[0]).toMatchObject({ id: review.id, body: 'After, rewritten.', is_spoiler: true })
    // Now a spoiler, so it is blurred again.
    expect(screen.getByText('After, rewritten.').classList.contains('is-blurred')).toBe(true)
  })

  it('Cancel leaves the review as it was', async () => {
    backend.addReview(alice, A, { body: 'Keep this.' })
    const { user } = await open()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit your review' }), { target: { value: 'Changed my mind.' } })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Keep this.')).toBeTruthy()
    expect(backend.reviews[0].body).toBe('Keep this.')
  })

  it('blocks an edit the content check flags', async () => {
    backend.addReview(alice, A, { body: 'Fine.' })
    const { user } = await open()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit your review' }), { target: { value: 'just kys' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('alert')).textContent).toBe(FLAGGED)
    expect(backend.reviews[0].body).toBe('Fine.')
    expect(backend.callsTo('from:reviews:update')).toHaveLength(0)
  })

  it('does not save an emptied review (use Delete for that)', async () => {
    backend.addReview(alice, A, { body: 'Fine.' })
    const { user } = await open()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit your review' }), { target: { value: '   ' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Write something, or delete the review.')
    expect(backend.reviews[0].body).toBe('Fine.')
  })

  it('keeps your edit and shows the error when saving fails', async () => {
    backend.addReview(alice, A, { body: 'Fine.' })
    backend.failQuery('reviews', 'update', 'boom', { times: 1 })
    const { user } = await open()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const box = screen.getByRole('textbox', { name: 'Edit your review' })
    fireEvent.change(box, { target: { value: 'Better words.' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('alert')).textContent).toBe(REVIEW_SAVE_ERROR)
    expect(box.value).toBe('Better words.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Better words.')).toBeTruthy()
    expect(backend.reviews[0].body).toBe('Better words.')
  })

  it('Delete asks first, then removes the review but keeps the movie', async () => {
    backend.addReview(alice, A, { body: 'Going away.' })
    const { user } = await open()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))

    expect(screen.getByText("Delete this review? This can't be undone.")).toBeTruthy()
    expect(backend.reviews).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('Going away.')).toBeNull())
    expect(backend.reviews).toEqual([])
    expect(cards()).toHaveLength(2)
    expect(backend.listOf(alice)).toEqual([[A], [B]]) // still ranked
  })

  it('Cancel on the delete question keeps the review', async () => {
    backend.addReview(alice, A, { body: 'Staying.' })
    const { user } = await open()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Staying.')).toBeTruthy()
    expect(screen.queryByText(/Delete this review/)).toBeNull()
    expect(backend.reviews).toHaveLength(1)
  })

  it('shows an error and keeps the review when deleting fails', async () => {
    backend.addReview(alice, A, { body: 'Stuck.' })
    backend.failQuery('reviews', 'delete', 'boom', { times: 1 })
    const { user } = await open()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect((await screen.findByRole('alert')).textContent).toBe(REVIEW_DELETE_ERROR)
    expect(screen.getByText('Stuck.')).toBeTruthy()
    expect(backend.reviews).toHaveLength(1)
  })
})

describe('the comments row on a card', () => {
  const movie = MOVIES[0]
  const review = (extra = {}) => ({ id: 'r1', body: 'Nice.', isSpoiler: false, commentCount: 0, ...extra })
  const card = (props) => mount(() => import('../../src/components/ReviewCard.jsx'), { movie, score: null, ...props })

  it('says "Comment" on someone else\'s review with no comments yet', async () => {
    await card({ review: review(), commentsHref: '#/somewhere' })
    expect(screen.getByRole('link', { name: 'Comment' }).getAttribute('href')).toBe('#/somewhere')
  })

  it('says "See 1 comment" and "See 3 comments"', async () => {
    const { view } = await card({ review: review({ commentCount: 1 }), commentsHref: '#/x' })
    expect(screen.getByRole('link', { name: 'See 1 comment' })).toBeTruthy()
    view.unmount()
    await card({ review: review({ commentCount: 3 }), commentsHref: '#/x' })
    expect(screen.getByRole('link', { name: 'See 3 comments' })).toBeTruthy()
  })

  it('is hidden on your own card until someone has commented', async () => {
    const { view } = await card({ review: review(), isOwner: true, commentsHref: '#/x' })
    expect(screen.queryByRole('link')).toBeNull()
    view.unmount()
    await card({ review: review({ commentCount: 2 }), isOwner: true, commentsHref: '#/x' })
    expect(screen.getByRole('link', { name: 'See 2 comments' })).toBeTruthy()
  })

  it('is not shown without a link target, or without a review', async () => {
    const { view } = await card({ review: review({ commentCount: 2 }) })
    expect(screen.queryByRole('link')).toBeNull()
    view.unmount()
    await card({ review: null, commentsHref: '#/x' })
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows the score in the corner only when there is one', async () => {
    const { view } = await card({ review: null, score: 8.4 })
    expect(screen.getByLabelText('Score 8.4').textContent).toBe('8.4')
    view.unmount()
    await card({ review: null, score: null })
    expect(screen.queryByLabelText(/^Score/)).toBeNull()
  })

  it('shows the title, year and genres', async () => {
    await card({ review: null })
    expect(screen.getByRole('button', { name: new RegExp(`^${movie.title}`) })).toBeTruthy()
    expect(screen.getByText(movie.genres.join(' · '))).toBeTruthy()
  })
})
