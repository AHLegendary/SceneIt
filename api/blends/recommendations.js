import { getAdminClient, getUserFromRequest } from '../_lib/supabaseAdmin.js';
import { fetchTmdbRecommendations } from '../_lib/tmdb.js';
import { mergeTmdbRecs } from '../../src/features/recommendations/recommend.js';
import { BLEND_REC_LIMIT, pickBlendSeeds, scoreBlend } from '../../src/features/blends/blendRecs.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One member's rankings as tiers of movies, best first. Movie ids are TMDb ids
// here, matching the candidates from TMDb.
function toTiers(rows) {
  const byPosition = new Map();
  for (const row of rows) {
    if (!row.movies) continue;
    const movie = { ...row.movies, id: row.movie_id, tmdb_id: row.movie_id, category: row.category };
    if (!byPosition.has(row.position)) byPosition.set(row.position, []);
    byPosition.get(row.position).push(movie);
  }
  return [...byPosition.entries()].sort(([a], [b]) => a - b).map(([, tier]) => tier);
}

// GET /api/blends/recommendations?id=<blend id>
// Authorization: Bearer <access token>
//
// Recommendations for a blend the caller is in (see src/features/blends/blendRecs.js):
//   { results: [{ movie: { tmdb_id, title, ... }, lovedCount, memberCount, because }] }
// `because` is a group favorite's title or null. Reads every member's rankings
// with the admin client, so only group-level facts go out: members don't have
// to be friends, and their profiles can be private.
// 404 { error: 'blend_not_found' } when the blend is gone or the caller isn't in it.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Log in to see blend recommendations.' });
  }
  const blendId = typeof req.query?.id === 'string' ? req.query.id : '';
  if (!UUID.test(blendId)) {
    return res.status(400).json({ error: 'Invalid blend id' });
  }

  const db = getAdminClient();
  const members = await db.from('blend_members').select('user_id').eq('blend_id', blendId);
  if (members.error) {
    console.error('Blend members failed:', members.error.message);
    return res.status(500).json({ error: "Couldn't load recommendations, try again later." });
  }
  const memberIds = (members.data ?? []).map((m) => m.user_id);
  if (!memberIds.includes(user.id)) {
    return res.status(404).json({ error: 'blend_not_found' });
  }
  if (memberIds.length < 2) {
    return res.status(200).json({ results: [] });
  }

  // One query per member: a single query would hit the API's 1000-row cap.
  const lists = await Promise.all(
    memberIds.map((id) =>
      db
        .from('rankings')
        .select('movie_id, position, category, movies(tmdb_id, title, year, poster_path, genres, overview)')
        .eq('user_id', id)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true }),
    ),
  );
  const failed = lists.find((l) => l.error);
  if (failed) {
    console.error('Blend rankings failed:', failed.error.message);
    return res.status(500).json({ error: "Couldn't load recommendations, try again later." });
  }
  const memberTiers = lists.map((l) => toTiers(l.data ?? []));

  // TMDb finds movies nobody in the blend has ranked. Without it the blend
  // still works from the members' own lists.
  const seeds = pickBlendSeeds(memberTiers);
  const settled = await Promise.allSettled(seeds.map((m) => fetchTmdbRecommendations(m.tmdb_id)));
  const tmdbResults = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled') tmdbResults.push({ seed: seeds[i].tmdb_id, movies: outcome.value });
    else console.warn('TMDb recommendations failed for a blend seed:', outcome.reason?.message);
  });
  const seedsByTmdb = new Map(seeds.map((m) => [m.tmdb_id, m]));
  const { candidates, links } = mergeTmdbRecs(tmdbResults, seedsByTmdb, (row) => ({ ...row, id: row.tmdb_id }));

  const results = scoreBlend(memberTiers, candidates, { links })
    .slice(0, BLEND_REC_LIMIT)
    .map(({ movie, lovedCount, memberCount, because }) => ({
      movie: {
        tmdb_id: movie.tmdb_id,
        title: movie.title,
        year: movie.year ?? null,
        poster_path: movie.poster_path ?? null,
        genres: movie.genres ?? [],
        overview: movie.overview ?? '',
      },
      lovedCount,
      memberCount,
      because: because?.title ?? null,
    }));
  return res.status(200).json({ results });
}
