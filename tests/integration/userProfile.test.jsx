import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent } from '@testing-library/react'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, goTo, launch, ready, screen, waitFor, within } from './helpers/harness.js'

const ids = (n) => MOVIES.slice(0, n).map((m) => m.id)
const title = (id) => MOVIES.find((m) => m.id === id).title

let backend
let alice
let bob // public, with a bio and pronouns
let dave // private

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
  bob = backend.addUser({ username: 'bob', bio: 'Horror fan.\nBig on the 80s.', pronouns: 'he/him' })
  dave = backend.addUser({ username: 'dave', is_public: false, bio: 'Secret bio', pronouns: 'they/them' })
})

// Opens a page as `as` (alice by default; pass null to be logged out).
async function open(hash, { as = alice } = {}) {
  const app = await launch({ backend, as, hash })
  await ready({ loggedIn: Boolean(as) })
  return app
}
// The status next to the profile card ('Friends', 'Requested'); the hidden Profile menu also says "Friends".
const actionTag = () => document.querySelector('.uprofile__action .friends__tag')?.textContent
const rowTitles = () => [...document.querySelectorAll('.row .row__title')].map((n) => n.textContent)
// The cards in "Recently ranked", newest first (the title text without the year).
const cardTitles = () => [...document.querySelectorAll('.rcard__title')].map((n) => n.firstChild.textContent)
// Sets when a user last ranked a movie, so "recently ranked" order is explicit.
function rankedAt(user, id, iso) {
  backend.rankings.find((r) => r.user_id === user.id && r.movie_id === MOVIES.find((m) => m.id === id).tmdb_id).updated_at = iso
}
const ranks = () => [...document.querySelectorAll('.row .row__rank')].map((n) => n.textContent)

describe("someone else's public profile", () => {
  it('shows their name, pronouns, bio and a way back to Friends', async () => {
    await open('#/u/bob')

    expect(await screen.findByRole('heading', { level: 1, name: 'bob' })).toBeTruthy()
    expect(screen.getByText('he/him')).toBeTruthy()
    expect(screen.getByText(/Horror fan\./).textContent).toBe('Horror fan.\nBig on the 80s.')
    expect(screen.queryByText(/Private profile/)).toBeNull()
    expect(screen.getByRole('link', { name: /Back to Friends/ }).getAttribute('href')).toBe('#/friends')
  })

  it('finds them whatever the capitalization in the URL', async () => {
    await open('#/u/BOB')
    expect(await screen.findByRole('heading', { level: 1, name: 'bob' })).toBeTruthy()
  })

  it('says "No bio yet." when they haven\'t written one, and leaves out missing pronouns', async () => {
    backend.addUser({ username: 'quiet' })
    await open('#/u/quiet')

    expect(await screen.findByText('No bio yet.')).toBeTruthy()
    expect(document.querySelector('.uprofile__pronouns')).toBeNull()
  })

  it('shows an initial in place of a missing profile picture', async () => {
    await open('#/u/bob')
    const img = await waitFor(() => {
      const el = document.querySelector('img.uprofile__avatar')
      expect(el).not.toBeNull()
      return el
    })
    expect(img.getAttribute('src')).toContain(`/profile-media/${bob.id}/avatar`)

    fireEvent.error(img)

    await waitFor(() => expect(document.querySelector('.uprofile__avatar--initial').textContent).toBe('B'))
  })

  it('shows a loading message while it looks them up', async () => {
    const gate = backend.hold('from:profiles:select')
    await launch({ backend, as: alice, hash: '#/u/bob' })
    expect(await screen.findByText('Loading profile…')).toBeTruthy()
    gate.release()
    expect(await screen.findByText(/Horror fan/)).toBeTruthy()
  })

  it('shows an error with a retry when the profile can\'t be loaded', async () => {
    const { user } = await launch({ backend, as: alice, hash: '#/leaderboard' })
    await ready({ loggedIn: true })
    backend.failQuery('profiles', 'select', 'boom', { times: 1 })
    await goTo('#/u/bob')

    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load this profile")
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText(/Horror fan/)).toBeTruthy()
  })
})

