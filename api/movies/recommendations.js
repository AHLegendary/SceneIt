import { tmdbFetch, toMovie } from '../_lib/tmdb.js';

export const MAX_SEEDS = 12;

// GET /api/movies/recommendations?ids=27205,157336
//
// TMDb's recommendations for each seed movie (TMDb ids), in TMDb's order:
//   { results: [{ seed: 27205, movies: [{ tmdb_id, title, ..., tmdb_rating, tmdb_votes }] }] }
// A seed TMDb can't answer for is left out, so one bad id doesn't sink the
// rest. Fails only when every seed fails.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const raw = typeof req.query.ids === 'string' ? req.query.ids : '';
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) {
    return res.status(400).json({ error: 'Missing movie ids' });
  }
  if (parts.length > MAX_SEEDS) {
    return res.status(400).json({ error: `At most ${MAX_SEEDS} movie ids` });
  }
  if (!parts.every((p) => /^\d{1,10}$/.test(p))) {
    return res.status(400).json({ error: 'Invalid movie id' });
  }
  const seeds = [...new Set(parts.map(Number))];

  const settled = await Promise.allSettled(
    seeds.map((id) => tmdbFetch(`/movie/${id}/recommendations`, { page: '1' })),
  );
  const results = [];
  settled.forEach((outcome, i) => {
    if (outcome.status !== 'fulfilled') return;
    const movies = (outcome.value.results ?? [])
      .filter((m) => m && m.id && m.title && !m.adult)
      .map((m) => ({ ...toMovie(m), tmdb_rating: m.vote_average ?? null, tmdb_votes: m.vote_count ?? null }));
    results.push({ seed: seeds[i], movies });
  });

  if (!results.length) {
    const reason = settled.find((s) => s.status === 'rejected')?.reason;
    console.error('Movie recommendations failed:', reason?.message);
    return res.status(502).json({ error: "Couldn't load recommendations, try again later." });
  }

  // TMDb's recommendations barely change day to day; let Vercel's CDN keep them.
  res.setHeader?.('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  return res.status(200).json({ results });
}
