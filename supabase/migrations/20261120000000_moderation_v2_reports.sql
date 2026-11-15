-- Moderation v2, part 1: report cooldown, all-time totals, and telling authors
-- when their post is hidden.
--
--   1. Report again after a cooldown. The "one report per person per post"
--      rule becomes "one OPEN report per person per post", and a report can be
--      filed again once the earlier one was resolved (dismissed, or hidden and
--      then restored) a day ago ('report_cooldown').
--   2. get_reports also returns all-time totals for each card.
--   3. A moderator hiding a review or comment notifies its author
--      ('content_hidden', with no actor: we don't say which moderator). Restoring
--      it takes the notification away again.
--
-- Deploy order: run this file FIRST, then deploy the frontend. The old frontend
-- keeps working against it: it never sends the new error, ignores the new
-- get_reports columns, and shows an unknown notification type as "<someone> did
-- something" (it only ever sees one after a moderator hides a post of theirs, so
-- deploy soon after). The new frontend maps 'report_cooldown', shows the totals
-- and words the new notification.
--
-- Constraint names are looked up instead of guessed: the unique constraint on
-- reports and the two check constraints on notifications were declared inline,
-- so Postgres named them itself. Each lookup matches by what the constraint
-- says and aborts the whole migration if it doesn't find exactly what it
-- expects, so it never drops the wrong thing.


-- =========================================================== 1. report cooldown

-- How long after a report was resolved the same person may report the same post
-- again. The ONE place to change it: tests/integration/helpers/fakeBackend.js
-- has the same number (REPORT_COOLDOWN_MS).
create function public.report_cooldown()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '1 day';
$$;

-- Postgres named the inline `unique (reporter_id, target_type, target_id)`
-- itself, so find it by what it covers: a unique constraint on exactly those
-- three columns (in any order). It must match exactly ONE constraint; if not,
-- stop with a message instead of dropping something else or nothing.
do $$
declare
  found text[];
begin
  select array_agg(c.conname::text) into found
  from pg_constraint c
  where c.conrelid = 'public.reports'::regclass
    and c.contype = 'u'
    and (
      select array_agg(a.attname::text order by a.attname)
      from unnest(c.conkey) as k(attnum)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    ) = array['reporter_id', 'target_id', 'target_type'];

  if coalesce(cardinality(found), 0) <> 1 then
    raise exception 'moderation v2: expected exactly 1 unique constraint on public.reports (reporter_id, target_type, target_id), found %: %',
      coalesce(cardinality(found), 0), coalesce(found::text, '{}');
  end if;

  execute format('alter table public.reports drop constraint %I', found[1]);
end;
$$;

-- At most one OPEN report per person per post. Resolved ones are history, so
-- the same person can have several over time. A second open one is a unique
-- violation (23505), which the app already shows as "You've already reported
-- that."
create unique index reports_one_open_per_reporter_idx
  on public.reports (reporter_id, target_type, target_id)
  where status = 'open';

-- The snapshot trigger from 20261118000000, now with the cooldown check FIRST,
-- before anything is looked up. The cooldown counts from when the earlier report
-- was RESOLVED, not from when it was filed. A report that is still open has no
-- resolved_at, so it isn't a cooldown: the unique index above refuses it instead.
--
-- It looks at auth.uid()'s own reports, not new.reporter_id: this trigger runs
-- before the insert policy has checked that the two match, and it reads
-- reports as the function owner, so going by the row would let anyone ask
-- whether somebody else had reported something recently.
create or replace function public.fill_report_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid;
  v_review uuid;
  v_body   text;
begin
  if exists (
    select 1
    from public.reports rp
    where rp.reporter_id = auth.uid()
      and rp.target_type = new.target_type
      and rp.target_id   = new.target_id
      and rp.resolved_at > now() - public.report_cooldown()
  ) then
    raise exception 'report_cooldown' using errcode = 'P0001';
  end if;

  if new.target_type = 'review' then
    select r.user_id, r.id, r.body into v_user, v_review, v_body
    from public.reviews r where r.id = new.target_id;
  else
    select c.user_id, c.review_id, c.body into v_user, v_review, v_body
    from public.review_comments c where c.id = new.target_id;
  end if;

  if v_user is not null and v_user = new.reporter_id then
    raise exception 'cannot_report_self' using errcode = '42501';
  end if;

  new.target_user_id := v_user;
  new.review_id      := v_review;
  new.target_body    := v_body;
  new.status         := 'open';
  new.resolved_by    := null;
  new.resolved_at    := null;
  return new;
