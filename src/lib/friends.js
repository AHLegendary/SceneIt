// Friends and friend requests for the signed-in user, stored in Supabase.
//
// Same shape as supabaseStore.js: UI code calls these functions instead of
// talking to Supabase, and this module keeps an in-memory copy of the
// friendships list so React can read it synchronously:
//   * getFriendsState() returns the copy instantly
//   * writes (send, accept, remove) call the database, then reload the copy
//   * subscribe() tells React when the copy changes
//
// It follows supabaseStore's login state: logging in loads the list, logging
// out or switching users clears it.
//
// Each entry is { id, username, direction, createdAt } from the current
// user's side, where direction is 'incoming' (they asked you), 'outgoing'
// (you asked them) or 'friends'.

import { supabase } from './supabase.js'
import { getState as getAccount, subscribe as subscribeAccount } from './supabaseStore.js'

export const LOAD_ERROR = "Couldn't load your friends. Check your connection and try again."
export const SEARCH_ERROR = "Couldn't search for users. Check your connection and try again."
export const SEND_ERROR = "Couldn't send that request. Check your connection and try again."
export const ACCEPT_ERROR = "Couldn't accept that request. It may have been cancelled."
export const REMOVE_ERROR = "Couldn't update your friends. Check your connection and try again."

// What send_friend_request returns, as a message for the user.
export const SEND_RESULTS = {
  sent: 'Request sent',
  accepted: "They'd already asked you, so you're now friends",
  already_sent: 'Request already sent',
  already_friends: "You're already friends",
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// status:
//   'signed-out' nobody is logged in
//   'loading'    loading the list after login
//   'ready'      loaded
//   'error'      load failed (error has the message)
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

export function getFriendsState() {
  return state
}

// Splits the list into the three groups the Friends page shows.
// Pure, so it's easy to test.
export function groupFriendships(list) {
  const groups = { incoming: [], outgoing: [], friends: [] }
  for (const entry of list ?? []) groups[entry.direction]?.push(entry)
  groups.friends.sort((a, b) => a.username.localeCompare(b.username))
  return groups
}

// How the current user is connected to `userId`: 'friends', 'incoming',
// 'outgoing', or null if not at all.
export function relationTo(list, userId) {
  return (list ?? []).find((entry) => entry.id === userId)?.direction ?? null
}

// Ids of accepted friends. Their rankings are readable under RLS even when
// their profile is private, which is what friend-based recommendations use.
export function getFriendIds() {
  return state.list.filter((entry) => entry.direction === 'friends').map((entry) => entry.id)
}

// Turns get_friendships rows into list entries.
export function rowsToFriendships(rows) {
  return (rows ?? []).map((row) => ({
    id: row.user_id,
    username: row.username,
    direction: row.direction,
    createdAt: row.created_at,
  }))
}

// ------------------------------------------------------------------ loading

// Reloads the list. Never throws: a failure puts the store in 'error' so the
// page can offer a retry.
export async function loadFriends() {
  const userId = state.userId
  if (!userId) return
  const { data, error } = await supabase.rpc('get_friendships')
  if (state.userId !== userId) return // logged out or switched users mid-request
  if (error) setState({ status: 'error', error: LOAD_ERROR })
  else setState({ status: 'ready', list: rowsToFriendships(data), error: null })
}

function onAccountChange() {
  const userId = getAccount().user?.id ?? null
  if (userId === state.userId) return
  if (!userId) {
    setState(SIGNED_OUT)
    return
  }
  setState({ status: 'loading', userId, list: [], error: null })
  loadFriends()
}

let started = false

// Starts following login state. Call once at app startup, after startAuth().
export function startFriends() {
  if (started) return
  started = true
  subscribeAccount(onAccountChange)
  onAccountChange()
}

// ------------------------------------------------------------------ search

// Finds users by username prefix (2+ characters). Returns [{ id, username }]
// without the current user. Throws an Error with a user-facing message.
export async function searchUsers(query) {
  const q = (query ?? '').trim()
  if (q.length < 2) return []
  const { data, error } = await supabase.rpc('search_users', { q })
  if (error) throw new Error(SEARCH_ERROR)
  return (data ?? []).filter((user) => user.id !== state.userId)
}

// ------------------------------------------------------------------ writes

function requireSignedIn() {
  if (!state.userId) throw new Error('Log in to add friends.')
}

function requireUserId(userId) {
  if (typeof userId !== 'string' || !UUID.test(userId)) throw new Error(`Unknown user: ${userId}`)
}

// Sends a request, or accepts theirs if they already asked. Returns one of
// the SEND_RESULTS keys. Throws an Error with a user-facing message.
export async function sendFriendRequest(userId) {
  requireSignedIn()
  requireUserId(userId)
  const { data, error } = await supabase.rpc('send_friend_request', { p_user_id: userId })
  if (error) throw new Error(SEND_ERROR)
  await loadFriends()
  return data
}

// Accepts a pending request from `userId`.
export async function acceptFriendRequest(userId) {
  requireSignedIn()
  requireUserId(userId)
  const { data, error } = await supabase
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('requester_id', userId)
    .eq('addressee_id', state.userId)
    .select('requester_id')
  await loadFriends()
  // No row back means the request was cancelled before we accepted it.
  if (error || !data?.length) throw new Error(ACCEPT_ERROR)
}

// Removes whatever is between the current user and `userId`: declines an
// incoming request, cancels an outgoing one, or unfriends.
export async function removeFriendship(userId) {
  requireSignedIn()
  requireUserId(userId)
  const me = state.userId
  const { error } = await supabase
    .from('friendships')
    .delete()
    .or(`and(requester_id.eq.${me},addressee_id.eq.${userId}),and(requester_id.eq.${userId},addressee_id.eq.${me})`)
  if (error) throw new Error(REMOVE_ERROR)
  await loadFriends()
}
