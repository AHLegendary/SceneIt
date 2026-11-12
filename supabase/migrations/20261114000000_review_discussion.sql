-- Review discussion pages.
--
--   1. Signed-out visitors can read reviews and comments of public profiles.
--      The earlier grants only covered logged-in users, so a public profile
--      opened while logged out couldn't load its reviews. RLS is unchanged:
--      it still decides which rows (can_view_user), so a private profile's
--      reviews stay hidden from anonymous visitors too.
--   2. get_review_comments: a review's comments with the commenter's username.
--      A comment can come from someone whose profile you can't see (private,
--      not your friend), and then reading their username straight from
--      `profiles` fails. The username of a commenter on a review you can see is
--      no more private than what search_users already reveals, so this
--      returns it, and nothing else about them.
--
-- No frontend deploy is needed before running this: the app only starts using
-- get_review_comments in the same release as this file.


-- =========================================================== 1. anonymous reads

grant select on public.reviews, public.review_comments to anon;


-- =========================================================== 2. get_review_comments
-- Runs as the function owner, so it has to apply the privacy rule itself:
-- comments are only returned when the review's author is visible to the caller
-- (can_view_user), exactly like the review_comments select policy.

create function public.get_review_comments(p_review_id uuid)
returns table (
  id          uuid,
  review_id   uuid,
  user_id     uuid,
  parent_id   uuid,
  body        text,
  created_at  timestamptz,
  updated_at  timestamptz,
  username    text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.review_id, c.user_id, c.parent_id, c.body, c.created_at, c.updated_at, p.username
  from public.review_comments c
  join public.reviews r on r.id = c.review_id
  join public.profiles p on p.id = c.user_id
  where c.review_id = p_review_id
    and public.can_view_user(r.user_id)
  order by c.created_at, c.id;
$$;

revoke execute on function public.get_review_comments(uuid) from public;
grant execute on function public.get_review_comments(uuid) to anon, authenticated;
