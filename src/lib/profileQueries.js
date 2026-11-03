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
