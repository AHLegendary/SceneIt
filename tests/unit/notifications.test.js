// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Fake Supabase client and account store, like friends.test.js.
const db = vi.hoisted(() => ({
  account: { user: null },
  accountListeners: new Set(),
  rows: [],
  openRows: [],
  failRpc: null,
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
  function from(table) {
    const call = { table, ops: [] }
    db.tableCalls.push(call)
    const chain = {}
    for (const op of ['update', 'is']) {
      chain[op] = (...args) => {
        call.ops.push([op, ...args])
        return chain
      }
    }
    chain.then = (resolve, reject) =>
      Promise.resolve({ data: null, error: db.failTable ? { message: 'boom' } : null }).then(resolve, reject)
    return chain
  }
  return {
    supabase: {
      from,
      rpc: async (name, args) => {
        db.rpcCalls.push({ name, args })
        if (db.failRpc === name) return { data: null, error: { message: 'boom' } }
        if (name === 'get_notifications') return { data: db.rows, error: null }
        if (name === 'open_notification') return { data: db.openRows, error: null }
        return { data: null, error: null }
      },
    },
  }
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 5))
const ME = '00000000-0000-0000-0000-00000000000a'
const loads = () => db.rpcCalls.filter((c) => c.name === 'get_notifications').length

const row = (id, extra = {}) => ({
  id,
  type: 'comment',
  created_at: '2026-11-01T00:00:00Z',
  seen_at: null,
  read_at: null,
  actor_username: 'bob',
  review_id: 'r1',
  comment_id: 'c1',
  review_author_username: 'me_99',
  movie_title: 'Dune',
  preview: 'Nice',
  available: true,
  ...extra,
})

async function setAccount(user) {
  db.account = { user }
  db.accountListeners.forEach((fn) => fn())
  await settle()
}

function setVisibility(value) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
}

let n

beforeEach(async () => {
  Object.assign(db, {
    account: { user: null },
    accountListeners: new Set(),
    rows: [row('a'), row('b', { seen_at: 'x' }), row('c', { seen_at: 'x', read_at: 'y' })],
    openRows: [],
    failRpc: null,
    failTable: false,
    rpcCalls: [],
    tableCalls: [],
  })
  setVisibility('visible')
  vi.resetModules()
  n = await import('../../src/lib/notifications.js')
})

afterEach(() => {
  // Logging out stops the refresh timer.
  db.account = { user: null }
  db.accountListeners.forEach((fn) => fn())
  vi.useRealTimers()
})

describe('login state', () => {
  beforeEach(() => n.startNotifications())

  it('starts signed out and does not load', () => {
    expect(n.getNotificationsState().status).toBe('signed-out')
    expect(loads()).toBe(0)
  })

  it('loads on login and maps the rows', async () => {
    await setAccount({ id: ME })
    const state = n.getNotificationsState()
    expect(state.status).toBe('ready')
    expect(state.list[0]).toEqual({
      id: 'a',
      type: 'comment',
      createdAt: '2026-11-01T00:00:00Z',
      seenAt: null,
      readAt: null,
      actorUsername: 'bob',
      reviewId: 'r1',
      commentId: 'c1',
      reviewAuthorUsername: 'me_99',
      movieTitle: 'Dune',
      preview: 'Nice',
      available: true,
    })
  })

  it('clears on logout', async () => {
    await setAccount({ id: ME })
    await setAccount(null)
    expect(n.getNotificationsState()).toMatchObject({ status: 'signed-out', list: [] })
  })

  it('puts the store in error, keeping the list, when a load fails', async () => {
    await setAccount({ id: ME })
    db.failRpc = 'get_notifications'
    await n.loadNotifications()
    expect(n.getNotificationsState()).toMatchObject({ status: 'error', error: n.LOAD_ERROR })
    expect(n.getNotificationsState().list).toHaveLength(3)
  })

  it('ignores a load that finishes after logout', async () => {
    await setAccount({ id: ME })
    const pending = n.loadNotifications()
    await setAccount(null)
    await pending
    expect(n.getNotificationsState().list).toEqual([])
  })
})

