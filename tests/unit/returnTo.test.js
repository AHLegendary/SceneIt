import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rememberReturn, takeReturn } from '../../src/lib/returnTo.js'

function fakeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

describe('returnTo', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', fakeStorage())
  })

  it('hands back what was remembered, once', () => {
    rememberReturn({ page: 'my-list', action: 'rank' })
    expect(takeReturn()).toEqual({ page: 'my-list', action: 'rank' })
    expect(takeReturn()).toBeNull()
  })

  it('returns null when nothing was remembered or storage is broken', () => {
    expect(takeReturn()).toBeNull()
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} })
    expect(() => rememberReturn({ page: 'friends' })).not.toThrow()
    expect(takeReturn()).toBeNull()
  })
})
