import { supabase } from './supabase.js'

const COLUMNS = 'username, bio, pronouns, is_public'

// RLS lets users read and update only their own row here.
export async function fetchProfile(userId) {
  const { data, error } = await supabase.from('profiles').select(COLUMNS).eq('id', userId).single()
  if (error) throw error
  return data
}

export async function saveProfile(userId, update) {
  const { data, error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', userId)
    .select(COLUMNS)
    .single()
  if (error) throw error
  return data
}

import { escapeLike } from './profileValidation.js'

// Another user's profile by username (any capitalization). Returns null when
// there's no row the current user is allowed to see: the username doesn't
// exist, or the profile is private and they aren't friends. RLS decides.
export async function fetchProfileByUsername(username) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, bio, pronouns, is_public')
    .ilike('username', escapeLike(username))
    .maybeSingle()
  if (error) throw error
  return data
}
