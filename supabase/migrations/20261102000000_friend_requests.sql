-- Friend requests: listing and sending.
--
-- The friendships table and its RLS policies are in the init migration.
-- Accepting (update status) and declining/cancelling/unfriending (delete)
-- go straight through those policies. This file adds the two things RLS
-- can't do on its own:
--
--   * get_friendships(): your requests and friends WITH usernames. A private
--     user who sends you a request isn't visible to you through the
--     profiles policy yet, so a plain join would hide their name.
--   * send_friend_request(): sends a request, or accepts theirs if they
--     already asked you. A plain insert would hit friendships_pair_idx
--     and fail with a confusing duplicate-key error in that case.


-- Every friendship row involving the current user, from their side.
--   direction: 'incoming' (they asked you, pending)
--              'outgoing' (you asked them, pending)
--              'friends'  (accepted, either direction)
-- Only ids and usernames come out, same as search_users.
create function public.get_friendships()
returns table (
  user_id     uuid,
  username    text,
  direction   text,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.username,
    case
      when f.status = 'accepted' then 'friends'
      when f.addressee_id = auth.uid() then 'incoming'
      else 'outgoing'
    end,
    f.created_at
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  where auth.uid() is not null
    and auth.uid() in (f.requester_id, f.addressee_id)
  order by f.created_at desc;
$$;


-- Sends a friend request from the current user to p_user_id.
-- Returns what happened, so the UI can say the right thing:
--   'sent'             new pending request
--   'accepted'         they had already asked you, so now you're friends
--   'already_sent'     you already have a pending request to them
--   'already_friends'  you're already friends
-- Raises for: not signed in, yourself, or a user that doesn't exist.
create function public.send_friend_request(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  existing public.friendships%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_user_id is null or p_user_id = uid then
    raise exception 'You can''t add yourself' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  -- Serialize per pair so two people adding each other at the same moment
  -- end up as friends instead of one of them getting a duplicate-key error.
  perform pg_advisory_xact_lock(
    hashtextextended(least(uid, p_user_id)::text || greatest(uid, p_user_id)::text, 0)
  );

  select * into existing
  from public.friendships f
  where (f.requester_id = uid and f.addressee_id = p_user_id)
     or (f.requester_id = p_user_id and f.addressee_id = uid);

  if not found then
    insert into public.friendships (requester_id, addressee_id) values (uid, p_user_id);
    return 'sent';
  elsif existing.status = 'accepted' then
    return 'already_friends';
  elsif existing.requester_id = uid then
    return 'already_sent';
  else
    update public.friendships set status = 'accepted'
    where requester_id = p_user_id and addressee_id = uid;
    return 'accepted';
  end if;
end;
$$;


revoke execute on function public.get_friendships() from public, anon;
revoke execute on function public.send_friend_request(uuid) from public, anon;
grant execute on function public.get_friendships() to authenticated;
grant execute on function public.send_friend_request(uuid) to authenticated;
