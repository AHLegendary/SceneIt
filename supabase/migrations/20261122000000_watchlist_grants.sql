-- Table grants for the watchlist.
--
-- The initial schema created the table and its RLS policies (visible when the
-- owner is visible; users insert and delete only their own rows) but not the
-- grants, so the `authenticated` role couldn't reach it through the API. RLS
-- decides which rows; these grants decide whether the API can touch the table.
--
-- No UPDATE: a watchlist row is just (user_id, movie_id, added_at). Adding is
-- an insert, removing is a delete. No sequences to grant (composite primary key).

grant select, insert, delete on public.watchlist to authenticated;
