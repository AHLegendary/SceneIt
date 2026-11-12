-- Community reviews feed.
--
-- get_review_feed returns one page of reviews for the Community page, newest
-- first or most discussed first, from everyone or only from your friends.
-- Each row carries what a review card needs (the author's username, the
-- movie's title, year, poster and genres, the number of comments, and the
-- author's score for the movie), so a page of the feed is one request.
--
-- Privacy: it runs as the function owner, so it applies the same rule as the
-- reviews policy itself, can_view_user(author). Reviews from private profiles
-- you aren't allowed to see never appear, and "friends" means accepted
-- friends only (your own reviews are not in the friends feed).
--
-- The score: the author's score for that movie, from user_movie_scores (the
-- one SQL copy of the formula), shown only when the author has ranked at least
-- 10 movies. That is SCORE_UNLOCK in src/features/ranking/scores.js; change
-- the two together.
--
-- Every review belongs to a movie its author has ranked (un-ranking deletes
-- the review), so every row has a score to show once that threshold is met.


create function public.get_review_feed(
  p_scope   text default 'everyone',
  p_sort    text default 'recent',
  p_limit   integer default 20,
  p_offset  integer default 0
)
returns table (
  id             uuid,
  user_id        uuid,
  username       text,
  movie_id       integer,
  title          text,
  year           integer,
  poster_path    text,
  genres         text[],
  overview       text,
  body           text,
  is_spoiler     boolean,
  created_at     timestamptz,
  updated_at     timestamptz,
  comment_count  integer,
  score          numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_scope not in ('everyone', 'friends') then
    raise exception 'Scope must be everyone or friends' using errcode = '22023';
  end if;
  if p_sort not in ('recent', 'discussed') then
    raise exception 'Sort must be recent or discussed' using errcode = '22023';
  end if;
  p_limit := least(greatest(coalesce(p_limit, 20), 1), 200);
  p_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  with comments as (
    select c.review_id, count(*)::integer as n
    from public.review_comments c
    group by c.review_id
  ),
  -- The page itself: visible reviews, in order, with `pos` to keep the order
  -- through the joins below.
  page as (
    select
      r.id, r.user_id, r.movie_id, r.body, r.is_spoiler, r.created_at, r.updated_at,
      coalesce(cm.n, 0) as comment_count,
      row_number() over (
        order by
          case when p_sort = 'discussed' then coalesce(cm.n, 0) end desc nulls last,
          r.created_at desc,
          r.id desc
      ) as pos
    from public.reviews r
    left join comments cm on cm.review_id = r.id
    where public.can_view_user(r.user_id)
      and (
        p_scope = 'everyone'
        or (auth.uid() is not null
            and r.user_id <> auth.uid()
            and public.are_friends(auth.uid(), r.user_id))
      )
    order by pos
    limit p_limit offset p_offset
  ),
  authors as (
    select distinct pg.user_id from page pg
  ),
  -- An empty page must pass an empty list: null would mean "everyone".
  scores as (
    select s.user_id, s.movie_id, s.score
    from public.user_movie_scores(coalesce((select array_agg(a.user_id) from authors a), '{}'::uuid[])) s
  ),
  ranked as (
    select rk.user_id, count(*) as n
    from public.rankings rk
    where rk.user_id in (select a.user_id from authors a)
    group by rk.user_id
  )
  select
    pg.id, pg.user_id, p.username, pg.movie_id,
    m.title, m.year, m.poster_path, m.genres, m.overview,
    pg.body, pg.is_spoiler, pg.created_at, pg.updated_at,
    pg.comment_count,
    case when rkd.n >= 10 then round(sc.score, 1) end
  from page pg
  join public.profiles p on p.id = pg.user_id
  join public.movies m on m.tmdb_id = pg.movie_id
  left join scores sc on sc.user_id = pg.user_id and sc.movie_id = pg.movie_id
  left join ranked rkd on rkd.user_id = pg.user_id
  order by pg.pos;
end;
$$;

-- Open to signed-out visitors too: they see reviews from public profiles.
revoke execute on function public.get_review_feed(text, text, integer, integer) from public;
grant execute on function public.get_review_feed(text, text, integer, integer) to anon, authenticated;
