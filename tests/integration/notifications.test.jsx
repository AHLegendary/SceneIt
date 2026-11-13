import { beforeEach, describe, expect, it, vi } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, launch, ready, screen, waitFor, within } from './helpers/harness.js'

const DUNE = MOVIES.find((m) => m.id === 'dune-part-two-2024')

const GONE_COMMENT = 'This comment is no longer available.'
const GONE_REQUEST = 'This request is no longer pending.'
const OPEN_ERROR = "Couldn't open that notification. Check your connection and try again."

let backend
let alice // the viewer
let bob
let cara
let review // alice's review of Dune

beforeEach(() => {
  // jsdom has no scrollIntoView (the comment deep link uses it).
  Element.prototype.scrollIntoView = vi.fn()
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
  bob = backend.addUser({ username: 'bob' })
  cara = backend.addUser({ username: 'cara' })
  backend.seedList(alice, [DUNE.id])
  review = backend.addReview(alice, DUNE.id, { body: 'Thoughts.' })
})

const open = async (options) => {
  const app = await launch({ backend, as: alice, hash: '#/home', ...options })
  await ready({ loggedIn: true })
  return app
}
const bell = () => screen.getByRole('button', { name: /^Notifications/ })
const badgeText = () => bell().querySelector('.badge')?.textContent ?? null
const openPanel = async (user) => {
  await user.click(bell())
  return within(await screen.findByRole('region', { name: 'Notifications' }))
}
const rowsOf = (panel) => panel.queryAllByRole('button').filter((b) => b.classList.contains('notif__row'))
const row = (panel, text) => panel.getByRole('button', { name: text })
const unread = (element) => element.classList.contains('is-unread')

describe('the bell', () => {
  it('is not there when logged out', async () => {
    await launch({ backend, hash: '#/home' })
    await ready({ loggedIn: false })
    expect(screen.queryByRole('button', { name: /^Notifications/ })).toBeNull()
  })

  it('shows no badge when there is nothing new', async () => {
    await open()
    expect(bell().getAttribute('aria-label')).toBe('Notifications')
    expect(badgeText()).toBeNull()
  })

  it('counts the notifications you have not seen', async () => {
    backend.addComment(bob, review)
    backend.addComment(cara, review)
    await open()
    await waitFor(() => expect(badgeText()).toBe('2'))
    expect(bell().getAttribute('aria-label')).toBe('Notifications, 2 unseen')
  })

  it('caps the badge at 9+', async () => {
    for (let i = 0; i < 10; i += 1) backend.addComment(bob, review)
    await open()
    await waitFor(() => expect(badgeText()).toBe('9+'))
    expect(bell().getAttribute('aria-label')).toBe('Notifications, 10 unseen')
  })
})

