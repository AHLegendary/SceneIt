import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RATE_LIMITS } from '../integration/helpers/fakeBackend.js'

// The limits exist in SQL (rate_limit_config()) and in the fake backend the
// integration tests run against. This fails if only one is changed.
const migration = readFileSync(new URL('../../supabase/migrations/20261121000000_rate_limits.sql', import.meta.url), 'utf8')

const UNIT_MS = { minute: 60 * 1000, minutes: 60 * 1000, hour: 60 * 60 * 1000, hours: 60 * 60 * 1000 }
const ms = (amount, unit) => Number(amount) * UNIT_MS[unit]

// ('report',  10, interval '5 minutes', 30,  interval '24 hours'),
const ROW = /\('(\w+)',\s*(\d+),\s*interval '(\d+) (\w+)',\s*(\d+),\s*interval '(\d+) (\w+)'\)/g

describe('rate_limit_config matches the fake backend', () => {
  const found = Object.fromEntries(
    [...migration.matchAll(ROW)].map(([, kind, burst, burstN, burstUnit, daily, dailyN, dailyUnit]) => [
      kind,
      { burst: Number(burst), burstMs: ms(burstN, burstUnit), daily: Number(daily), dailyMs: ms(dailyN, dailyUnit) },
    ]),
  )

  it('lists the same kinds', () => {
    expect(Object.keys(found).sort()).toEqual(Object.keys(RATE_LIMITS).sort())
  })

  it.each(Object.keys(RATE_LIMITS))('has the same numbers for %s', (kind) => {
    expect(found[kind]).toEqual(RATE_LIMITS[kind])
  })

  it('runs the check before the other BEFORE INSERT triggers (they sort by name)', () => {
    const names = [...migration.matchAll(/create trigger (\w+)\s+before insert/g)].map((m) => m[1])
    expect(names).toHaveLength(3)
    // Existing triggers on these tables (earlier migrations) all start later in the alphabet.
    for (const name of names) expect(name < 'review').toBe(true)
  })
})
