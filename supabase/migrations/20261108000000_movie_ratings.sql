-- Outside scores (IMDb rating and votes, Rotten Tomatoes) from OMDb, cached by
-- GET /api/movies/:id/ratings so OMDb is asked at most once per movie every
-- couple of weeks. Any TMDb movie can be cached, whether or not it has been
-- saved to `movies`, so there is deliberately no foreign key.
create table if not exists public.movie_ratings (
  tmdb_id     integer primary key,
  imdb_id     text,                                           -- null when TMDb has none
  imdb        numeric(3, 1) check (imdb between 0 and 10),    -- null when OMDb has none
  imdb_votes  integer check (imdb_votes > 0),
  rt          smallint check (rt between 0 and 100),          -- Rotten Tomatoes %, often missing
  checked_at  timestamptz not null default now()
);

-- Only the API (service role, which bypasses RLS) reads and writes this table.
-- With RLS on and no policies, the browser's publishable key can't touch it.
alter table public.movie_ratings enable row level security;