describe('their ranked movies', () => {
  it('shows their Top Movie, Top Genre and a recently ranked list, newest first', async () => {
    backend.seedList(bob, ids(3))
    rankedAt(bob, ids(3)[1], '2026-11-03T00:00:00Z')
    rankedAt(bob, ids(3)[0], '2026-11-02T00:00:00Z')
    rankedAt(bob, ids(3)[2], '2026-11-01T00:00:00Z')
    await open('#/u/bob')

    const highlights = within(await screen.findByRole('region', { name: 'Highlights' }))
    expect(highlights.getByText('Top Movie')).toBeTruthy()
    expect(highlights.getByText(title(ids(1)[0]))).toBeTruthy() // their #1
    expect(highlights.getByText('Top Genre')).toBeTruthy()
    await waitFor(() => expect(cardTitles()).toEqual([ids(3)[1], ids(3)[0], ids(3)[2]].map(title)))
    expect(screen.getByRole('link', { name: 'View full list' }).getAttribute('href')).toBe('#/u/bob/my-list')
  })

  it('lets you open their top 10 from View Top 10', async () => {
    backend.seedList(bob, ids(12))
    const { user } = await open('#/u/bob')

    await user.click(await screen.findByRole('button', { name: 'View Top 10' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Top 10' }))
    const cards = [...document.querySelectorAll('.profile-favs__list .rec .rec__title')].map((n) => n.textContent)
    expect(cards).toEqual(ids(10).map((id, i) => `#${i + 1} ${title(id)}`))
    expect(dialog.getByText('10.0 score')).toBeTruthy()

    await user.click(dialog.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('calls the dialog "Top movies" when they have fewer than ten, with years instead of scores', async () => {
    backend.seedList(bob, ids(3))
    const { user } = await open('#/u/bob')

    await user.click(await screen.findByRole('button', { name: 'View Top 10' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Top movies' }))
    expect(dialog.queryByText(/score/)).toBeNull()
    expect(dialog.getByText(`#1 ${title(ids(1)[0])}`)).toBeTruthy()
  })

  it('opens a movie from the top 10 dialog', async () => {
    backend.seedList(bob, ids(3))
    const { user } = await open('#/u/bob')
    await user.click(await screen.findByRole('button', { name: 'View Top 10' }))
    await user.click(await screen.findByText(`#2 ${title(ids(2)[1])}`))

    expect(await screen.findByRole('dialog', { name: new RegExp(title(ids(2)[1])) })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Top movies' })).toBeNull()
  })

  it('says so when they haven\'t ranked anything', async () => {
    await open('#/u/bob')

    expect(await screen.findByText('Nothing ranked yet')).toBeTruthy()
    expect(screen.getByText('Their number one movie shows up here.')).toBeTruthy()
    expect(screen.getByText('No favorite genre yet')).toBeTruthy()
    expect(screen.getByText(/Movies show up here as they're ranked/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start ranking' })).toBeNull() // that's for your own profile
    expect(screen.queryByRole('button', { name: 'View Top 10' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'View full list' })).toBeNull()
    expect(screen.queryByRole('searchbox', { name: 'Search ranked movies' })).toBeNull()
  })

  it('lists tied movies', async () => {
    backend.seedList(bob, [ids(1)[0], { movie: ids(2)[1], tied: true }, ids(3)[2]])
    await open('#/u/bob')

    await waitFor(() => expect(cardTitles()).toHaveLength(3))
    expect(cardTitles().sort()).toEqual(ids(3).map(title).sort())
  })

  it('shows each movie\'s score once they have ranked ten, worked out from their whole list', async () => {
    backend.seedList(bob, ids(12))
    await open('#/u/bob')

    await waitFor(() => expect(cardTitles()).toHaveLength(12))
    const scores = [...document.querySelectorAll('.rcard__score')].map((n) => n.textContent)
    expect(scores).toHaveLength(12)
    expect(scores).toContain('10.0') // their #1
  })

  it('shows no scores below ten movies', async () => {
    backend.seedList(bob, ids(9))
    await open('#/u/bob')

    await waitFor(() => expect(cardTitles()).toHaveLength(9))
    expect(document.querySelector('.rcard__score')).toBeNull()
  })

  it('opens a movie\'s details when you click it', async () => {
    backend.seedList(bob, ids(3))
    const { user } = await open('#/u/bob')
    await waitFor(() => expect(cardTitles()).toHaveLength(3))

    await user.click(screen.getAllByRole('button', { name: new RegExp(`^${title(ids(1)[0])}`) })[0])

    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('shows an error with a retry for the movies without hiding the profile', async () => {
    backend.seedList(bob, ids(3))
    const { user } = await launch({ backend, as: alice, hash: '#/u/bob' })
    await ready({ loggedIn: true })
    await screen.findByText(/Horror fan/)
    // Let the first load finish, so the failure below can only hit the next one.
    await waitFor(() => expect(cardTitles()).toHaveLength(3))
    backend.failQuery('rankings', 'select', 'boom', { times: 1 })
    await goTo('#/leaderboard')
    await goTo('#/u/bob')

    const alert = await screen.findByText("Couldn't load these movies.")
    expect(alert).toBeTruthy()
    expect(screen.getByText(/Horror fan/)).toBeTruthy()
    await user.click(within(alert.closest('[role="alert"]')).getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(cardTitles()).toHaveLength(3))
  })
})

describe('friend status on their profile', () => {
  it('lets you add them, then shows Requested', async () => {
    const { user } = await open('#/u/bob')
    await screen.findByText(/Horror fan/)

    await user.click(await screen.findByRole('button', { name: 'Add friend' }))

    expect((await screen.findByRole('status')).textContent).toBe('Request sent')
    expect(await screen.findByText('Requested')).toBeTruthy()
    expect(backend.friendships).toEqual([expect.objectContaining({ requester_id: alice.id, addressee_id: bob.id, status: 'pending' })])
  })

  it('shows Requested if you already asked', async () => {
    backend.addFriendship(alice, bob, 'pending')
    await open('#/u/bob')
    expect(await screen.findByText('Requested')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add friend' })).toBeNull()
  })

  it('lets you accept their request', async () => {
    backend.addFriendship(bob, alice, 'pending')
    const { user } = await open('#/u/bob')

    await user.click(await screen.findByRole('button', { name: 'Accept request' }))

    expect((await screen.findByRole('status')).textContent).toBe('You and bob are now friends')
    await waitFor(() => expect(actionTag()).toBe('Friends'))
  })

  it('shows Friends for a friend', async () => {
    backend.addFriendship(alice, bob, 'accepted')
    await open('#/u/bob')
    await waitFor(() => expect(actionTag()).toBe('Friends'))
  })

  it('shows an error if the request can\'t be sent', async () => {
    backend.failRpc('send_friend_request', 'boom', { times: 1 })
    const { user } = await open('#/u/bob')

    await user.click(await screen.findByRole('button', { name: 'Add friend' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn't send that request/i)
  })

  it('does not reload in a loop for a friend: it loads once and stays put', async () => {
    backend.addFriendship(alice, bob, 'accepted')
    backend.seedList(bob, ids(6))
    await open('#/u/bob')
    await waitFor(() => expect(cardTitles()).toHaveLength(6))

    // A reload loop keeps asking forever, so the number of reads must stop growing.
    const reads = () => backend.calls.filter((c) => c.key === 'from:profiles:select').length
    await new Promise((r) => setTimeout(r, 300))
    const before = reads()
    await new Promise((r) => setTimeout(r, 400))

    expect(reads()).toBe(before)
    expect(before).toBeLessThan(8)
    expect(cardTitles()).toHaveLength(6)
    expect(screen.queryByText('Loading profile…')).toBeNull()
  })
})

describe('a private profile', () => {
  it('shows only a private notice to someone who isn\'t a friend, and nothing of theirs', async () => {
    backend.seedList(dave, ids(6))
    await open('#/u/dave')

    expect(await screen.findByText('Private profile')).toBeTruthy()
    expect(screen.getByText('This profile is private. Add them as a friend to see their profile.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add friend' })).toBeTruthy()
    expect(screen.queryByText('Secret bio')).toBeNull()
    expect(screen.queryByText('they/them')).toBeNull()
    expect(screen.queryByRole('heading', { name: /Top/ })).toBeNull()
    expect(cardTitles()).toEqual([])
    expect(screen.getByRole('heading', { level: 1, name: 'dave' })).toBeTruthy()
  })

  it('still looks private after you send a request', async () => {
    const { user } = await open('#/u/dave')
    await user.click(await screen.findByRole('button', { name: 'Add friend' }))

    expect(await screen.findByText('Requested')).toBeTruthy()
    expect(screen.getByText('This profile is private. Add them as a friend to see their profile.')).toBeTruthy()
    expect(screen.queryByText('Secret bio')).toBeNull()
  })

  it('opens up as soon as you accept their request', async () => {
    backend.seedList(dave, ids(3))
    backend.addFriendship(dave, alice, 'pending')
    const { user } = await open('#/u/dave')

    await user.click(await screen.findByRole('button', { name: 'Accept request' }))

    expect(await screen.findByText('Secret bio')).toBeTruthy()
    expect(screen.getByText('they/them')).toBeTruthy()
    expect(screen.getByText('Private profile, shared with friends')).toBeTruthy()
    await waitFor(() => expect(cardTitles()).toHaveLength(3))
  })

  it('is fully visible to a friend', async () => {
    backend.addFriendship(alice, dave, 'accepted')
    backend.seedList(dave, ids(7))
    await open('#/u/dave')

    expect(await screen.findByText('Secret bio')).toBeTruthy()
    expect(screen.getByText('Private profile, shared with friends')).toBeTruthy()
    await waitFor(() => expect(cardTitles()).toHaveLength(7))
    expect(screen.getByRole('link', { name: 'View full list' })).toBeTruthy()
  })

  it('hides again if the friendship is removed', async () => {
    backend.addFriendship(alice, dave, 'accepted')
    const { user } = await open('#/u/dave')
    await screen.findByText('Secret bio')
    backend.friendships.length = 0
    await goTo('#/friends')
    await goTo('#/u/dave')

    expect(await screen.findByText('This profile is private. Add them as a friend to see their profile.')).toBeTruthy()
    void user
  })
})

describe('when you are not logged in', () => {
  it('lets you read a public profile, and asks you to log in to add friends', async () => {
    backend.seedList(bob, ids(3))
    const { user } = await open('#/u/bob', { as: null })

    expect(await screen.findByText(/Horror fan/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Back to Friends/ })).toBeNull()
    await waitFor(() => expect(cardTitles()).toHaveLength(3))

    await user.click(screen.getByRole('button', { name: 'Log in to add friends' }))
    expect(window.location.hash).toBe('#/login')
  })

  it('can\'t tell a private profile from one that doesn\'t exist', async () => {
    await open('#/u/dave', { as: null })
    const privateMessage = (await screen.findByText(/This profile is private, or the user doesn't exist/)).textContent
    expect(privateMessage).toBe("This profile is private, or the user doesn't exist. Log in to find out and to add friends.")
    expect(screen.queryByText('Secret bio')).toBeNull()

    await goTo('#/u/nobody_here')
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'nobody_here' })).toBeTruthy())
    expect(screen.getByText(/This profile is private, or the user doesn't exist/).textContent).toBe(privateMessage)
    expect(backend.callsTo('rpc:search_users')).toHaveLength(0)
  })

  it('sends you to log in from the private message', async () => {
    const { user } = await open('#/u/dave', { as: null })
    await screen.findByText(/This profile is private, or the user doesn't exist/)

    const card = screen.getByText(/This profile is private, or/).closest('.uprofile')
    await user.click(within(card).getByRole('button', { name: 'Log in' }))

    expect(window.location.hash).toBe('#/login')
  })
})

describe('unusual addresses', () => {
  it('says nobody has that username', async () => {
    await open('#/u/nobody_here')
    expect(await screen.findByText('No one on SceneIt goes by that username.')).toBeTruthy()
  })

  it('doesn\'t look up a username that can\'t exist', async () => {
    await open('#/u/ab')
    expect(await screen.findByText('No one on SceneIt goes by that username.')).toBeTruthy()
    expect(backend.callsTo('rpc:search_users')).toHaveLength(0)
  })

  it('sends you to your own Profile page when the username is yours', async () => {
    await open('#/u/alice_99')
    await waitFor(() => expect(window.location.hash).toBe('#/profile'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Alice_99' })).toBeTruthy()
  })

  it('shows the Friends page link back, and follows it', async () => {
    const { user } = await open('#/u/bob')
    await user.click(await screen.findByRole('link', { name: /Back to Friends/ }))
    expect(window.location.hash).toBe('#/friends')
    expect(await screen.findByRole('heading', { level: 1, name: 'Friends' })).toBeTruthy()
  })

  it('opens from a username on the Friends page', async () => {
    backend.addFriendship(alice, bob, 'accepted')
    const { user } = await open('#/friends')
    await user.click(await screen.findByRole('link', { name: 'bob' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'bob' })).toBeTruthy()
    expect(window.location.hash).toBe('#/u/bob')
  })
})

describe("someone else's full list", () => {
  it('shows every movie in order with a count and a way back to their profile', async () => {
    backend.seedList(bob, ids(8))
    await open('#/u/bob/my-list')

    expect(await screen.findByRole('heading', { level: 1, name: "bob's list" })).toBeTruthy()
    expect(await screen.findByText('8 ranked movies')).toBeTruthy()
    expect(rowTitles()).toEqual(ids(8).map(title))
    expect(ranks()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(screen.getByRole('link', { name: "← Back to bob's profile" }).getAttribute('href')).toBe('#/u/bob')
  })

  it('says "1 ranked movie" in the singular', async () => {
    backend.seedList(bob, ids(1))
    await open('#/u/bob/my-list')
    expect(await screen.findByText('1 ranked movie')).toBeTruthy()
  })

  it('says so when the list is empty', async () => {
    await open('#/u/bob/my-list')
    expect(await screen.findByText('No ranked movies yet.')).toBeTruthy()
    expect(rowTitles()).toEqual([])
  })

  it('shows scores once they have ranked ten', async () => {
    backend.seedList(bob, ids(12))
    await open('#/u/bob/my-list')
    await waitFor(() => expect(rowTitles()).toHaveLength(12))
    expect(screen.getAllByText('score')).toHaveLength(12)
  })

  it('groups ties', async () => {
    backend.seedList(bob, [ids(1)[0], { movie: ids(2)[1], tied: true }, ids(3)[2]])
    await open('#/u/bob/my-list')
    await waitFor(() => expect(rowTitles()).toHaveLength(3))
    expect(ranks()).toEqual(['1', '1', '3'])
  })

  it('opens a movie\'s details', async () => {
    backend.seedList(bob, ids(2))
    const { user } = await open('#/u/bob/my-list')
    await waitFor(() => expect(rowTitles()).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: title(ids(1)[0]) }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('shows a loading message, then the list', async () => {
    backend.seedList(bob, ids(2))
    const gate = backend.hold('from:rankings:select')
    await launch({ backend, as: alice, hash: '#/u/bob/my-list' })
    expect(await screen.findByText('Loading list…')).toBeTruthy()
    gate.release()
    await waitFor(() => expect(rowTitles()).toHaveLength(2))
  })

  it('offers a retry when the list can\'t be loaded', async () => {
    backend.seedList(bob, ids(2))
    const { user } = await launch({ backend, as: alice, hash: '#/friends' })
    await ready({ loggedIn: true })
    backend.failQuery('rankings', 'select', 'boom', { times: 1 })
    await goTo('#/u/bob/my-list')

    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(rowTitles()).toHaveLength(2))
  })

  it('is private for someone who isn\'t a friend, and offers Add friend', async () => {
    backend.seedList(dave, ids(4))
    await open('#/u/dave/my-list')

    expect(await screen.findByText('This list is private. Add them as a friend to see their list.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add friend' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: "dave's list" })).toBeTruthy()
    expect(rowTitles()).toEqual([])
  })

  it('shows a friend\'s private list', async () => {
    backend.addFriendship(alice, dave, 'accepted')
    backend.seedList(dave, ids(4))
    await open('#/u/dave/my-list')
    await waitFor(() => expect(rowTitles()).toEqual(ids(4).map(title)))
  })

  it('opens up when you accept their request', async () => {
    backend.addFriendship(dave, alice, 'pending')
    backend.seedList(dave, ids(2))
    const { user } = await open('#/u/dave/my-list')

    await user.click(await screen.findByRole('button', { name: 'Accept request' }))

    await waitFor(() => expect(rowTitles()).toHaveLength(2))
  })

  it('is open to logged-out visitors for a public profile', async () => {
    backend.seedList(bob, ids(3))
    await open('#/u/bob/my-list', { as: null })
    await waitFor(() => expect(rowTitles()).toHaveLength(3))
  })

  it('tells logged-out visitors a private list is private or missing', async () => {
    await open('#/u/dave/my-list', { as: null })
    expect(await screen.findByText("This list is private, or the user doesn't exist. Log in to find out and to add friends.")).toBeTruthy()
    expect(rowTitles()).toEqual([])
  })

  it('says nobody has that username', async () => {
    await open('#/u/nobody_here/my-list')
    expect(await screen.findByText('No one on SceneIt goes by that username.')).toBeTruthy()
  })

  it('sends you to your own My List when the username is yours', async () => {
    await open('#/u/Alice_99/my-list')
    await waitFor(() => expect(window.location.hash).toBe('#/my-list'))
    expect(await screen.findByRole('heading', { level: 1, name: 'My List' })).toBeTruthy()
  })

  it('is reached from "View all" on their profile', async () => {
    backend.seedList(bob, ids(8))
    const { user } = await open('#/u/bob')
    await user.click(await screen.findByRole('link', { name: 'View full list' }))

    expect(window.location.hash).toBe('#/u/bob/my-list')
    expect(await screen.findByText('8 ranked movies')).toBeTruthy()
  })
})
