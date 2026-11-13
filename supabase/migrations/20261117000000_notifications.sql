-- Notifications (v1): the data behind the bell in the top nav.
--
-- You get a notification when someone
--   * comments on your review                  ('comment')
--   * replies to your comment                  ('reply')
--   * sends you a friend request               ('friend_request')
--   * invites you to a Movie Blend             ('blend_invite')
--
-- Rows are created only by triggers on those tables, never by the app, so
-- nobody can fake a notification for someone else. Nobody is notified about
-- their own actions.
--
-- The target columns (review_id, comment_id, blend_invite_id) have no foreign
-- keys on purpose. When the comment, the review or the invite is deleted, the
-- notification has to survive, so that clicking it can say "no longer
-- available" instead of the row silently vanishing.
--
-- A friend request has no id of its own (friendships has a composite key), so
-- its notification points at it with (actor_id = requester, recipient_id =
-- addressee).
--
-- The notification doesn't copy the comment text. get_notifications reads it
-- live, so edits, deletions and (later) moderation are always reflected.
--
-- "Is the thing still there?" is answered in ONE place,
-- notification_available. When moderation arrives and can hide reviews and
-- comments, that function is the only one that has to change.
--
-- No frontend deploy is needed before running this: nothing in the app calls
-- the new functions yet.


-- =========================================================== 1. table

create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  recipient_id     uuid not null references public.profiles (id) on delete cascade,
  actor_id         uuid not null references public.profiles (id) on delete cascade,
  type             text not null check (type in ('comment', 'reply', 'friend_request', 'blend_invite')),
  -- Targets. No foreign keys, see the header.
  review_id        uuid,
  comment_id       uuid,
  blend_invite_id  uuid,
  created_at       timestamptz not null default now(),
  -- seen: the panel was opened (clears the badge). read: the row was clicked.
  seen_at          timestamptz,
  read_at          timestamptz,
  check (
    (type in ('comment', 'reply') and review_id is not null and comment_id is not null)
    or (type = 'friend_request')
    or (type = 'blend_invite' and blend_invite_id is not null)
  )
);

create index notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);


-- =========================================================== 2. RLS and grants

alter table public.notifications enable row level security;

create policy "notifications: recipient reads"
  on public.notifications for select
  using (recipient_id = auth.uid());

-- The recipient may mark their own notifications seen/read. Which columns is
-- decided by the column grant below. There is no insert or delete policy:
-- only the triggers create rows.
create policy "notifications: recipient updates"
  on public.notifications for update
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- Same reasoning as 20261113000100_reviews_grants.sql: a table-wide
-- `grant update` would let people rewrite recipient_id, type and the targets,
-- so update is limited to the two timestamps. Nothing for `anon`.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (seen_at, read_at) on public.notifications to authenticated;


-- =========================================================== 3. triggers that create notifications

-- A comment or reply on a review.
--   * Top-level comment: the review's author hears about it.
--   * Reply: the parent comment's author hears about it ('reply'), and the
--     review's author too ('comment'), unless that is the same person or the
--     replier, so one event never notifies someone twice.
create function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  review_author uuid;
  parent_author uuid;
begin
  select r.user_id into review_author
  from public.reviews r
  where r.id = new.review_id;

  if new.parent_id is null then
    if review_author is not null and review_author <> new.user_id then
      insert into public.notifications (recipient_id, actor_id, type, review_id, comment_id)
      values (review_author, new.user_id, 'comment', new.review_id, new.id);
    end if;
    return null;
  end if;

  select c.user_id into parent_author
  from public.review_comments c
  where c.id = new.parent_id;

  if parent_author is not null and parent_author <> new.user_id then
    insert into public.notifications (recipient_id, actor_id, type, review_id, comment_id)
    values (parent_author, new.user_id, 'reply', new.review_id, new.id);
  end if;

  if review_author is not null
     and review_author <> new.user_id
     and review_author is distinct from parent_author then
    insert into public.notifications (recipient_id, actor_id, type, review_id, comment_id)
    values (review_author, new.user_id, 'comment', new.review_id, new.id);
  end if;

  return null;
end;
$$;

create trigger review_comments_notify
  after insert on public.review_comments
  for each row execute function public.notify_on_comment();


