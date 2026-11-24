import { tmdbFetch, toMovie } from '../_lib/tmdb.js';

const MAX_QUERY_LENGTH = 100;
const MAX_PEOPLE = 3;
const MAX_MOVIES = 40;
const MIN_POPULARITY = 1;

// GET /api/movies/actors?q=tom hanks   -> { people: [{ id, name, profile_path }] }
// GET /api/movies/actors?id=31         -> { results: [movie] } the person's acting credits, most popular first
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { q, id } = req.query;
  try {
    if (typeof id === 'string') {
      if (!/^\d{1,9}$/.test(id)) return res.status(400).json({ error: 'Invalid person id' });
      const data = await tmdbFetch(`/person/${id}/movie_credits`);
      const seen = new Set();
      const credits = (data.cast ?? [])
        .filter((m) => m && m.id && m.title && !m.adult && !seen.has(m.id) && seen.add(m.id))
        .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
        .slice(0, MAX_MOVIES);
      return res.status(200).json({ results: credits.map(toMovie) });
    }

    const query = typeof q === 'string' ? q.trim() : '';
    if (!query) return res.status(400).json({ error: 'Missing search query' });
    if (query.length > MAX_QUERY_LENGTH) return res.status(400).json({ error: 'Search query is too long' });

    const data = await tmdbFetch('/search/person', { query, include_adult: 'false', page: '1' });
    const people = (data.results ?? [])
      .filter((p) => p && p.id && p.name && !p.adult && p.known_for_department === 'Acting')
      // TMDb lists obscure namesakes ("Tom Holland" x3); keep the best match, and others only if they have some following.
      .filter((p, i) => i === 0 || (p.popularity ?? 0) >= MIN_POPULARITY)
      .slice(0, MAX_PEOPLE)
      .map((p) => ({ id: p.id, name: p.name, profile_path: p.profile_path || null }));
    return res.status(200).json({ people });
  } catch (error) {
    console.error('Actor search failed:', error.message);
    return res.status(502).json({ error: "Couldn't load actors, try again later." });
  }
}
