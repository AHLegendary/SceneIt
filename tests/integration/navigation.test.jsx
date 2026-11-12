import { beforeEach, describe, expect, it } from 'vitest'
import { FakeBackend, goTo, launch, ready, screen, useMenu, waitFor, within, act } from './helpers/harness.js'

let backend
let alice
let bob
let cara

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
  bob = backend.addUser({ username: 'bob' })
  cara = backend.addUser({ username: 'cara' })
})

const open = (options) => launch({ backend, as: alice, ...options })
const nav = () => within(screen.getByRole('navigation', { name: 'Main' }))
// The menu is always in the page; the `hidden` attribute is what closes it.
const menu = () => document.querySelector('[role="menu"][aria-label="Profile menu"]')

describe('pages in the URL hash', () => {
  it.each([
    ['#/home', { level: 1, name: /welcome to sceneit/i }],
    ['#/leaderboard', { level: 1, name: 'Leaderboard' }],
    ['#/my-list', { level: 1, name: 'My List' }],
    ['#/for-you', { level: 1, name: 'For You' }],
    ['#/friends', { level: 1, name: 'Friends' }],
    ['#/profile', { level: 1, name: 'Alice_99' }],
  ])('opens %s', async (hash, heading) => {
    await open({ hash })
    expect(await screen.findByRole('heading', heading)).toBeTruthy()
  })

  it.each([[''], ['#/'], ['#/nope'], ['#/u/'], ['#/user']])('falls back to the home page for %j', async (hash) => {
    await open({ hash })
    expect(await screen.findByRole('heading', { level: 1, name: /welcome to sceneit/i })).toBeTruthy()
  })

  it('follows the hash when it changes, like the back and forward buttons do', async () => {
    await open({ hash: '#/home' })
    await ready({ loggedIn: true })

    await goTo('#/leaderboard')
    expect(await screen.findByRole('heading', { level: 1, name: 'Leaderboard' })).toBeTruthy()
    await goTo('#/friends')
    expect(await screen.findByRole('heading', { level: 1, name: 'Friends' })).toBeTruthy()
    await goTo('#/home')
    expect(await screen.findByRole('heading', { level: 1, name: /welcome to sceneit/i })).toBeTruthy()
  })
})

