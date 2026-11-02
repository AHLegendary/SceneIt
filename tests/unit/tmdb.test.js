  import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
  import { toMovie, tmdbFetch } from '../../api/_lib/tmdb.js';
  import searchHandler from '../../api/movies/search.js';
  import detailsHandler from '../../api/movies/[id].js';

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

  function mockFetchOnce(status, body) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }),
    );
  }

  function mockFetchRejectOnce() {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
  }

  beforeEach(() => {
    vi.stubEnv('TMDB_READ_TOKEN', 'test-token');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('toMovie', () => {
    it('builds a poster URL and extracts genre names', () => {
      expect(
        toMovie({
          id: 27205,
          title: 'Inception',
          release_date: '2010-07-15',
          poster_path: '/abc.jpg',
          genres: [{ id: 28, name: 'Action' }],
          overview: 'Dreams.',
        }),
      ).toEqual({
        tmdb_id: 27205,
        title: 'Inception',
        release_date: '2010-07-15',
        poster_url: 'https://image.tmdb.org/t/p/w500/abc.jpg',
        genres: ['Action'],
        overview: 'Dreams.',
      });
    });

    it('uses safe defaults for missing optional fields', () => {
      expect(toMovie({ id: 1, title: 'Unknown' })).toEqual({
        tmdb_id: 1,
        title: 'Unknown',
        release_date: null,
        poster_url: null,
        genres: [],
        overview: '',
      });
    });

    it('handles non-array genres', () => {
      expect(toMovie({ id: 2, title: 'Example', genres: 'Drama' }).genres).toEqual([]);
    });
  });

  describe('tmdbFetch', () => {
    it('requests the expected URL and sends the Bearer token', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      await tmdbFetch('/search/movie', {
        query: 'Inception',
        include_adult: 'false',
        page: '1',
      });

      expect(fetch).toHaveBeenCalledTimes(1);

      const [requestUrl, options] = fetch.mock.calls[0];
      const url = new URL(requestUrl);

      expect(url.origin).toBe('https://api.themoviedb.org');
      expect(url.pathname).toBe('/3/search/movie');
      expect(url.searchParams.get('query')).toBe('Inception');
      expect(url.searchParams.get('include_adult')).toBe('false');
      expect(url.searchParams.get('page')).toBe('1');
      expect(options.headers).toEqual({
        Authorization: 'Bearer test-token',
        Accept: 'application/json',
      });
    });

    it('does not call fetch when the token is missing', async () => {
      vi.stubEnv('TMDB_READ_TOKEN', '');

      await expect(tmdbFetch('/search/movie')).rejects.toThrow(
        'TMDB_READ_TOKEN is not set',
      );

      expect(fetch).not.toHaveBeenCalled();
    });

    it('throws an error with the HTTP status when TMDb responds unsuccessfully', async () => {
      mockFetchOnce(500, { status_message: 'Internal error' });

      await expect(tmdbFetch('/search/movie')).rejects.toMatchObject({
        message: 'TMDb request failed with status 500',
        status: 500,
      });
    });

    it('propagates network errors', async () => {
      mockFetchRejectOnce();

      await expect(tmdbFetch('/search/movie')).rejects.toThrow('Network error');
    });
  });

  describe('GET /api/movies/search', () => {
    it('returns 405 for non-GET requests without calling fetch', async () => {
      const res = mockRes();
      await searchHandler({ method: 'POST', query: { q: 'Up' } }, res);

      expect(res.statusCode).toBe(405);
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
      ['missing query', {}],
      ['empty query', { q: '' }],
      ['whitespace-only query', { q: '   ' }],
      ['non-string query', { q: ['Up'] }],
    ])('returns 400 for a %s without calling fetch', async (_label, query) => {
      const res = mockRes();
      await searchHandler({ method: 'GET', query }, res);

      expect(res.statusCode).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('returns 400 when query exceeds 100 characters', async () => {
      const res = mockRes();
      await searchHandler({ method: 'GET', query: { q: 'a'.repeat(101) } }, res);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/too long/i);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('trims the query and returns normalized results', async () => {
      mockFetchOnce(200, {
        results: [
          {
            id: 1,
            title: 'Up',
            release_date: '2009-05-28',
            poster_path: '/up.jpg',
          },
        ],
      });

      const res = mockRes();
      await searchHandler({ method: 'GET', query: { q: '  Up  ' } }, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.results[0]).toMatchObject({
        tmdb_id: 1,
        title: 'Up',
        poster_url: 'https://image.tmdb.org/t/p/w500/up.jpg',
      });

      const [requestUrl] = fetch.mock.calls[0];
      const url = new URL(requestUrl);

      expect(url.pathname).toBe('/3/search/movie');
      expect(url.searchParams.get('query')).toBe('Up');
      expect(url.searchParams.get('include_adult')).toBe('false');
      expect(url.searchParams.get('page')).toBe('1');
    });

    it('returns an empty results array when TMDb has no matches', async () => {
      mockFetchOnce(200, { results: [] });

      const res = mockRes();
      await searchHandler({ method: 'GET', query: { q: 'no matches' } }, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ results: [] });
    });

    it('sends the token as a Bearer authorization header', async () => {
      mockFetchOnce(200, { results: [] });

      await searchHandler({ method: 'GET', query: { q: 'Up' } }, mockRes());

      const [, options] = fetch.mock.calls[0];
      expect(options.headers.Authorization).toBe('Bearer test-token');
      expect(options.headers.Accept).toBe('application/json');
    });

    it('returns a friendly 502 when TMDb responds with an error', async () => {
      mockFetchOnce(500, { status_message: 'Internal error' });

      const res = mockRes();
      await searchHandler({ method: 'GET', query: { q: 'Up' } }, res);

      expect(res.statusCode).toBe(502);
      expect(res.body.error).toMatch(/try again later/i);
      expect(res.body.error).not.toContain('Internal error');
    });

    it('returns 502 when the network request fails', async () => {
      mockFetchRejectOnce();

      const res = mockRes();
      await searchHandler({ method: 'GET', query: { q: 'Up' } }, res);

      expect(res.statusCode).toBe(502);
    });

    it('returns a controlled error when the token is missing without calling fetch', async () => {
      vi.stubEnv('TMDB_READ_TOKEN', '');

      const res = mockRes();
      await searchHandler({ method: 'GET', query: { q: 'Up' } }, res);

      expect(res.statusCode).toBe(502);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/movies/[id]', () => {
    it('returns 405 for non-GET requests without calling fetch', async () => {
      const res = mockRes();
      await detailsHandler({ method: 'POST', query: { id: '27205' } }, res);

      expect(res.statusCode).toBe(405);
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
      ['non-numeric ID', 'abc'],
      ['decimal ID', '12.5'],
      ['negative ID', '-12'],
      ['missing ID', undefined],
    ])('returns 400 for a %s without calling fetch', async (_label, id) => {
      const res = mockRes();
      await detailsHandler({ method: 'GET', query: { id } }, res);

      expect(res.statusCode).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('returns normalized movie details', async () => {
      mockFetchOnce(200, {
        id: 27205,
        title: 'Inception',
        release_date: '2010-07-15',
        poster_path: '/abc.jpg',
        genres: [{ id: 28, name: 'Action' }],
        overview: 'Dreams.',
      });

      const res = mockRes();
      await detailsHandler({ method: 'GET', query: { id: '27205' } }, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.movie).toMatchObject({
        tmdb_id: 27205,
        title: 'Inception',
        genres: ['Action'],
      });

      const [requestUrl] = fetch.mock.calls[0];
      const url = new URL(requestUrl);

      expect(url.pathname).toBe('/3/movie/27205');
    });

    it('returns 404 when TMDb says the movie does not exist', async () => {
      mockFetchOnce(404, {});

      const res = mockRes();
      await detailsHandler({ method: 'GET', query: { id: '999999999' } }, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.error).toMatch(/movie not found/i);
    });

    it.each([401, 403, 500])(
      'returns 502 when TMDb responds with status %i',
      async (status) => {
        mockFetchOnce(status, {});

        const res = mockRes();
        await detailsHandler({ method: 'GET', query: { id: '27205' } }, res);

        expect(res.statusCode).toBe(502);
        expect(res.body.error).toMatch(/try again later/i);
      },
    );

    it('returns 502 when the network request fails', async () => {
      mockFetchRejectOnce();

      const res = mockRes();
      await detailsHandler({ method: 'GET', query: { id: '27205' } }, res);

      expect(res.statusCode).toBe(502);
    });

    it('returns a controlled error when the token is missing without calling fetch', async () => {
      vi.stubEnv('TMDB_READ_TOKEN', '');

      const res = mockRes();
      await detailsHandler({ method: 'GET', query: { id: '27205' } }, res);

      expect(res.statusCode).toBe(502);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
