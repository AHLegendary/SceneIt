-- Moderation, part 1: the database checks bad text itself, blank bodies are
-- refused, and reports keep a copy of what was reported.
--
--   1. text_is_allowed + triggers: reviews and comments with blocked phrases
--      or spam are rejected by the database ('content_flagged'), not just by
--      the browser. src/lib/moderation.js still checks first so people get a
--      message right away.
--   2. No blank bodies: reviews, comments and report reasons can't be empty or
--      whitespace-only.
--   3. Reports get a snapshot (who wrote it, which review it belongs to, what
--      it said) filled in by a trigger, plus a status for the moderation page.
--
-- Deploy order: run this file FIRST, then deploy the frontend. The old
-- frontend keeps working against it (it checks the text itself, and its own
-- report button was already hidden on your own posts). The new frontend maps
-- the new error messages ('content_flagged', 'cannot_report_self'), which the
-- old database never sends.
--
-- Not in v1:
-- TODO(moderation-v2): text posted before this file isn't re-scanned.
-- TODO(moderation-v2): replace the phrase list with a hosted moderation API
--                      called from api/ (this function is the stand-in).


-- =========================================================== 1. text checks
-- The rules below are a copy of src/lib/moderation.js. CHANGE THEM TOGETHER:
-- tests/unit/moderationSql.test.js reads this file and fails if the phrase
-- list or the repeat count drift apart. If you reformat the two patterns,
-- keep that test able to find them.
--
-- Phrase match: the phrase must not touch another letter or digit on either
-- side, so "skys" and "monkeys" are fine ("[[:alnum:]]" is Postgres's way of
-- saying letters and digits; the JS version uses \p{L}\p{N}).
-- Spam: one non-space character repeated more than 20 times in a row.

create function public.text_is_allowed(p_text text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select not (
    coalesce(p_text, '') ~* '(^|[^[:alnum:]])(kill yourself|kys)($|[^[:alnum:]])'
    or coalesce(p_text, '') ~ '(\S)\1{20,}'
  );
$$;

create function public.check_text_allowed()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.text_is_allowed(new.body) then
    raise exception 'content_flagged' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- `update of body`: only runs when an edit names the body column, so the
-- spoiler flag (and the moderation columns, later) can change without a re-scan.
create trigger reviews_check_text
  before insert or update of body on public.reviews
  for each row execute function public.check_text_allowed();

create trigger review_comments_check_text
  before insert or update of body on public.review_comments
  for each row execute function public.check_text_allowed();


-- =========================================================== 2. no blank bodies
-- Added `not valid` first: that enforces the rule on every new or edited row
-- straight away without scanning old rows, so it can't fail on data that is
-- already there. Then any whitespace-only rows that slipped in are cleaned up
-- (the app trims text before saving, so there should be none), and only then
-- is the constraint validated against the whole table.
--
-- "Blank" means only spaces, tabs and line breaks. btrim() on its own strips
-- plain spaces only, which would let a body of just "\n" through.

alter table public.reviews
  add constraint reviews_body_not_blank
  check (char_length(btrim(body, E' \t\r\n')) > 0) not valid;

alter table public.review_comments
  add constraint review_comments_body_not_blank
  check (char_length(btrim(body, E' \t\r\n')) > 0) not valid;

alter table public.reports
  add constraint reports_reason_not_blank
  check (char_length(btrim(reason, E' \t\r\n')) > 0) not valid;

-- A blank review or comment says nothing, so it goes (its comments and replies
-- cascade). A report is a record, so it stays and gets a placeholder reason.
delete from public.reviews         where char_length(btrim(body, E' \t\r\n')) = 0;
delete from public.review_comments where char_length(btrim(body, E' \t\r\n')) = 0;
update public.reports set reason = '(no reason given)' where char_length(btrim(reason, E' \t\r\n')) = 0;

alter table public.reviews         validate constraint reviews_body_not_blank;
alter table public.review_comments validate constraint review_comments_body_not_blank;
alter table public.reports         validate constraint reports_reason_not_blank;


-- =========================================================== 3. report snapshots
-- A report has to survive the thing it reports: the author may edit the text
-- afterwards or delete it, and a moderator still needs to see what was said.
-- review_id has no foreign key for the same reason (reports outlive deletions).
-- target_user_id is cleared if the author's account goes away.

alter table public.reports
  add column target_user_id uuid references public.profiles (id) on delete set null,
  add column review_id      uuid,
  add column target_body    text,
  add column status         text not null default 'open'
    check (status in ('open', 'dismissed', 'hidden')),
  add column resolved_by    uuid references public.profiles (id) on delete set null,
  add column resolved_at    timestamptz;

-- Never trust the client for these. Whatever it sent in those columns is
-- overwritten here: the snapshot comes from the real row, and a new report is
-- always open and unresolved.
--
-- Security definer because the reporter may only be allowed to read part of
-- what it needs, and so it can run before the insert policy has looked at the
-- row. If the target doesn't exist the snapshot stays empty and the insert
-- policy then refuses the report, as before. It only ever raises about the
-- reporter's own content, so it reveals nothing about anyone else's.
create function public.fill_report_snapshot()
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

-- Only the trigger runs it; nobody should call it directly.
revoke execute on function public.fill_report_snapshot() from public;

create trigger reports_fill_snapshot
  before insert on public.reports
  for each row execute function public.fill_report_snapshot();

-- Fill in the snapshot for reports filed before this file, where the target
-- still exists. (Reports about things that were already deleted stay empty.)
update public.reports rp
set target_user_id = r.user_id, review_id = r.id, target_body = r.body
from public.reviews r
where rp.target_type = 'review' and rp.target_id = r.id;

update public.reports rp
set target_user_id = c.user_id, review_id = c.review_id, target_body = c.body
from public.review_comments c
where rp.target_type = 'comment' and rp.target_id = c.id;

-- The moderation queue: open reports, newest first.
create index reports_open_idx on public.reports (created_at desc) where status = 'open';

-- Grants: unchanged. `authenticated` can still only insert into reports.