end;
$$;

-- Only the trigger above uses it (it runs as the function owner), so nobody
-- else needs to call it.
revoke execute on function public.report_cooldown() from public;


-- =========================================================== 2. notifications schema

-- 'content_hidden' has no actor (nobody is told which moderator did it), so
-- actor_id can now be null. The check below makes sure that is the ONLY type
-- without one.
alter table public.notifications alter column actor_id drop not null;

-- The two check constraints (the one on `type` and the one on the targets) were
-- declared inline, so Postgres named them. Find each by its definition
-- (Postgres prints `type in (...)` as `type = ANY (ARRAY[...])`):
--   * the type check: mentions type = ANY and none of the target columns;
--   * the targets check: mentions review_id, comment_id and blend_invite_id.
-- There must be exactly one of each (and nothing else); if not, stop with a
-- message instead of dropping something else.
do $$
declare
  type_checks   text[];
  target_checks text[];
  other_checks  text[];
begin
  select
    array_agg(c.conname::text) filter (where d like '%type = ANY%' and d not like '%review_id%'),
    array_agg(c.conname::text) filter (where d like '%review_id%' and d like '%comment_id%' and d like '%blend_invite_id%'),
    array_agg(c.conname::text) filter (where not (
      (d like '%type = ANY%' and d not like '%review_id%')
      or (d like '%review_id%' and d like '%comment_id%' and d like '%blend_invite_id%')
    ))
  into type_checks, target_checks, other_checks
  from pg_constraint c
  cross join lateral (select pg_get_constraintdef(c.oid) as d) def
  where c.conrelid = 'public.notifications'::regclass and c.contype = 'c';

  if coalesce(cardinality(type_checks), 0) <> 1
     or coalesce(cardinality(target_checks), 0) <> 1
     or other_checks is not null then
    raise exception 'moderation v2: expected exactly 2 check constraints on public.notifications (1 on type, 1 on review_id/comment_id/blend_invite_id), found type: %, targets: %, other: %',
      coalesce(type_checks::text, '{}'), coalesce(target_checks::text, '{}'), coalesce(other_checks::text, '{}');
  end if;

  execute format('alter table public.notifications drop constraint %I', type_checks[1]);
  execute format('alter table public.notifications drop constraint %I', target_checks[1]);
end;
$$;

alter table public.notifications
  add constraint notifications_type_check
  check (type in ('comment', 'reply', 'friend_request', 'blend_invite', 'content_hidden'));

-- content_hidden: always needs review_id; comment_id is set for a hidden
-- comment and null for a hidden review. Every other type still needs its actor.
alter table public.notifications
  add constraint notifications_targets_check
  check (
    (type in ('comment', 'reply') and actor_id is not null and review_id is not null and comment_id is not null)
    or (type = 'friend_request' and actor_id is not null)
    or (type = 'blend_invite' and actor_id is not null and blend_invite_id is not null)
    or (type = 'content_hidden' and actor_id is null and review_id is not null)
  );


-- =========================================================== 3. is the target still there?
-- notification_available with one more branch. 'content_hidden' is available
-- while the post still exists, hidden or not: its author can always see their
-- own hidden post, so there is no hidden filter here. If the author deleted it,
-- it is gone. Everything else is unchanged.
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
    when 'content_hidden' then case
      when n.comment_id is not null then exists (
        select 1
        from public.review_comments c
        where c.id = n.comment_id and c.review_id = n.review_id
      )
      else exists (select 1 from public.reviews r where r.id = n.review_id)
    end
    else false
  end;
$$;


