-- Moderation, part 2: moderators, and hiding reviews and comments.
--
--   1. profiles.is_moderator and is_moderator().
--   2. hidden_at / hidden_by / hidden_reason on reviews and review_comments.
--   3. Hidden content disappears for everyone except its author and
--      moderators: the reviews and review_comments select policies,
--      get_review_comments (placeholder rows), get_review_feed,
--      notification_available, get_notifications and open_notification.
--      You also can't comment on a hidden review or reply to a hidden comment.
--   4. Moderator RPCs: get_reports and moderate_content (hide, restore,
--      dismiss).
--
-- Making someone a moderator has no UI. Do it in the Supabase SQL editor:
--
--   update public.profiles set is_moderator = true where username = '...';
--
-- Users can never set it themselves: it is not in the profiles update grant
-- (username, bio, pronouns, is_public, top_movies), and neither are the hidden_*
-- columns in the reviews / review_comments update grants. Don't add a
-- table-wide `grant update` to any of these tables.
--
-- Deploy order: run this file FIRST, then deploy the frontend. The old
-- frontend keeps working: hidden content simply doesn't show up, and its
-- get_review_comments reads still work (the extra columns are ignored). The
-- new frontend needs the new columns and the is_hidden output.
--
-- Not in v1:
-- TODO(moderation-v2): tell the author when their content is hidden.
-- TODO(moderation-v2): ban or suspend users, or hide a whole profile.
-- TODO(moderation-v2): rate limits on posting and reporting.


-- =========================================================== 1. moderator role

alter table public.profiles add column is_moderator boolean not null default false;

-- Security definer so it can read the flag whatever the caller's own profile
-- policy allows. Granted to signed-out visitors too, on purpose: the reviews
-- and comments select policies below call it, and Postgres checks EXECUTE on
-- every function a policy uses for the role running the query, even when the
-- other half of the `or` would have been enough. Without the anon grant,
-- signed-out visitors would get "permission denied" reading any review. For
-- them auth.uid() is null, so it simply returns false.
create function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_moderator from public.profiles p where p.id = auth.uid()), false);
$$;

revoke execute on function public.is_moderator() from public;
grant execute on function public.is_moderator() to anon, authenticated;


-- =========================================================== 2. hidden columns
-- None of these are in an update grant, so users can't set them. Only
-- moderate_content (below) writes them.

alter table public.reviews
  add column hidden_at     timestamptz,
  add column hidden_by     uuid references public.profiles (id) on delete set null,
  add column hidden_reason text check (char_length(hidden_reason) <= 500);

alter table public.review_comments
  add column hidden_at     timestamptz,
  add column hidden_by     uuid references public.profiles (id) on delete set null,
  add column hidden_reason text check (char_length(hidden_reason) <= 500);


-- =========================================================== 3. who sees hidden content

-- Reviews: a hidden review is visible to its author and to moderators only.
drop policy "reviews: visible if author is visible" on public.reviews;
create policy "reviews: visible if author is visible"
  on public.reviews for select
  using (
    public.can_view_user(user_id)
    and (hidden_at is null or user_id = auth.uid() or public.is_moderator())
  );

-- Comments: the subquery runs as the caller, so it already follows the review
-- rule above (comments on a hidden review are only reachable by its author and
-- moderators). The hidden clause is the same rule for the comment itself. This
-- also covers the review_comments(count) embed, so comment counts drop hidden
-- comments for everyone else.
drop policy "review_comments: visible if the review is visible" on public.review_comments;
create policy "review_comments: visible if the review is visible"
  on public.review_comments for select
  using (
    exists (select 1 from public.reviews r where r.id = review_id)
    and (hidden_at is null or user_id = auth.uid() or public.is_moderator())
  );

-- You can't comment on a hidden review (not even its author, or a moderator).
drop policy "review_comments: comment as yourself on a visible review" on public.review_comments;
create policy "review_comments: comment as yourself on a visible review"
  on public.review_comments for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.reviews r where r.id = review_id and r.hidden_at is null)
  );

