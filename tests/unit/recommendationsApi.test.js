import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { MAX_SEEDS } from '../../api/movies/recommendations.js';

function mockRes() {
  const res = { headers: {} };
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body) => {
    res.body = body;
    return res;
  });
  res.setHeader = vi.fn((k, v) => {
    res.headers[k] = v;
  });
  return res;
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });
const tmdbMovie = (id, extra = {}) => ({
  id, title: `Movie ${id}`, release_date: '2020-01-01', genre_ids: [18], poster_path: '/p.jpg',
  overview: '', vote_average: 7.5, vote_count: 900, ...extra,
});

beforeEach(() => {
  vi.stubEnv('TMDB_READ_TOKEN', 'test-token');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/movies/recommendations', () => {
  it('returns TMDb recommendations per seed, in our movie shape plus rating and votes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (
      String(url).includes('/movie/1/') ? ok({ results: [tmdbMovie(10), tmdbMovie(11)] }) : ok({ results: [tmdbMovie(20)] })
    )));
    const res = mockRes();
    await handler({ method: 'GET', query: { ids: '1,2' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0]).toMatchObject({ seed: 1 });
    expect(res.body.results[0].movies.map((m) => m.tmdb_id)).toEqual([10, 11]);
    expect(res.body.results[0].movies[0]).toMatchObject({
      title: 'Movie 10', year: 2020, genres: ['Drama'], tmdb_rating: 7.5, tmdb_votes: 900,
    });
    expect(String(fetch.mock.calls[0][0])).toContain('/movie/1/recommendations');
    expect(res.headers['Cache-Control']).toMatch(/s-maxage/);
  });

  it('drops adult titles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ results: [tmdbMovie(10, { adult: true }), tmdbMovie(11)] })));
    const res = mockRes();
    await handler({ method: 'GET', query: { ids: '1' } }, res);
    expect(res.body.results[0].movies.map((m) => m.tmdb_id)).toEqual([11]);
  });

  it('skips seeds TMDb fails on but keeps the rest', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).includes('/movie/1/') ? fail(404) : ok({ results: [tmdbMovie(20)] }))));
    const res = mockRes();
    await handler({ method: 'GET', query: { ids: '1,2' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.results.map((r) => r.seed)).toEqual([2]);
  });

  it('returns 502 when every seed fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fail(500)));
    const res = mockRes();
    await handler({ method: 'GET', query: { ids: '1,2' } }, res);
    expect(res.statusCode).toBe(502);
  });

  it('dedupes repeated ids', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ results: [] })));
    const res = mockRes();
    await handler({ method: 'GET', query: { ids: '5,5' } }, res);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{}, 400],
    [{ ids: '' }, 400],
    [{ ids: 'abc' }, 400],
    [{ ids: '1,../2' }, 400],
    [{ ids: Array.from({ length: MAX_SEEDS + 1 }, (_, i) => i + 1).join(',') }, 400],
  ])('rejects bad ids %j', async (query, status) => {
    vi.stubGlobal('fetch', vi.fn());
    const res = mockRes();
    await handler({ method: 'GET', query }, res);
    expect(res.statusCode).toBe(status);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('only allows GET', async () => {
    const res = mockRes();
    await handler({ method: 'POST', query: { ids: '1' } }, res);
    expect(res.statusCode).toBe(405);
  });
});
