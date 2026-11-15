-- Moderation v2, part 2: rate limits on new reports, comments (replies too)
-- and reviews.
--
-- A new post is refused with 'rate_limited' when the person already made too
-- many in a short window (burst) or in the last 24 hours (daily). Only NEW posts
-- count: edits and deletes don't. Every number lives in rate_limit_config()
-- below, so changing a limit is a one-line migration.
--
-- Deploy order: run this file FIRST, then deploy the frontend. The old frontend
-- keeps working against it, but shows its generic "couldn't post" message when
-- someone is limited; the new frontend maps 'rate_limited' to a clear one.
--
-- Not covered:
--   * No moderator exemption.
--   * Inserts with no signed-in user (the service role, the SQL editor, seed
--     scripts) are never limited: there is no one to count them against.
--   * An attempt that fails for another reason (flagged text, a missing ranking)
--     rolls back with everything else, so it doesn't count either.


-- =========================================================== 1. the limits
-- THE place to change a limit. One row per kind of post:
--
--   kind      burst              daily
--   report    10 per 5 minutes   30 per 24 hours
--   comment   10 per 1 minute    200 per 24 hours     (replies count as comments)
--   review    20 per 5 minutes   100 per 24 hours
--
-- "10 per 5 minutes" means the 11th within any 5-minute window is refused.
-- daily_window is also how long events are kept, so keep it the longest window.
-- tests/unit/rateLimitsSql.test.js reads this table and fails if the fake
-- backend (tests/integration/helpers/fakeBackend.js, RATE_LIMITS) drifts from it,
-- so change both. Keep one row per line in this layout so that test can find them.
create function public.rate_limit_config()
returns table (
  kind          text,
  burst_limit   integer,
  burst_window  interval,
  daily_limit   integer,
  daily_window  interval
)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('report',  10, interval '5 minutes', 30,  interval '24 hours'),
    ('comment', 10, interval '1 minute',  200, interval '24 hours'),
    ('review',  20, interval '5 minutes', 100, interval '24 hours')
  ) as t (kind, burst_limit, burst_window, daily_limit, daily_window);
$$;

-- Only the trigger function below calls it (as the function owner).
revoke execute on function public.rate_limit_config() from public;


-- =========================================================== 2. what was posted
-- A separate table instead of counting the posts themselves: otherwise someone
-- could post, delete and repost forever without ever hitting the limit.
-- RLS on and NO policies, and no grants to anon or authenticated: nobody can
-- read or write it through the API. Only the trigger below touches it (it runs
-- as the function owner, which isn't subject to RLS).

create table public.rate_limit_events (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('report', 'comment', 'review')),
  created_at  timestamptz not null default now()
);

create index rate_limit_events_user_kind_idx
  on public.rate_limit_events (user_id, kind, created_at desc);

alter table public.rate_limit_events enable row level security;
revoke all on public.rate_limit_events from anon, authenticated;


-- =========================================================== 3. the check
-- One trigger function for all three tables; the trigger passes the kind as its
-- argument. It identifies the caller with auth.uid(), not the row's user_id /
-- reporter_id (RLS forces those to match anyway, this just doesn't rely on it).
--
-- Steps: count the caller's events of this kind in the burst window and in the
-- daily window; if either is full, refuse; otherwise record this one; and
-- delete this user's events of this kind that are older than the daily window.
--
-- The advisory lock makes two simultaneous posts by the same person take turns,
-- so they can't both squeeze in under the limit. It is released at the end of
-- the transaction.
create function public.enforce_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  cfg     record;
  in_burst integer;
  in_day   integer;
begin
  if uid is null then
    return new;
  end if;

  select c.* into cfg from public.rate_limit_config() c where c.kind = tg_argv[0];
  if not found then
    raise exception 'unknown rate limit kind: %', tg_argv[0];
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rate_limit:' || uid::text || ':' || cfg.kind, 0));

  select
    count(*) filter (where e.created_at > now() - cfg.burst_window),
    count(*)
  into in_burst, in_day
  from public.rate_limit_events e
  where e.user_id = uid and e.kind = cfg.kind and e.created_at > now() - cfg.daily_window;

  if in_burst >= cfg.burst_limit or in_day >= cfg.daily_limit then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.rate_limit_events (user_id, kind) values (uid, cfg.kind);

  delete from public.rate_limit_events e
  where e.user_id = uid and e.kind = cfg.kind and e.created_at <= now() - cfg.daily_window;

  return new;
end;
$$;

-- Only the triggers run it; nobody should call it directly.
revoke execute on function public.enforce_rate_limit() from public, anon, authenticated;

-- Postgres runs BEFORE triggers in alphabetical order of their names. "a_" makes
-- this one first, ahead of reviews_check_text, review_comments_check_text and
-- reports_fill_snapshot, so spam is refused before any of the costlier checks
-- run. Don't rename it to something that sorts later.
create trigger a_rate_limit
  before insert on public.reports
  for each row execute function public.enforce_rate_limit('report');

create trigger a_rate_limit
  before insert on public.review_comments
  for each row execute function public.enforce_rate_limit('comment');

create trigger a_rate_limit
  before insert on public.reviews
  for each row execute function public.enforce_rate_limit('review');
