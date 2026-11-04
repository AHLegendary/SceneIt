-- Ranking categories: "Loved it" / "It was okay" / "Not a fan".
--
-- Before comparing, the user now says how they felt about a movie. That
-- category is stored on the ranking and decides:
--   * which movies it's compared against (only its own category)
--   * the band its score falls in: loved 6.0–10, okay 4.0–5.9, meh 0.0–3.9
--     (the best in a category gets the top of the band, the worst the bottom,
--     a movie alone in its category gets the middle)
--
-- A user's list stays one list of tiers (position 0 = best), always ordered
-- all 'loved', then all 'okay', then all 'meh'. save_ranking keeps it that
-- way. Scores are still computed, not stored (see src/features/ranking/scores.js).
--
-- Deploy together with the matching frontend: save_ranking's arguments change.


-- =========================================================== rankings.category

alter table public.rankings add column category text;

-- Existing rankings: use the category their old position-based score fell in
-- (top of the list 10, bottom 1, same thresholds the My List filter used).
-- Scores never go up going down a list, so each category stays one block.
-- A list with a single movie has no old score; call it 'loved'.
with per_user as (
  select
    r.user_id,
    r.movie_id,
    count(*) over (partition by r.user_id) as total,
    count(*) over (partition by r.user_id, r.position) as tier_size,
    count(*) over (partition by r.user_id order by r.position
                   range between unbounded preceding and current row) as through_tier
  from public.rankings r
),
old_scores as (
  select
    user_id,
    movie_id,
    case when total < 2 then 10
         else round(1 + 9 * (1 - ((through_tier - tier_size) + (tier_size - 1) / 2.0) / (total - 1)), 1)
    end as score
  from per_user
)
update public.rankings r
set category = case when s.score >= 6 then 'loved' when s.score >= 4 then 'okay' else 'meh' end
from old_scores s
where r.user_id = s.user_id and r.movie_id = s.movie_id;

alter table public.rankings
  alter column category set not null,
  add constraint rankings_category_check check (category in ('loved', 'okay', 'meh'));


-- 0 = loved, 1 = okay, 2 = meh: the order categories sit in a list.
create function public.category_order(p_category text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_category when 'loved' then 0 when 'okay' then 1 when 'meh' then 2 end;
$$;


-- =========================================================== save_ranking
-- Replaces save_ranking(movie, position, tied). The position is now inside
-- the movie's category, matching what the user compared it against:
--   tied = false: becomes its own tier at p_position within p_category
--   tied = true:  joins the category's existing tier at p_position
-- p_position past the end of the category is clamped to its bottom. Moving a
-- movie to another category (reranking) works the same way.

drop function public.save_ranking(integer, integer, boolean);

create function public.save_ranking(
  p_movie_id integer,
  p_category text,
  p_position integer,
  p_tied boolean default false
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  old_pos integer;
  first_ranked timestamptz;
  offset_tiers integer;
  category_tiers integer;
  local_pos integer;
  at integer;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_category is null or public.category_order(p_category) is null then
    raise exception 'Category must be loved, okay or meh' using errcode = '22023';
  end if;
  if p_position is null or p_position < 0 then
    raise exception 'Position must be 0 or more' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  -- Take it out first if it's already ranked, closing the gap if its tier
  -- is now empty.
  delete from public.rankings
  where user_id = uid and movie_id = p_movie_id
  returning position, created_at into old_pos, first_ranked;

  if old_pos is not null and not exists (
    select 1 from public.rankings where user_id = uid and position = old_pos
  ) then
    update public.rankings set position = position - 1
    where user_id = uid and position > old_pos;
  end if;

  -- Tiers in better categories come first; this category's block starts
  -- right after them.
  select count(distinct position) into offset_tiers
  from public.rankings
  where user_id = uid and public.category_order(category) < public.category_order(p_category);

  select count(distinct position) into category_tiers
  from public.rankings
  where user_id = uid and category = p_category;

  local_pos := least(p_position, category_tiers);
  at := offset_tiers + local_pos;

  -- New tier: shift everything at or below it down one.
  if not (p_tied and local_pos < category_tiers) then
    update public.rankings set position = position + 1
    where user_id = uid and position >= at;
  end if;

  insert into public.rankings (user_id, movie_id, position, category, created_at, updated_at)
  values (uid, p_movie_id, at, p_category, coalesce(first_ranked, now()), now());
end;
$$;

revoke execute on function public.save_ranking(integer, text, integer, boolean) from public, anon;
grant execute on function public.save_ranking(integer, text, integer, boolean) to authenticated;
-- category_order is harmless, but keep the default-deny habit.
revoke execute on function public.category_order(text) from public, anon;
grant execute on function public.category_order(text) to authenticated;


-- =========================================================== leaderboard
-- Same as before, except each user's score for a movie now comes from its
-- category band and its place inside that category (same formula as
-- scoreTiers in src/features/ranking/scores.js). Since a movie alone in its
-- category has a meaningful score (the middle of the band), single-movie
-- lists count now too.

create or replace function public.get_leaderboard(
  p_period text default 'weekly',
  p_category text default 'highest',
  p_limit integer default 10
)
returns table (
  movie_id     integer,
  title        text,
  year         integer,
  poster_path  text,
  score        numeric,
  rankers      bigint,
  rank         bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with per_user as (
    select
      r.user_id,
      r.movie_id,
      r.created_at,
      r.category,
      count(*) over (partition by r.user_id, r.category) as cat_total,
      count(*) over (partition by r.user_id, r.position) as tier_size,
      count(*) over (partition by r.user_id, r.category order by r.position
                     range between unbounded preceding and current row) as through_tier
    from public.rankings r
  ),
  banded as (
    select
      movie_id,
      user_id,
      created_at,
      case category when 'loved' then 6.0 when 'okay' then 4.0 else 0.0 end as band_min,
      case category when 'loved' then 10.0 when 'okay' then 5.9 else 3.9 end as band_max,
      -- 1 at the top of the category, 0 at the bottom, 0.5 when alone in it.
      coalesce(1 - ((through_tier - tier_size) + (tier_size - 1) / 2.0) / nullif(cat_total - 1, 0), 0.5) as from_top
    from per_user
  ),
  scored as (
    select
      movie_id,
      user_id,
      band_min + (band_max - band_min) * from_top as user_score
    from banded
    where created_at >= now() - case p_period
                                  when 'weekly' then interval '7 days'
                                  when 'monthly' then interval '30 days'
                                end
  ),
  agg as (
    select movie_id, round(avg(user_score), 1) as score, count(*) as rankers
    from scored
    group by movie_id
  )
  select
    m.tmdb_id, m.title, m.year, m.poster_path, a.score, a.rankers,
    row_number() over (
      order by
        case when p_category = 'watched' then a.rankers end desc nulls last,
        a.score desc,
        a.rankers desc,
        m.title
    ) as rank
  from agg a
  join public.movies m on m.tmdb_id = a.movie_id
  order by rank
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
$$;
