import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fake Supabase client and account store. Tests set `db.*`, then log in or
// out through `setAccount`.
const db = vi.hoisted(() => ({
  account: { user: null },
  accountListeners: new Set(),
  responses: {}, // rpc name -> { data, error }
  rpcCalls: [],
}))

vi.mock('../../src/lib/supabaseStore.js', () => ({
  getState: () => db.account,
  subscribe: (fn) => {
    db.accountListeners.add(fn)
    return () => db.accountListeners.delete(fn)
  },
}))

vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    rpc: async (name, args) => {
      db.rpcCalls.push({ name, args })
      return db.responses[name] ?? { data: null, error: null }
    },
  },
}))

const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

const ME = '00000000-0000-0000-0000-00000000000a'
const BLEND = '00000000-0000-0000-0000-0000000000b1'
const INVITE = '00000000-0000-0000-0000-0000000000c1'
const BOB = '00000000-0000-0000-0000-00000000000b'

const BLEND_ROW = {
  blend_id: BLEND,
  owner_id: ME,
  owner_username: 'me',
  member_usernames: ['me', 'bob'],
  member_count: 2,
  joined_at: '2026-11-03T00:00:00Z',
}
const INVITE_ROW = {
  invite_id: INVITE,
  blend_id: BLEND,
  inviter_username: 'bob',
  member_count: 3,
  expires_at: '2026-11-10T00:00:00Z',
}

async function setAccount(user) {
  db.account = { user }
  db.accountListeners.forEach((fn) => fn())
  await settle()
}

const callsTo = (name) => db.rpcCalls.filter((call) => call.name === name)

let blends

beforeEach(async () => {
  Object.assign(db, {
    account: { user: null },
    accountListeners: new Set(),
    responses: {
      get_my_blends: { data: [BLEND_ROW], error: null },
      get_my_blend_invites: { data: [INVITE_ROW], error: null },
    },
    rpcCalls: [],
  })
  vi.resetModules()
  blends = await import('../../src/features/blends/blends.js')
  blends.startBlends()
})

describe('row mapping', () => {
  it('turns blend and invite rows into UI shapes with numeric counts', () => {
    expect(blends.rowsToBlends([{ ...BLEND_ROW, member_count: '2' }])[0]).toMatchObject({
      id: BLEND,
      ownerUsername: 'me',
      memberUsernames: ['me', 'bob'],
      memberCount: 2,
    })
    expect(blends.rowsToInvites([INVITE_ROW])[0]).toMatchObject({ id: INVITE, inviterUsername: 'bob', memberCount: 3 })
  })
  it('handles missing rows', () => {
    expect(blends.rowsToBlends(null)).toEqual([])
    expect(blends.rowsToInvites(undefined)).toEqual([])
    expect(blends.rowsToMembers(null)).toEqual([])
    expect(blends.rowsToSentInvites(null)).toEqual([])
    expect(blends.rowsToRecommendations(null)).toEqual([])
  })
  it('makes recommendations for movies outside the catalog openable by id', async () => {
    const { getMovie } = await import('../../src/lib/localStore.js')
    const [rec] = blends.rowsToRecommendations([
      { movie_id: 987654321, title: 'Not In Catalog', year: 2020, liked_count: '2', member_count: '3', avg_score: '7.5' },
    ])
    expect(rec).toMatchObject({ likedCount: 2, memberCount: 3, avgScore: 7.5 })
    expect(getMovie(rec.movie.id)).toBe(rec.movie)
  })
  it('skips recommendation rows it cannot build a movie for', () => {
    expect(blends.rowsToRecommendations([{ movie_id: 987654322 }])).toEqual([])
  })
})

describe('toBlendError', () => {
  it('maps known database errors to messages and keeps the code', () => {
    const error = blends.toBlendError({ message: 'blend_full' }, 'fallback')
    expect(error.code).toBe('blend_full')
    expect(error.message).toMatch(/full/)
  })
  it('uses the fallback with no code for anything else, so the UI offers a retry', () => {
    const error = blends.toBlendError({ message: 'TypeError: Failed to fetch' }, 'fallback')
    expect(error.code).toBeNull()
    expect(error.message).toBe('fallback')
  })
  it('is not fooled by object property names or a missing error', () => {
    expect(blends.toBlendError({ message: 'constructor' }, 'fallback').code).toBeNull()
    expect(blends.toBlendError(null, 'fallback').message).toBe('fallback')
  })
})

describe('store', () => {
  it('starts signed out without calling the database', () => {
    expect(blends.getBlendsState().status).toBe('signed-out')
    expect(db.rpcCalls).toEqual([])
  })
  it('loads blends and invites on login, and clears them on logout', async () => {
    await setAccount({ id: ME })
    expect(blends.getBlendsState()).toMatchObject({ status: 'ready', userId: ME })
    expect(blends.getBlendsState().blends).toHaveLength(1)
    expect(blends.getBlendsState().invites).toHaveLength(1)

    await setAccount(null)
    expect(blends.getBlendsState()).toMatchObject({ status: 'signed-out', blends: [], invites: [] })
  })
  it('goes to the error state when loading fails, and a retry recovers', async () => {
    const good = db.responses.get_my_blend_invites
    db.responses.get_my_blend_invites = { data: null, error: { message: 'boom' } }
    await setAccount({ id: ME })
    expect(blends.getBlendsState()).toMatchObject({ status: 'error', error: blends.LOAD_ERROR })

    db.responses.get_my_blend_invites = good
    await blends.loadBlends()
    expect(blends.getBlendsState()).toMatchObject({ status: 'ready', error: null })
  })
  it('tells subscribers about a notice', async () => {
    const listener = vi.fn()
    blends.subscribe(listener)
    blends.setBlendNotice(blends.BLEND_GONE)
    expect(listener).toHaveBeenCalled()
    expect(blends.getBlendsState().notice).toBe(blends.BLEND_GONE)
  })
})

