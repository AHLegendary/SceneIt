import { describe, it, expect } from 'vitest'
import {
  BIO_MAX,
  PRONOUNS_MAX,
  charCount,
  toProfileUpdate,
  validateBio,
  validateProfile,
  validatePronouns,
} from '../../src/lib/profileValidation.js'

describe('charCount', () => {
  it('counts an emoji once, like Postgres char_length', () => {
    expect(charCount('hi 🎬')).toBe(4)
  })
})

describe('validateBio', () => {
  it('accepts empty and maximum-length bios', () => {
    expect(validateBio('')).toBe('')
    expect(validateBio('a'.repeat(BIO_MAX))).toBe('')
  })
  it('rejects a bio over the limit', () => {
    expect(validateBio('a'.repeat(BIO_MAX + 1))).not.toBe('')
  })
  it('ignores surrounding whitespace, which is trimmed before saving', () => {
    expect(validateBio(`  ${'a'.repeat(BIO_MAX)}  `)).toBe('')
  })
  it('does not count emoji twice', () => {
    expect(validateBio('🎬'.repeat(BIO_MAX))).toBe('')
    expect(validateBio('🎬'.repeat(BIO_MAX + 1))).not.toBe('')
  })
})

describe('validatePronouns', () => {
  it('accepts typical pronouns and the maximum length', () => {
    expect(validatePronouns('she/her')).toBe('')
    expect(validatePronouns('a'.repeat(PRONOUNS_MAX))).toBe('')
  })
  it('rejects pronouns over the limit', () => {
    expect(validatePronouns('a'.repeat(PRONOUNS_MAX + 1))).not.toBe('')
  })
})

describe('validateProfile', () => {
  it('returns an error per invalid field', () => {
    expect(
      Object.keys(validateProfile({ bio: 'a'.repeat(BIO_MAX + 1), pronouns: 'a'.repeat(PRONOUNS_MAX + 1) })),
    ).toEqual(['bio', 'pronouns'])
  })
  it('returns no errors for valid input', () => {
    expect(validateProfile({ bio: 'Horror fan', pronouns: 'they/them' })).toEqual({})
  })
})

describe('toProfileUpdate', () => {
  it('trims text and maps visibility to is_public', () => {
    expect(toProfileUpdate({ bio: '  Hi  ', pronouns: ' she/her ', isPublic: false })).toEqual({
      bio: 'Hi',
      pronouns: 'she/her',
      is_public: false,
    })
  })
  it('stores blank text as null', () => {
    expect(toProfileUpdate({ bio: '   ', pronouns: '', isPublic: true })).toEqual({
      bio: null,
      pronouns: null,
      is_public: true,
    })
  })
})
