// Issue #38: people couldn't find recommendations or tell how to unlock them.
// The For You link in the top bar shows progress, and ranking the 15th movie
// pops up a notice that takes you there.

import { beforeEach, describe, expect, it } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, launch, ready, screen, skipReview, waitFor, within } from './helpers/harness.js'

const ids = (n) => MOVIES.slice(0, n).map((m) => m.id)
const title = (id) => MOVIES.find((m) => m.id === id).title
const nav = () => within(screen.getByRole('navigation', { name: 'Main' }))
const unlockedDialog = () => screen.queryByRole('dialog', { name: 'Recommendations unlocked!' })

let backend
let alice

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
})

async function open(hash = '#/my-list') {
  const app = await launch({ backend, as: alice, hash })
  await ready({ loggedIn: true })
  return app
}

// Ranks one movie as "Not a fan". The seeded lists are all "Loved it", so no
// head-to-head questions are asked.
async function rankNotAFan(user, id) {
  backend.tmdbKnows(id)
  await user.click(await screen.findByRole('button', { name: 'Rank a movie' }))
  const dialog = await screen.findByRole('dialog', { name: 'Rank a movie' })
  await user.type(within(dialog).getByRole('searchbox', { name: 'Search movies' }), title(id))
  await user.click(await within(dialog).findByRole('button', { name: `Rank ${title(id)}` }))
  await user.click(screen.getByRole('button', { name: /^Not a fan/ }))
  await skipReview(user)
  await waitFor(() => expect(screen.getByRole('button', { name: 'See my list' }).disabled).toBe(false))
}

describe('For You in the top bar', () => {
  it('is hidden when logged out', async () => {
    await launch({ backend })
    await ready({ loggedIn: false })
    expect(nav().queryByRole('button', { name: /^For You/ })).toBeNull()
  })

  it('shows progress toward unlocking while locked, and opens For You', async () => {
    backend.seedList(alice, ids(6))
    const { user } = await open('#/home')

    const link = await nav().findByRole('button', { name: 'For You, locked: 6 of 15 movies ranked' })
    expect(link.textContent).toContain('6/15')
    await user.click(link)
    expect(await screen.findByRole('heading', { level: 1, name: 'For You' })).toBeTruthy()
  })

  it('drops the progress once unlocked', async () => {
    backend.seedList(alice, ids(15))
    await open('#/home')
    const link = await nav().findByRole('button', { name: 'For You' })
    expect(link.textContent).not.toContain('/15')
  })
})

describe('the unlock popup', () => {
  it('appears after ranking the 15th movie, once the result screen closes, and goes to For You', async () => {
    backend.seedList(alice, ids(14))
    const { user } = await open()
    await screen.findByText('14 ranked movies')

    await rankNotAFan(user, ids(15)[14])
    expect(unlockedDialog()).toBeNull() // doesn't cover the ranking result
    await user.click(screen.getByRole('button', { name: 'See my list' }))

    const dialog = await screen.findByRole('dialog', { name: 'Recommendations unlocked!' })
    await user.click(within(dialog).getByRole('button', { name: 'See my picks' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'For You' })).toBeTruthy()
    expect(unlockedDialog()).toBeNull()
  })

  it('can be dismissed with "Later"', async () => {
    backend.seedList(alice, ids(14))
    const { user } = await open()
    await screen.findByText('14 ranked movies')

    await rankNotAFan(user, ids(15)[14])
    await user.click(screen.getByRole('button', { name: 'See my list' }))
    await user.click(await screen.findByRole('button', { name: 'Later' }))
    expect(unlockedDialog()).toBeNull()
  })

  it('does not appear when you log in with 15 or more already ranked', async () => {
    backend.seedList(alice, ids(15))
    await open()
    await screen.findByText('15 ranked movies')
    expect(unlockedDialog()).toBeNull()
  })

  it('does not appear for a ranking that stays below 15', async () => {
    backend.seedList(alice, ids(5))
    const { user } = await open()
    await screen.findByText('5 ranked movies')

    await rankNotAFan(user, ids(6)[5])
    await user.click(screen.getByRole('button', { name: 'See my list' }))
    await screen.findByText('6 ranked movies')
    expect(unlockedDialog()).toBeNull()
  })
})
