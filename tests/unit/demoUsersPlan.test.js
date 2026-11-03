import { describe, expect, it } from 'vitest'
import catalog from '../../src/data/movies.json'
import {
  affinity,
  buildDemoPlan,
  buildFriendships,
  DEMO_USERS,
  MAX_RANKED,
  MIN_RANKED,
  seededRandom,
} from '../../scripts/demo-users-plan.js'

const NOW = Date.parse('2026-11-02T12:00:00Z')
const REAL = ['real-1', 'real-2']
const plan = buildDemoPlan(catalog, REAL, { now: NOW })
const names = DEMO_USERS.map((u) => u.username)
const pairKey = (a, b) => [a, b].sort().join('|')

describe('demo users', () => {
  it('have valid, unique usernames', () => {
    for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_]{3,20}$/)
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length)
  })

  it('only like genres that exist in the catalog', () => {
    const genres = new Set(catalog.flatMap((m) => m.genres))
    for (const user of DEMO_USERS) for (const g of user.likes) expect(genres).toContain(g)
  })
})

describe('rankings', () => {
  it(`gives everyone ${MIN_RANKED}-${MAX_RANKED} distinct catalog movies`, () => {
    const ids = new Set(catalog.map((m) => m.tmdb_id))
    for (const user of plan.users) {
      expect(user.rankings.length).toBeGreaterThanOrEqual(MIN_RANKED)
      expect(user.rankings.length).toBeLessThanOrEqual(MAX_RANKED)
      const movies = user.rankings.map((r) => r.tmdb_id)
      expect(new Set(movies).size).toBe(movies.length)
      for (const id of movies) expect(ids).toContain(id)
    }
  })

  it('keeps positions dense from 0, the shape save_ranking keeps', () => {
    for (const user of plan.users) {
      const positions = user.rankings.map((r) => r.position)
      expect(positions[0]).toBe(0)
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i] - positions[i - 1]).toBeGreaterThanOrEqual(0)
        expect(positions[i] - positions[i - 1]).toBeLessThanOrEqual(1)
      }
    }
  })

  it('dates every ranking within the last month, with some this week', () => {
    const all = plan.users.flatMap((u) => u.rankings).map((r) => Date.parse(r.created_at))
    for (const t of all) {
      expect(t).toBeLessThanOrEqual(NOW)
      expect(NOW - t).toBeLessThan(30 * 24 * 3600e3)
    }
    expect(all.filter((t) => NOW - t < 7 * 24 * 3600e3).length).toBeGreaterThan(all.length * 0.2)
  })

  it('puts movies in the user\'s genres higher on average', () => {
    const byId = new Map(catalog.map((m) => [m.tmdb_id, m]))
    for (const user of plan.users) {
      const half = Math.floor(user.rankings.length / 2)
      const avg = (rows) => rows.reduce((s, r) => s + affinity(user.likes, byId.get(r.tmdb_id)), 0) / rows.length
      expect(avg(user.rankings.slice(0, half))).toBeGreaterThan(avg(user.rankings.slice(half)))
    }
  })
})

describe('friendships', () => {
  it('never pairs someone with themselves or the same pair twice', () => {
    const seen = new Set()
    for (const f of plan.friendships) {
      expect(f.requester).not.toBe(f.addressee)
      const key = pairKey(f.requester, f.addressee)
      expect(seen.has(key)).toBe(false)
      seen.add(key)
      expect(['pending', 'accepted']).toContain(f.status)
    }
  })

  it('gives every demo user at least one accepted friend', () => {
    for (const name of names) {
      expect(plan.friendships.some((f) => f.status === 'accepted' && [f.requester, f.addressee].includes(name))).toBe(true)
    }
  })

  it('gives each real user 3 demo friends and 1 pending request from a demo user', () => {
    for (const real of REAL) {
      const rows = plan.friendships.filter((f) => f.addressee === real)
      expect(rows.filter((f) => f.status === 'accepted')).toHaveLength(3)
      expect(rows.filter((f) => f.status === 'pending')).toHaveLength(1)
      for (const f of rows) expect(names).toContain(f.requester)
      expect(plan.friendships.some((f) => f.requester === real)).toBe(false)
    }
  })

  it('still gives everyone a friend when the dice say no to every pair', () => {
    const rows = buildFriendships(['a', 'b', 'c'], [], () => 0.99)
    for (const name of ['a', 'b', 'c']) {
      expect(rows.some((f) => f.status === 'accepted' && [f.requester, f.addressee].includes(name))).toBe(true)
    }
  })

  it('accepts a pending request when every pair is already taken', () => {
    // 0.1 = every pair friends; 0.9 = every one of them pending
    let calls = 0
    const rand = () => (calls++ % 3 === 2 ? 0.9 : 0.1)
    const rows = buildFriendships(['a', 'b'], [], rand)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('accepted')
  })
})

describe('determinism', () => {
  it('gives the same plan for the same seed and a different one for another seed', () => {
    expect(buildDemoPlan(catalog, REAL, { now: NOW })).toEqual(plan)
    expect(buildDemoPlan(catalog, REAL, { now: NOW, seed: 1 })).not.toEqual(plan)
  })

  it('seededRandom stays in [0, 1)', () => {
    const rand = seededRandom(7)
    for (let i = 0; i < 1000; i++) {
      const x = rand()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})

describe('privacy mix', () => {
  it('has both public and private demo accounts', () => {
    expect(DEMO_USERS.some((u) => u.private)).toBe(true)
    expect(DEMO_USERS.some((u) => !u.private)).toBe(true)
  })
})
