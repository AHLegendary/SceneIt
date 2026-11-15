import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, launch, openProfileMenu, ready, relaunch, screen, waitFor, within } from './helpers/harness.js'
import { PUBLISHABLE_KEY, SUPABASE_URL } from './helpers/fakeBackend.js'

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

describe('the moderation page', () => {
  const NO_ACCESS = "You don't have access to this page."
  let mod
  let carol
  let review // bob's review of Dune
  let comment // alice's comment on it

  beforeEach(() => {
    mod = backend.addUser({ username: 'modley', is_moderator: true })
    carol = backend.addUser({ username: 'carol' })
    review = backend.addReview(bob, DUNE.id, { body: 'A masterpiece.' })
    comment = backend.addComment(alice, review, { body: 'Something nasty.' })
  })

  // Files a report the way the app does (through the database, so the snapshot trigger runs).
  async function report(user, type, id, reason) {
    const client = backend.createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } })
    await client.auth.signInWithPassword({ email: user.email, password: user.password })
    const { error } = await client.from('reports').insert({ reporter_id: user.id, target_type: type, target_id: id, reason })
    expect(error).toBeNull()
  }
  const openQueue = async (as = mod) => {
    const app = await launch({ backend, as, hash: '#/moderation' })
    await ready({ loggedIn: true })
    return app
  }
  const card = (name) => within(screen.getByRole('article', { name }))
  const commentCard = () => card('Comment by Alice_99')
  const tab = (name) => screen.getByRole('radio', { name })
  const reviewLinkHref = `#/u/bob/review/`

  describe('access', () => {
    it("has no menu shortcut for regular users, and the page says they can't use it", async () => {
      const { user } = await openQueue(carol)
      expect(await screen.findByText(NO_ACCESS)).toBeTruthy()
      expect(screen.queryByRole('radio', { name: 'Open' })).toBeNull()
      const menu = await openProfileMenu(user)
      expect(within(menu).queryByRole('menuitem', { name: 'Moderation' })).toBeNull()
      expect(backend.callsTo('rpc:get_reports')).toHaveLength(0)
    })

    it('asks logged-out visitors to log in', async () => {
      await launch({ backend, hash: '#/moderation' })
      expect((await screen.findAllByRole('button', { name: /^log in$/i })).length).toBeGreaterThan(0)
      expect(screen.queryByText(NO_ACCESS)).toBeNull()
      expect(screen.queryByRole('radio', { name: 'Open' })).toBeNull()
    })

    it('gives moderators a menu shortcut that opens the page', async () => {
      const { user } = await launch({ backend, as: mod, hash: '#/home' })
      await ready({ loggedIn: true })
      await waitFor(() => expect(screen.getByRole('button', { name: /^profile/i })).toBeTruthy())
      await waitFor(async () => {
        const menu = await openProfileMenu(user)
        expect(within(menu).getByRole('menuitem', { name: 'Moderation' })).toBeTruthy()
      })
      await user.click(screen.getByRole('menuitem', { name: 'Moderation' }))
      expect(await screen.findByRole('heading', { level: 1, name: 'Moderation' })).toBeTruthy()
      expect(window.location.hash).toBe('#/moderation')
      expect(screen.queryByText(NO_ACCESS)).toBeNull()
    })
  })

  describe('the queue', () => {
    it('says so when there is nothing to do', async () => {
      const { user } = await openQueue()
      expect(await screen.findByText('No open reports.')).toBeTruthy()
      await user.click(tab('Resolved'))
      expect(await screen.findByText('Nothing resolved yet.')).toBeTruthy()
    })

    it('shows reports on the same comment as one card, with the count, reasons and reporters', async () => {
      await report(bob, 'comment', comment.id, 'Rude')
      await report(carol, 'comment', comment.id, 'Hateful')
      await openQueue()
      await screen.findByRole('article', { name: 'Comment by Alice_99' })
      expect(screen.getAllByRole('article')).toHaveLength(1)
      expect(commentCard().getByText('2 reports')).toBeTruthy()
      expect(commentCard().getByText(/“Rude”/).textContent).toMatch(/bob · /)
      expect(commentCard().getByText(/“Hateful”/).textContent).toMatch(/carol · /)
      expect(commentCard().getByText('Something nasty.')).toBeTruthy()
      expect(commentCard().queryByText('Now:')).toBeNull() // unchanged, so only one copy
    })

    it('has a "View in context" link to the comment, in the same tab', async () => {
      await report(bob, 'comment', comment.id, 'Rude')
      await report(carol, 'review', review.id, 'Spam')
      await openQueue()
      await screen.findByRole('article', { name: 'Comment by Alice_99' })
      const toComment = commentCard().getByRole('link', { name: 'View in context' })
      expect(toComment.getAttribute('href')).toBe(`${reviewLinkHref}${review.id}/c/${comment.id}`)
      expect(toComment.getAttribute('target')).toBeNull()
      expect(card('Review by bob').getByRole('link', { name: 'View in context' }).getAttribute('href')).toBe(`${reviewLinkHref}${review.id}`)
    })

    it('shows a load error with Try again', async () => {
      backend.failRpc('get_reports', 'down', { times: 1 })
      const { user } = await openQueue()
      expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load the reports.")
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByText('No open reports.')).toBeTruthy()
    })
  })

  describe('hide and restore', () => {
    // Opens bob's review as `viewer` in a fresh app and returns whether alice's comment shows as removed.
    async function seenBy(app, viewer) {
      const next = await relaunch(app, { as: viewer, hash: `#/u/bob/review/${review.id}` })
      await ready({ loggedIn: true })
      await screen.findByRole('heading', { level: 1, name: `Review of ${DUNE.title}` })
      await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: /^Comments/ })).toBeTruthy())
      await waitFor(() => expect(screen.queryByRole('article', { name: /Comment by|Removed comment/ })).not.toBeNull())
      return next
    }

    it('hides a comment: the card leaves Open, shows in Resolved, and regular users see a placeholder', async () => {
      await report(bob, 'comment', comment.id, 'Rude')
      await report(carol, 'comment', comment.id, 'Hateful')
      const app = await openQueue()
      await screen.findByRole('article', { name: 'Comment by Alice_99' })

      await app.user.click(commentCard().getByRole('button', { name: 'Hide' }))
      await app.user.type(commentCard().getByRole('textbox', { name: 'Reason (optional)' }), 'Insulting')
      await app.user.click(commentCard().getByRole('button', { name: 'Hide it' }))

      await waitFor(() => expect(screen.queryByRole('article', { name: 'Comment by Alice_99' })).toBeNull())
      expect(screen.getByText('No open reports.')).toBeTruthy()
      expect(comment.hidden_reason).toBe('Insulting')
      expect(backend.reports.map((r) => r.status)).toEqual(['hidden', 'hidden'])

      await app.user.click(tab('Resolved'))
      const resolved = await screen.findByRole('article', { name: 'Comment by Alice_99' })
      expect(within(resolved).getByText(/^Hidden by modley · /)).toBeTruthy()
      expect(within(resolved).getByRole('button', { name: 'Restore' })).toBeTruthy()
      expect(within(resolved).queryByRole('button', { name: 'Hide' })).toBeNull()

      // A regular user now sees the placeholder.
      await seenBy(app, carol)
      expect(screen.getByText('This comment was removed by a moderator.')).toBeTruthy()
      expect(screen.queryByText('Something nasty.')).toBeNull()
    })

    it('restores it from Resolved, and it is visible again', async () => {
      await report(bob, 'comment', comment.id, 'Rude')
      backend.moderateContent(mod.id, 'comment', comment.id, 'hide')
      const app = await openQueue()
      await app.user.click(tab('Resolved'))
      await app.user.click(await screen.findByRole('button', { name: 'Restore' }))

      await waitFor(() => expect(comment.hidden_at).toBeNull())
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull())
      expect(screen.getByRole('article', { name: 'Comment by Alice_99' })).toBeTruthy() // the history stays

      await seenBy(app, carol)
      expect(screen.getByText('Something nasty.')).toBeTruthy()
      expect(screen.queryByText('This comment was removed by a moderator.')).toBeNull()
    })

    it('hides a review, with no reason needed', async () => {
      await report(carol, 'review', review.id, 'Spam')
      const app = await openQueue()
      await app.user.click(await card('Review by bob').findByRole('button', { name: 'Hide' }))
      await app.user.click(card('Review by bob').getByRole('button', { name: 'Hide it' }))
      await waitFor(() => expect(review.hidden_at).toBeTruthy())
      expect(review.hidden_reason).toBeNull()
      expect(await screen.findByText('No open reports.')).toBeTruthy()
    })

    it('puts the card back, with a message, when hiding fails', async () => {
      await report(bob, 'comment', comment.id, 'Rude')
      const app = await openQueue()
      await screen.findByRole('article', { name: 'Comment by Alice_99' })
      backend.failRpc('moderate_content', 'down', { times: 1 })

      await app.user.click(commentCard().getByRole('button', { name: 'Hide' }))
      await app.user.click(commentCard().getByRole('button', { name: 'Hide it' }))

      expect((await commentCard().findByRole('alert')).textContent).toBe("Couldn't do that. Check your connection and try again.")
      expect(commentCard().getByRole('button', { name: 'Dismiss' })).toBeTruthy()
      expect(comment.hidden_at).toBeNull()
      expect(backend.reports[0].status).toBe('open')
    })
  })

  describe('dismiss', () => {
    it('moves the card to Resolved and leaves the content visible', async () => {
      await report(bob, 'comment', comment.id, 'Rude')
      const app = await openQueue()
      await screen.findByRole('article', { name: 'Comment by Alice_99' })
      await app.user.click(commentCard().getByRole('button', { name: 'Dismiss' }))

      await waitFor(() => expect(screen.queryByRole('article')).toBeNull())
      expect(comment.hidden_at).toBeNull()
      await app.user.click(tab('Resolved'))
      const resolved = await screen.findByRole('article', { name: 'Comment by Alice_99' })
      expect(within(resolved).getByText(/^Dismissed by modley · /)).toBeTruthy()
      expect(within(resolved).queryByRole('button', { name: 'Restore' })).toBeNull()

      const next = await relaunch(app, { as: carol, hash: `#/u/bob/review/${review.id}` })
      await ready({ loggedIn: true })
      expect(await screen.findByText('Something nasty.')).toBeTruthy()
      expect(next).toBeTruthy()
    })
  })

  describe('reporting again after a cooldown', () => {
    const DAY = 24 * 60 * 60 * 1000
    const COOLDOWN = 'You reported this recently. You can report it again a day after it was reviewed.'

    // carol reports alice's comment from the review page, the way a person would.
    async function reportFromPage(app, text) {
      await app.user.click(await screen.findByRole('button', { name: 'Report comment by Alice_99' }))
      type(screen.getByRole('textbox', { name: 'Why are you reporting this comment?' }), text)
      await app.user.click(screen.getByRole('button', { name: 'Send report' }))
    }

    it('shows the cooldown message after a dismissal, lets the report through a day later, and the card shows the totals', async () => {
      let app = await openReview(review, { as: carol })
      await reportFromPage(app, 'First time.')
      expect(await screen.findByText("Reported. Thanks, we'll take a look.")).toBeTruthy()

      backend.moderateContent(mod.id, 'comment', comment.id, 'dismiss')

      app = await relaunch(app, { as: carol, hash: `#/u/bob/review/${review.id}` })
      await ready({ loggedIn: true })
      await reportFromPage(app, 'Still bad.')
      expect((await screen.findByRole('alert')).textContent).toBe(COOLDOWN)
      expect(backend.reports).toHaveLength(1)

      backend.advanceTime(DAY + 60 * 1000)
      type(screen.getByRole('textbox', { name: 'Why are you reporting this comment?' }), 'Still bad.')
      await app.user.click(screen.getByRole('button', { name: 'Send report' }))
      expect(await screen.findByText("Reported. Thanks, we'll take a look.")).toBeTruthy()
      expect(backend.reports.map((r) => r.status)).toEqual(['dismissed', 'open'])

      app = await relaunch(app, { as: mod, hash: '#/moderation' })
      await ready({ loggedIn: true })
      await screen.findByRole('article', { name: 'Comment by Alice_99' })
      expect(commentCard().getByText('1 report · 2 all-time from 1 person')).toBeTruthy()
    })

    it('shows the plain count when nothing was reported before', async () => {
      await report(bob, 'comment', comment.id, 'Rude')
      await report(carol, 'comment', comment.id, 'Hateful')
      await openQueue()
      await screen.findByRole('article', { name: 'Comment by Alice_99' })
      expect(commentCard().getByText('2 reports')).toBeTruthy()
    })

    it('words the totals for several people', async () => {
      await report(bob, 'comment', comment.id, 'Rude')
      await report(carol, 'comment', comment.id, 'Hateful')
      backend.moderateContent(mod.id, 'comment', comment.id, 'dismiss')
      backend.advanceTime(DAY + 60 * 1000)
      await report(bob, 'comment', comment.id, 'Again')
      await report(carol, 'comment', comment.id, 'Again too')
      await report(backend.addUser({ username: 'dina' }), 'comment', comment.id, 'New')
      await openQueue()
      await screen.findByRole('article', { name: 'Comment by Alice_99' })
      expect(commentCard().getByText('3 reports · 5 all-time from 3 people')).toBeTruthy()
    })
  })

  describe('what was reported vs what it says now', () => {
    it('shows both when the author edited it after the report', async () => {
      await report(bob, 'comment', comment.id, 'Rude')
      comment.body = 'Something much nicer.'
      await openQueue()
      await screen.findByRole('article', { name: 'Comment by Alice_99' })
      expect(commentCard().getByText('Reported text')).toBeTruthy()
      expect(commentCard().getByText('Something nasty.')).toBeTruthy()
      expect(commentCard().getByText('Now:')).toBeTruthy()
      expect(commentCard().getByText('Something much nicer.')).toBeTruthy()
    })

    it('says "Deleted by the author" and does not offer Hide when it is gone', async () => {
      await report(bob, 'comment', comment.id, 'Rude')
      backend.review_comments = backend.review_comments.filter((c) => c.id !== comment.id)
      const app = await openQueue()
      await screen.findByRole('article', { name: 'Comment by Alice_99' })
      expect(commentCard().getByText('Deleted by the author')).toBeTruthy()
      expect(commentCard().getByText('Something nasty.')).toBeTruthy() // the copy from report time
      expect(commentCard().queryByRole('button', { name: 'Hide' })).toBeNull()

      await app.user.click(commentCard().getByRole('button', { name: 'Dismiss' })) // still possible
      await waitFor(() => expect(backend.reports[0].status).toBe('dismissed'))
    })
  })
})