describe('header', () => {
  it('has Home and Leaderboard buttons that navigate', async () => {
    const { user } = await open({ hash: '#/home' })
    await ready({ loggedIn: true })

    await user.click(nav().getByRole('button', { name: 'Leaderboard' }))
    expect(window.location.hash).toBe('#/leaderboard')
    expect(await screen.findByRole('heading', { level: 1, name: 'Leaderboard' })).toBeTruthy()

    await user.click(nav().getByRole('button', { name: 'Home' }))
    expect(window.location.hash).toBe('#/home')
  })

  it('marks the current page', async () => {
    await open({ hash: '#/leaderboard' })
    await ready({ loggedIn: true })

    expect(nav().getByRole('button', { name: 'Leaderboard' }).getAttribute('aria-current')).toBe('page')
    expect(nav().getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBeNull()
  })

  it('takes you home from the logo', async () => {
    const { user } = await open({ hash: '#/leaderboard' })
    await ready({ loggedIn: true })

    await user.click(screen.getAllByRole('link', { name: /sceneit/i })[0])

    expect(window.location.hash).toBe('#/home')
  })

  it('shows nothing account-specific until the saved session has been checked', async () => {
    const gate = backend.hold('auth:getSession')
    const { store } = await launch({ backend, hash: '#/home' })
    void store
    // While the session is being checked there is neither a Profile nor a Log in button.
    const holding = backend.callsTo('auth:getSession').length > 0
    if (holding) {
      expect(nav().queryByRole('button', { name: 'Log in' })).toBeNull()
      expect(nav().queryByRole('button', { name: /^profile/i })).toBeNull()
    }
    gate.release()
    await ready({ loggedIn: false })
  })
})

describe('Profile menu', () => {
  it('is closed until you click Profile, then lists the shortcuts and your name', async () => {
    const { user } = await open({ hash: '#/home' })
    await ready({ loggedIn: true })
    const button = screen.getByRole('button', { name: /^profile/i })

    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(menu().hidden).toBe(true)

    await user.click(button)

    expect(button.getAttribute('aria-expanded')).toBe('true')
    const items = within(screen.getByRole('menu', { name: 'Profile menu' }))
    expect(items.getAllByRole('menuitem').map((el) => el.textContent.trim())).toEqual(['Friends', 'My List', 'Rank Movies', 'Bio', 'Log out'])
    expect(items.getByText('Alice_99')).toBeTruthy()
  })

  it.each([
    ['Friends', '#/friends', { level: 1, name: 'Friends' }],
    ['My List', '#/my-list', { level: 1, name: 'My List' }],
    ['Bio', '#/profile', { level: 1, name: 'Alice_99' }],
  ])('takes you to %s and closes', async (label, hash, heading) => {
    const { user } = await open({ hash: '#/home' })
    await ready({ loggedIn: true })

    await useMenu(user, label)

    expect(window.location.hash).toBe(hash)
    expect(await screen.findByRole('heading', heading)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^profile/i }).getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the movie search from Rank Movies', async () => {
    const { user } = await open({ hash: '#/home' })
    await ready({ loggedIn: true })

    await useMenu(user, 'Rank Movies')

    expect(await screen.findByRole('dialog', { name: /rank/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Profile' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('closes with Escape', async () => {
    const { user } = await open({ hash: '#/home' })
    await ready({ loggedIn: true })
    await user.click(screen.getByRole('button', { name: /^profile/i }))

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.getByRole('button', { name: /^profile/i }).getAttribute('aria-expanded')).toBe('false'))
  })

  it('closes when you click elsewhere', async () => {
    const { user } = await open({ hash: '#/home' })
    await ready({ loggedIn: true })
    await user.click(screen.getByRole('button', { name: /^profile/i }))

    await user.pointer({ keys: '[MouseLeft]', target: document.body })

    await waitFor(() => expect(screen.getByRole('button', { name: /^profile/i }).getAttribute('aria-expanded')).toBe('false'))
  })

  it('closes when you click Profile again', async () => {
    const { user } = await open({ hash: '#/home' })
    await ready({ loggedIn: true })
    const button = screen.getByRole('button', { name: /^profile/i })
    await user.click(button)
    await user.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes when the page changes underneath it', async () => {
    const { user } = await open({ hash: '#/home' })
    await ready({ loggedIn: true })
    await user.click(screen.getByRole('button', { name: /^profile/i }))

    await goTo('#/leaderboard')

    await waitFor(() => expect(screen.getByRole('button', { name: /^profile/i }).getAttribute('aria-expanded')).toBe('false'))
  })

  it('stays closed when you come back to the page it was opened on', async () => {
    const { user } = await open({ hash: '#/home' })
    await ready({ loggedIn: true })
    await user.click(screen.getByRole('button', { name: /^profile/i }))
    await goTo('#/leaderboard')
    await waitFor(() => expect(screen.getByRole('button', { name: /^profile/i }).getAttribute('aria-expanded')).toBe('false'))

    await goTo('#/home')

    expect(screen.getByRole('button', { name: /^profile/i }).getAttribute('aria-expanded')).toBe('false')
  })

  it('shows "Logging out…" while logging out', async () => {
    const gate = backend.hold('auth:signOut')
    const { user } = await open({ hash: '#/home' })
    await ready({ loggedIn: true })
    await user.click(screen.getByRole('button', { name: /^profile/i }))

    await user.click(within(screen.getByRole('menu', { name: 'Profile menu' })).getByRole('menuitem', { name: 'Log out' }))

    expect(await screen.findByRole('menuitem', { name: 'Logging out…' })).toBeTruthy()
    await act(async () => gate.release())
    await ready({ loggedIn: false })
  })

  it('counts pending friend requests on the button, and marks Friends in the menu', async () => {
    backend.addFriendship(bob, alice, 'pending')
    backend.addFriendship(cara, alice, 'pending')
    const { user } = await open({ hash: '#/home' })
    await ready({ loggedIn: true })

    const badge = await screen.findByLabelText('2 pending friend requests')
    expect(badge.textContent).toBe('2')

    await user.click(screen.getByRole('button', { name: /^profile/i }))
    const friends = within(screen.getByRole('menu', { name: 'Profile menu' })).getByRole('menuitem', { name: 'Friends' })
    expect(friends.querySelector('.badge--dot')).not.toBeNull()
  })

  it('says "1 pending friend request" in the singular', async () => {
    backend.addFriendship(bob, alice, 'pending')
    await open({ hash: '#/home' })
    expect(await screen.findByLabelText('1 pending friend request')).toBeTruthy()
  })

  it('shows no badge without incoming requests (outgoing ones don\'t count)', async () => {
    backend.addFriendship(alice, bob, 'pending')
    await open({ hash: '#/home' })
    await ready({ loggedIn: true })
    await waitFor(() => expect(backend.callsTo('rpc:get_friendships').length).toBeGreaterThan(0))
    expect(screen.queryByLabelText(/pending friend request/)).toBeNull()
  })
})
