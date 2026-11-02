// Server-only Supabase client that uses the secret key, so it skips RLS.
// Never import this file from src/. Only use it for writes users aren't
// allowed to make themselves (like adding a movie to the shared catalog),
// and always check who's asking first with getUserFromRequest.
import { createClient } from '@supabase/supabase-js';

let client = null;

export function getAdminClient() {
  if (client) return client;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  // api/login.js calls the same key SUPABASE_SERVICE_ROLE_KEY; accept either.
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set');
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

// The logged-in user making the request, from the "Authorization: Bearer
// <access token>" header the frontend sends, or null if there isn't a valid one.
export async function getUserFromRequest(req) {
  const header = req.headers?.authorization ?? req.headers?.Authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const { data, error } = await getAdminClient().auth.getUser(match[1]);
  if (error || !data?.user) return null;
  return data.user;
}
