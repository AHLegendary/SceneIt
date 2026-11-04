-- Movie Blend: small friend groups that get shared movie recommendations.
--
--   * blends         one row per group; owner_id is the current owner
--   * blend_members  people who are in the group (5 at most, creator included)
--   * blend_invites  invites from the owner to a friend; accepting one adds a member
--
-- Clients can only read these tables, and only what RLS allows: blends they
-- belong to, and invites sent to or from them. Every write goes through the
-- functions below.
--
-- The functions that touch other people's rows are security definer. As
-- security invoker they'd need direct write grants on these tables, and a
-- client could then skip their checks (friends only, 15 rankings, owner only).
-- Each one checks auth.uid() itself.
--
-- Errors use short stable messages (blend_full, invite_invalid, ...). The UI
-- turns them into text in src/features/blends/blends.js.
--
-- Deleting an account also deletes blends it owns (owner_id cascades). Leaving
-- a blend is the path that transfers ownership.


-- =========================================================== tables

create table public.blends (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index blends_owner_idx on public.blends (owner_id);


create table public.blend_members (
  blend_id   uuid not null references public.blends (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (blend_id, user_id)
);

create index blend_members_user_idx on public.blend_members (user_id);


create table public.blend_invites (
  id          uuid primary key default gen_random_uuid(),
  blend_id    uuid not null references public.blends (id) on delete cascade,
  inviter_id  uuid not null references public.profiles (id) on delete cascade,
  invitee_id  uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'pending'
              check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  check (inviter_id <> invitee_id)
);

-- One open invite per person per blend. Declined and expired ones stay as
-- history, so the same person can be invited again.
create unique index blend_invites_pending_idx
  on public.blend_invites (blend_id, invitee_id)
  where status = 'pending';

create index blend_invites_invitee_idx on public.blend_invites (invitee_id);
create index blend_invites_inviter_idx on public.blend_invites (inviter_id);


-- =========================================================== member limit
-- A blend holds at most this many people, creator included.

create function public.blend_max_members()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select 5;
$$;

-- Enforced here so no code path can go over the limit. The advisory lock makes
-- two people accepting at the same moment take turns.
create function public.enforce_blend_member_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.blend_id::text, 0));

  if (select count(*) from public.blend_members m where m.blend_id = new.blend_id)
     >= public.blend_max_members() then
    raise exception 'blend_full' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger blend_members_limit
  before insert on public.blend_members
  for each row execute function public.enforce_blend_member_limit();


-- =========================================================== access helper
-- security definer so blend_members' policy can look at blend_members without
-- recursing into itself.

create function public.is_blend_member(p_blend_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blend_members m
    where m.blend_id = p_blend_id and m.user_id = auth.uid()
  );
$$;


-- =========================================================== RLS

alter table public.blends        enable row level security;
alter table public.blend_members enable row level security;
alter table public.blend_invites enable row level security;

create policy "blends: visible to members"
  on public.blends for select
  to authenticated
  using (public.is_blend_member(id));

create policy "blend_members: visible to members"
  on public.blend_members for select
  to authenticated
  using (public.is_blend_member(blend_id));

create policy "blend_invites: visible to inviter and invitee"
  on public.blend_invites for select
  to authenticated
  using (auth.uid() in (inviter_id, invitee_id));

-- Read only for clients. Writes go through the functions below.
revoke all on public.blends, public.blend_members, public.blend_invites from anon, authenticated;
grant select on public.blends, public.blend_members, public.blend_invites to authenticated;


-- =========================================================== create_blend
-- Creates a blend with the current user as owner and invites p_friend_ids.
-- Needs 15+ ranked movies and 1 to 4 accepted friends. Returns the blend id.

create function public.create_blend(p_friend_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  friend_ids uuid[];
  new_blend_id uuid;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select coalesce(array_agg(distinct f), '{}') into friend_ids
  from unnest(p_friend_ids) as f
  where f is not null;

  if (select count(*) from public.rankings r where r.user_id = uid) < 15 then
    raise exception 'not_enough_rankings' using errcode = 'P0001';
  end if;
  if cardinality(friend_ids) = 0 then
    raise exception 'friend_required' using errcode = '22023';
  end if;
  if uid = any (friend_ids) then
    raise exception 'invalid_user' using errcode = '22023';
  end if;
  if cardinality(friend_ids) > public.blend_max_members() - 1 then
    raise exception 'blend_full' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(friend_ids) as f where not public.are_friends(uid, f)) then
    raise exception 'not_friends' using errcode = 'P0001';
  end if;

  insert into public.blends (owner_id) values (uid) returning id into new_blend_id;
  insert into public.blend_members (blend_id, user_id) values (new_blend_id, uid);

  insert into public.blend_invites (blend_id, inviter_id, invitee_id)
  select new_blend_id, uid, f from unnest(friend_ids) as f;

  return new_blend_id;
end;
$$;


-- =========================================================== invite_to_blend
-- The owner invites a friend. Works again after a decline or an expired invite.
-- Returns the invite id.

