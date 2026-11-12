import { describe, expect, it } from 'vitest'
import { FLAGGED_MESSAGE, moderateText } from '../../src/lib/moderation.js'

describe('moderateText', () => {
  it('lets ordinary text through', () => {
    expect(moderateText('A beautiful, slow, devastating film.')).toEqual({ ok: true })
    expect(moderateText('10/10 would watch again!!!')).toEqual({ ok: true })
    expect(moderateText('')).toEqual({ ok: true })
    expect(moderateText(undefined)).toEqual({ ok: true })
  })

  it('flags blocked phrases, in any case and with punctuation around them', () => {
    for (const text of ['kys', 'KYS!', 'you should (kys)', 'Kill  yourself'.replace('  ', ' '), 'go kill yourself.']) {
      expect(moderateText(text)).toEqual({ ok: false, reason: FLAGGED_MESSAGE })
    }
  })

  it('only matches whole words, so innocent words are not blocked', () => {
    expect(moderateText('Skys and kyshtym are fine').ok).toBe(true)
    expect(moderateText('monkeys').ok).toBe(true)
  })

  it('flags one character repeated as spam, but not normal emphasis', () => {
    expect(moderateText('a'.repeat(21)).ok).toBe(false)
    expect(moderateText('!'.repeat(25)).ok).toBe(false)
    expect(moderateText('a'.repeat(20)).ok).toBe(true)
    expect(moderateText('Sooooooo good').ok).toBe(true)
  })

  it('always returns a message the user can read when flagged', () => {
    const verdict = moderateText('kys')
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/can't be posted/)
  })
})
