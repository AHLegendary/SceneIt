-- Reviews, comments and reports.
--
--   * reviews:         one short write-up per (user, movie), written when the
--                      movie is ranked. Only for movies the user has ranked;
--                      un-ranking a movie deletes its review (see
--                      remove_ranking below).
--   * review_comments: comments on a review, with ONE level of replies.
--   * reports:         "this review/comment is a problem". Users can file
--                      them but not read them back; moderators read them
--                      through the dashboard (service role) for now.
--
-- Who can see what follows the existing privacy rule (can_view_user): if you
-- can see someone's profile and rankings, you can see their reviews and the
-- comments on them.
--
-- No frontend change is needed to apply this: the app just doesn't use these
-- tables until the review features ship.


-- =========================================================== reviews

create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  movie_id    integer not null references public.movies (tmdb_id),
  body        text not null check (char_length(body) between 1 and 2000),
  is_spoiler  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, movie_id)
);

-- Profile page: one user's reviews, newest first. Community feed: newest
-- first across everyone.
create index reviews_user_created_idx on public.reviews (user_id, created_at desc);
create index reviews_created_idx on public.reviews (created_at desc);


-- =========================================================== review_comments
-- parent_id is null for a top-level comment, or points at a top-level comment
-- for a reply. Replies can't have replies (checked by the trigger below).

create table public.review_comments (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.reviews (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  parent_id   uuid references public.review_comments (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index review_comments_review_idx on public.review_comments (review_id, created_at);
create index review_comments_parent_idx on public.review_comments (parent_id);

-- A reply must point at a top-level comment on the same review.
create function public.check_comment_nesting()
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
  return new;
end;
$$;

create trigger review_comments_nesting
  before insert on public.review_comments
  for each row execute function public.check_comment_nesting();


-- =========================================================== updated_at
-- Edits stamp updated_at on the server, so the client can't fake it.

create function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger reviews_touch_updated_at
  before update on public.reviews
  for each row execute function public.touch_updated_at();

create trigger review_comments_touch_updated_at
  before update on public.review_comments
  for each row execute function public.touch_updated_at();


-- =========================================================== reports
-- target_id points at a review or a comment depending on target_type. There's
-- no foreign key because it can be either table; reports about something
-- that was later deleted just stay as a record.

create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references public.profiles (id) on delete cascade,
  target_type  text not null check (target_type in ('review', 'comment')),
  target_id    uuid not null,
  reason       text not null check (char_length(reason) between 1 and 500),
  created_at   timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);


-- =========================================================== RLS

alter table public.reviews         enable row level security;
alter table public.review_comments enable row level security;
alter table public.reports         enable row level security;

-- reviews
create policy "reviews: visible if author is visible"
  on public.reviews for select
  using (public.can_view_user(user_id));

-- You can only review a movie you've ranked.
create policy "reviews: users insert their own for ranked movies"
  on public.reviews for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.rankings r
      where r.user_id = auth.uid() and r.movie_id = reviews.movie_id
    )
  );

create policy "reviews: users update their own"
  on public.reviews for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "reviews: users delete their own"
  on public.reviews for delete
  using (user_id = auth.uid());

-- Edits can change the text and the spoiler flag, nothing else (not the
-- owner, the movie, or the dates).
revoke update on public.reviews from anon, authenticated;
grant update (body, is_spoiler) on public.reviews to authenticated;

-- review_comments
-- The subqueries below run as the caller, so they only find reviews the
-- caller is allowed to see (the reviews policy above applies).
create policy "review_comments: visible if the review is visible"
  on public.review_comments for select
  using (exists (select 1 from public.reviews r where r.id = review_id));

create policy "review_comments: comment as yourself on a visible review"
  on public.review_comments for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.reviews r where r.id = review_id)
  );

create policy "review_comments: users update their own"
  on public.review_comments for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- The commenter can delete their comment, and the review's author can delete
-- any comment on their review.
create policy "review_comments: commenter or review author deletes"
  on public.review_comments for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.reviews r
      where r.id = review_id and r.user_id = auth.uid()
    )
  );

revoke update on public.review_comments from anon, authenticated;
grant update (body) on public.review_comments to authenticated;

-- reports: insert only, as yourself, and only about something you can see.
create policy "reports: file a report as yourself"
  on public.reports for insert
  with check (
    reporter_id = auth.uid()
    and (
      (target_type = 'review'
        and exists (select 1 from public.reviews r where r.id = target_id))
      or (target_type = 'comment'
        and exists (select 1 from public.review_comments c where c.id = target_id))
    )
  );
-- No select, update or delete policy: nobody reads reports through the app.


-- =========================================================== remove_ranking
-- Same as before (init_schema), plus: un-ranking a movie deletes the user's
-- review of it, and its comments go with it (cascade). Otherwise the review
-- would be left behind with no ranking (and no score) to hang off.
-- The signature doesn't change, so no frontend deploy is needed.

create or replace function public.remove_ranking(p_movie_id integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  old_pos integer;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  delete from public.rankings
  where user_id = uid and movie_id = p_movie_id
  returning position into old_pos;

  if old_pos is not null and not exists (
    select 1 from public.rankings where user_id = uid and position = old_pos
  ) then
    update public.rankings set position = position - 1
    where user_id = uid and position > old_pos;
  end if;

  delete from public.reviews where user_id = uid and movie_id = p_movie_id;
end;
$$;
