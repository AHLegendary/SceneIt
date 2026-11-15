// The moderation queue: reported reviews and comments, for moderators.
//
// Same shape as friends.js and notifications.js: UI code calls these functions
// instead of talking to Supabase, and this module keeps an in-memory copy of
// the list so React can read it synchronously (see useModerationQueue.js).
//
// It holds ONE list at a time, the tab being looked at: 'open' (reports nobody
// has dealt with) or 'resolved' (dismissed or hidden). Calling loadReports for
// a tab replaces the list. Only moderators get anything back: the database
// refuses everyone else ('not_moderator'), whatever the page shows.
//
// Acting on a report (moderate) updates the list straight away and puts it
// back, with a message, if the database refuses. Hiding or dismissing takes
// the card out of the Open list; restoring keeps its card in Resolved (it is
// history) and just turns off the Restore button.
//
// Each entry is { key, targetType, targetId, reviewId, reviewAuthorUsername,
// targetAuthorUsername, reportedBody, currentBody, isDeleted, isHidden,
// reportCount, totalReportCount, totalReporterCount,
// reports: [{ reason, reporter, createdAt }], status,
// resolvedByUsername, resolvedAt, lastReportedAt }.
//   reportedBody  what it said when it was first reported
//   currentBody   what it says now, null once it is deleted
//   reportCount   reports in this card's state; totalReportCount and
//                 totalReporterCount are all-time for the post, any status
//                 (people can report again after a cooldown, so there can be
//                 fewer reporters than reports)

import { supabase } from './supabase.js'
import { getState as getAccount } from './supabaseStore.js'

export const LOAD_ERROR = "Couldn't load the reports. Check your connection and try again."
export const ACTION_ERROR = "Couldn't do that. Check your connection and try again."
export const NOT_MODERATOR_ERROR = "You don't have access to do that."
export const TARGET_GONE_ERROR = 'That post was deleted, so it can only be dismissed.'

export const MAX_HIDE_REASON_LENGTH = 500

// One page of reports. The database caps it at 200, which is more than a
// queue should ever hold; the Open list shrinks as reports are dealt with.
// TODO(moderation-v2): page through the Resolved tab once it gets long.
const PAGE_SIZE = 200

// status:
//   'idle'    nothing loaded yet
//   'loading' loading `filter`
//   'ready'   loaded
//   'error'   load failed (error has the message)
// rowErrors: { [key]: message } for actions that failed. busy: { [key]: true }.
const EMPTY = { status: 'idle', userId: null, filter: 'open', list: [], error: null, rowErrors: {}, busy: {} }
let state = EMPTY
const listeners = new Set()

function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}

// ------------------------------------------------------------------ reads

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getModerationState() {
  return state
}

export const reportKey = (targetType, targetId) => `${targetType}:${targetId}`

// Turns get_reports rows into list entries.
export function rowsToReports(rows) {
  return (rows ?? []).map((row) => ({
    key: reportKey(row.target_type, row.target_id),
    targetType: row.target_type,
    targetId: row.target_id,
    reviewId: row.review_id,
    reviewAuthorUsername: row.review_author_username ?? null,
    targetAuthorUsername: row.target_author_username ?? null,
    reportedBody: row.target_body ?? null,
    currentBody: row.current_body ?? null,
    isDeleted: Boolean(row.is_deleted),
    isHidden: Boolean(row.is_hidden),
    reportCount: row.report_count,
    // Older databases don't send the totals; then the card shows no extra line.
    totalReportCount: row.total_report_count ?? row.report_count,
    totalReporterCount: row.total_reporter_count ?? row.report_count,
    reports: (row.reports ?? []).map((r) => ({ reason: r.reason, reporter: r.reporter ?? null, createdAt: r.created_at })),
    status: row.status,
    resolvedByUsername: row.resolved_by_username ?? null,
    resolvedAt: row.resolved_at ?? null,
    lastReportedAt: row.last_reported_at,
  }))
}

// ------------------------------------------------------------------ loading

let loadCounter = 0

// Loads one tab: 'open' or 'resolved'. Never throws: a failure puts the store
// in 'error' so the page can offer a retry.
export async function loadReports(filter = 'open') {
  const userId = getAccount().user?.id ?? null
  if (!userId) {
    setState(EMPTY)
    return
  }
  // A different person than last time: forget the old list.
  if (userId !== state.userId) setState({ ...EMPTY, userId })
  const mine = (loadCounter += 1)
  setState({ status: 'loading', filter, list: [], error: null, rowErrors: {}, busy: {} })
  const { data, error } = await supabase.rpc('get_reports', { p_status: filter, p_limit: PAGE_SIZE, p_offset: 0 })
  if (mine !== loadCounter || state.userId !== userId) return // another load started, or the user changed
  if (error) setState({ status: 'error', error: LOAD_ERROR })
  else setState({ status: 'ready', list: rowsToReports(data), error: null })
}

// ------------------------------------------------------------------ actions

function messageFor(error) {
  if (error?.message?.includes('not_moderator')) return NOT_MODERATOR_ERROR
  if (error?.message?.includes('target_not_found')) return TARGET_GONE_ERROR
  return ACTION_ERROR
}

// Hide, restore or dismiss a reported review or comment. Returns true when it
// worked, and false (with the reason in rowErrors, shown on the card) when it
// didn't. `reason` is the optional note for a hide, 500 characters at most.
export async function moderate(targetType, targetId, action, reason = null) {
  const key = reportKey(targetType, targetId)
  const userId = state.userId
  const index = state.list.findIndex((entry) => entry.key === key)
  const entry = state.list[index]
  if (!entry || state.busy[key]) return false

  const note = (reason ?? '').trim() || null
  if (note && [...note].length > MAX_HIDE_REASON_LENGTH) {
    setState({ rowErrors: { ...state.rowErrors, [key]: `Keep the reason under ${MAX_HIDE_REASON_LENGTH} characters.` } })
    return false
  }

  // Show the result straight away; undone below if the database says no.
  const withoutRow = (list) => list.filter((e) => e.key !== key)
  const { [key]: _cleared, ...otherErrors } = state.rowErrors
  if (action === 'restore') {
    setState({
      list: state.list.map((e) => (e.key === key ? { ...e, isHidden: false } : e)),
      rowErrors: otherErrors,
      busy: { ...state.busy, [key]: true },
    })
  } else if (state.filter === 'open') {
    setState({ list: withoutRow(state.list), rowErrors: otherErrors })
  } else {
    setState({ rowErrors: otherErrors, busy: { ...state.busy, [key]: true } })
  }

  const { error } = await supabase.rpc('moderate_content', {
    p_target_type: targetType,
    p_target_id: targetId,
    p_action: action,
    p_reason: action === 'hide' ? note : null,
  })
  if (state.userId !== userId) return false

  const { [key]: _done, ...stillBusy } = state.busy
  if (!error) {
    setState({ busy: stillBusy })
    return true
  }

  // Put it back where it was. If the post turned out to be deleted, say so on
  // the card, so Hide is no longer offered.
  const restored = { ...entry, ...(error.message?.includes('target_not_found') ? { isDeleted: true, currentBody: null } : {}) }
  const hasRow = state.list.some((e) => e.key === key)
  const list = hasRow
    ? state.list.map((e) => (e.key === key ? restored : e))
    : [...state.list.slice(0, index), restored, ...state.list.slice(index)]
  setState({ list, busy: stillBusy, rowErrors: { ...state.rowErrors, [key]: messageFor(error) } })
  return false
}
