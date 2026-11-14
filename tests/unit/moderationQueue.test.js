import { describe, expect, it, vi } from 'vitest'

// Only the pure helpers are tested here. The store imports the Supabase client
// and the account store, which need env vars and a login, so both are mocked
// (CI has no .env). The store itself is covered in tests/integration/moderation.test.jsx.
vi.mock('../../src/lib/supabase.js', () => ({ supabase: {} }))
vi.mock('../../src/lib/supabaseStore.js', () => ({ getState: () => ({ user: null }) }))

import { reportKey, rowsToReports } from '../../src/lib/moderationQueue.js'

describe('rowsToReports', () => {
  it('turns get_reports rows into list entries', () => {
    const [entry] = rowsToReports([
      {
        target_type: 'comment',
        target_id: 'c1',
        review_id: 'r1',
        review_author_username: 'bob',
        target_author_username: 'alice',
        target_body: 'then',
        current_body: 'now',
        is_deleted: false,
        is_hidden: true,
        report_count: 2,
        reports: [{ reason: 'Rude', reporter: 'carol', created_at: '2026-11-01T00:00:00Z' }],
        status: 'open',
        resolved_by_username: null,
        resolved_at: null,
        last_reported_at: '2026-11-01T00:00:00Z',
      },
    ])
    expect(entry).toEqual({
      key: 'comment:c1',
      targetType: 'comment',
      targetId: 'c1',
      reviewId: 'r1',
      reviewAuthorUsername: 'bob',
      targetAuthorUsername: 'alice',
      reportedBody: 'then',
      currentBody: 'now',
      isDeleted: false,
      isHidden: true,
      reportCount: 2,
      reports: [{ reason: 'Rude', reporter: 'carol', createdAt: '2026-11-01T00:00:00Z' }],
      status: 'open',
      resolvedByUsername: null,
      resolvedAt: null,
      lastReportedAt: '2026-11-01T00:00:00Z',
    })
  })

  it('copes with a deleted author and no rows', () => {
    expect(rowsToReports(null)).toEqual([])
    const [entry] = rowsToReports([{ target_type: 'review', target_id: 'r1', target_user_id: null, report_count: 1, reports: [], is_deleted: true }])
    expect(entry).toMatchObject({ targetAuthorUsername: null, reviewAuthorUsername: null, isDeleted: true, currentBody: null })
  })

  it('keys a report by what it is about', () => {
    expect(reportKey('review', 'x')).toBe('review:x')
  })
})