-- ... or reply to a hidden comment. (Someone who can't see the hidden parent
-- gets "Reply target not found" already; this covers its author and moderators.)
create or replace function public.check_comment_nesting()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent public.review_comments;
begin
  if new.parent_id is null then
    return new;
  end if;

  select * into parent from public.review_comments where id = new.parent_id;
  if not found then
    raise exception 'Reply target not found' using errcode = '23503';
  end if;
  if parent.parent_id is not null then
    raise exception 'Replies can''t have replies' using errcode = '23514';
  end if;
  if parent.review_id <> new.review_id then
    raise exception 'Reply must be on the same review' using errcode = '23514';
  end if;
  if parent.hidden_at is not null then
    raise exception 'Can''t reply to a hidden comment' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Hiding is not an edit. touch_updated_at stamps updated_at on every update,
-- which would make a hidden (or restored) review look as if its author had
-- edited it. So it now skips updates that change the hidden_* columns. (Checked
-- inside the function, not with a `when` clause on the trigger, so an author
-- re-saving without changing anything still stamps updated_at like before.)
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.hidden_at     is distinct from old.hidden_at
     or new.hidden_by     is distinct from old.hidden_by
     or new.hidden_reason is distinct from old.hidden_reason then
    return new;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- get_review_comments: the return type changes (is_hidden, hidden_reason), so
-- it has to be dropped and created again, and the grants applied again.
--
-- Hidden comments come back as placeholder rows for everyone except their
-- author and moderators: no body, no user id, no username, so the thread keeps
-- its shape and replies stay under them. The review must be visible too: a
-- hidden review's comments are only returned to its author and moderators.
drop function public.get_review_comments(uuid);

