import { beforeEach, describe, expect, it } from 'vitest'
import { FakeBackend, launch, ready, screen, waitFor, within } from './helpers/harness.js'

const LOAD_ERROR = "Couldn't load your friends. Check your connection and try again."
const SEARCH_ERROR = "Couldn't search for users. Check your connection and try again."
const SEND_ERROR = "Couldn't send that request. Check your connection and try again."
const ACCEPT_ERROR = "Couldn't accept that request. It may have been cancelled."
const REMOVE_ERROR = "Couldn't update your friends. Check your connection and try again."

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
  dave = backend.addUser({ username: 'dave', is_public: false })
})

const open = async (options) => {
  const app = await launch({ backend, as: alice, hash: '#/friends', ...options })
  await ready({ loggedIn: true })
  return app
}
const row = (name) => screen.getByRole('link', { name }).closest('li')
const section = (name) => within(screen.getByRole('region', { name }))
const search = () => screen.getByRole('searchbox', { name: 'Search usernames' })

// A friendship created `minutes` ago (the fake's clock is only used for ordering).
function friendshipAt(from, to, status, minutes) {
  backend.friendships.push({ requester_id: from.id, addressee_id: to.id, status, created_at: new Date(Date.now() - minutes * 60000).toISOString() })
}

describe('the page', () => {
  it('shows a loading message, then the lists', async () => {
    const gate = backend.hold('rpc:get_friendships')
    await open()
    expect(await screen.findByText('Loading your friends…')).toBeTruthy()
    gate.release()
    expect(await screen.findByText(/No friends yet/)).toBeTruthy()
    expect(screen.queryByText('Loading your friends…')).toBeNull()
  })

  it('explains an empty list', async () => {
    await open()
    expect(await screen.findByText("No friends yet. Search for someone's username above to send a request.")).toBeTruthy()
    expect(section('Your friends').getByText('0')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Requests' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Sent requests' })).toBeNull()
  })

  it('lists friends alphabetically, with when you became friends', async () => {
    backend.addFriendship(alice, cara, 'accepted')
    backend.addFriendship(bob, alice, 'accepted')
    await open()

    const names = (await section('Your friends').findAllByRole('link')).map((a) => a.textContent)
    expect(names).toEqual(['bob', 'cara'])
    expect(section('Your friends').getByText('2')).toBeTruthy()
    expect(within(row('bob')).getByText(/^Friends since /)).toBeTruthy()
  })

  it('lists incoming and outgoing requests in their own sections', async () => {
    backend.addFriendship(bob, alice, 'pending')
    backend.addFriendship(alice, cara, 'pending')
    await open()

    expect(await section('Requests').findByRole('link', { name: 'bob' })).toBeTruthy()
    expect(section('Sent requests').getByRole('link', { name: 'cara' })).toBeTruthy()
    expect(within(row('bob')).getByRole('button', { name: 'Accept' })).toBeTruthy()
    expect(within(row('bob')).getByRole('button', { name: 'Decline' })).toBeTruthy()
    expect(within(row('cara')).getByRole('button', { name: 'Cancel request' })).toBeTruthy()
  })

  it('says how long ago a request was made', async () => {
    friendshipAt(bob, alice, 'pending', 0)
    friendshipAt(cara, alice, 'pending', 5)
    friendshipAt(dave, alice, 'pending', 3 * 60)
    const erin = backend.addUser({ username: 'erin' })
    const finn = backend.addUser({ username: 'finn' })
    friendshipAt(erin, alice, 'pending', 2 * 24 * 60)
    friendshipAt(finn, alice, 'pending', 20 * 24 * 60)
    await open()

    await screen.findByRole('link', { name: 'bob' })
    expect(within(row('bob')).getByText('Asked just now')).toBeTruthy()
    expect(within(row('cara')).getByText('Asked 5 min ago')).toBeTruthy()
    expect(within(row('dave')).getByText('Asked 3 hr ago')).toBeTruthy()
    expect(within(row('erin')).getByText('Asked 2 days ago')).toBeTruthy()
    expect(within(row('finn')).getByText(/^Asked on /)).toBeTruthy()
  })

  it('links every username to that person\'s profile', async () => {
    backend.addFriendship(alice, bob, 'accepted')
    await open()
    expect((await screen.findByRole('link', { name: 'bob' })).getAttribute('href')).toBe('#/u/bob')
  })

  it('shows an error with a retry when the list can\'t be loaded', async () => {
    backend.failRpc('get_friendships', 'boom', { times: 1 })
    backend.addFriendship(alice, bob, 'accepted')
    const { user } = await open()

    expect((await screen.findByRole('alert')).textContent).toContain(LOAD_ERROR)
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('link', { name: 'bob' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('answering requests', () => {
  it('accepts a request and moves them to your friends', async () => {
    backend.addFriendship(bob, alice, 'pending')
    const { user } = await open()
    await screen.findByRole('link', { name: 'bob' })

    await user.click(within(row('bob')).getByRole('button', { name: 'Accept' }))

    expect((await screen.findByRole('status')).textContent).toContain('You and bob are now friends')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Requests' })).toBeNull())
    expect(section('Your friends').getByRole('link', { name: 'bob' })).toBeTruthy()
    expect(backend.friendships[0].status).toBe('accepted')
  })

  it('tells you when the request was cancelled before you accepted it', async () => {
    backend.addFriendship(bob, alice, 'pending')
    const { user } = await open()
    await screen.findByRole('link', { name: 'bob' })
    backend.friendships.length = 0 // bob cancelled in the meantime

    await user.click(within(row('bob')).getByRole('button', { name: 'Accept' }))

    expect((await screen.findByRole('alert')).textContent).toContain(ACCEPT_ERROR)
    await waitFor(() => expect(screen.queryByRole('link', { name: 'bob' })).toBeNull())
  })

  it('declines a request quietly', async () => {
    backend.addFriendship(bob, alice, 'pending')
    const { user } = await open()
    await screen.findByRole('link', { name: 'bob' })

    await user.click(within(row('bob')).getByRole('button', { name: 'Decline' }))

    await waitFor(() => expect(screen.queryByRole('link', { name: 'bob' })).toBeNull())
    expect(backend.friendships).toHaveLength(0)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('cancels a request you sent', async () => {
    backend.addFriendship(alice, cara, 'pending')
    const { user } = await open()
    await screen.findByRole('link', { name: 'cara' })

    await user.click(within(row('cara')).getByRole('button', { name: 'Cancel request' }))

    await waitFor(() => expect(screen.queryByRole('link', { name: 'cara' })).toBeNull())
    expect(backend.friendships).toHaveLength(0)
  })

  it('disables a row\'s buttons while it is being updated', async () => {
    backend.addFriendship(bob, alice, 'pending')
    const gate = backend.hold('from:friendships:update')
    const { user } = await open()
    await screen.findByRole('link', { name: 'bob' })

    await user.click(within(row('bob')).getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(within(row('bob')).getByRole('button', { name: 'Decline' }).disabled).toBe(true))
    gate.release()
    await screen.findByRole('status')
  })

  it('shows an error when declining fails, and keeps the request', async () => {
    backend.addFriendship(bob, alice, 'pending')
    backend.failQuery('friendships', 'delete', 'boom', { times: 1 })
    const { user } = await open()
    await screen.findByRole('link', { name: 'bob' })

    await user.click(within(row('bob')).getByRole('button', { name: 'Decline' }))

    expect((await screen.findByRole('alert')).textContent).toContain(REMOVE_ERROR)
    expect(screen.getByRole('link', { name: 'bob' })).toBeTruthy()
  })
})

describe('removing a friend', () => {
  it('asks you to confirm, and Keep backs out', async () => {
    backend.addFriendship(alice, bob, 'accepted')
    const { user } = await open()
    await screen.findByRole('link', { name: 'bob' })

    await user.click(within(row('bob')).getByRole('button', { name: 'Remove friend' }))
    expect(within(row('bob')).getByRole('button', { name: 'Remove' })).toBeTruthy()

    await user.click(within(row('bob')).getByRole('button', { name: 'Keep' }))
    expect(within(row('bob')).getByRole('button', { name: 'Remove friend' })).toBeTruthy()
    expect(backend.friendships).toHaveLength(1)
  })

  it('removes the friend once confirmed', async () => {
    backend.addFriendship(alice, bob, 'accepted')
    const { user } = await open()
    await screen.findByRole('link', { name: 'bob' })

    await user.click(within(row('bob')).getByRole('button', { name: 'Remove friend' }))
    await user.click(within(row('bob')).getByRole('button', { name: 'Remove' }))

    expect((await screen.findByRole('status')).textContent).toContain('Removed bob from your friends')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'bob' })).toBeNull())
    expect(await screen.findByText(/No friends yet/)).toBeTruthy()
    expect(backend.friendships).toHaveLength(0)
  })

  it('shows an error when removing fails, and keeps the friend', async () => {
    backend.addFriendship(alice, bob, 'accepted')
    backend.failQuery('friendships', 'delete', 'boom', { times: 1 })
    const { user } = await open()
    await screen.findByRole('link', { name: 'bob' })

    await user.click(within(row('bob')).getByRole('button', { name: 'Remove friend' }))
    await user.click(within(row('bob')).getByRole('button', { name: 'Remove' }))

    expect((await screen.findByRole('alert')).textContent).toContain(REMOVE_ERROR)
    expect(backend.friendships).toHaveLength(1)
  })

  it('lets you dismiss the message', async () => {
    backend.addFriendship(alice, bob, 'accepted')
    const { user } = await open()
    await screen.findByRole('link', { name: 'bob' })
    await user.click(within(row('bob')).getByRole('button', { name: 'Remove friend' }))
    await user.click(within(row('bob')).getByRole('button', { name: 'Remove' }))
    await screen.findByRole('status')

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('finding people', () => {
  it('asks for at least two characters and doesn\'t search yet', async () => {
    const { user } = await open()
    await user.type(search(), 'b')

    expect(await screen.findByText('Keep typing, at least 2 characters.')).toBeTruthy()
    await new Promise((r) => setTimeout(r, 400))
    expect(backend.callsTo('rpc:search_users')).toHaveLength(0)
  })

  it('shows "Searching…" and then the matches', async () => {
    const gate = backend.hold('rpc:search_users')
    const { user } = await open()
    await user.type(search(), 'bo')

    expect(await screen.findByText('Searching…')).toBeTruthy()
    gate.release()

    const results = await screen.findByRole('list', { name: 'Search results' })
    expect(within(results).getByRole('link', { name: 'bob' })).toBeTruthy()
    expect(within(results).getByRole('button', { name: 'Add friend' })).toBeTruthy()
  })

  it('searches once after you stop typing, not on every key', async () => {
    const { user } = await open()
    await user.type(search(), 'bob')
    await screen.findByRole('list', { name: 'Search results' })

    expect(backend.callsTo('rpc:search_users')).toHaveLength(1)
    expect(backend.callsTo('rpc:search_users')[0].args).toEqual({ q: 'bob' })
  })

  it('matches the start of a username, ignoring capitalization', async () => {
    const { user } = await open()
    await user.type(search(), 'CA')

    expect(await within(await screen.findByRole('list', { name: 'Search results' })).findByRole('link', { name: 'cara' })).toBeTruthy()
  })

  it('leaves you out of your own results', async () => {
    const { user } = await open()
    await user.type(search(), 'al')

    expect(await screen.findByText(/No one with a username starting with/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Alice_99' })).toBeNull()
  })

  it('finds users with private profiles too', async () => {
    const { user } = await open()
    await user.type(search(), 'da')

    expect(await within(await screen.findByRole('list', { name: 'Search results' })).findByRole('link', { name: 'dave' })).toBeTruthy()
  })

  it('says when nobody matches', async () => {
    const { user } = await open()
    await user.type(search(), 'zz')

    expect(await screen.findByText('No one with a username starting with “zz”.')).toBeTruthy()
  })

  it('shows an error if the search fails', async () => {
    backend.failRpc('search_users', 'boom')
    const { user } = await open()
    await user.type(search(), 'bo')

    expect((await screen.findByRole('alert')).textContent).toBe(SEARCH_ERROR)
  })

  it('clears the results when you delete the text', async () => {
    const { user } = await open()
    await user.type(search(), 'bo')
    await screen.findByRole('list', { name: 'Search results' })

    await user.clear(search())

    await waitFor(() => expect(screen.queryByRole('list', { name: 'Search results' })).toBeNull())
  })

  it('sends a request, shows it as Requested, and moves them to Sent requests', async () => {
    const { user } = await open()
    await user.type(search(), 'bob')
    const results = await screen.findByRole('list', { name: 'Search results' })

    await user.click(within(results).getByRole('button', { name: 'Add friend' }))

    expect((await screen.findByRole('status')).textContent).toContain('bob: Request sent')
    expect(await within(screen.getByRole('list', { name: 'Search results' })).findByText('Requested')).toBeTruthy()
    expect(await section('Sent requests').findByRole('link', { name: 'bob' })).toBeTruthy()
    expect(backend.friendships).toEqual([expect.objectContaining({ requester_id: alice.id, addressee_id: bob.id, status: 'pending' })])
  })

  it('shows "Sending…" while the request is on its way', async () => {
    const gate = backend.hold('rpc:send_friend_request')
    const { user } = await open()
    await user.type(search(), 'bob')
    const results = await screen.findByRole('list', { name: 'Search results' })

    await user.click(within(results).getByRole('button', { name: 'Add friend' }))

    const sending = await within(results).findByRole('button', { name: 'Sending…' })
    expect(sending.disabled).toBe(true)
    gate.release()
    await screen.findByRole('status')
  })

  it('shows an error if the request fails', async () => {
    backend.failRpc('send_friend_request', 'boom', { times: 1 })
    const { user } = await open()
    await user.type(search(), 'bob')
    const results = await screen.findByRole('list', { name: 'Search results' })

    await user.click(within(results).getByRole('button', { name: 'Add friend' }))

    expect((await screen.findByRole('alert')).textContent).toContain(SEND_ERROR)
    expect(backend.friendships).toHaveLength(0)
  })

  it('shows how you\'re already connected to each result', async () => {
    backend.addFriendship(alice, bob, 'accepted')
    backend.addFriendship(alice, cara, 'pending')
    const erin = backend.addUser({ username: 'ea_incoming' })
    backend.addFriendship(erin, alice, 'pending')
    const { user } = await open()
    await screen.findByRole('link', { name: 'bob' })

    await user.type(search(), 'b')
    await user.clear(search())
    await user.type(search(), 'bo')
    const results = await screen.findByRole('list', { name: 'Search results' })
    expect(within(results).getByText('Friends')).toBeTruthy()

    await user.clear(search())
    await user.type(search(), 'ca')
    expect(await within(await screen.findByRole('list', { name: 'Search results' })).findByText('Requested')).toBeTruthy()

    await user.clear(search())
    await user.type(search(), 'ea')
    const incoming = await screen.findByRole('list', { name: 'Search results' })
    expect(await within(incoming).findByRole('button', { name: 'Accept request' })).toBeTruthy()
  })

  it('accepts their request straight from the search results', async () => {
    backend.addFriendship(bob, alice, 'pending')
    const { user } = await open()
    await screen.findByRole('link', { name: 'bob' })
    await user.type(search(), 'bo')
    const results = await screen.findByRole('list', { name: 'Search results' })

    await user.click(within(results).getByRole('button', { name: 'Accept request' }))

    expect((await screen.findByRole('status')).textContent).toContain('You and bob are now friends')
    expect(backend.friendships[0].status).toBe('accepted')
  })

  it('reports what really happened when your list was out of date', async () => {
    const { user } = await open()
    await screen.findByText(/No friends yet/)

    // bob asks you after the page loaded: sending him a request accepts his instead.
    backend.addFriendship(bob, alice, 'pending')
    await user.type(search(), 'bob')
    await user.click(within(await screen.findByRole('list', { name: 'Search results' })).getByRole('button', { name: 'Add friend' }))
    expect((await screen.findByRole('status')).textContent).toContain("They'd already asked you, so you're now friends")
  })

  it.each([
    ['already_sent', 'cara: Request already sent', (b, a, other) => b.addFriendship(a, other, 'pending')],
    ['already_friends', "cara: You're already friends", (b, a, other) => b.addFriendship(a, other, 'accepted')],
  ])('reports "%s" when the request had already been made elsewhere', async (_key, message, seed) => {
    const { user } = await open()
    await screen.findByText(/No friends yet/)
    seed(backend, alice, cara)

    await user.type(search(), 'cara')
    await user.click(within(await screen.findByRole('list', { name: 'Search results' })).getByRole('button', { name: 'Add friend' }))

    expect((await screen.findByRole('status')).textContent).toContain(message)
  })
})

describe('what the other person sees', () => {
  it('shows your request to them, with Accept and Decline', async () => {
    const mine = await open()
    await mine.user.type(search(), 'bob')
    await mine.user.click(within(await screen.findByRole('list', { name: 'Search results' })).getByRole('button', { name: 'Add friend' }))
    await screen.findByRole('status')

    const asBob = backend.getFriendships(bob.id)
    expect(asBob).toEqual([expect.objectContaining({ username: 'Alice_99', direction: 'incoming' })])
  })
})
