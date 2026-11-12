import { describe, expect, it } from 'vitest'
import { RECS_UNLOCK } from '../../src/features/recommendations/recommend.js'
import { justUnlockedRecs } from '../../src/features/recommendations/unlockNotice.js'

describe('justUnlockedRecs', () => {
  it('fires when the count crosses the unlock line', () => {
    expect(justUnlockedRecs(RECS_UNLOCK - 1, RECS_UNLOCK)).toBe(true)
  })

  it('does not fire on the first load, even with plenty ranked', () => {
    expect(justUnlockedRecs(null, 40)).toBe(false)
  })

  it('does not fire below the line or once already past it', () => {
    expect(justUnlockedRecs(3, 4)).toBe(false)
    expect(justUnlockedRecs(RECS_UNLOCK, RECS_UNLOCK + 1)).toBe(false)
    expect(justUnlockedRecs(RECS_UNLOCK + 1, RECS_UNLOCK)).toBe(false)
  })

  it('respects a custom threshold', () => {
    expect(justUnlockedRecs(2, 3, 3)).toBe(true)
  })
})
