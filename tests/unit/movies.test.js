import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMovie, searchMovies } from '../../src/lib/movies.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockResponse({ ok = true, status = 200, body = {} } = {}) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok, status, json: vi.fn().mockResolvedValue(body),
  }));
}

describe('src/lib/movies.js', () => {
  it('searchMovies requests the endpoint and returns results', async () => {
    const results = [{ tmdb_id: 1, title: 'Up' }];
    mockResponse({ body: { results } });
    await expect(searchMovies('Up')).resolves.toEqual(results);
    expect(fetch).toHaveBeenCalledWith('/api/movies/search?q=Up');
  });

  it('URL-encodes special characters in search queries', async () => {
    mockResponse({ body: { results: [] } });
    await searchMovies('Spider-Man: No Way Home & Friends');
    expect(fetch).toHaveBeenCalledWith(
      '/api/movies/search?q=Spider-Man%3A%20No%20Way%20Home%20%26%20Friends',
    );
  });

  it('getMovie requests the details endpoint and returns the movie', async () => {
    const movie = { tmdb_id: 27205, title: 'Inception' };
    mockResponse({ body: { movie } });
    await expect(getMovie(27205)).resolves.toEqual(movie);
    expect(fetch).toHaveBeenCalledWith('/api/movies/27205');
  });

  it('URL-encodes movie IDs', async () => {
    mockResponse({ body: { movie: {} } });
    await getMovie('27205/extra');
    expect(fetch).toHaveBeenCalledWith('/api/movies/27205%2Fextra');
  });

  it('throws the API error message for unsuccessful responses', async () => {
    mockResponse({ ok: false, status: 502, body: { error: "Couldn't load movies, try again later." } });
    await expect(searchMovies('Up')).rejects.toThrow("Couldn't load movies, try again later.");
  });

  it('uses a fallback message when the error response has no error field', async () => {
    mockResponse({ ok: false, status: 500, body: {} });
    await expect(getMovie(1)).rejects.toThrow('Something went wrong, try again later.');
  });

  it('handles non-JSON error responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 502, json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
    }));
    await expect(searchMovies('Up')).rejects.toThrow('Something went wrong, try again later.');
  });
});
