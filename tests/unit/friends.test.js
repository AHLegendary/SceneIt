import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fake Supabase client and account store. Tests set `db.*`, then log in or
// out through `setAccount`.
const db = vi.hoisted(() => ({
  account: { user: null },
  accountListeners: new Set(),
  friendRows: [],
  searchRows: [],
  sendResult: 'sent',
  failRpc: null, // name of the rpc that should fail
  updateRows: [{ requester_id: 'x' }],
  failTable: false,
  rpcCalls: [],
  tableCalls: [],
}))

vi.mock('../../src/lib/supabaseStore.js', () => ({
  getState: () => db.account,
  subscribe: (fn) => {
    db.accountListeners.add(fn)
    return () => db.accountListeners.delete(fn)
  },
}))

vi.mock('../../src/lib/supabase.js', () => {
  // supabase.from(table).update()/.delete() + filters: chainable, awaitable,
  // and records every call so tests can check the filters.
  function from(table) {
    const call = { table, ops: [] }
    db.tableCalls.push(call)
    const result = () =>
      db.failTable
        ? { data: null, error: { message: 'boom' } }
        : { data: call.ops.some(([op]) => op === 'update') ? db.updateRows : null, error: null }
    const chain = {}
    for (const op of ['update', 'delete', 'eq', 'or', 'select']) {
      chain[op] = (...args) => {
        call.ops.push([op, ...args])
        return chain
      }
    }
    chain.then = (resolve, reject) => Promise.resolve(result()).then(resolve, reject)
    return chain
  }
  return {
    supabase: {
      from,
      rpc: async (name, args) => {
        db.rpcCalls.push({ name, args })
        if (db.failRpc === name) return { data: null, error: { message: 'boom' } }
        if (name === 'get_friendships') return { data: db.friendRows, error: null }
        if (name === 'search_users') return { data: db.searchRows, error: null }
        if (name === 'send_friend_request') return { data: db.sendResult, error: null }
        return { data: null, error: null }
      },
    },
  }
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

const ME = '00000000-0000-0000-0000-00000000000a'
const BOB = '00000000-0000-0000-0000-00000000000b'
const CAROL = '00000000-0000-0000-0000-00000000000c'
const DAN = '00000000-0000-0000-0000-00000000000d'

const ROWS = [
  { user_id: BOB, username: 'bob', direction: 'friends', created_at: '2026-11-01T00:00:00Z' },
  { user_id: CAROL, username: 'carol', direction: 'incoming', created_at: '2026-11-02T00:00:00Z' },
  { user_id: DAN, username: 'dan', direction: 'outgoing', created_at: '2026-11-02T01:00:00Z' },
]

async function setAccount(user) {
  db.account = { user }
  db.accountListeners.forEach((fn) => fn())
  await settle()
}

let friends

beforeEach(async () => {
  Object.assign(db, {
    account: { user: null },
    accountListeners: new Set(),
    friendRows: ROWS,
    searchRows: [],
    sendResult: 'sent',
    failRpc: null,
    updateRows: [{ requester_id: CAROL }],
    failTable: false,
    rpcCalls: [],
    tableCalls: [],
  })
  vi.resetModules()
  friends = await import('../../src/lib/friends.js')
  friends.startFriends()
})

describe('groupFriendships', () => {
  it('splits entries by direction and sorts friends by username', () => {
    const groups = friends.groupFriendships([
      { id: '1', username: 'zed', direction: 'friends' },
      { id: '2', username: 'amy', direction: 'friends' },
      { id: '3', username: 'kai', direction: 'incoming' },
      { id: '4', username: 'lee', direction: 'outgoing' },
    ])
    expect(groups.friends.map((f) => f.username)).toEqual(['amy', 'zed'])
    expect(groups.incoming.map((f) => f.username)).toEqual(['kai'])
    expect(groups.outgoing.map((f) => f.username)).toEqual(['lee'])
  })

  it('ignores unknown directions and handles no list', () => {
    expect(friends.groupFriendships([{ id: '1', username: 'x', direction: 'weird' }])).toEqual({
      incoming: [], outgoing: [], friends: [],
    })
    expect(friends.groupFriendships(undefined)).toEqual({ incoming: [], outgoing: [], friends: [] })
  })
})

describe('relationTo', () => {
  it('says how the user is connected to someone', () => {
    const list = friends.rowsToFriendships(ROWS)
    expect(friends.relationTo(list, BOB)).toBe('friends')
    expect(friends.relationTo(list, CAROL)).toBe('incoming')
    expect(friends.relationTo(list, DAN)).toBe('outgoing')
    expect(friends.relationTo(list, ME)).toBe(null)
  })
})

describe('login state', () => {
  it('starts signed out and does not load', () => {
    expect(friends.getFriendsState().status).toBe('signed-out')
    expect(db.rpcCalls).toEqual([])
  })

  it('loads the list on login', async () => {
    await setAccount({ id: ME })
    const state = friends.getFriendsState()
    expect(state.status).toBe('ready')
    expect(state.list).toEqual([
      { id: BOB, username: 'bob', direction: 'friends', createdAt: '2026-11-01T00:00:00Z' },
      { id: CAROL, username: 'carol', direction: 'incoming', createdAt: '2026-11-02T00:00:00Z' },
      { id: DAN, username: 'dan', direction: 'outgoing', createdAt: '2026-11-02T01:00:00Z' },
    ])
    expect(friends.getFriendIds()).toEqual([BOB])
  })

  it('clears the list on logout', async () => {
    await setAccount({ id: ME })
    await setAccount(null)
    expect(friends.getFriendsState()).toMatchObject({ status: 'signed-out', list: [], userId: null })
    expect(friends.getFriendIds()).toEqual([])
  })

  it('does not reload when the same user is reported again', async () => {
    await setAccount({ id: ME })
    await setAccount({ id: ME })
    expect(db.rpcCalls.filter((c) => c.name === 'get_friendships')).toHaveLength(1)
  })

  it('goes to error with a message when loading fails, and recovers on retry', async () => {
    db.failRpc = 'get_friendships'
    await setAccount({ id: ME })
    expect(friends.getFriendsState()).toMatchObject({ status: 'error', error: friends.LOAD_ERROR })
    db.failRpc = null
    await friends.loadFriends()
    expect(friends.getFriendsState().status).toBe('ready')
  })

  it('notifies subscribers when the list changes', async () => {
    const seen = []
    friends.subscribe(() => seen.push(friends.getFriendsState().status))
    await setAccount({ id: ME })
    expect(seen).toEqual(['loading', 'ready'])
  })
})

describe('searchUsers', () => {
  beforeEach(() => setAccount({ id: ME }))

  it('does not search for fewer than 2 characters', async () => {
    expect(await friends.searchUsers(' a ')).toEqual([])
    expect(db.rpcCalls.some((c) => c.name === 'search_users')).toBe(false)
  })

  it('trims the query and leaves the current user out', async () => {
    db.searchRows = [{ id: ME, username: 'reil' }, { id: BOB, username: 'reilly' }]
    expect(await friends.searchUsers('  rei ')).toEqual([{ id: BOB, username: 'reilly' }])
    expect(db.rpcCalls.at(-1)).toEqual({ name: 'search_users', args: { q: 'rei' } })
  })

  it('throws a friendly message on failure', async () => {
    db.failRpc = 'search_users'
    await expect(friends.searchUsers('bob')).rejects.toThrow(friends.SEARCH_ERROR)
  })
})

describe('writes', () => {
  it('need a signed-in user', async () => {
    await expect(friends.sendFriendRequest(BOB)).rejects.toThrow('Log in')
    await expect(friends.acceptFriendRequest(BOB)).rejects.toThrow('Log in')
    await expect(friends.removeFriendship(BOB)).rejects.toThrow('Log in')
  })

  it('reject ids that are not user ids, before touching the database', async () => {
    await setAccount({ id: ME })
    const before = db.rpcCalls.length
    await expect(friends.sendFriendRequest('bob')).rejects.toThrow('Unknown user')
    await expect(friends.removeFriendship('x),or(true')).rejects.toThrow('Unknown user')
    expect(db.rpcCalls.length).toBe(before)
    expect(db.tableCalls).toEqual([])
  })
})

describe('sendFriendRequest', () => {
  beforeEach(() => setAccount({ id: ME }))

  it('calls send_friend_request, returns its result, and reloads', async () => {
    db.sendResult = 'accepted'
    const loadsBefore = db.rpcCalls.filter((c) => c.name === 'get_friendships').length
    expect(await friends.sendFriendRequest(BOB)).toBe('accepted')
    expect(db.rpcCalls).toContainEqual({ name: 'send_friend_request', args: { p_user_id: BOB } })
    expect(db.rpcCalls.filter((c) => c.name === 'get_friendships').length).toBe(loadsBefore + 1)
    expect(friends.SEND_RESULTS.accepted).toMatch(/friends/)
  })

  it('throws a friendly message on failure', async () => {
    db.failRpc = 'send_friend_request'
    await expect(friends.sendFriendRequest(BOB)).rejects.toThrow(friends.SEND_ERROR)
  })
})

describe('acceptFriendRequest', () => {
  beforeEach(() => setAccount({ id: ME }))

  it('marks their request to me as accepted', async () => {
    await friends.acceptFriendRequest(CAROL)
    const call = db.tableCalls.at(-1)
    expect(call.table).toBe('friendships')
    expect(call.ops).toEqual([
      ['update', { status: 'accepted' }],
      ['eq', 'requester_id', CAROL],
      ['eq', 'addressee_id', ME],
      ['select', 'requester_id'],
    ])
  })

  it('throws when the request no longer exists', async () => {
    db.updateRows = []
    await expect(friends.acceptFriendRequest(CAROL)).rejects.toThrow(friends.ACCEPT_ERROR)
  })

  it('throws on a database error', async () => {
    db.failTable = true
    await expect(friends.acceptFriendRequest(CAROL)).rejects.toThrow(friends.ACCEPT_ERROR)
  })
})

describe('removeFriendship', () => {
  beforeEach(() => setAccount({ id: ME }))

  it('deletes the row in either direction', async () => {
    await friends.removeFriendship(BOB)
    const call = db.tableCalls.at(-1)
    expect(call.ops).toEqual([
      ['delete'],
      ['or', `and(requester_id.eq.${ME},addressee_id.eq.${BOB}),and(requester_id.eq.${BOB},addressee_id.eq.${ME})`],
    ])
  })

  it('throws a friendly message on failure', async () => {
    db.failTable = true
    await expect(friends.removeFriendship(BOB)).rejects.toThrow(friends.REMOVE_ERROR)
  })
})
