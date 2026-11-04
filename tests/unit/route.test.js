import { describe, it, expect } from 'vitest'
import { blendHref, parseHash, userHref, userListHref, DEFAULT_PAGE } from '../../src/lib/route.js'

describe('parseHash', () => {
  it('reads a sidebar page', () => {
    expect(parseHash('#/my-list')).toEqual({ page: 'my-list', username: null })
    expect(parseHash('#/friends')).toEqual({ page: 'friends', username: null })
  })
  it("reads another user's profile", () => {
    expect(parseHash('#/u/reil_99')).toEqual({ page: 'user', username: 'reil_99' })
  })
  it("reads another user's full list", () => {
    expect(parseHash('#/u/reil_99/my-list')).toEqual({ page: 'user-list', username: 'reil_99' })
  })
  it('decodes the username', () => {
    expect(parseHash('#/u/a%5Fb')).toEqual({ page: 'user', username: 'a_b' })
    expect(parseHash('#/u/a%5Fb/my-list')).toEqual({ page: 'user-list', username: 'a_b' })
  })
  it('falls back to the default page for unknown or empty hashes', () => {
    expect(parseHash('')).toEqual({ page: DEFAULT_PAGE, username: null })
    expect(parseHash('#/nope')).toEqual({ page: DEFAULT_PAGE, username: null })
    expect(parseHash(undefined)).toEqual({ page: DEFAULT_PAGE, username: null })
  })
  it('does not treat "user", "user-list", or malformed paths as pages', () => {
    expect(parseHash('#/user').page).toBe(DEFAULT_PAGE)
    expect(parseHash('#/user-list').page).toBe(DEFAULT_PAGE)
    expect(parseHash('#/u/').page).toBe(DEFAULT_PAGE)
    expect(parseHash('#/u/a/b').page).toBe(DEFAULT_PAGE)
    expect(parseHash('#/u/reil_99/other').page).toBe(DEFAULT_PAGE)
    expect(parseHash('#/u//my-list').page).toBe(DEFAULT_PAGE)
  })
  it('falls back on a malformed encoding instead of throwing', () => {
    expect(parseHash('#/u/%E0%A4%A')).toEqual({ page: DEFAULT_PAGE, username: null })
    expect(parseHash('#/u/%E0%A4%A/my-list')).toEqual({ page: DEFAULT_PAGE, username: null })
  })
})

describe('Movie Blend routes', () => {
  it('reads the blends tab', () => {
    expect(parseHash('#/blends')).toEqual({ page: 'blends', username: null })
  })
  it('reads one blend, and blendHref builds a link it reads back', () => {
    expect(parseHash('#/blends/abc')).toEqual({ page: 'blend', username: null, blendId: 'abc' })
    expect(parseHash(blendHref('abc'))).toEqual({ page: 'blend', username: null, blendId: 'abc' })
  })
  it('falls back on malformed blend paths', () => {
    expect(parseHash('#/blend').page).toBe(DEFAULT_PAGE)
    expect(parseHash('#/blends/').page).toBe(DEFAULT_PAGE)
    expect(parseHash('#/blends/a/b').page).toBe(DEFAULT_PAGE)
    expect(parseHash('#/blends/%E0%A4%A')).toEqual({ page: DEFAULT_PAGE, username: null })
  })
})

describe('userHref and userListHref', () => {
  it('build links that parseHash reads back', () => {
    expect(parseHash(userHref('reil_99'))).toEqual({ page: 'user', username: 'reil_99' })
    expect(parseHash(userListHref('reil_99'))).toEqual({ page: 'user-list', username: 'reil_99' })
  })
  it('puts the username before /my-list', () => {
    expect(userListHref('reil_99')).toBe('#/u/reil_99/my-list')
  })
})
