import { tmdbFetch, toMovie } from '../_lib/tmdb.js';

// GET /api/movies/trending   this week's most popular movies on TMDb
//
// Same shape as search results (our `movies` table) plus backdrop_path, which
// the homepage uses for its wide cards. Results are cached by the CDN for an
// hour: trending barely changes and this is the first request on every visit.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = await tmdbFetch('/trending/movie/week', { page: '1' });
    const results = (data.results ?? [])
      .filter((raw) => !raw.adult)
      .map((raw) => ({ ...toMovie(raw), backdrop_path: raw.backdrop_path || null }));
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ results });
  } catch (error) {
    console.error('Trending failed:', error.message);
    return res.status(502).json({ error: "Couldn't load trending movies, try again later." });
  }
}
