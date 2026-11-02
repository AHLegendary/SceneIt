// Community leaderboard, computed in the database by get_leaderboard (see
// supabase/migrations). It's public: logged-out visitors can read it too.
//
// The database returns TMDb ids; the UI uses catalog ids like
// "dune-part-two-2024". We convert here, like supabaseStore.js does.

import { movieFromDb } from './localStore.js'
import { supabase } from './supabase.js'

export const PERIODS = ['weekly', 'monthly']
export const CATEGORIES = ['highest', 'watched']
export const LEADERBOARD_ERROR = "Couldn't load the leaderboard. Check your connection and try again."

// Turns get_leaderboard rows into the shape the page shows:
// { ...movie, score, rankers, rank }. Movies outside the catalog use the
// title, year and poster the database returns. Rows we can't build a movie
// for are skipped and the rest renumbered so ranks stay 1, 2, 3...
export function rowsToLeaderboard(rows) {
  const out = []
  for (const row of rows ?? []) {
    const movie = movieFromDb({ ...row, tmdb_id: row.movie_id })
    if (!movie) continue
    out.push({ ...movie, score: Number(row.score), rankers: Number(row.rankers), rank: out.length + 1 })
  }
  return out
}

// Leaderboard for a period ('weekly' | 'monthly'), ordered by category:
// 'highest' = best community score, 'watched' = most users ranked it.
// Throws an Error with a user-facing message if the request fails.
export async function fetchLeaderboard(period = 'weekly', category = 'highest', limit = 10) {
  if (!PERIODS.includes(period)) throw new Error(`Unknown leaderboard period: ${period}`)
  if (!CATEGORIES.includes(category)) throw new Error(`Unknown leaderboard category: ${category}`)
  const { data, error } = await supabase.rpc('get_leaderboard', {
    p_period: period,
    p_category: category,
    p_limit: limit,
  })
  if (error) throw new Error(LEADERBOARD_ERROR)
  return rowsToLeaderboard(data)
}

// How the community ranks one movie this week and this month.
// Returns { weekly, monthly }, each { rank, score, rankers } or null when the
// movie isn't on that board. Looks at the top 100 (the database's maximum).
export async function fetchCommunityStats(id) {
  const boards = await Promise.all(PERIODS.map((period) => fetchLeaderboard(period, 'highest', 100)))
  const stats = {}
  PERIODS.forEach((period, i) => {
    const row = boards[i].find((r) => r.id === id)
    stats[period] = row ? { rank: row.rank, score: row.score, rankers: row.rankers } : null
  })
  return stats
}
