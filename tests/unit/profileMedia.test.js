import { describe, expect, it } from 'vitest'
import { IMAGE_LIMITS, MEDIA_NOT_READY, profileMediaReady } from '../../src/lib/profileQueries.js'

describe('profile media', () => {
  it('keeps uploads small: square avatars, wide banners', () => {
    expect(IMAGE_LIMITS.avatar).toMatchObject({ width: 512, height: 512 })
    expect(IMAGE_LIMITS.banner.width).toBeGreaterThan(IMAGE_LIMITS.banner.height)
  })
  it('assumes the migration is applied until a query says otherwise', () => {
    expect(profileMediaReady()).toBe(true)
    expect(MEDIA_NOT_READY).toMatch(/migration/)
  })
})
