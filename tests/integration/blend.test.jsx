// Movie Blend's front door: a teaser while logged out, and an empty state that
// explains the feature and shows progress while creating a blend is locked.

import { beforeEach, describe, expect, it } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, launch, ready, screen, within } from './helpers/harness.js'

const ids = (n) => MOVIES.slice(0, n).map((m) => m.id)
const nav = () => within(screen.getByRole('navigation', { name: 'Main' }))

let backend
let alice

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
})

describe('Movie Blend, logged out', () => {
  it('stays in the nav and explains what a blend is', async () => {
    const { user } = await launch({ backend })
    await ready({ loggedIn: false })

    await user.click(nav().getByRole('button', { name: /^Movie Blend/ }))

    expect(await screen.findByRole('heading', { name: 'Find a movie your whole group will like' })).toBeTruthy()
    expect(screen.getByText(/Blend your rankings with up to 4 friends/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Log in to start ranking' })).toBeNull()
    const prompt = screen.getByRole('heading', { name: /whole group/ }).closest('section')
    expect(within(prompt).getByRole('button', { name: 'Log in' })).toBeTruthy()
    expect(within(prompt).getByRole('button', { name: 'Create an account' })).toBeTruthy()
  })
})

describe('Movie Blend, logged in with too few rankings', () => {
  it('shows progress on the nav link and an empty state instead of "Your blends: 0"', async () => {
    backend.seedList(alice, ids(6))
    await launch({ backend, as: alice, hash: '#/blends' })
    await ready({ loggedIn: true })

    const link = await nav().findByRole('button', { name: /^Movie Blend, 6 of 15/ })
    expect(link.textContent).toContain('6/15')

    expect(await screen.findByRole('heading', { name: 'Rank 15 movies to start a blend' })).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: /creating a blend/ }).getAttribute('aria-valuenow')).toBe('6')
    expect(screen.getByRole('button', { name: 'Rank more movies' })).toBeTruthy()
    expect(screen.getByText(/You can still join a friend's blend/)).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Your blends' })).toBeNull()
  })

  it('drops the badge once 15 movies are ranked', async () => {
    backend.seedList(alice, ids(15))
    await launch({ backend, as: alice, hash: '#/home' })
    await ready({ loggedIn: true })
    const link = await nav().findByRole('button', { name: 'Movie Blend' })
    expect(link.textContent).not.toContain('/15')
  })
})