-- =========================================================== 4. get_notifications
-- Same function as before, with two changes:
--   * the actor join is a LEFT join, so a notification with no actor still
--     comes back (actor_username is null);
--   * for 'content_hidden' the preview is the moderator's reason (null if there
--     is none) instead of comment text. Like the comment preview, it only shows
--     while the notification is available.
-- movie_title and review_author_username already follow the hidden-review rule
-- from 20261119000000 (the author and moderators get them), so they come back
-- for the author of a hidden review.
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
    case
      when not av.ok then null
      when n.type = 'content_hidden' then case when n.comment_id is not null then c.hidden_reason else r.hidden_reason end
      else left(c.body, 120)
    end,
    av.ok
  from public.notifications n
  left join public.profiles actor on actor.id = n.actor_id
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


-- =========================================================== 5. get_reports: all-time totals
-- Two more columns:
--   total_report_count    every report ever filed on this target, any status
--   total_reporter_count  distinct people who ever reported it (lower than the
--                         count when someone reported again after a cooldown)
-- report_count stays what it was: the reports in THIS card's state. Dropped and
-- created again because the return type changes; grants applied again below.
drop function public.get_reports(text, integer, integer);

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
  total_report_count     integer,
  total_reporter_count   integer,
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
    tot.reports_ever,
    tot.reporters_ever,
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
  -- Every report on this target, whatever its status. Only for the page of
  -- cards being returned, not the whole table.
  cross join lateral (
    select count(*)::integer as reports_ever, count(distinct t.reporter_id)::integer as reporters_ever
    from public.reports t
    where t.target_type = g.target_type and t.target_id = g.target_id
  ) tot
  order by g.last_reported_at desc, g.target_id;
end;
$$;

revoke execute on function public.get_reports(text, integer, integer) from public;
grant execute on function public.get_reports(text, integer, integer) to authenticated;


-- =========================================================== 6. moderate_content
-- Same function as before, plus the notification:
--   hide     tells the content's author ('content_hidden', no actor). Not when
--            the moderator is hiding their own post, and not twice for a post
--            that is hidden again (the reason is read live, so the one
--            notification already shows the new reason).
--   restore  deletes the author's 'content_hidden' notification: restoring
--            undoes the hide completely.
-- Dismiss is unchanged.
create or replace function public.moderate_content(
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
  uid     uuid := auth.uid();
  reason  text := nullif(btrim(p_reason), '');
  n       integer;
  author  uuid;
  rev_id  uuid;
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
      where id = p_target_id
      returning user_id, id into author, rev_id;
    else
      update public.review_comments
      set hidden_at = now(), hidden_by = uid, hidden_reason = reason
      where id = p_target_id
      returning user_id, review_id into author, rev_id;
    end if;
    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'target_not_found' using errcode = 'P0002';
    end if;

    update public.reports
    set status = 'hidden', resolved_by = uid, resolved_at = now()
    where target_type = p_target_type and target_id = p_target_id and status = 'open';

    if author is not null
       and author <> uid
       and not exists (
         select 1 from public.notifications x
         where x.type = 'content_hidden'
           and x.recipient_id = author
           and x.review_id = rev_id
           and x.comment_id is not distinct from (case when p_target_type = 'comment' then p_target_id end)
       ) then
      insert into public.notifications (recipient_id, actor_id, type, review_id, comment_id)
      values (author, null, 'content_hidden', rev_id,
              case when p_target_type = 'comment' then p_target_id end);
    end if;
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
    delete from public.notifications
    where type = 'content_hidden' and review_id = p_target_id and comment_id is null;
  else
    update public.review_comments
    set hidden_at = null, hidden_by = null, hidden_reason = null
    where id = p_target_id and hidden_at is not null;
    get diagnostics n = row_count;
    if n = 0 and not exists (select 1 from public.review_comments where id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0002';
    end if;
    delete from public.notifications
    where type = 'content_hidden' and comment_id = p_target_id;
  end if;
end;
$$;

revoke execute on function public.moderate_content(text, uuid, text, text) from public;
grant execute on function public.moderate_content(text, uuid, text, text) to authenticated;