describe('the panel', () => {
  it('says so when there is nothing', async () => {
    const { user } = await open()
    const panel = await openPanel(user)
    expect(panel.getByText('No notifications yet.')).toBeTruthy()
    expect(panel.queryByRole('button', { name: 'Mark all read' })).toBeNull()
  })

  it('lists them newest first, worded per kind', async () => {
    const top = backend.addComment(alice, review, { body: 'My own comment.' })
    backend.addFriendship(cara, alice, 'pending')
    backend.addComment(bob, review, { body: 'Great review.' })
    backend.addComment(bob, review, { body: 'Replying to you.', parentId: top.id })
    const blend = backend.addBlend(cara)
    backend.addBlendInvite(blend, cara, alice)
    const { user } = await open()
    const panel = await openPanel(user)

    // alice is both the review's author and the parent comment's author, so
    // bob's reply gives her one notification, not two.
    const texts = rowsOf(panel).map((r) => r.textContent.replace(/^Unread\. /, ''))
    expect(texts).toHaveLength(4)
    expect(texts[0]).toMatch(/^cara invited you to a Movie Blend/)
    expect(texts[1]).toMatch(/^bob replied to your comment on Dune/)
    expect(texts[2]).toMatch(/^bob commented on your review of Dune/)
    expect(texts[3]).toMatch(/^cara sent you a friend request/)
    expect(texts[1]).toContain('Replying to you.') // the preview, on a second line
    expect(texts[2]).toContain('Great review.')
    expect(texts[0]).not.toContain('Great')
  })

  it('clears the badge when opened, but rows stay unread until clicked', async () => {
    backend.addComment(bob, review, { body: 'Great review.' })
    const { user } = await open()
    await waitFor(() => expect(badgeText()).toBe('1'))
    const panel = await openPanel(user)

    await waitFor(() => expect(badgeText()).toBeNull())
    expect(bell().getAttribute('aria-label')).toBe('Notifications')
    expect(unread(row(panel, /bob commented/))).toBe(true)
    expect(backend.notifications[0].seen_at).not.toBeNull()
    expect(backend.notifications[0].read_at).toBeNull()
  })

  it('"Mark all read" clears the unread styling', async () => {
    backend.addComment(bob, review)
    backend.addComment(cara, review)
    const { user } = await open()
    const panel = await openPanel(user)
    expect(rowsOf(panel).every(unread)).toBe(true)

    await user.click(panel.getByRole('button', { name: 'Mark all read' }))

    await waitFor(() => expect(rowsOf(panel).some(unread)).toBe(false))
    expect(panel.queryByRole('button', { name: 'Mark all read' })).toBeNull()
    expect(backend.notifications.every((n) => n.read_at !== null)).toBe(true)
  })

  it('closes on Escape, on a click outside, and when the page changes', async () => {
    const { user } = await open()
    await openPanel(user)
    await user.keyboard('{Escape}')
    expect(bell().getAttribute('aria-expanded')).toBe('false')

    await openPanel(user)
    await user.click(document.body)
    expect(bell().getAttribute('aria-expanded')).toBe('false')

    await openPanel(user)
    await user.click(screen.getByRole('button', { name: 'Community' }))
    expect(bell().getAttribute('aria-expanded')).toBe('false')
  })

  it('shows a loading message, then the list', async () => {
    backend.addComment(bob, review)
    // One hold for the load at login, one for the load when the panel opens.
    const first = backend.hold('rpc:get_notifications')
    const second = backend.hold('rpc:get_notifications')
    const { user } = await open()
    const panel = await openPanel(user)
    expect(panel.getByText('Loading…')).toBeTruthy()
    first.release()
    second.release()
    expect(await panel.findByRole('button', { name: /bob commented/ })).toBeTruthy()
  })

  it('shows the error with a Try again button', async () => {
    backend.addComment(bob, review)
    const { user } = await open()
    await waitFor(() => expect(badgeText()).toBe('1'))
    backend.failRpc('get_notifications', 'down', { times: 1 })
    const panel = await openPanel(user)
    expect((await panel.findByRole('alert')).textContent).toContain("Couldn't load your notifications")

    await user.click(panel.getByRole('button', { name: 'Try again' }))
    expect(await panel.findByRole('button', { name: /bob commented/ })).toBeTruthy()
    expect(panel.queryByRole('alert')).toBeNull()
  })
})

