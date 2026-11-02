import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fake admin Supabase client: `db.movies` is the movies table, `db.user`
// is who the access token belongs to (null = invalid token).
const db = vi.hoisted(() => ({ movies: new Map(), user: null, upserts: [], failDb: false }));

vi.mock('../../api/_lib/supabaseAdmin.js', () => ({
  getUserFromRequest: async (req) =>
    req.headers?.authorization === 'Bearer good-token' ? db.user : null,
  getAdminClient: () => ({
    from: () => {
      let id;
      const chain = {
        select: () => chain,
        eq: (_col, value) => {
          id = value;
          return chain;
        },
        maybeSingle: async () =>
          db.failDb ? { data: null, error: { message: 'db down' } } : { data: db.movies.get(id) ?? null, error: null },
        upsert: (row) => {
          db.upserts.push(row);
          db.movies.set(row.tmdb_id, row);
          id = row.tmdb_id;
          return chain;
        },
        single: async () => ({ data: db.movies.get(id), error: null }),
      };
      return chain;
    },
  }),
}));

const { default: handler } = await import('../../api/movies/[id].js');

function mockRes() {
  const res = {};
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body) => {
    res.body = body;
    return res;
  });
  return res;
}

const post = (id, token = 'good-token') =>
  handler({ method: 'POST', query: { id: String(id) }, headers: token ? { authorization: `Bearer ${token}` } : {} }, mockRes());

async function call(id, token) {
  const res = mockRes();
  await handler({ method: 'POST', query: { id: String(id) }, headers: token ? { authorization: `Bearer ${token}` } : {} }, res);
  return res;
}

const PADDINGTON_TMDB = {
  id: 346648,
  title: 'Paddington 2',
  release_date: '2017-11-09',
  poster_path: '/p.jpg',
  genres: [{ id: 35, name: 'Comedy' }],
  overview: 'A bear.',
};

beforeEach(() => {
  db.movies = new Map();
  db.user = { id: 'user-1' };
  db.upserts = [];
  db.failDb = false;
  vi.stubEnv('TMDB_READ_TOKEN', 'test-token');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) =>
      String(url).includes('/movie/346648')
        ? { ok: true, status: 200, json: async () => PADDINGTON_TMDB }
        : { ok: false, status: 404, json: async () => ({}) },
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('POST /api/movies/[id]', () => {
  it('rejects requests without a valid login', async () => {
    expect((await call(346648, null)).statusCode).toBe(401);
    expect((await call(346648, 'bad-token')).statusCode).toBe(401);
    expect(db.upserts).toEqual([]);
  });

  it('saves the movie using TMDb data and returns it', async () => {
    const res = await call(346648, 'good-token');
    expect(res.statusCode).toBe(201);
    expect(res.body.movie).toMatchObject({ tmdb_id: 346648, title: 'Paddington 2', year: 2017, genres: ['Comedy'] });
    expect(db.upserts).toHaveLength(1);
  });

  it('does not call TMDb or write again when the movie is already saved', async () => {
    await post(346648);
    fetch.mockClear();
    const res = await call(346648, 'good-token');
    expect(res.statusCode).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    expect(db.upserts).toHaveLength(1);
  });

  it('returns 404 for a movie TMDb does not have', async () => {
    const res = await call(999999999, 'good-token');
    expect(res.statusCode).toBe(404);
    expect(db.upserts).toEqual([]);
  });

  it('rejects a bad id before checking anything', async () => {
    const res = await call('12;drop', 'good-token');
    expect(res.statusCode).toBe(400);
  });

  it('returns a friendly 502 when the database fails', async () => {
    db.failDb = true;
    const res = await call(346648, 'good-token');
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/try again/);
  });
});
