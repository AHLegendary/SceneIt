import { describe, it, expect } from 'vitest'
import {
  validateEmail,
  validateLogin,
  validateIdentifier,
  validateUsername,
  validateNewPassword,
  validateSignUp,
} from '../../src/lib/validation.js'

describe('validateEmail', () => {
  it('rejects empty input', () => {
    expect(validateEmail('   ')).toBe('Enter your email.')
  })
  it('rejects malformed emails', () => {
    expect(validateEmail('not-an-email')).not.toBe('')
    expect(validateEmail('a@b')).not.toBe('')
  })
  it('accepts a normal email', () => {
    expect(validateEmail(' user@example.com ')).toBe('')
  })
})

describe('validateUsername', () => {
  it('rejects empty, too short, too long, and invalid characters', () => {
    expect(validateUsername('')).not.toBe('')
    expect(validateUsername('ab')).not.toBe('')
    expect(validateUsername('a'.repeat(21))).not.toBe('')
    expect(validateUsername('has space')).not.toBe('')
    expect(validateUsername('bad-name!')).not.toBe('')
  })
  it('accepts values the database accepts', () => {
    expect(validateUsername('abc')).toBe('')
    expect(validateUsername('Movie_Fan_99')).toBe('')
    expect(validateUsername('a'.repeat(20))).toBe('')
  })
})

describe('validateNewPassword', () => {
  it('requires 8 or more characters', () => {
    expect(validateNewPassword('')).not.toBe('')
    expect(validateNewPassword('1234567')).not.toBe('')
    expect(validateNewPassword('12345678')).toBe('')
  })
})

describe('validateIdentifier', () => {
  it('rejects empty input', () => {
    expect(validateIdentifier('  ')).toBe('Enter your email or username.')
  })
  it('accepts a valid username or email', () => {
    expect(validateIdentifier('reil_99')).toBe('')
    expect(validateIdentifier('user@example.com')).toBe('')
  })
  it('rejects a bad email or an invalid username', () => {
    expect(validateIdentifier('user@')).not.toBe('')
    expect(validateIdentifier('has space')).not.toBe('')
    expect(validateIdentifier('ab')).not.toBe('')
  })
})

describe('validateLogin', () => {
  it('returns errors for both empty fields', () => {
    expect(Object.keys(validateLogin({ identifier: '', password: '' }))).toEqual(['identifier', 'password'])
  })
  it('returns no errors for valid input', () => {
    expect(validateLogin({ identifier: 'reil_99', password: 'x' })).toEqual({})
    expect(validateLogin({ identifier: 'user@example.com', password: 'x' })).toEqual({})
  })
})

describe('validateSignUp', () => {
  it('returns an error for each invalid field', () => {
    expect(Object.keys(validateSignUp({ username: '', email: '', password: '' }))).toEqual([
      'username',
      'email',
      'password',
    ])
  })
  it('returns no errors for valid input', () => {
    expect(
      validateSignUp({ username: 'reil_99', email: 'user@example.com', password: 'longenough' }),
    ).toEqual({})
  })
})
