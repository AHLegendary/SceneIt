import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, launch, ready, screen } from './helpers/harness.js'

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
