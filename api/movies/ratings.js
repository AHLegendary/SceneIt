import { pickRatings } from '../../src/lib/movieDetails.js';
import { omdbFetch } from '../_lib/omdb.js';
import { getAdminClient } from '../_lib/supabaseAdmin.js';
import { tmdbFetch } from '../_lib/tmdb.js';

// GET /api/movies/ratings?id=27205
//
// IMDb and Rotten Tomatoes scores for a movie that isn't in the built-in
// catalog. TMDb gives the movie's IMDb id, OMDb gives the scores, and the
// answer is cached in movie_ratings so OMDb (a small free daily quota) is asked
// once per movie, not once per click. A shared daily budget (omdb_usage) stops
// the number of OMDb lookups from ever passing the quota, however many people ask.
//
// Returns { imdb_id, ratings }, where ratings is { imdb, imdb_votes, rt, checked }
// (the same shape as `ratings` in src/data/movies.json) or null when no scores exist.

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_SCORES_DAYS = 14; // scores change slowly
const RETRY_EMPTY_DAYS = 2; // nothing found yet: look again sooner
// OMDb's free key allows 1,000 requests a day. Stop short of that, so the key
// is never locked out and the daily scripts (npm run ratings) still have room.
const DAILY_BUDGET = 900;

class BudgetUsedUp extends Error {}

// Takes one of today's OMDb lookups from the shared counter in the database
// (atomic, so simultaneous requests can't overspend). False means it's used up.
// If the counter itself can't be reached, carry on: losing the scores would be worse.
async function claimLookup(db) {
  if (!db) return true;
  const { data, error } = await db.rpc('claim_omdb_call', { p_limit: DAILY_BUDGET });
  if (error) {
    console.error('OMDb budget check failed:', error.message);
    return true;
  }
  return data === true;
}

const hasScores = (row) => row.imdb !== null || row.rt !== null;

function isFresh(row, now) {
  const days = hasScores(row) ? KEEP_SCORES_DAYS : RETRY_EMPTY_DAYS;
  return now - new Date(row.checked_at).getTime() < days * DAY_MS;
}

function send(res, row) {
  const found = hasScores(row);
  // Let Vercel's CDN keep the answer too.
  res.setHeader?.(
    'Cache-Control',
    found ? 'public, s-maxage=86400, stale-while-revalidate=604800' : 'public, s-maxage=3600',
  );
  return res.status(200).json({
    imdb_id: row.imdb_id ?? null,
    ratings: found
      ? { imdb: row.imdb, imdb_votes: row.imdb_votes, rt: row.rt, checked: String(row.checked_at).slice(0, 10) }
      : null,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = String(req.query.id ?? '');
  if (!/^\d{1,10}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid movie id' });
  }
  const tmdbId = Number(id);

  // The cache is an optimisation: if it can't be read or written, carry on without it.
  let db = null;
  let cached = null;
  try {
    db = getAdminClient();
    const { data, error } = await db
      .from('movie_ratings')
      .select('tmdb_id, imdb_id, imdb, imdb_votes, rt, checked_at')
      .eq('tmdb_id', tmdbId)
      .maybeSingle();
    if (error) console.error('Ratings cache read failed:', error.message);
    else cached = data;
  } catch (error) {
    console.error('Ratings cache unavailable:', error.message);
  }

  if (cached && isFresh(cached, Date.now())) return send(res, cached);

  try {
    let external;
    try {
      external = await tmdbFetch(`/movie/${tmdbId}/external_ids`);
    } catch (error) {
      if (error.status === 404) return res.status(404).json({ error: 'Movie not found' });
      throw error;
    }

    const imdbId = /^tt\d{5,10}$/.test(external?.imdb_id ?? '') ? external.imdb_id : null;
    let omdb = null;
    if (imdbId) {
      if (!(await claimLookup(db))) throw new BudgetUsedUp("Today's OMDb lookups are used up");
      omdb = await omdbFetch(imdbId);
    }
    const row = {
      tmdb_id: tmdbId,
      imdb_id: imdbId,
      ...pickRatings(omdb),
      checked_at: new Date().toISOString(),
    };
    // Say why a movie ends up with no scores, so "Not available" can be traced.
    if (!hasScores(row)) {
      const why = !imdbId
        ? 'TMDb has no IMDb id for it'
        : !omdb
          ? `OMDb doesn't know ${imdbId}`
          : `OMDb answered but nothing was read from it (imdbRating=${omdb.imdbRating}; Ratings=${JSON.stringify(omdb.Ratings)})`;
      console.warn(`No scores for TMDb ${tmdbId}: ${why}`);
    }

    if (db) {
      const { error } = await db.from('movie_ratings').upsert(row, { onConflict: 'tmdb_id' });
      if (error) console.error('Ratings cache write failed:', error.message);
    }
    return send(res, row);
  } catch (error) {
    console.error('Ratings lookup failed:', error.message);
    // Out-of-date scores are better than none.
    if (cached) return send(res, cached);
    res.setHeader?.('Cache-Control', 'no-store');
    if (error instanceof BudgetUsedUp) {
      return res.status(503).json({ error: 'Scores are temporarily unavailable.' });
    }
    return res.status(502).json({ error: "Couldn't load scores, try again later." });
  }
}
