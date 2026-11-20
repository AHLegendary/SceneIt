import { tmdbFetch } from '../_lib/tmdb.js';

// GET /api/movies/providers?id=27205
//
// Where a movie can be watched in the US: streaming, rent and buy options from
// TMDb (which takes them from JustWatch). Returns { link, stream, rent, buy }.
// Each list holds { id, name, logo_path }, sorted the way TMDb ranks them.
// `link` is TMDb's page with every option; TMDb only gives that link, not one
// per service. A movie nobody sells or streams gives empty lists.

const LIST_LIMIT = 12;

function pick(list) {
  return (list ?? [])
    .slice()
    .sort((a, b) => (a.display_priority ?? 0) - (b.display_priority ?? 0))
    .slice(0, LIST_LIMIT)
    .map((p) => ({ id: p.provider_id, name: p.provider_name, logo_path: p.logo_path ?? null }));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = String(req.query.id ?? '');
  if (!/^\d{1,10}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid movie id' });
  }

  try {
    const data = await tmdbFetch(`/movie/${id}/watch/providers`);
    const us = data.results?.US ?? {};
    res.setHeader?.('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({
      link: us.link ?? null,
      stream: pick(us.flatrate),
      rent: pick(us.rent),
      buy: pick(us.buy),
    });
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    console.error('Watch providers failed:', error.message);
    return res.status(502).json({ error: "Couldn't load where to watch, try again later." });
  }
}
