// Frontend data layer for our movie API (api/movies/*). UI components call
// these instead of fetch().

async function getJson(url, options) {
  const response = await (options ? fetch(url, options) : fetch(url));
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || 'Something went wrong, try again later.');
  }
  return body;
}

export async function searchMovies(query) {
  const { results } = await getJson(`/api/movies/search?q=${encodeURIComponent(query)}`);
  return results;
}

// This week's most popular movies on TMDb (through our API), in the
// `movies` table shape plus backdrop_path.
export async function fetchTrending() {
  const { results } = await getJson('/api/movies/trending');
  return results;
}

export async function getMovie(tmdbId) {
  const { movie } = await getJson(`/api/movies/${encodeURIComponent(tmdbId)}`);
  return movie;
}

export class UnauthorizedError extends Error {}

// TMDb's recommendations for each seed movie (TMDb ids). Ids are sorted so
// the same set of seeds always hits the same cached URL.
// Returns [{ seed, movies: [{ tmdb_id, title, ..., tmdb_rating, tmdb_votes }] }].
export async function getRecommendations(tmdbIds) {
  const ids = [...new Set(tmdbIds)].sort((a, b) => a - b);
  if (!ids.length) return [];
  const { results } = await getJson(`/api/movies/recommendations?ids=${ids.join(',')}`);
  return results;
}

// Makes sure a movie is in the database so it can be ranked. The server
// checks the access token, looks the movie up on TMDb and saves it.
// Returns the saved row ({ tmdb_id, title, year, ... }). Throws
// UnauthorizedError when the server rejects the token, so the caller can
// refresh the session and try again.
export async function saveMovie(tmdbId, accessToken) {
  const response = await fetch(`/api/movies/${encodeURIComponent(tmdbId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) throw new UnauthorizedError(body.error || 'Log in to rank movies.');
  if (!response.ok) throw new Error(body.error || 'Something went wrong, try again later.');
  return body.movie;
}
