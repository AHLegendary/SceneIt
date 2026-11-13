// Notifications for the signed-in user (the bell in the top nav).
//
// Same shape as friends.js: UI code calls these functions instead of talking
// to Supabase, and this module keeps an in-memory copy of the list so React
// can read it synchronously (see useNotifications.js).
//
// It follows supabaseStore's login state: logging in loads the list and
// starts refreshing it, logging out or switching users clears it. There is no
// realtime. The list is refreshed on login, every minute while the tab is
// visible, when the tab becomes visible again, and by the panel when it opens.
//
// "Seen" means the panel was opened (the badge counts unseen ones); "read"
// means the notification was clicked.
//
// Each entry is { id, type, createdAt, seenAt, readAt, actorUsername,
// reviewId, commentId, reviewAuthorUsername, movieTitle, preview, available }.
// `type` is 'comment', 'reply', 'friend_request' or 'blend_invite'. `preview`
// is read live from the comment, and is null once it isn't available.

import { supabase } from './supabase.js'
import { reviewCommentHref } from './route.js'
import { getState as getAccount, subscribe as subscribeAccount } from './supabaseStore.js'

export const LOAD_ERROR = "Couldn't load your notifications. Check your connection and try again."
export const OPEN_ERROR = "Couldn't open that notification. Check your connection and try again."

const REFRESH_MS = 60 * 1000

// status:
//   'signed-out' nobody is logged in
//   'loading'    loading the list after login
//   'ready'      loaded
//   'error'      load failed (error has the message; the old list is kept)
const SIGNED_OUT = { status: 'signed-out', userId: null, list: [], error: null }
let state = SIGNED_OUT
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

export function getNotificationsState() {
  return state
}

// How many the user hasn't seen (the badge number).
export function unseenCount(s = state) {
  return (s.list ?? []).filter((n) => !n.seenAt).length
}

// How many haven't been clicked (what "Mark all read" would change).
export function unreadCount(s = state) {
  return (s.list ?? []).filter((n) => !n.readAt).length
}

// Turns get_notifications rows into list entries.
export function rowsToNotifications(rows) {
  return (rows ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    createdAt: row.created_at,
    seenAt: row.seen_at,
    readAt: row.read_at,
    actorUsername: row.actor_username,
    reviewId: row.review_id,
    commentId: row.comment_id,
    reviewAuthorUsername: row.review_author_username,
    movieTitle: row.movie_title,
    preview: row.preview,
    available: row.available,
  }))
}

// Where a click goes. Comments and replies need the review author's name for
// the address, which the database only gives while the review is visible.
export function notificationHref(type, row) {
  if (type === 'friend_request') return '#/friends'
  if (type === 'blend_invite') return '#/blends'
  if (row?.reviewAuthorUsername && row.reviewId && row.commentId) {
    return reviewCommentHref(row.reviewAuthorUsername, row.reviewId, row.commentId)
  }
  return null
}

// ------------------------------------------------------------------ loading

// Reloads the list. Never throws: a failure puts the store in 'error' so the
// panel can offer a retry (the list we already had stays).
export async function loadNotifications() {
  const userId = state.userId
  if (!userId) return
  const { data, error } = await supabase.rpc('get_notifications')
  if (state.userId !== userId) return // logged out or switched users mid-request
  if (error) setState({ status: 'error', error: LOAD_ERROR })
  else setState({ status: 'ready', list: rowsToNotifications(data), error: null })
}

let timer = null

function stopRefreshing() {
  clearInterval(timer)
  timer = null
}

function startRefreshing() {
  stopRefreshing()
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') loadNotifications()
  }, REFRESH_MS)
}

function onAccountChange() {
  const userId = getAccount().user?.id ?? null
  if (userId === state.userId) return
  stopRefreshing()
  if (!userId) {
    setState(SIGNED_OUT)
    return
  }
  setState({ status: 'loading', userId, list: [], error: null })
  startRefreshing()
  loadNotifications()
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') loadNotifications()
}

let started = false

// Starts following login state. Call once at app startup, after startAuth().
export function startNotifications() {
  if (started) return
  started = true
  subscribeAccount(onAccountChange)
  document.addEventListener('visibilitychange', onVisibilityChange)
  onAccountChange()
}

// ------------------------------------------------------------------ writes

// Applies `patch` to every entry that matches, in the local copy.
function patchLocal(match, patch) {
  setState({ list: state.list.map((n) => (match(n) ? { ...n, ...patch } : n)) })
}

// Marks every notification seen (the panel was opened). The screen updates at
// once; if the database refuses, the list is reloaded so it shows the truth.
// Never throws.
export async function markAllSeen() {
  const userId = state.userId
  if (!userId || !state.list.some((n) => !n.seenAt)) return
  const stamp = new Date().toISOString()
  patchLocal((n) => !n.seenAt, { seenAt: stamp })
  const { error } = await supabase.from('notifications').update({ seen_at: stamp }).is('seen_at', null)
  if (error) await loadNotifications()
}

// Marks every notification read (and seen, where it wasn't). Never throws.
export async function markAllRead() {
  const userId = state.userId
  if (!userId || !state.list.some((n) => !n.readAt || !n.seenAt)) return
  const stamp = new Date().toISOString()
  setState({ list: state.list.map((n) => ({ ...n, readAt: n.readAt ?? stamp, seenAt: n.seenAt ?? stamp })) })
  const read = await supabase.from('notifications').update({ read_at: stamp }).is('read_at', null)
  const seen = await supabase.from('notifications').update({ seen_at: stamp }).is('seen_at', null)
  if (read.error || seen.error) await loadNotifications()
}

// A click on a notification. The database marks it read and checks right now
// whether its target still exists. Resolves to { available, type, href }:
// navigate to `href` when available, otherwise show "no longer available".
// Throws an Error with a readable message if the request fails (then nothing
// has changed, so the caller shouldn't navigate).
export async function openNotification(id) {
  const userId = state.userId
  if (!userId) throw new Error(OPEN_ERROR)
  const known = state.list.find((n) => n.id === id)
  const { data, error } = await supabase.rpc('open_notification', { p_id: id })
  if (error) throw new Error(OPEN_ERROR)
  if (state.userId === userId) {
    const stamp = new Date().toISOString()
    patchLocal((n) => n.id === id, { readAt: known?.readAt ?? stamp, seenAt: known?.seenAt ?? stamp })
  }
  const row = Array.isArray(data) ? data[0] : data
  // No row: it isn't ours (or was removed), so there is nothing to open.
  if (!row) return { available: false, type: known?.type ?? null, href: null }
  const href = row.available
    ? notificationHref(row.type, {
        reviewAuthorUsername: row.review_author_username,
        reviewId: row.review_id,
        commentId: row.comment_id,
      })
    : null
  // If an available comment has no address to go to, treat it as unavailable
  // rather than navigating nowhere.
  return { available: Boolean(row.available && href), type: row.type, href }
}
