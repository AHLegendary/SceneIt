import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/movies/trending.js';

function mockRes() {
  const res = { headers: {} };
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  res.setHeader = vi.fn((k, v) => { res.headers[k] = v; });
  return res;
}

beforeEach(() => {
  vi.stubEnv('TMDB_READ_TOKEN', 'test-token');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('GET /api/movies/trending', () => {
  it('returns this week\'s movies in the movies-table shape plus backdrops', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ results: [
        { id: 1, title: 'A', release_date: '2024-01-01', poster_path: '/a.jpg', backdrop_path: '/ab.jpg', genre_ids: [28], overview: 'x' },
        { id: 2, title: 'B', release_date: '', poster_path: null, backdrop_path: null, genre_ids: [], overview: '', adult: true },
      ] }),
    }));
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.results).toEqual([
      { tmdb_id: 1, title: 'A', year: 2024, poster_path: '/a.jpg', genres: ['Action'], overview: 'x', backdrop_path: '/ab.jpg' },
    ]);
    expect(res.headers['Cache-Control']).toContain('s-maxage');
    expect(fetch.mock.calls[0][0].toString()).toContain('/trending/movie/week');
  });

  it('answers 502 when TMDb fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(502);
  });

  it('rejects other methods', async () => {
    const res = mockRes();
    await handler({ method: 'POST', query: {} }, res);
    expect(res.statusCode).toBe(405);
  });
});
