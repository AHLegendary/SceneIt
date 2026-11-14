import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, launch, ready, screen, waitFor, within } from './helpers/harness.js'

// The forms check text in the browser first. These tests switch that check off
// (moderateText always says yes), which is what someone skipping the browser
// does, to show the database refuses the text on its own.
vi.mock('../../src/lib/moderation.js', async (importOriginal) => ({
  ...(await importOriginal()),
  moderateText: () => ({ ok: true }),
}))

const DUNE = MOVIES.find((m) => m.id === 'dune-part-two-2024')
const FLAGGED = "That text can't be posted because it may break our community rules. Edit it and try again."

let backend
let alice // the viewer
let bob // wrote the review

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
  bob = backend.addUser({ username: 'bob' })
  backend.seedList(alice, [DUNE.id])
  backend.seedList(bob, [DUNE.id])
})

async function openReview(review, { as = alice } = {}) {
  const app = await launch({ backend, as, hash: `#/u/bob/review/${review.id}` })
  await ready({ loggedIn: Boolean(as) })
  await screen.findByRole('heading', { level: 1, name: `Review of ${DUNE.title}` })
  return app
}
const type = (box, text) => fireEvent.change(box, { target: { value: text } })

describe('server-side text checks', () => {
  let review

  beforeEach(() => {
    review = backend.addReview(bob, DUNE.id, { body: 'A masterpiece.' })
  })

  it('refuses a flagged comment that skipped the browser check, and shows the usual message', async () => {
    const { user } = await openReview(review)
    await user.type(await screen.findByRole('textbox', { name: 'Add a comment' }), 'just kys')
    await user.click(screen.getByRole('button', { name: 'Comment' }))

    expect((await screen.findByRole('alert')).textContent).toBe(FLAGGED)
    expect(backend.callsTo('from:review_comments:insert')).toHaveLength(1) // it did reach the database
    expect(backend.review_comments).toHaveLength(0)
  })

  it('refuses a flagged edit of your own comment, and keeps the old text', async () => {
    const mine = backend.addComment(alice, review, { body: 'Original' })
    const { user } = await openReview(review)
    await user.click(await screen.findByRole('button', { name: 'Edit comment by Alice_99' }))
    const box = screen.getByRole('textbox', { name: /Edit/i })
    type(box, 'go kys')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('alert')).textContent).toBe(FLAGGED)
    expect(mine.body).toBe('Original')
  })
})

describe('reporting your own posts', () => {
  it("has no Report button on your own review or comment, but does on someone else's", async () => {
    const review = backend.addReview(alice, DUNE.id, { body: 'My review.' })
    backend.addComment(alice, review, { body: 'My own comment.' })
    backend.addComment(bob, review, { body: 'Bob replies.' })
    await launch({ backend, as: alice, hash: `#/u/Alice_99/review/${review.id}` })
    await ready({ loggedIn: true })
    await screen.findByRole('heading', { level: 1, name: `Review of ${DUNE.title}` })
    await screen.findByText('Bob replies.')

    expect(screen.queryByRole('button', { name: 'Report review' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Report comment by Alice_99' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Report comment by bob' })).toBeTruthy()
  })
})