create function public.invite_to_blend(p_blend_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  blend_owner uuid;
  new_invite_id uuid;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_user_id is null or p_user_id = uid then
    raise exception 'invalid_user' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_blend_id::text, 0));

  select b.owner_id into blend_owner from public.blends b where b.id = p_blend_id;

  -- Non-members get the same answer as a missing blend.
  if blend_owner is null or not public.is_blend_member(p_blend_id) then
    raise exception 'blend_not_found' using errcode = 'P0002';
  end if;
  if blend_owner <> uid then
    raise exception 'not_blend_owner' using errcode = '42501';
  end if;
  if not public.are_friends(uid, p_user_id) then
    raise exception 'not_friends' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.blend_members m
    where m.blend_id = p_blend_id and m.user_id = p_user_id
  ) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  if (select count(*) from public.blend_members m where m.blend_id = p_blend_id)
     >= public.blend_max_members() then
    raise exception 'blend_full' using errcode = 'P0001';
  end if;

  -- An old invite past its date no longer counts as open.
  update public.blend_invites i
  set status = 'expired'
  where i.blend_id = p_blend_id
    and i.invitee_id = p_user_id
    and i.status = 'pending'
    and i.expires_at <= now();

  if exists (
    select 1 from public.blend_invites i
    where i.blend_id = p_blend_id and i.invitee_id = p_user_id and i.status = 'pending'
  ) then
    raise exception 'already_invited' using errcode = 'P0001';
  end if;

  insert into public.blend_invites (blend_id, inviter_id, invitee_id)
  values (p_blend_id, uid, p_user_id)
  returning id into new_invite_id;

  return new_invite_id;
end;
$$;


-- =========================================================== respond_to_blend_invite
-- The invitee accepts or declines. Returns the blend id.

create function public.respond_to_blend_invite(p_invite_id uuid, p_accept boolean)
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

  insert into public.blend_members (blend_id, user_id) values (target_blend_id, uid);
  update public.blend_invites i set status = 'accepted' where i.id = p_invite_id;

  return target_blend_id;
end;
$$;


-- =========================================================== leave_blend
-- Removes the current user and the pending invites they sent.
--   * the owner leaving passes ownership to the member with the oldest joined_at
--   * the last member leaving deletes the blend
-- Returns 'left', 'transferred' or 'deleted'.

create function public.leave_blend(p_blend_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  blend_owner uuid;
  next_owner uuid;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_blend_id::text, 0));

  select b.owner_id into blend_owner from public.blends b where b.id = p_blend_id;

  if blend_owner is null or not public.is_blend_member(p_blend_id) then
    raise exception 'blend_not_found' using errcode = 'P0002';
  end if;

  delete from public.blend_members m where m.blend_id = p_blend_id and m.user_id = uid;
  delete from public.blend_invites i
  where i.blend_id = p_blend_id and i.inviter_id = uid and i.status = 'pending';

  select m.user_id into next_owner
  from public.blend_members m
  where m.blend_id = p_blend_id
  order by m.joined_at, m.user_id
  limit 1;

  if next_owner is null then
    delete from public.blends b where b.id = p_blend_id;
    return 'deleted';
  end if;

  if blend_owner = uid then
    update public.blends b set owner_id = next_owner where b.id = p_blend_id;
    return 'transferred';
  end if;

  return 'left';
end;
$$;


-- =========================================================== reads
-- security definer so usernames come through even for members whose profile is
-- private to you (you can share a blend without being friends). Only ids,
-- usernames and blend facts come out, same as get_friendships.