-- A new friend request. send_friend_request ACCEPTS instead of inserting when
-- the other person already asked you, and that is an update, so it correctly
-- creates nothing here.
create function public.notify_on_friend_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending' then
    insert into public.notifications (recipient_id, actor_id, type)
    values (new.addressee_id, new.requester_id, 'friend_request');
  end if;
  return null;
end;
$$;

create trigger friendships_notify
  after insert on public.friendships
  for each row execute function public.notify_on_friend_request();


-- A Movie Blend invite. The invites are inserted inside security definer
-- functions (see the blend migrations); the trigger fires whichever one did it.
create function public.notify_on_blend_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (recipient_id, actor_id, type, blend_invite_id)
  values (new.invitee_id, new.inviter_id, 'blend_invite', new.id);
  return null;
end;
$$;

create trigger blend_invites_notify
  after insert on public.blend_invites
  for each row execute function public.notify_on_blend_invite();


-- =========================================================== 4. resolved elsewhere = read
-- If a request is accepted, declined or cancelled on the Friends or Blends
-- page, the bell shouldn't keep showing it as new.

create function public.resolve_friend_request_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications n
  set read_at = coalesce(n.read_at, now()),
      seen_at = coalesce(n.seen_at, now())
  where n.type = 'friend_request'
    and n.actor_id = old.requester_id
    and n.recipient_id = old.addressee_id;
  return null;
end;
$$;

create trigger friendships_resolve_notifications
  after update or delete on public.friendships
  for each row execute function public.resolve_friend_request_notifications();


create function public.resolve_blend_invite_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications n
  set read_at = coalesce(n.read_at, now()),
      seen_at = coalesce(n.seen_at, now())
  where n.type = 'blend_invite'
    and n.blend_invite_id = new.id;
  return null;
end;
$$;

create trigger blend_invites_resolve_notifications
  after update of status on public.blend_invites
  for each row
  when (new.status <> 'pending')
  execute function public.resolve_blend_invite_notifications();

-- Trigger functions are never called directly.
revoke execute on function public.notify_on_comment() from public, anon, authenticated;
revoke execute on function public.notify_on_friend_request() from public, anon, authenticated;
revoke execute on function public.notify_on_blend_invite() from public, anon, authenticated;
revoke execute on function public.resolve_friend_request_notifications() from public, anon, authenticated;
revoke execute on function public.resolve_blend_invite_notifications() from public, anon, authenticated;


-- =========================================================== 5. is the target still there?
-- The one place that decides whether a notification can still be opened.
-- Runs as the function owner (it reads rows the caller may not see), so it
-- applies the privacy rule itself. Not granted to the app: only
-- get_notifications and open_notification below call it.

create function public.notification_available(n public.notifications)
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
        -- TODO(moderation): also require the comment and its review to not be hidden.
    )
    when 'reply' then exists (
      select 1
      from public.review_comments c
      join public.reviews r on r.id = c.review_id
      where c.id = n.comment_id
        and c.review_id = n.review_id
        and public.can_view_user(r.user_id)
        -- TODO(moderation): also require the comment and its review to not be hidden.
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

revoke execute on function public.notification_available(public.notifications) from public, anon, authenticated;


-- =========================================================== 6. functions the app calls

-- The caller's notifications, newest first, each with what the panel needs to
-- draw it. Left joins keep a row for a deleted target (with nulls). The review
-- author's username and the movie title are only returned for a review the
-- caller may see, and the preview only while the comment is still available.
create function public.get_notifications(p_limit integer default 30)
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
    case when public.can_view_user(r.user_id) then author.username end,
    case when public.can_view_user(r.user_id) then m.title end,
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

-- A click on a notification: marks it read (and seen), then says whether the
-- target can still be opened right now. Returns no row if it isn't yours.
create function public.open_notification(p_id uuid)
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
    case when public.can_view_user(r.user_id) then author.username end
  from public.notifications n
  left join public.reviews r on r.id = n.review_id
  left join public.profiles author on author.id = r.user_id
  where n.id = p_id and n.recipient_id = uid;
end;
$$;

revoke execute on function public.get_notifications(integer) from public, anon;
revoke execute on function public.open_notification(uuid) from public, anon;
grant execute on function public.get_notifications(integer) to authenticated;
grant execute on function public.open_notification(uuid) to authenticated;
