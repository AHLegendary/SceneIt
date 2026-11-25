// Movie Blend's list page: creating a blend and answering invites.

import { beforeEach, describe, expect, it } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, launch, ready, screen, waitFor, within } from './helpers/harness.js'

const ids = (n) => MOVIES.slice(0, n).map((m) => m.id)

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

async function open({ ranked = 15, friends = [bob, cara] } = {}) {
  backend.seedList(alice, ids(ranked))
  for (const f of friends) backend.addFriendship(alice, f)
  const app = await launch({ backend, as: alice, hash: '#/blends' })
  await ready({ loggedIn: true })
  return app
}

describe('creating a blend', () => {
  it('invites the picked friends and opens the new blend', async () => {
    const { user } = await open()
    await user.click((await screen.findAllByRole('button', { name: 'New blend' }))[0])
    const form = screen.getByRole('heading', { name: 'New blend' }).closest('form')
    const submit = within(form).getByRole('button', { name: 'Create and invite' })
    expect(submit.disabled).toBe(true)

    await user.click(within(form).getByRole('checkbox', { name: /bob/ }))
    expect(submit.disabled).toBe(false)
    await user.click(submit)

    await waitFor(() => expect(window.location.hash).toMatch(/^#\/blends\/.+/))
    expect(backend.blends).toHaveLength(1)
    expect(backend.blend_invites).toEqual([expect.objectContaining({ invitee_id: bob.id, status: 'pending' })])
  })

  it('can be cancelled without creating anything', async () => {
    const { user } = await open()
    await user.click((await screen.findAllByRole('button', { name: 'New blend' }))[0])
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'New blend' })).toBeNull()
    expect(backend.blends).toHaveLength(0)
  })

  it('shows the error and offers "Try again" when creating fails', async () => {
    backend.failRpc('create_blend', 'boom', { times: 1 })
    const { user } = await open()
    await user.click((await screen.findAllByRole('button', { name: 'New blend' }))[0])
    await user.click(screen.getByRole('checkbox', { name: /bob/ }))
    await user.click(screen.getByRole('button', { name: 'Create and invite' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Couldn't create the blend")
    expect(backend.blends).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(backend.blends).toHaveLength(1))
  })

  it('points to Find friends when you have none', async () => {
    await open({ friends: [] })
    expect(await screen.findByText('You need at least one friend to create a blend.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Find friends' }).getAttribute('href')).toBe('#/friends')
    expect(screen.queryByRole('button', { name: 'New blend' })).toBeNull()
  })
})

describe('invites', () => {
  function invite() {
    const id = backend.addBlend(bob)
    return backend.addBlendInvite(id, bob, alice)
  }

  it('lists a pending invite and joins on Accept', async () => {
    const inv = invite()
    const { user } = await open({ ranked: 0, friends: [] })
    const section = within(await screen.findByRole('region', { name: 'Invites' }))
    expect(section.getByText('bob invited you')).toBeTruthy()

    await user.click(section.getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(window.location.hash).toBe(`#/blends/${inv.blend_id}`))
    expect(backend.isBlendMember(alice.id, inv.blend_id)).toBe(true)
  })

  it('drops the invite on Decline and stays on the page', async () => {
    const inv = invite()
    const { user } = await open({ ranked: 0, friends: [] })
    const section = within(await screen.findByRole('region', { name: 'Invites' }))

    await user.click(section.getByRole('button', { name: 'Decline' }))

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Invites' })).toBeNull())
    expect(backend.isBlendMember(alice.id, inv.blend_id)).toBe(false)
    expect(window.location.hash).toBe('#/blends')
  })

  it('retries after a connection failure', async () => {
    invite()
    backend.failRpc('respond_to_blend_invite', 'boom', { times: 1 })
    const { user } = await open({ ranked: 0, friends: [] })
    await user.click(await screen.findByRole('button', { name: 'Accept' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Couldn't answer that invite")
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/blends\/.+/))
  })

  it('explains a full blend with Dismiss, no retry', async () => {
    const inv = invite()
    for (const n of ['d', 'e', 'f']) {
      backend.blend_members.push({ blend_id: inv.blend_id, user_id: backend.addUser({ username: n }).id, joined_at: backend.now() })
    }
    backend.blend_members.push({ blend_id: inv.blend_id, user_id: cara.id, joined_at: backend.now() })
    const { user } = await open({ ranked: 0, friends: [] })
    await user.click(await screen.findByRole('button', { name: 'Accept' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('This blend is full')
    expect(within(alert).queryByRole('button', { name: 'Try again' })).toBeNull()
    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