-- Blends the current user belongs to.
create function public.get_my_blends()
returns table (
  blend_id          uuid,
  owner_id          uuid,
  owner_username    text,
  member_usernames  text[],
  member_count      bigint,
  created_at        timestamptz,
  joined_at         timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    b.id,
    b.owner_id,
    o.username,
    (select array_agg(p.username order by m2.joined_at, p.username)
     from public.blend_members m2
     join public.profiles p on p.id = m2.user_id
     where m2.blend_id = b.id),
    (select count(*) from public.blend_members m3 where m3.blend_id = b.id),
    b.created_at,
    me.joined_at
  from public.blend_members me
  join public.blends b on b.id = me.blend_id
  join public.profiles o on o.id = b.owner_id
  where me.user_id = auth.uid()
  order by me.joined_at desc;
$$;

-- Open invites sent to the current user. Ones past their date are left out.
create function public.get_my_blend_invites()
returns table (
  invite_id         uuid,
  blend_id          uuid,
  inviter_username  text,
  member_count      bigint,
  created_at        timestamptz,
  expires_at        timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id,
    i.blend_id,
    p.username,
    (select count(*) from public.blend_members m where m.blend_id = i.blend_id),
    i.created_at,
    i.expires_at
  from public.blend_invites i
  join public.profiles p on p.id = i.inviter_id
  where i.invitee_id = auth.uid()
    and i.status = 'pending'
    and i.expires_at > now()
  order by i.created_at desc;
$$;

-- Members of a blend. Empty for non-members and for blends that no longer exist.
create function public.get_blend_members(p_blend_id uuid)
returns table (
  user_id    uuid,
  username   text,
  is_owner   boolean,
  joined_at  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, p.username, b.owner_id = m.user_id, m.joined_at
  from public.blend_members m
  join public.blends b on b.id = m.blend_id
  join public.profiles p on p.id = m.user_id
  where m.blend_id = p_blend_id
    and public.is_blend_member(p_blend_id)
  order by m.joined_at, m.user_id;
$$;

-- Invites the current user sent for this blend: the newest per person, leaving
-- out people who accepted. Lets the owner see a decline and invite someone else.
create function public.get_blend_sent_invites(p_blend_id uuid)
returns table (
  invite_id         uuid,
  invitee_id        uuid,
  invitee_username  text,
  status            text,
  created_at        timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select latest.id, latest.invitee_id, p.username, latest.status, latest.created_at
  from (
    select distinct on (i.invitee_id)
      i.id,
      i.invitee_id,
      case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end as status,
      i.created_at
    from public.blend_invites i
    where i.blend_id = p_blend_id
      and i.inviter_id = auth.uid()
    order by i.invitee_id, i.created_at desc
  ) latest
  join public.profiles p on p.id = latest.invitee_id
  where latest.status <> 'accepted'
    and public.is_blend_member(p_blend_id)
  order by latest.created_at desc;
$$;


-- =========================================================== recommendations
-- Movies for the group, worked out from everyone's rankings when asked for:
--   * liked (loved or okay) by at least 2 members; in a 2-person blend 1 is enough,
--     because a movie both people ranked is never shown
--   * not ranked yet by at least one member
--   * never a movie any member marked meh
-- Sorted by how many members liked it, then average score. Empty for
-- non-members and for a blend with fewer than 2 members.
--
-- Only group totals come out, never one person's rankings: members don't have
-- to be friends with each other, and their profiles can be private.
--
-- A member's score uses the same formula as get_leaderboard and scoreTiers in
-- src/features/ranking/scores.js. Rankings are the only viewing history
-- SceneIt has; the watchlist means "want to watch", so it isn't excluded.

create function public.get_blend_recommendations(p_blend_id uuid, p_limit integer default 20)
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
  per_user as (
    select
      r.movie_id,
      r.category,
      count(*) over (partition by r.user_id, r.category) as cat_total,
      count(*) over (partition by r.user_id, r.position) as tier_size,
      count(*) over (partition by r.user_id, r.category order by r.position
                     range between unbounded preceding and current row) as through_tier
    from public.rankings r
    join members m on m.user_id = r.user_id
  ),
  banded as (
    select
      movie_id,
      category,
      case category when 'loved' then 6.0 when 'okay' then 4.0 else 0.0 end as band_min,
      case category when 'loved' then 10.0 when 'okay' then 5.9 else 3.9 end as band_max,
      -- 1 at the top of the category, 0 at the bottom, 0.5 when alone in it.
      coalesce(1 - ((through_tier - tier_size) + (tier_size - 1) / 2.0) / nullif(cat_total - 1, 0), 0.5) as from_top
    from per_user
  ),
  agg as (
    select
      movie_id,
      count(*) as ranked_count,
      count(*) filter (where category in ('loved', 'okay')) as liked_count,
      count(*) filter (where category = 'meh') as meh_count,
      round(avg(band_min + (band_max - band_min) * from_top), 1) as avg_score
    from banded
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


-- =========================================================== grants
-- Internal helpers: nobody calls these directly.
revoke execute on function public.blend_max_members() from public, anon, authenticated;
revoke execute on function public.enforce_blend_member_limit() from public, anon, authenticated;

-- RLS policies call this as the signed-in user, so they need it.
revoke execute on function public.is_blend_member(uuid) from public, anon;
grant execute on function public.is_blend_member(uuid) to authenticated;

revoke execute on function public.create_blend(uuid[]) from public, anon;
revoke execute on function public.invite_to_blend(uuid, uuid) from public, anon;
revoke execute on function public.respond_to_blend_invite(uuid, boolean) from public, anon;
revoke execute on function public.leave_blend(uuid) from public, anon;
revoke execute on function public.get_my_blends() from public, anon;
revoke execute on function public.get_my_blend_invites() from public, anon;
revoke execute on function public.get_blend_members(uuid) from public, anon;
revoke execute on function public.get_blend_sent_invites(uuid) from public, anon;
revoke execute on function public.get_blend_recommendations(uuid, integer) from public, anon;

grant execute on function public.create_blend(uuid[]) to authenticated;
grant execute on function public.invite_to_blend(uuid, uuid) to authenticated;
grant execute on function public.respond_to_blend_invite(uuid, boolean) to authenticated;
grant execute on function public.leave_blend(uuid) to authenticated;
grant execute on function public.get_my_blends() to authenticated;
grant execute on function public.get_my_blend_invites() to authenticated;
grant execute on function public.get_blend_members(uuid) to authenticated;
grant execute on function public.get_blend_sent_invites(uuid) to authenticated;
grant execute on function public.get_blend_recommendations(uuid, integer) to authenticated;
