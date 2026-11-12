-- Movie Blend revisions.
--
--   1. One SQL home for the score formula. get_leaderboard and
--      get_blend_recommendations each carried their own copy; both now read
--      user_movie_scores(). (The JS copy, scoreTiers, stays: the browser
--      scores a list it already holds, and asking the database for that would
--      cost a round trip per render.)
--   2. When the owner leaves a blend, the blend is disbanded. Ownership no
--      longer transfers.
--   3. When a blend reaches its member limit, its remaining pending invites
--      expire, so they stop sitting in inboxes as "blend full" dead ends.
--      invite_to_blend already refuses invites for a full blend.


-- =========================================================== 1. score formula
-- Every ranking's score for its user: category band, spread by position
-- inside the category, ties averaged, alone-in-category = band middle.
-- Change this and scoreTiers in src/features/ranking/scores.js together.
--
-- Not rounded: callers average first and round after. p_user_ids limits the
-- work to some users (windows are per user, so the result is the same).
-- Reads every user's rankings, so it's for the definer functions below only.

create function public.user_movie_scores(p_user_ids uuid[] default null)
returns table (
  user_id     uuid,
  movie_id    integer,
  category    text,
  created_at  timestamptz,
  score       numeric
)
language sql
stable
security invoker
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
    where p_user_ids is null or r.user_id = any (p_user_ids)
  ),
  banded as (
    select
      user_id,
      movie_id,
      category,
      created_at,
      case category when 'loved' then 6.0 when 'okay' then 4.0 else 0.0 end as band_min,
      case category when 'loved' then 10.0 when 'okay' then 5.9 else 3.9 end as band_max,
      -- 1 at the top of the category, 0 at the bottom, 0.5 when alone in it.
      coalesce(1 - ((through_tier - tier_size) + (tier_size - 1) / 2.0) / nullif(cat_total - 1, 0), 0.5) as from_top
    from per_user
  )
  select user_id, movie_id, category, created_at, band_min + (band_max - band_min) * from_top
  from banded;
$$;

revoke execute on function public.user_movie_scores(uuid[]) from public, anon, authenticated;


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
  with scored as (
    select s.movie_id, s.user_id, s.score as user_score
    from public.user_movie_scores() s
    -- The window is worked out over everyone's whole list; only then are old
    -- rankings dropped, so a movie's score doesn't depend on the period.
    where s.created_at >= now() - case p_period
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


create or replace function public.get_blend_recommendations(p_blend_id uuid, p_limit integer default 20)
returns table (
  movie_id      integer,
  title         text,
  year          integer,
  poster_path   text,
  genres        text[],
  overview      text,
  liked_count   bigint,
  member_count  bigint,
  avg_score     numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select m.user_id
    from public.blend_members m
    where m.blend_id = p_blend_id
      and public.is_blend_member(p_blend_id)
  ),
  total as (
    select count(*) as n from members
  ),
  scored as (
    select s.movie_id, s.score, s.category
    from public.user_movie_scores((select coalesce(array_agg(user_id), '{}') from members)) s
  ),
  agg as (
    select
      movie_id,
      count(*) as ranked_count,
      count(*) filter (where category in ('loved', 'okay')) as liked_count,
      count(*) filter (where category = 'meh') as meh_count,
      round(avg(score), 1) as avg_score
    from scored
    group by movie_id
  )
  select
    mv.tmdb_id,
    mv.title,
    mv.year,
    mv.poster_path,
    mv.genres,
    mv.overview,
    a.liked_count,
    t.n,
    a.avg_score
  from agg a
  cross join total t
  join public.movies mv on mv.tmdb_id = a.movie_id
  where t.n >= 2
    and a.meh_count = 0
    and a.ranked_count < t.n
    and a.liked_count >= case when t.n = 2 then 1 else 2 end
  order by a.liked_count desc, a.avg_score desc, mv.title
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;


-- =========================================================== 2. owner leaves
-- The owner leaving deletes the blend (members and invites go with it by
-- cascade). Anyone else leaving just leaves.
-- Returns 'left' or 'deleted'.

create or replace function public.leave_blend(p_blend_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  blend_owner uuid;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_blend_id::text, 0));

  select b.owner_id into blend_owner from public.blends b where b.id = p_blend_id;

  if blend_owner is null or not public.is_blend_member(p_blend_id) then
    raise exception 'blend_not_found' using errcode = 'P0002';
  end if;

  if blend_owner = uid then
    delete from public.blends b where b.id = p_blend_id;
    return 'deleted';
  end if;

  delete from public.blend_members m where m.blend_id = p_blend_id and m.user_id = uid;
  return 'left';
end;
$$;


-- =========================================================== 3. full blend
-- Runs after every new member, whichever path added them. The advisory lock
-- from the before-insert limit trigger is still held, so this sees the
-- final count.

create function public.expire_invites_when_blend_full()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select count(*) from public.blend_members m where m.blend_id = new.blend_id)
     >= public.blend_max_members() then
    update public.blend_invites i
    set status = 'expired'
    where i.blend_id = new.blend_id and i.status = 'pending';
  end if;
  return null;
end;
$$;

create trigger blend_members_expire_invites
  after insert on public.blend_members
  for each row execute function public.expire_invites_when_blend_full();

revoke execute on function public.expire_invites_when_blend_full() from public, anon, authenticated;


-- Accepting marks the invite accepted first, so the trigger above only expires
-- the others.
create or replace function public.respond_to_blend_invite(p_invite_id uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target_blend_id uuid;
  invite public.blend_invites%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_accept is null then
    raise exception 'invite_invalid' using errcode = '22023';
  end if;

  select i.blend_id into target_blend_id
  from public.blend_invites i
  where i.id = p_invite_id and i.invitee_id = uid;

  if target_blend_id is null then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_blend_id::text, 0));

  -- Read again under the lock: the blend may have been deleted while waiting.
  select * into invite
  from public.blend_invites i
  where i.id = p_invite_id and i.invitee_id = uid;

  if not found or invite.status <> 'pending' then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  if invite.expires_at <= now() then
    raise exception 'invite_expired' using errcode = 'P0001';
  end if;

  if not p_accept then
    update public.blend_invites i set status = 'declined' where i.id = p_invite_id;
    return target_blend_id;
  end if;

  if not public.are_friends(invite.inviter_id, uid) then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.blend_members m
    where m.blend_id = target_blend_id and m.user_id = uid
  ) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  if (select count(*) from public.blend_members m where m.blend_id = target_blend_id)
     >= public.blend_max_members() then
    raise exception 'blend_full' using errcode = 'P0001';
  end if;

  update public.blend_invites i set status = 'accepted' where i.id = p_invite_id;
  insert into public.blend_members (blend_id, user_id) values (target_blend_id, uid);

  return target_blend_id;
end;
$$;


-- One-time cleanup: invites that were left pending on blends that already filled up.
update public.blend_invites i
set status = 'expired'
where i.status = 'pending'
  and (select count(*) from public.blend_members m where m.blend_id = i.blend_id)
      >= public.blend_max_members();