describe('clicking a comment notification', () => {
  it('opens the review page at that comment, highlighted', async () => {
    const comment = backend.addComment(bob, review, { body: 'Great review.' })
    const { user } = await open()
    const panel = await openPanel(user)

    await user.click(row(panel, /bob commented/))

    await screen.findByRole('heading', { level: 1, name: 'Review of Dune: Part Two' })
    expect(window.location.hash).toBe(`#/u/Alice_99/review/${review.id}/c/${comment.id}`)
    await waitFor(() => expect(document.getElementById(`comment-${comment.id}`).classList.contains('is-flash')).toBe(true))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    expect(bell().getAttribute('aria-expanded')).toBe('false')
    expect(backend.notifications[0].read_at).not.toBeNull()
  })

  it('does the same for a reply', async () => {
    const top = backend.addComment(alice, review, { body: 'Mine.' })
    const reply = backend.addComment(bob, review, { body: 'A reply.', parentId: top.id })
    const { user } = await open()
    const panel = await openPanel(user)

    await user.click(row(panel, /bob replied/))

    await waitFor(() => expect(document.getElementById(`comment-${reply.id}`)?.classList.contains('is-flash')).toBe(true))
    expect(document.getElementById(`comment-${top.id}`).classList.contains('is-flash')).toBe(false)
  })

  describe('when it is gone', () => {
    const cases = {
      'the comment was deleted': (comment) => {
        backend.review_comments = backend.review_comments.filter((c) => c.id !== comment.id)
      },
      'the review was deleted': () => backend.deleteReviews((r) => r.id === review.id),
      'the movie was un-ranked': () => backend.removeRanking(alice.id, backend.catalog(DUNE.id).tmdb_id),
    }

    it.each(Object.entries(cases))('says so, and stays put, when %s', async (_name, remove) => {
      const comment = backend.addComment(bob, review, { body: 'Great review.' })
      const { user } = await open()
      await waitFor(() => expect(badgeText()).toBe('1'))
      remove(comment)
      const panel = await openPanel(user)
      const gone = await panel.findByRole('button', { name: /bob commented/ })
      expect(gone.textContent).not.toContain('Great review.') // no preview for a missing comment

      await user.click(gone)

      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText(GONE_COMMENT)).toBeTruthy()
      expect(window.location.hash).toBe('#/home')
      await user.click(within(dialog).getByRole('button', { name: 'OK' }))
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('closes the popup with Escape, or a click on the backdrop', async () => {
      const comment = backend.addComment(bob, review)
      const { user } = await open()
      await waitFor(() => expect(badgeText()).toBe('1'))
      backend.review_comments = backend.review_comments.filter((c) => c.id !== comment.id)
      let panel = await openPanel(user)
      await user.click(await panel.findByRole('button', { name: /bob commented/ }))
      await screen.findByRole('dialog')
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).toBeNull()

      panel = await openPanel(user)
      await user.click(await panel.findByRole('button', { name: /bob commented/ }))
      const dialog = await screen.findByRole('dialog')
      await user.click(dialog.parentElement)
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('shows the error inline, and does not navigate, when opening fails', async () => {
    backend.addComment(bob, review)
    const { user } = await open()
    const panel = await openPanel(user)
    backend.failRpc('open_notification', 'down')

    await user.click(row(panel, /bob commented/))

    expect((await panel.findByRole('alert')).textContent).toBe(OPEN_ERROR)
    expect(window.location.hash).toBe('#/home')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(unread(row(panel, /bob commented/))).toBe(true)
  })
})

describe('friend request notifications', () => {
  it('open the Friends page', async () => {
    backend.addFriendship(bob, alice, 'pending')
    const { user } = await open()
    const panel = await openPanel(user)

    await user.click(row(panel, /bob sent you a friend request/))

    await screen.findByRole('heading', { level: 1, name: 'Friends' })
    expect(window.location.hash).toBe('#/friends')
  })

  it('say the request is no longer pending when it was cancelled first', async () => {
    backend.addFriendship(bob, alice, 'pending')
    const { user } = await open()
    await waitFor(() => expect(badgeText()).toBe('1'))
    backend.friendships = []
    const panel = await openPanel(user)

    await user.click(await panel.findByRole('button', { name: /bob sent you a friend request/ }))

    expect(within(await screen.findByRole('dialog')).getByText(GONE_REQUEST)).toBeTruthy()
    expect(window.location.hash).toBe('#/home')
  })

  it('are marked read when you accept the request on the Friends page', async () => {
    backend.addFriendship(bob, alice, 'pending')
    const { user } = await open({ hash: '#/friends' })
    const requestRow = (await screen.findByRole('link', { name: 'bob' })).closest('li')
    await user.click(within(requestRow).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(backend.friendships[0].status).toBe('accepted'))

    const panel = await openPanel(user)

    await waitFor(() => expect(unread(row(panel, /bob sent you a friend request/))).toBe(false))
    expect(backend.notifications[0].read_at).not.toBeNull()
  })

  it('still count as pending requests on the Profile button', async () => {
    backend.addFriendship(bob, alice, 'pending')
    await open()
    expect(await screen.findByLabelText('1 pending friend request')).toBeTruthy()
  })
})

describe('Movie Blend invite notifications', () => {
  let blend

  beforeEach(() => {
    blend = backend.addBlend(bob)
  })

  it('open the Movie Blend page', async () => {
    backend.addBlendInvite(blend, bob, alice)
    const { user } = await open()
    const panel = await openPanel(user)

    await user.click(row(panel, /bob invited you to a Movie Blend/))

    await waitFor(() => expect(window.location.hash).toBe('#/blends'))
  })

  it.each([
    ['declined', (invite) => backend.setBlendInviteStatus(invite, 'declined')],
    ['accepted', (invite) => backend.setBlendInviteStatus(invite, 'accepted')],
    ['expired', (invite) => { invite.expires_at = new Date(Date.now() - 1000).toISOString() }],
  ])('say the request is no longer pending when the invite was %s', async (_name, change) => {
    const invite = backend.addBlendInvite(blend, bob, alice)
    const { user } = await open()
    await waitFor(() => expect(badgeText()).toBe('1'))
    change(invite)
    const panel = await openPanel(user)

    await user.click(await panel.findByRole('button', { name: /bob invited you/ }))

    expect(within(await screen.findByRole('dialog')).getByText(GONE_REQUEST)).toBeTruthy()
    expect(window.location.hash).toBe('#/home')
  })
})
