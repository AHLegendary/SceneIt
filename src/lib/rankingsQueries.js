import { supabase } from './supabase.js'
import { rowsToTiers } from './supabaseStore.js'

// Another user's ranked list as tiers, best first. RLS only returns rows when
// the owner's profile is visible to you (public, you, or a friend), so a
// private non-friend gets an empty list, not an error. Check profile access first.
export async function fetchUserTiers(userId) {
  const { data, error } = await supabase
    .from('rankings')
    .select('movie_id, position, movies(tmdb_id, title, year, poster_path, genres, overview)')
    .eq('user_id', userId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return rowsToTiers(data)
}

// Several users' ranked lists in one request, as a Map of user id -> tiers.
// Meant for friends: RLS lets you read a friend's rankings even when their
// profile is private. Users with nothing ranked (or hidden) are left out.
export async function fetchTiersForUsers(userIds) {
  const ids = [...new Set(userIds)]
  if (!ids.length) return new Map()
  const { data, error } = await supabase
    .from('rankings')
    .select('user_id, movie_id, position, movies(tmdb_id, title, year, poster_path, genres, overview)')
    .in('user_id', ids)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return groupRowsByUser(data)
}

// rankings rows (with user_id) -> Map of user id -> tiers. Pure.
export function groupRowsByUser(rows) {
  const byUser = new Map()
  for (const row of rows ?? []) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, [])
    byUser.get(row.user_id).push(row)
  }
  const result = new Map()
  for (const [userId, userRows] of byUser) {
    const tiers = rowsToTiers(userRows)
    if (tiers.length) result.set(userId, tiers)
  }
  return result
}
