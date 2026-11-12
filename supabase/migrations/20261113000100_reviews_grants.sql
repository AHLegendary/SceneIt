-- Table grants for reviews, review_comments and reports.
--
-- The previous migration created the tables and their RLS policies but not
-- the grants, so the dashboard showed "API DISABLED": the `authenticated`
-- role couldn't touch them at all, whatever the policies said. RLS decides
-- which rows; these grants decide whether the API can reach the table.
--
-- This doesn't change any RLS policy.
--
-- UPDATE isn't granted here on purpose. The previous migration already gave
-- `authenticated` column-level UPDATE (reviews: body, is_spoiler;
-- review_comments: body). A table-wide `grant update` would replace that and
-- let people edit movie_id, review_id, parent_id and the dates.
--
-- No sequence grants are needed: every id is a uuid with gen_random_uuid().

grant select, insert, delete on public.reviews         to authenticated;
grant select, insert, delete on public.review_comments to authenticated;

-- Reports are file-only: insert, and nothing else (no select, update or
-- delete), matching the policy.
grant insert on public.reports to authenticated;
