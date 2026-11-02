// POST /api/login  { username, password }
//
// Supabase Auth only signs in with an email, so this looks up the email for a
// username on the server and signs in there. The email never reaches the
// browser, and unknown usernames and wrong passwords get the same response.
//
// Env vars (Vercel project settings, and .env for `vercel dev`):
//   VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY  (already used by the client)
//   SUPABASE_SERVICE_ROLE_KEY                          (server only, never VITE_)
import { createClient } from '@supabase/supabase-js'

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/
const BAD_CREDENTIALS = { error: 'invalid_credentials' }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const { username, password } = req.body ?? {}
  if (typeof username !== 'string' || typeof password !== 'string' || !USERNAME_PATTERN.test(username) || !password) {
    return res.status(401).json(BAD_CREDENTIALS)
  }

  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !publishableKey || !serviceKey) {
    const missing = [
      !url && 'VITE_SUPABASE_URL',
      !publishableKey && 'VITE_SUPABASE_PUBLISHABLE_KEY',
      !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY',
    ].filter(Boolean)
    console.error('Login: missing env vars:', missing.join(', '))
    return res.status(500).json({ error: 'server_not_configured' })
  }

  const noSession = { auth: { persistSession: false, autoRefreshToken: false } }
  const admin = createClient(url, serviceKey, noSession)

  try {
    // Usernames are unique ignoring case. In LIKE patterns "_" is a wildcard, so escape it.
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id')
      .ilike('username', username.replace(/_/g, '\\_'))
      .maybeSingle()
    if (profileError) {
      console.error('Login: profile lookup failed:', profileError.message)
      return res.status(500).json({ error: 'lookup_failed' })
    }
    if (!profile) return res.status(401).json(BAD_CREDENTIALS)

    const { data: found, error: userError } = await admin.auth.admin.getUserById(profile.id)
    const email = found?.user?.email
    if (userError) console.error('Login: auth user lookup failed:', userError.message)
    if (userError || !email) return res.status(401).json(BAD_CREDENTIALS)

    const anon = createClient(url, publishableKey, noSession)
    const { data, error } = await anon.auth.signInWithPassword({ email, password })
    if (error && error.status !== 400) console.error('Login: sign-in failed:', error.message)
    if (error || !data.session) {
      return res.status(error?.status === 400 ? 401 : 502).json(error?.status === 400 ? BAD_CREDENTIALS : { error: 'auth_unavailable' })
    }

    const { access_token, refresh_token } = data.session
    return res.status(200).json({ session: { access_token, refresh_token } })
  } catch (error) {
    console.error('Login: unexpected error:', error.message)
    return res.status(502).json({ error: 'auth_unavailable' })
  }
}
