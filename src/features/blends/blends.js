// Movie Blend data for the signed-in user, stored in Supabase.
//
// Same shape as src/lib/friends.js: UI code calls these functions instead of
// talking to Supabase, and this module keeps an in-memory copy of the user's
// blends and open invites so React can read it synchronously. One blend's
// members and recommendations are fetched when its page opens.
//
// The rules (15 rankings, friends only, 5 members, owner transfer) live in the
// database, see supabase/migrations/20261104000000_movie_blends.sql. The
// constants here only decide what the UI offers.

import { movieFromDb } from '../../lib/localStore.js'
import { supabase } from '../../lib/supabase.js'
import { getState as getAccount, subscribe as subscribeAccount } from '../../lib/supabaseStore.js'

export const BLEND_MAX_MEMBERS = 5
export const BLEND_MIN_RANKINGS = 15

export const LOAD_ERROR = "Couldn't load your blends. Check your connection and try again."
export const DETAIL_ERROR = "Couldn't load this blend. Check your connection and try again."
export const CREATE_ERROR = "Couldn't create the blend. Check your connection and try again."
export const INVITE_ERROR = "Couldn't send that invite. Check your connection and try again."
export const RESPOND_ERROR = "Couldn't answer that invite. Check your connection and try again."
export const LEAVE_ERROR = "Couldn't leave the blend. Check your connection and try again."
export const BLEND_GONE = 'That blend no longer exists.'

// What the database's error messages mean to the user.
const ERROR_MESSAGES = {
  not_enough_rankings: `You need at least ${BLEND_MIN_RANKINGS} ranked movies to create a blend. Rank a few more and try again.`,
  friend_required: 'Pick at least one friend to invite.',
  invalid_user: "You can't invite that person.",
  not_friends: 'You can only invite your friends.',
  not_blend_owner: 'Only the blend owner can invite people.',
  blend_full: `This blend is full. A blend can have up to ${BLEND_MAX_MEMBERS} people.`,
  already_member: "They're already in this blend.",
  already_invited: "They've already been invited.",
  invite_invalid: 'This invite is no longer valid.',
  invite_expired: 'This invite has expired. Ask for a new one.',
  blend_not_found: BLEND_GONE,
}

// An error with a user-facing message. `code` is the database's error when it
// meant something specific, or null for connection and unexpected failures.
export class BlendError extends Error {
  constructor(message, code = null) {
    super(message)
    this.name = 'BlendError'
    this.code = code
  }
}

