import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// getRatings remembers answers in a module-level cache, so each test gets a fresh copy.
async function freshGetRatings() {
  vi.resetModules();
  return (await import('../../src/lib/movies.js')).getRatings;
}

function mockFetch(status, body) {
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
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getRatings', () => {
  const found = {
    imdb_id: 'tt1375666',
    ratings: { imdb: 8.8, imdb_votes: 2400000, rt: 87, checked: '2026-11-10' },
  };

  it('asks the ratings route for the movie and returns the scores and IMDb id', async () => {
    mockFetch(200, found);
    const getRatings = await freshGetRatings();

    expect(await getRatings(27205)).toEqual(found);
    expect(fetch).toHaveBeenCalledWith('/api/movies/ratings?id=27205');
  });

  it('remembers an answer, so the same movie is only asked for once', async () => {
    mockFetch(200, found);
    const getRatings = await freshGetRatings();

    await getRatings(27205);
    await getRatings(27205);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('asks again for a different movie', async () => {
    mockFetch(200, found);
    const getRatings = await freshGetRatings();

    await getRatings(27205);
    await getRatings(603);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('turns "no scores" into ratings: null, and remembers that too', async () => {
    mockFetch(200, { imdb_id: null, ratings: null });
    const getRatings = await freshGetRatings();

    expect(await getRatings(1)).toEqual({ ratings: null, imdb_id: null });
    await getRatings(1);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fills in missing fields with null', async () => {
    mockFetch(200, {});
    const getRatings = await freshGetRatings();

    expect(await getRatings(1)).toEqual({ ratings: null, imdb_id: null });
  });

  it('throws the server\'s message on a failure, and asks again next time', async () => {
    mockFetch(502, { error: "Couldn't load scores, try again later." });
    const getRatings = await freshGetRatings();

    await expect(getRatings(27205)).rejects.toThrow("Couldn't load scores, try again later.");

    mockFetch(200, found);
    expect(await getRatings(27205)).toEqual(found);
  });

  it('throws a friendly message when the response has no error text', async () => {
    mockFetch(500, {});
    const getRatings = await freshGetRatings();

    await expect(getRatings(27205)).rejects.toThrow('Something went wrong, try again later.');
  });

  it('propagates network errors without remembering anything', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    const getRatings = await freshGetRatings();

    await expect(getRatings(27205)).rejects.toThrow('Failed to fetch');
  });
});