describe('fetchBlendDetail', () => {
  beforeEach(() => setAccount({ id: ME }))

  it('returns members, sent invites and recommendations', async () => {
    db.responses.get_blend_members = {
      data: [{ user_id: ME, username: 'me', is_owner: true, joined_at: 'x' }],
      error: null,
    }
    db.responses.get_blend_sent_invites = {
      data: [{ invite_id: INVITE, invitee_id: BOB, invitee_username: 'bob', status: 'declined' }],
      error: null,
    }
    db.responses.get_blend_recommendations = { data: [], error: null }
    const detail = await blends.fetchBlendDetail(BLEND)
    expect(detail.members[0]).toMatchObject({ id: ME, isOwner: true })
    expect(detail.sentInvites[0]).toMatchObject({ inviteeId: BOB, status: 'declined' })
    expect(detail.recommendations).toEqual([])
  })
  it('returns null when the blend is gone or the user is not in it', async () => {
    db.responses.get_blend_members = { data: [], error: null }
    expect(await blends.fetchBlendDetail(BLEND)).toBeNull()
  })
  it('returns null for a malformed id without calling the database', async () => {
    db.rpcCalls.length = 0
    expect(await blends.fetchBlendDetail('not-a-uuid')).toBeNull()
    expect(db.rpcCalls).toEqual([])
  })
  it('throws the load message when a request fails', async () => {
    db.responses.get_blend_recommendations = { data: null, error: { message: 'boom' } }
    db.responses.get_blend_members = { data: [], error: null }
    await expect(blends.fetchBlendDetail(BLEND)).rejects.toThrow(blends.DETAIL_ERROR)
  })
})

describe('writes', () => {
  it('require a login', async () => {
    await expect(blends.createBlend([BOB])).rejects.toThrow(/Log in/)
    expect(db.rpcCalls).toEqual([])
  })

  describe('when logged in', () => {
    beforeEach(() => setAccount({ id: ME }))

    it('createBlend sends the friends, reloads, and returns the id', async () => {
      db.responses.create_blend = { data: BLEND, error: null }
      db.rpcCalls.length = 0
      expect(await blends.createBlend([BOB])).toBe(BLEND)
      expect(callsTo('create_blend')[0].args).toEqual({ p_friend_ids: [BOB] })
      expect(callsTo('get_my_blends')).toHaveLength(1)
    })
    it('createBlend reports too few rankings', async () => {
      db.responses.create_blend = { data: null, error: { message: 'not_enough_rankings' } }
      await expect(blends.createBlend([BOB])).rejects.toMatchObject({ code: 'not_enough_rankings' })
    })
    it('inviteToBlend passes its arguments and reports a full blend', async () => {
      await blends.inviteToBlend(BLEND, BOB)
      expect(callsTo('invite_to_blend')[0].args).toEqual({ p_blend_id: BLEND, p_user_id: BOB })

      db.responses.invite_to_blend = { data: null, error: { message: 'blend_full' } }
      await expect(blends.inviteToBlend(BLEND, BOB)).rejects.toMatchObject({ code: 'blend_full' })
    })
    it('inviteToBlend gives a retryable error on a network failure', async () => {
      db.responses.invite_to_blend = { data: null, error: { message: 'Failed to fetch' } }
      await expect(blends.inviteToBlend(BLEND, BOB)).rejects.toMatchObject({ code: null, message: blends.INVITE_ERROR })
    })
    it('respondToInvite returns the blend id and reloads', async () => {
      db.responses.respond_to_blend_invite = { data: BLEND, error: null }
      db.rpcCalls.length = 0
      expect(await blends.respondToInvite(INVITE, true)).toBe(BLEND)
      expect(callsTo('respond_to_blend_invite')[0].args).toEqual({ p_invite_id: INVITE, p_accept: true })
      expect(callsTo('get_my_blends')).toHaveLength(1)
    })
    it('respondToInvite still reloads when the invite has expired', async () => {
      db.responses.respond_to_blend_invite = { data: null, error: { message: 'invite_expired' } }
      db.rpcCalls.length = 0
      await expect(blends.respondToInvite(INVITE, true)).rejects.toMatchObject({ code: 'invite_expired' })
      expect(callsTo('get_my_blends')).toHaveLength(1)
    })
    it('leaveBlend returns what happened, and reports a blend that is gone', async () => {
      db.responses.leave_blend = { data: 'transferred', error: null }
      expect(await blends.leaveBlend(BLEND)).toBe('transferred')

      db.responses.leave_blend = { data: null, error: { message: 'blend_not_found' } }
      await expect(blends.leaveBlend(BLEND)).rejects.toMatchObject({ code: 'blend_not_found' })
    })
  })
})