export function toBlendError(error, fallback) {
  const code = error?.message
  return Object.hasOwn(ERROR_MESSAGES, code ?? '')
    ? new BlendError(ERROR_MESSAGES[code], code)
    : new BlendError(fallback)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// status:
//   'signed-out' nobody is logged in
//   'loading'    loading after login
//   'ready'      loaded
//   'error'      load failed (error has the message)
// notice is a one-time message for the blends page, like a blend that vanished.
const SIGNED_OUT = { status: 'signed-out', userId: null, blends: [], invites: [], error: null, notice: null }
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

export function getBlendsState() {
  return state
}

export function setBlendNotice(notice) {
  setState({ notice })
}

// ------------------------------------------------------------------ row mapping

export function rowsToBlends(rows) {
  return (rows ?? []).map((row) => ({
    id: row.blend_id,
    ownerId: row.owner_id,
    ownerUsername: row.owner_username,
    memberUsernames: row.member_usernames ?? [],
    memberCount: Number(row.member_count),
    joinedAt: row.joined_at,
  }))
}

export function rowsToInvites(rows) {
  return (rows ?? []).map((row) => ({
    id: row.invite_id,
    blendId: row.blend_id,
    inviterUsername: row.inviter_username,
    memberCount: Number(row.member_count),
    expiresAt: row.expires_at,
  }))
}

export function rowsToMembers(rows) {
  return (rows ?? []).map((row) => ({
    id: row.user_id,
    username: row.username,
    isOwner: Boolean(row.is_owner),
    joinedAt: row.joined_at,
  }))
}

export function rowsToSentInvites(rows) {
  return (rows ?? []).map((row) => ({
    id: row.invite_id,
    inviteeId: row.invitee_id,
    username: row.invitee_username,
    status: row.status,
  }))
}

// movieFromDb remembers movies outside the catalog, so the existing details
// view can open them by id. Rows we can't build a movie for are skipped.
export function rowsToRecommendations(rows) {
  const out = []
  for (const row of rows ?? []) {
    const movie = movieFromDb({ ...row, tmdb_id: row.movie_id })
    if (!movie) continue
    out.push({
      movie,
      likedCount: Number(row.liked_count),
      memberCount: Number(row.member_count),
      avgScore: Number(row.avg_score),
    })
  }
  return out
}

// ------------------------------------------------------------------ loading

// Reloads blends and invites. Never throws: a failure puts the store in
// 'error' so the page can offer a retry.
export async function loadBlends() {
  const userId = state.userId
  if (!userId) return
  const [blends, invites] = await Promise.all([
    supabase.rpc('get_my_blends'),
    supabase.rpc('get_my_blend_invites'),
  ])
  if (state.userId !== userId) return // logged out or switched users mid-request
  if (blends.error || invites.error) setState({ status: 'error', error: LOAD_ERROR })
  else {
    setState({
      status: 'ready',
      blends: rowsToBlends(blends.data),
      invites: rowsToInvites(invites.data),
      error: null,
    })
  }
}

function onAccountChange() {
  const userId = getAccount().user?.id ?? null
  if (userId === state.userId) return
  if (!userId) {
    setState(SIGNED_OUT)
    return
  }
  setState({ ...SIGNED_OUT, status: 'loading', userId })
  loadBlends()
}

let started = false

// Starts following login state. Call once at app startup, after startAuth().
export function startBlends() {
  if (started) return
  started = true
  subscribeAccount(onAccountChange)
  onAccountChange()
}

// One blend's page: { members, sentInvites, recommendations }, or null when the
// blend doesn't exist or the user isn't in it. Throws a BlendError on failure.
export async function fetchBlendDetail(blendId) {
  if (typeof blendId !== 'string' || !UUID.test(blendId)) return null
  const args = { p_blend_id: blendId }
  const [members, sentInvites, recommendations] = await Promise.all([
    supabase.rpc('get_blend_members', args),
    supabase.rpc('get_blend_sent_invites', args),
    supabase.rpc('get_blend_recommendations', args),
  ])
  const failed = members.error || sentInvites.error || recommendations.error
  if (failed) throw toBlendError(failed, DETAIL_ERROR)
  if (!members.data?.length) return null
  return {
    members: rowsToMembers(members.data),
    sentInvites: rowsToSentInvites(sentInvites.data),
    recommendations: rowsToRecommendations(recommendations.data),
  }
}

// ------------------------------------------------------------------ writes

async function call(name, args, fallback) {
  if (!state.userId) throw new BlendError('Log in to use Movie Blend.')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw toBlendError(error, fallback)
  return data
}

// Creates a blend and invites these friends. Returns the new blend's id.
export async function createBlend(friendIds) {
  const id = await call('create_blend', { p_friend_ids: friendIds }, CREATE_ERROR)
  await loadBlends()
  return id
}

export async function inviteToBlend(blendId, userId) {
  return call('invite_to_blend', { p_blend_id: blendId, p_user_id: userId }, INVITE_ERROR)
}

// Accepts or declines. Returns the blend's id. The list reloads either way, so
// an invite that turned out to be invalid disappears.
export async function respondToInvite(inviteId, accept) {
  try {
    return await call('respond_to_blend_invite', { p_invite_id: inviteId, p_accept: accept }, RESPOND_ERROR)
  } finally {
    await loadBlends()
  }
}

// Returns 'left', 'transferred' or 'deleted'.
export async function leaveBlend(blendId) {
  const result = await call('leave_blend', { p_blend_id: blendId }, LEAVE_ERROR)
  await loadBlends()
  return result
}
