// Problems with the browser-side env vars the app can't start without.
export function envProblems(env = import.meta.env) {
  const problems = []
  const url = env.VITE_SUPABASE_URL
  if (!url) problems.push('VITE_SUPABASE_URL is missing')
  else {
    try { new URL(url) } catch { problems.push('VITE_SUPABASE_URL is not a valid URL') }
  }
  if (!env.VITE_SUPABASE_PUBLISHABLE_KEY) problems.push('VITE_SUPABASE_PUBLISHABLE_KEY is missing')
  return problems
}
