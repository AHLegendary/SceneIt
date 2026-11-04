import { getAdminClient, getUserFromRequest } from '../_lib/supabaseAdmin.js';
import { tmdbFetch, toMovie } from '../_lib/tmdb.js';
import { pickDetails } from '../../src/lib/movieDetails.js';

const MOVIE_COLUMNS = 'tmdb_id, title, year, poster_path, genres, overview';

// GET  /api/movies/27205   movie info from TMDb, with the details the panel
//                          shows (runtime, director, cast, tagline, backdrop)
// POST /api/movies/27205   makes sure the movie is in our `movies` table so it
//                          can be ranked (rankings.movie_id points at it).
//                          Logged-in users only. Returns the saved row.
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = String(req.query.id ?? '');
  if (!/^\d{1,10}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid movie id' });
  }

  if (req.method === 'POST') return saveMovie(req, res, Number(id));

  try {
    const data = await tmdbFetch(`/movie/${id}`, { append_to_response: 'credits' });
    res.setHeader?.('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({ movie: { ...toMovie(data), ...pickDetails(data) } });
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    console.error('Movie details failed:', error.message);
    return res.status(502).json({ error: "Couldn't load movie, try again later." });
  }
}

async function saveMovie(req, res, tmdbId) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Log in to rank movies.' });
    }

    const db = getAdminClient();
    const existing = await db.from('movies').select(MOVIE_COLUMNS).eq('tmdb_id', tmdbId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      return res.status(200).json({ movie: existing.data });
    }

    // Only save what TMDb confirms exists, never what the client sent.
    let raw;
    try {
      raw = await tmdbFetch(`/movie/${tmdbId}`);
    } catch (error) {
      if (error.status === 404) return res.status(404).json({ error: 'Movie not found' });
      throw error;
    }
    const saved = await db
      .from('movies')
      .upsert({ ...toMovie(raw), cached_at: new Date().toISOString() }, { onConflict: 'tmdb_id' })
      .select(MOVIE_COLUMNS)
      .single();
    if (saved.error) throw saved.error;
    return res.status(201).json({ movie: saved.data });
  } catch (error) {
    console.error('Saving movie failed:', error.message);
    return res.status(502).json({ error: "Couldn't save that movie, try again." });
  }
}
