import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BLOCKED_PHRASES, MAX_REPEAT } from '../../src/lib/moderation.js'

// The text rules exist twice: in the browser (moderation.js) and in the
// database (text_is_allowed). This fails if someone changes only one.
const MIGRATION = new URL('../../supabase/migrations/20261118000000_moderation_checks.sql', import.meta.url)
const sql = readFileSync(MIGRATION, 'utf8')

describe('text_is_allowed matches moderation.js', () => {
  it('blocks the same phrases', () => {
    const match = /~\* '\(\^\|\[\^\[:alnum:\]\]\)\(([^)]*)\)\(\$\|\[\^\[:alnum:\]\]\)'/.exec(sql)
    expect(match, 'phrase pattern not found in the migration').not.toBeNull()
    const phrases = match[1].split('|')
    expect([...phrases].sort()).toEqual([...BLOCKED_PHRASES].sort())
  })

  it('uses the same repeat count', () => {
    const match = /~ '\(\\S\)\\1\{(\d+),\}'/.exec(sql)
    expect(match, 'repeat pattern not found in the migration').not.toBeNull()
    expect(Number(match[1])).toBe(MAX_REPEAT)
  })

  it('only contains phrases that need no regex escaping', () => {
    // The SQL pattern is written by hand; a phrase with ( | . etc. would need care.
    for (const phrase of BLOCKED_PHRASES) expect(phrase).toMatch(/^[a-z0-9 ]+$/)
  })
})

// The report cooldown exists in SQL (report_cooldown()) and in the fake backend
// the integration tests run against. This fails if only one is changed.
describe('report_cooldown matches the fake backend', () => {
  it('is the same length', async () => {
    const { REPORT_COOLDOWN_MS } = await import('../integration/helpers/fakeBackend.js')
    const migration = readFileSync(new URL('../../supabase/migrations/20261120000000_moderation_v2_reports.sql', import.meta.url), 'utf8')
    const match = /create function public\.report_cooldown\(\)[\s\S]*?select interval '(\d+) day'/.exec(migration)
    expect(match, 'report_cooldown() not found in the migration').not.toBeNull()
    expect(Number(match[1]) * 24 * 60 * 60 * 1000).toBe(REPORT_COOLDOWN_MS)
  })
})