create function public.get_review_comments(p_review_id uuid)
returns table (
  id            uuid,
  review_id     uuid,
  user_id       uuid,
  parent_id     uuid,
  body          text,
  created_at    timestamptz,
  updated_at    timestamptz,
  username      text,
  is_hidden     boolean,
  hidden_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.review_id,
    case when not m.masked then c.user_id end,
    c.parent_id,
    case when not m.masked then c.body end,
    c.created_at,
    c.updated_at,
    case when not m.masked then p.username end,
    c.hidden_at is not null,
    case when not m.masked then c.hidden_reason end
  from public.review_comments c
  join public.reviews r on r.id = c.review_id
  join public.profiles p on p.id = c.user_id
  cross join lateral (
    select (c.hidden_at is not null
            and c.user_id is distinct from auth.uid()
            and not public.is_moderator()) as masked
  ) m
  where c.review_id = p_review_id
    and public.can_view_user(r.user_id)
    and (r.hidden_at is null or r.user_id = auth.uid() or public.is_moderator())
  order by c.created_at, c.id;
$$;

revoke execute on function public.get_review_comments(uuid) from public;
grant execute on function public.get_review_comments(uuid) to anon, authenticated;

-- get_review_feed: same function as before with two more filters. The feed is
-- the public view, so hidden reviews are out for everyone, authors and
-- moderators included, and hidden comments don't count.
create or replace function public.get_review_feed(
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
    where c.hidden_at is null
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
      and r.hidden_at is null
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

-- notification_available: fills in the two TODO(moderation) lines from the
-- notifications migration. A notification about a hidden comment, or a comment
-- on a hidden review, is "no longer available" (for everyone, the author and
-- moderators included: the panel just says it's gone). Nothing else changes.
create or replace function public.notification_available(n public.notifications)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case n.type
    when 'comment' then exists (
      select 1
      from public.review_comments c
      join public.reviews r on r.id = c.review_id
      where c.id = n.comment_id
        and c.review_id = n.review_id
        and public.can_view_user(r.user_id)
        and c.hidden_at is null and r.hidden_at is null
    )
    when 'reply' then exists (
      select 1
      from public.review_comments c
      join public.reviews r on r.id = c.review_id
      where c.id = n.comment_id
        and c.review_id = n.review_id
        and public.can_view_user(r.user_id)
        and c.hidden_at is null and r.hidden_at is null
    )
    when 'friend_request' then exists (
      select 1
      from public.friendships f
      where f.requester_id = n.actor_id
        and f.addressee_id = n.recipient_id
        and f.status = 'pending'
    )
    when 'blend_invite' then exists (
      select 1
      from public.blend_invites i
      where i.id = n.blend_invite_id
        and i.status = 'pending'
        and i.expires_at > now()
    )
    else false
  end;
$$;

-- get_notifications and open_notification also read reviews as the function
-- owner. The comment preview was already safe (it only shows while
-- notification_available is true), but the review author's username and the
-- movie title came back for a hidden review too. Now they follow the same rule
-- as the reviews policy: for a hidden review only its author and moderators
-- get them. The row itself still comes back (with available = false), so the
-- panel can say the target is gone. Same signatures, so the grants stay.
create or replace function public.get_notifications(p_limit integer default 30)
returns table (
  id                     uuid,
  type                   text,
  created_at             timestamptz,
  seen_at                timestamptz,
  read_at                timestamptz,
  actor_username         text,
  review_id              uuid,
  comment_id             uuid,
  review_author_username text,
  movie_title            text,
  preview                text,
  available              boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  return query
  select
    n.id,
    n.type,
    n.created_at,
    n.seen_at,
    n.read_at,
    actor.username,
    n.review_id,
    n.comment_id,
    case when public.can_view_user(r.user_id)
              and (r.hidden_at is null or r.user_id = auth.uid() or public.is_moderator())
         then author.username end,
    case when public.can_view_user(r.user_id)
              and (r.hidden_at is null or r.user_id = auth.uid() or public.is_moderator())
         then m.title end,
    case when av.ok then left(c.body, 120) end,
    av.ok
  from public.notifications n
  join public.profiles actor on actor.id = n.actor_id
  left join public.reviews r on r.id = n.review_id
  left join public.profiles author on author.id = r.user_id
  left join public.movies m on m.tmdb_id = r.movie_id
  left join public.review_comments c on c.id = n.comment_id
  cross join lateral (select public.notification_available(n) as ok) av
  where n.recipient_id = auth.uid()
  order by n.created_at desc, n.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
end;
$$;

create or replace function public.open_notification(p_id uuid)
returns table (
  available              boolean,
  type                   text,
  review_id              uuid,
  comment_id             uuid,
  review_author_username text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  update public.notifications n
  set read_at = coalesce(n.read_at, now()),
      seen_at = coalesce(n.seen_at, now())
  where n.id = p_id and n.recipient_id = uid;

  return query
  select
    public.notification_available(n),
    n.type,
    n.review_id,
    n.comment_id,
    case when public.can_view_user(r.user_id)
              and (r.hidden_at is null or r.user_id = uid or public.is_moderator())
         then author.username end
  from public.notifications n
  left join public.reviews r on r.id = n.review_id
  left join public.profiles author on author.id = r.user_id
  where n.id = p_id and n.recipient_id = uid;
end;
$$;


-- =========================================================== 4. moderator RPCs

-- The reports queue. One row per reported thing (and status, see below), the
-- newest report first.
--
-- p_status: 'open', 'dismissed', 'hidden', or 'resolved' (= dismissed + hidden,
-- for the Resolved tab). Reports on the same target are grouped after
-- filtering, and also by status: if something was reported, hidden, restored
-- and then reported again, the old reports (hidden) and the new ones (open)
-- are separate rows, each with its own outcome.
--
-- target_body is the text from the EARLIEST report in the group (what the first
-- person saw); current_body is what the text says now, or null once it's gone.
-- review_author_username is the author of the review the target is on (for the
-- "view in context" link) and is null if that review no longer exists.
-- reports is [{ reason, reporter, created_at }], oldest first.
create function public.get_reports(
  p_status text default 'open',
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  target_type            text,
  target_id              uuid,
  review_id              uuid,
  review_author_username text,
  target_author_username text,
  target_body            text,
  current_body           text,
  is_deleted             boolean,
  is_hidden              boolean,
  report_count           integer,
  reports                jsonb,
  status                 text,
  resolved_by_username   text,
  resolved_at            timestamptz,
  last_reported_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_moderator() then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  if p_status not in ('open', 'dismissed', 'hidden', 'resolved') then
    raise exception 'Status must be open, dismissed, hidden or resolved' using errcode = '22023';
  end if;
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  p_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  with grouped as (
    select
      rp.target_type,
      rp.target_id,
      rp.status,
      (array_agg(rp.review_id order by rp.created_at))[1]       as review_id,
      (array_agg(rp.target_user_id order by rp.created_at))[1]  as target_user_id,
      (array_agg(rp.target_body order by rp.created_at))[1]     as target_body,
      count(*)::integer                                         as report_count,
      jsonb_agg(
        jsonb_build_object('reason', rp.reason, 'reporter', reporter.username, 'created_at', rp.created_at)
        order by rp.created_at
      )                                                         as reports,
      (array_agg(rp.resolved_by order by rp.resolved_at desc nulls last))[1] as resolved_by,
      max(rp.resolved_at)                                       as resolved_at,
      max(rp.created_at)                                        as last_reported_at
    from public.reports rp
    join public.profiles reporter on reporter.id = rp.reporter_id
    where rp.status = p_status or (p_status = 'resolved' and rp.status <> 'open')
    group by rp.target_type, rp.target_id, rp.status
    order by max(rp.created_at) desc, rp.target_id
    limit p_limit offset p_offset
  )
  select
    g.target_type,
    g.target_id,
    g.review_id,
    review_author.username,
    target_author.username,
    g.target_body,
    case g.target_type when 'review' then rv.body else c.body end,
    case g.target_type when 'review' then rv.id is null else c.id is null end,
    coalesce(case g.target_type when 'review' then rv.hidden_at else c.hidden_at end is not null, false),
    g.report_count,
    g.reports,
    g.status,
    resolver.username,
    g.resolved_at,
    g.last_reported_at
  from grouped g
  left join public.reviews rv on rv.id = g.review_id
  left join public.review_comments c on g.target_type = 'comment' and c.id = g.target_id
  left join public.profiles review_author on review_author.id = rv.user_id
  left join public.profiles target_author on target_author.id = g.target_user_id
  left join public.profiles resolver on resolver.id = g.resolved_by
  order by g.last_reported_at desc, g.target_id;
end;
$$;

-- Hide, restore or dismiss a reported review or comment.
--
--   hide     hides it and marks every OPEN report on it 'hidden'.
--   restore  un-hides it. Reports are history and are left alone.
--   dismiss  marks every open report on it 'dismissed'. The content stays.
--
-- hide and restore need the content to still exist ('target_not_found');
-- dismiss works on deleted content, since the report still has to be cleared.
-- Hiding doesn't touch updated_at (see touch_updated_at above), so it doesn't
-- look like the author edited it.
-- TODO(moderation-v2): notify the author when their content is hidden.
create function public.moderate_content(
  p_target_type text,
  p_target_id   uuid,
  p_action      text,
  p_reason      text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid    uuid := auth.uid();
  reason text := nullif(btrim(p_reason), '');
  n      integer;
begin
  if not public.is_moderator() then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  if p_target_type not in ('review', 'comment') then
    raise exception 'Target type must be review or comment' using errcode = '22023';
  end if;
  if p_action not in ('hide', 'restore', 'dismiss') then
    raise exception 'Action must be hide, restore or dismiss' using errcode = '22023';
  end if;
  if char_length(reason) > 500 then
    raise exception 'The reason is too long (500 characters at most)' using errcode = '22023';
  end if;

  if p_action = 'dismiss' then
    update public.reports
    set status = 'dismissed', resolved_by = uid, resolved_at = now()
    where target_type = p_target_type and target_id = p_target_id and status = 'open';
    return;
  end if;

  if p_action = 'hide' then
    if p_target_type = 'review' then
      update public.reviews
      set hidden_at = now(), hidden_by = uid, hidden_reason = reason
      where id = p_target_id;
    else
      update public.review_comments
      set hidden_at = now(), hidden_by = uid, hidden_reason = reason
      where id = p_target_id;
    end if;
    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'target_not_found' using errcode = 'P0002';
    end if;

    update public.reports
    set status = 'hidden', resolved_by = uid, resolved_at = now()
    where target_type = p_target_type and target_id = p_target_id and status = 'open';
    return;
  end if;

  -- restore. Only touches rows that are hidden, so restoring something that
  -- isn't hidden is a harmless no-op that doesn't stamp updated_at.
  if p_target_type = 'review' then
    update public.reviews
    set hidden_at = null, hidden_by = null, hidden_reason = null
    where id = p_target_id and hidden_at is not null;
    get diagnostics n = row_count;
    if n = 0 and not exists (select 1 from public.reviews where id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0002';
    end if;
  else
    update public.review_comments
    set hidden_at = null, hidden_by = null, hidden_reason = null
    where id = p_target_id and hidden_at is not null;
    get diagnostics n = row_count;
    if n = 0 and not exists (select 1 from public.review_comments where id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0002';
    end if;
  end if;
end;
$$;

revoke execute on function public.get_reports(text, integer, integer) from public;
revoke execute on function public.moderate_content(text, uuid, text, text) from public;
grant execute on function public.get_reports(text, integer, integer) to authenticated;
grant execute on function public.moderate_content(text, uuid, text, text) to authenticated;