describe('hidden reviews', () => {
  let mod
  let review

  beforeEach(() => {
    mod = backend.addUser({ username: 'modley', is_moderator: true })
    review = backend.addReview(bob, DUNE.id, { body: 'A masterpiece.' })
    backend.addComment(alice, review, { body: 'I agree.' })
    backend.moderateContent(mod.id, 'review', review.id, 'hide', 'Off topic')
  })

  it('looks like "not found" to other people', async () => {
    await launch({ backend, as: alice, hash: `#/u/bob/review/${review.id}` })
    await ready({ loggedIn: true })
    expect(await screen.findByRole('heading', { level: 1, name: 'Review not found' })).toBeTruthy()
    expect(screen.queryByText('A masterpiece.')).toBeNull()
  })

  it('looks like "not found" when logged out', async () => {
    await launch({ backend, hash: `#/u/bob/review/${review.id}` })
    await ready({ loggedIn: false })
    expect(await screen.findByRole('heading', { level: 1, name: 'Review not found' })).toBeTruthy()
  })

  it('shows the author a banner with the reason, and no comment box', async () => {
    await launch({ backend, as: bob, hash: `#/u/bob/review/${review.id}` })
    await ready({ loggedIn: true })
    await screen.findByRole('heading', { level: 1, name: `Review of ${DUNE.title}` })
    const banner = await screen.findByRole('status')
    expect(banner.textContent).toBe('Hidden by a moderator. Only you can see this. Reason: Off topic')
    expect(screen.getByText('A masterpiece.')).toBeTruthy()
    await screen.findByText('I agree.') // the comments are still there for the author
    expect(screen.queryByRole('textbox', { name: 'Add a comment' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull()
  })

  it('shows a moderator a "Hidden" label, no comment box and no Report button', async () => {
    await launch({ backend, as: mod, hash: `#/u/bob/review/${review.id}` })
    await ready({ loggedIn: true })
    await screen.findByRole('heading', { level: 1, name: `Review of ${DUNE.title}` })
    expect((await screen.findByRole('status')).textContent).toBe('Hidden Reason: Off topic')
    expect(screen.queryByRole('textbox', { name: 'Add a comment' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Report/ })).toBeNull()
  })

  it('is left out of the community feed', async () => {
    backend.seedList(alice, [DUNE.id])
    backend.addReview(alice, DUNE.id, { body: 'Visible one.' })
    await launch({ backend, as: alice, hash: '#/community' })
    await ready({ loggedIn: true })
    await screen.findByText('Visible one.')
    expect(screen.queryByText('A masterpiece.')).toBeNull()
  })

  it("shows on the author's own profile with the banner, and not on anyone else's view of it", async () => {
    await launch({ backend, as: bob, hash: '#/profile' })
    await ready({ loggedIn: true })
    expect(await screen.findByText('A masterpiece.')).toBeTruthy()
    expect(screen.getByText(/Hidden by a moderator\. Only you can see this\./)).toBeTruthy()
  })

  it("is missing from the author's public profile for other people", async () => {
    await launch({ backend, as: alice, hash: '#/u/bob' })
    await ready({ loggedIn: true })
    await screen.findByRole('heading', { level: 1, name: 'bob' })
    await screen.findAllByText(DUNE.title)
    // Wait until the profile has asked for the reviews, so "missing" isn't just "not loaded yet".
    await waitFor(() => expect(backend.callsTo('from:reviews:select').length).toBeGreaterThan(0))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText('A masterpiece.')).toBeNull()
    expect(screen.queryByText(/Hidden/)).toBeNull()
  })
})

describe('hidden comments', () => {
  let mod
  let review
  let top
  let reply

  beforeEach(() => {
    mod = backend.addUser({ username: 'modley', is_moderator: true })
    review = backend.addReview(bob, DUNE.id, { body: 'A masterpiece.' })
    top = backend.addComment(alice, review, { body: 'Something nasty.' })
    reply = backend.addComment(bob, review, { body: 'Please be kind.', parentId: top.id })
    backend.moderateContent(mod.id, 'comment', top.id, 'hide')
  })

  const reviewHash = () => `#/u/bob/review/${review.id}`

  it('is a placeholder for other people, and its reply is still visible', async () => {
    const carol = backend.addUser({ username: 'carol' })
    await launch({ backend, as: carol, hash: reviewHash() })
    await ready({ loggedIn: true })
    expect(await screen.findByText('This comment was removed by a moderator.')).toBeTruthy()
    expect(screen.queryByText('Something nasty.')).toBeNull()
    const placeholder = screen.getByRole('article', { name: 'Removed comment' })
    expect(within(placeholder).queryByRole('link')).toBeNull() // no username
    expect(within(placeholder).queryByRole('button')).toBeNull() // no Reply, Report or Edit
    expect(screen.getByText('Please be kind.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Comments (1)' })).toBeTruthy()
  })

  it('shows its own author the text and a label', async () => {
    await launch({ backend, as: alice, hash: reviewHash() })
    await ready({ loggedIn: true })
    const own = await screen.findByRole('article', { name: 'Comment by Alice_99' })
    expect(within(own).getByText('Something nasty.')).toBeTruthy()
    expect(within(own).getByText('Hidden by a moderator')).toBeTruthy()
    expect(within(own).queryByRole('button', { name: /^Reply/ })).toBeNull()
    expect(within(own).getByRole('button', { name: 'Edit comment by Alice_99' })).toBeTruthy()
    expect(screen.queryByText('This comment was removed by a moderator.')).toBeNull()
  })

  it('shows a moderator the text and a "Hidden" label, with no Report or Reply', async () => {
    await launch({ backend, as: mod, hash: reviewHash() })
    await ready({ loggedIn: true })
    const seen = await screen.findByRole('article', { name: 'Comment by Alice_99' })
    expect(within(seen).getByText('Something nasty.')).toBeTruthy()
    expect(within(seen).getByText('Hidden')).toBeTruthy()
    expect(within(seen).queryByRole('button', { name: /^(Reply|Report)/ })).toBeNull()
  })

  it('counts comments without it on the profile card', async () => {
    backend.seedList(bob, [DUNE.id])
    await launch({ backend, as: backend.addUser({ username: 'carol' }), hash: '#/u/bob' })
    await ready({ loggedIn: true })
    expect(await screen.findByRole('link', { name: 'See 1 comment' })).toBeTruthy()
    expect(reply).toBeTruthy()
  })
})
