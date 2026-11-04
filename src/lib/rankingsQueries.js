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
