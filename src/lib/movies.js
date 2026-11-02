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

export async function getMovie(tmdbId) {
  const { movie } = await getJson(`/api/movies/${encodeURIComponent(tmdbId)}`);
  return movie;
}

// Makes sure a movie is in the database so it can be ranked. The server
// checks the access token, looks the movie up on TMDb and saves it.
// Returns the saved row ({ tmdb_id, title, year, ... }).
export async function saveMovie(tmdbId, accessToken) {
  const { movie } = await getJson(`/api/movies/${encodeURIComponent(tmdbId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return movie;
}