describe('refreshing', () => {
  // Fake timers go on before login, so the interval is created under them.
  beforeEach(async () => {
    vi.useFakeTimers()
    n.startNotifications()
    db.account = { user: { id: ME } }
    db.accountListeners.forEach((fn) => fn())
    await vi.advanceTimersByTimeAsync(0)
    db.rpcCalls = []
  })

  it('reloads every 60 seconds while the tab is visible', async () => {
    await vi.advanceTimersByTimeAsync(60_000)
    expect(loads()).toBe(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(loads()).toBe(2)
  })

  it('skips the reload while the tab is hidden', async () => {
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(loads()).toBe(0)
  })

  it('reloads when the tab becomes visible again, not when it is hidden', async () => {
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(loads()).toBe(1)
    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(loads()).toBe(1)
  })

  it('stops the timer on logout', async () => {
    db.account = { user: null }
    db.accountListeners.forEach((fn) => fn())
    await vi.advanceTimersByTimeAsync(180_000)
    expect(loads()).toBe(0)
  })
})

describe('after login', () => {
  beforeEach(async () => {
    n.startNotifications()
    await setAccount({ id: ME })
  })

  it('counts unseen and unread separately', () => {
    expect(n.unseenCount()).toBe(1)
    expect(n.unreadCount()).toBe(2)
  })

  describe('markAllSeen', () => {
    it('clears the badge at once and only updates unseen rows', async () => {
      db.tableCalls = []
      const pending = n.markAllSeen()
      expect(n.unseenCount()).toBe(0)
      await pending
      const call = db.tableCalls[0]
      expect(call.table).toBe('notifications')
      expect(Object.keys(call.ops[0][1])).toEqual(['seen_at'])
      expect(call.ops[1]).toEqual(['is', 'seen_at', null])
      expect(n.unreadCount()).toBe(2) // seen is not read
    })

    it('does nothing when everything is already seen', async () => {
      await n.markAllSeen()
      db.tableCalls = []
      await n.markAllSeen()
      expect(db.tableCalls).toEqual([])
    })

    it('reloads the real state when the update fails', async () => {
      db.failTable = true
      db.rpcCalls = []
      await n.markAllSeen()
      expect(loads()).toBe(1)
      expect(n.unseenCount()).toBe(1)
    })
  })

  describe('markAllRead', () => {
    it('marks everything read and seen', async () => {
      db.tableCalls = []
      await n.markAllRead()
      expect(n.unreadCount()).toBe(0)
      expect(n.unseenCount()).toBe(0)
      expect(db.tableCalls.map((c) => Object.keys(c.ops[0][1])[0])).toEqual(['read_at', 'seen_at'])
    })
  })

  describe('openNotification', () => {
    it('goes to the comment when it is available, and marks it read', async () => {
      db.openRows = [{ available: true, type: 'comment', review_id: 'r1', comment_id: 'c1', review_author_username: 'me_99' }]
      const result = await n.openNotification('a')
      expect(result).toEqual({ available: true, type: 'comment', href: '#/u/me_99/review/r1/c/c1' })
      expect(db.rpcCalls.at(-1)).toEqual({ name: 'open_notification', args: { p_id: 'a' } })
      const entry = n.getNotificationsState().list.find((x) => x.id === 'a')
      expect(entry.readAt).not.toBeNull()
      expect(entry.seenAt).not.toBeNull()
    })

    it('goes to the Friends and Blends pages for requests and invites', async () => {
      db.openRows = [{ available: true, type: 'friend_request', review_id: null, comment_id: null, review_author_username: null }]
      expect((await n.openNotification('a')).href).toBe('#/friends')
      db.openRows = [{ available: true, type: 'blend_invite', review_id: null, comment_id: null, review_author_username: null }]
      expect((await n.openNotification('a')).href).toBe('#/blends')
    })

    it('has no address when the target is gone', async () => {
      db.openRows = [{ available: false, type: 'reply', review_id: 'r1', comment_id: 'c1', review_author_username: 'me_99' }]
      expect(await n.openNotification('a')).toEqual({ available: false, type: 'reply', href: null })
    })

    it('treats an available comment with no author name as unavailable', async () => {
      db.openRows = [{ available: true, type: 'comment', review_id: 'r1', comment_id: 'c1', review_author_username: null }]
      expect((await n.openNotification('a')).available).toBe(false)
    })

    it('says unavailable when the database returns no row', async () => {
      db.openRows = []
      expect(await n.openNotification('a')).toEqual({ available: false, type: 'comment', href: null })
    })

    it('throws a readable error when the request fails, and keeps the row unread', async () => {
      db.failRpc = 'open_notification'
      await expect(n.openNotification('a')).rejects.toThrow(n.OPEN_ERROR)
      expect(n.getNotificationsState().list.find((x) => x.id === 'a').readAt).toBeNull()
    })
  })
})
