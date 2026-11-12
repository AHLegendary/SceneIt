import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { omdbFetch } from '../../api/_lib/omdb.js';

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

beforeEach(() => {
  vi.stubEnv('OMDB_API_KEY', 'test-key');
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('omdbFetch', () => {
  it('asks OMDb for the IMDb id with the key, and returns what it says', async () => {
    mockFetchOnce(200, { Response: 'True', imdbRating: '8.1' });

    const result = await omdbFetch('tt1375666');

    expect(result).toEqual({ Response: 'True', imdbRating: '8.1' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [requestUrl, options] = fetch.mock.calls[0];
    const url = new URL(requestUrl);
    expect(url.origin).toBe('https://www.omdbapi.com');
    expect(url.searchParams.get('i')).toBe('tt1375666');
    expect(url.searchParams.get('apikey')).toBe('test-key');
    expect(options.headers).toEqual({ Accept: 'application/json' });
  });

  it('does not call fetch when the key is missing', async () => {
    vi.stubEnv('OMDB_API_KEY', '');

    await expect(omdbFetch('tt1375666')).rejects.toThrow('OMDB_API_KEY is not set');

    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'a bad key or a used-up daily limit'],
    [500, 'a server error'],
    [503, 'the service being down'],
  ])('throws with the status for HTTP %i (%s)', async (status) => {
    mockFetchOnce(status, { Response: 'False', Error: 'whatever' });

    await expect(omdbFetch('tt1375666')).rejects.toMatchObject({
      message: `OMDb request failed with status ${status}`,
      status,
    });
  });

  it.each([['Invalid API key!'], ['Request limit reached!']])('throws when OMDb says "%s" with a 200', async (message) => {
    mockFetchOnce(200, { Response: 'False', Error: message });

    await expect(omdbFetch('tt1375666')).rejects.toThrow(`OMDb refused the request: ${message}`);
  });

  it.each([['Incorrect IMDb ID.'], ['Movie not found!']])('returns null when OMDb says "%s"', async (message) => {
    mockFetchOnce(200, { Response: 'False', Error: message });

    expect(await omdbFetch('tt1375666')).toBeNull();
  });

  it('never puts the key in an error message', async () => {
    mockFetchOnce(401, {});

    const error = await omdbFetch('tt1375666').catch((e) => e);

    expect(error.message).not.toContain('test-key');
  });

  it('propagates network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    await expect(omdbFetch('tt1375666')).rejects.toThrow('Network error');
  });
});
