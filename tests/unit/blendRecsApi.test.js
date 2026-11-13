import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BLEND = '00000000-0000-0000-0000-0000000000b1';
const db = vi.hoisted(() => ({ members: [], rankings: {}, error: null }));

// Minimal admin client: blend_members by blend, rankings by user.
function query(table) {
  const filters = {};
  const q = {
    select: () => q,
    order: () => q,
    eq: (col, value) => {
      filters[col] = value;
      return q;
    },
    then: (resolve) => {
      if (db.error) return resolve({ data: null, error: db.error });
      if (table === 'blend_members') return resolve({ data: db.members.map((user_id) => ({ user_id })), error: null });
      return resolve({ data: db.rankings[filters.user_id] ?? [], error: null });
    },
  };
  return q;
}

vi.mock('../../api/_lib/supabaseAdmin.js', () => ({
  getAdminClient: () => ({ from: query }),
  getUserFromRequest: async (req) => (req.headers?.authorization === 'Bearer good' ? { id: 'ana' } : null),
}));

const { default: handler } = await import('../../api/blends/recommendations.js');

function mockRes() {
  const res = {};
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  return res;
}
const call = async (query = { id: BLEND }, headers = { authorization: 'Bearer good' }, method = 'GET') => {
  const res = mockRes();
  await handler({ method, headers, query }, res);
  return res;
};
const row = (id, position, category) => ({
  movie_id: id, position, category, movies: { tmdb_id: id, title: `Movie ${id}`, year: 2020, genres: [] },
});
const tmdbMovie = (id) => ({ id, title: `Found ${id}`, release_date: '2021-01-01', genre_ids: [], vote_average: 7.8, vote_count: 900 });

beforeEach(() => {
  vi.stubEnv('TMDB_READ_TOKEN', 'test-token');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  db.members = ['ana', 'ben'];
  db.error = null;
  db.rankings = {
    ana: [row(1, 0, 'loved'), row(2, 1, 'okay')],
    ben: [row(3, 0, 'loved'), row(1, 1, 'loved'), row(4, 2, 'meh')],
  };
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: true,
    status: 200,
    json: async () => ({ results: String(url).includes('/movie/1/') ? [tmdbMovie(500)] : [] }),
  })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/blends/recommendations', () => {
  it('checks method, login and id', async () => {
    expect((await call({ id: BLEND }, {}, 'POST')).statusCode).toBe(405);
    expect((await call({ id: BLEND }, {})).statusCode).toBe(401);
    expect((await call({ id: 'nope' })).statusCode).toBe(400);
  });

  it("says blend_not_found to someone who isn't a member", async () => {
    db.members = ['ben', 'cat'];
    const res = await call();
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'blend_not_found' });
  });

  it('returns nothing until a second member joins', async () => {
    db.members = ['ana'];
    expect((await call()).body).toEqual({ results: [] });
  });

  it('mixes TMDb discoveries with members\' movies and sends only group-level facts', async () => {
    const res = await call();
    expect(res.statusCode).toBe(200);
    const byId = new Map(res.body.results.map((r) => [r.movie.tmdb_id, r]));
    expect(byId.get(500)).toMatchObject({ movie: { title: 'Found 500' }, lovedCount: 0, memberCount: 2, because: 'Movie 1' });
    expect(byId.get(3)).toMatchObject({ lovedCount: 1, memberCount: 2 });
    expect(byId.has(1)).toBe(false); // both ranked it
    expect(byId.has(4)).toBe(false); // Ben's "Not a fan"
    for (const r of res.body.results) {
      expect(Object.keys(r).sort()).toEqual(['because', 'lovedCount', 'memberCount', 'movie']);
      expect(Object.keys(r.movie).sort()).toEqual(['genres', 'overview', 'poster_path', 'title', 'tmdb_id', 'year']);
    }
  });

  it("still answers from members' lists when TMDb is down", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(res.body.results.map((r) => r.movie.tmdb_id)).toContain(3);
  });

  it('fails cleanly when the database does', async () => {
    db.error = { message: 'boom' };
    expect((await call()).statusCode).toBe(500);
  });
});
