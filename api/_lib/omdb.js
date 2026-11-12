// Server-side client for OMDb (https://www.omdbapi.com), which is where IMDb
// and Rotten Tomatoes scores come from. The key stays on the server.

const OMDB_URL = 'https://www.omdbapi.com/';

// Looks a movie up by IMDb id (tt1234567). Returns OMDb's JSON, or null when
// OMDb doesn't know that id. Throws when OMDb can't be asked or can't answer
// (no key, bad key, daily limit reached, network or server errors), so the
// caller can tell "no scores exist" apart from "couldn't check".
export async function omdbFetch(imdbId) {
  const key = process.env.OMDB_API_KEY;
  if (!key) throw new Error('OMDB_API_KEY is not set');

  const url = new URL(OMDB_URL);
  url.searchParams.set('i', imdbId);
  url.searchParams.set('apikey', key);

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  // OMDb answers a bad key or a used-up daily limit with HTTP 401.
  if (!response.ok) {
    const error = new Error(`OMDb request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const body = await response.json();
  if (body.Response === 'False') {
    const message = String(body.Error ?? '');
    if (/api key|limit/i.test(message)) throw new Error(`OMDb refused the request: ${message}`);
    return null; // "Incorrect IMDb ID." / "Movie not found!"
  }
  return body;
}
