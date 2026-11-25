// A single blend's page: members, inviting (owner only) and leaving.

import { beforeEach, describe, expect, it } from 'vitest'
import { FakeBackend, launch, ready, screen, waitFor, within } from './helpers/harness.js'

let backend
let alice
let bob
let cara
let blendId

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
  bob = backend.addUser({ username: 'bob' })
  cara = backend.addUser({ username: 'cara' })
  backend.addFriendship(alice, bob)
  backend.addFriendship(alice, cara)
  blendId = backend.addBlend(alice, [bob])
})

async function openBlend(as = alice, id = blendId) {
  const app = await launch({ backend, as, hash: `#/blends/${id}` })
  await ready({ loggedIn: true })
  return app
}
const region = (name) => within(screen.getByRole('region', { name }))

describe('members', () => {
  it('lists everyone and marks the owner', async () => {
    await openBlend()
    const members = within(await screen.findByRole('region', { name: 'Members' }))
    expect(members.getAllByRole('listitem')).toHaveLength(2)
    expect(members.getByText('Owner')).toBeTruthy()
    expect(screen.getByText('2 of 5 people')).toBeTruthy()
  })

  it('hides invites from a non-owner', async () => {
    await openBlend(bob)
    await screen.findByRole('region', { name: 'Members' })
    expect(screen.queryByRole('region', { name: 'Invites' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Leave blend' })).toBeTruthy()
  })
})

describe('inviting', () => {
  it('invites a friend who is not in the blend, and shows them as Invited', async () => {
    const { user } = await openBlend()
    await user.click(await screen.findByRole('button', { name: 'Invite a friend' }))
    const form = screen.getByRole('heading', { name: 'Invite a friend' }).closest('form')
    expect(within(form).queryByRole('checkbox', { name: /bob/ })).toBeNull()
    await user.click(within(form).getByRole('checkbox', { name: /cara/ }))
    await user.click(within(form).getByRole('button', { name: 'Send invite' }))

    await waitFor(() => expect(region('Invites').getByText('Invited')).toBeTruthy())
    expect(backend.blend_invites).toEqual([expect.objectContaining({ invitee_id: cara.id, status: 'pending' })])
    expect(screen.queryByRole('heading', { name: 'Invite a friend' })).toBeNull()
  })

  it('keeps the form and offers a retry when sending fails', async () => {
    backend.failRpc('invite_to_blend', 'boom', { times: 1 })
    const { user } = await openBlend()
    await user.click(await screen.findByRole('button', { name: 'Invite a friend' }))
    await user.click(screen.getByRole('checkbox', { name: /cara/ }))
    await user.click(screen.getByRole('button', { name: 'Send invite' }))

    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't send that invite")
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(backend.blend_invites).toHaveLength(1))
  })

  it('says the blend is full instead of offering invites', async () => {
    const extra = ['d', 'e', 'f'].map((n) => backend.addUser({ username: n }))
    for (const u of extra) backend.blend_members.push({ blend_id: blendId, user_id: u.id, joined_at: backend.now() })
    await openBlend()
    expect(await screen.findByText(/This blend is full/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Invite a friend' })).toBeNull()
  })
})

describe('leaving', () => {
  it('asks first; Stay cancels', async () => {
    const { user } = await openBlend(bob)
    await user.click(await screen.findByRole('button', { name: 'Leave blend' }))
    await user.click(screen.getByRole('button', { name: 'Stay' }))
    expect(screen.getByRole('button', { name: 'Leave blend' })).toBeTruthy()
    expect(backend.isBlendMember(bob.id, blendId)).toBe(true)
  })

  it('removes a member, who lands back on Movie Blend', async () => {
    const { user } = await openBlend(bob)
    await user.click(await screen.findByRole('button', { name: 'Leave blend' }))
    await user.click(screen.getByRole('button', { name: 'Leave blend' }))
    await waitFor(() => expect(backend.isBlendMember(bob.id, blendId)).toBe(false))
    await waitFor(() => expect(window.location.hash).toBe('#/blends'))
  })

  it('warns that the owner leaving disbands the blend for everyone', async () => {
    const { user } = await openBlend()
    await user.click(await screen.findByRole('button', { name: 'Disband blend' }))
    expect(screen.getByText(/Leaving disbands it for everyone/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Disband blend' }))
    await waitFor(() => expect(backend.blends).toHaveLength(0))
  })

  it('offers a retry on a connection failure', async () => {
    backend.failRpc('leave_blend', 'boom', { times: 1 })
    const { user } = await openBlend(bob)
    await user.click(await screen.findByRole('button', { name: 'Leave blend' }))
    await user.click(screen.getByRole('button', { name: 'Leave blend' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Couldn't leave the blend")
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(backend.isBlendMember(bob.id, blendId)).toBe(false))
  })
})

describe('load failures', () => {
  it('shows an error with Try again when the blend will not load', async () => {
    backend.failRpc('get_blend_members', 'boom', { times: 1 })
    const { user } = await openBlend()
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load this blend")
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: 'Members' })).toBeTruthy()
  })

  it('sends you back with a notice when the blend is gone', async () => {
    await openBlend(alice, 'no-such-blend')
    await waitFor(() => expect(window.location.hash).toBe('#/blends'))
    expect(await screen.findByText('That blend no longer exists.')).toBeTruthy()
  })
})
