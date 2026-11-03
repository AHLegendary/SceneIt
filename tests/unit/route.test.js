import { describe, it, expect } from 'vitest'
import { parseHash, userHref, DEFAULT_PAGE } from '../../src/lib/route.js'

describe('parseHash', () => {
  it('reads a sidebar page', () => {
    expect(parseHash('#/my-list')).toEqual({ page: 'my-list', username: null })
    expect(parseHash('#/friends')).toEqual({ page: 'friends', username: null })
  })
  it('reads another user\'s profile', () => {
    expect(parseHash('#/u/reil_99')).toEqual({ page: 'user', username: 'reil_99' })
  })
  it('decodes the username', () => {
    expect(parseHash('#/u/a%5Fb')).toEqual({ page: 'user', username: 'a_b' })
  })
  it('falls back to the default page for unknown or empty hashes', () => {
    expect(parseHash('')).toEqual({ page: DEFAULT_PAGE, username: null })
    expect(parseHash('#/nope')).toEqual({ page: DEFAULT_PAGE, username: null })
    expect(parseHash(undefined)).toEqual({ page: DEFAULT_PAGE, username: null })
  })
  it('does not treat "user" or a bare /u/ as a page', () => {
    expect(parseHash('#/user').page).toBe(DEFAULT_PAGE)
    expect(parseHash('#/u/').page).toBe(DEFAULT_PAGE)
    expect(parseHash('#/u/a/b').page).toBe(DEFAULT_PAGE)
  })
  it('falls back on a malformed encoding instead of throwing', () => {
    expect(parseHash('#/u/%E0%A4%A')).toEqual({ page: DEFAULT_PAGE, username: null })
  })
})

describe('userHref', () => {
  it('builds a link that parseHash reads back', () => {
    expect(parseHash(userHref('reil_99'))).toEqual({ page: 'user', username: 'reil_99' })
  })
})
