-- A shared daily budget for OMDb lookups, so the API can never use more than the
-- free key allows (1,000 a day), however many people open movies at once.
-- /api/movies/ratings takes one from this budget before each OMDb request.
create table if not exists public.omdb_usage (
  day    date primary key,
  calls  integer not null default 0
);

-- Only the API (service role, which bypasses RLS) uses this table.
alter table public.omdb_usage enable row level security;

-- Takes one lookup from today's budget. Returns true if there was room, false if
-- today's budget (p_limit) is used up. One statement, so two requests at the same
-- moment can't both take the last lookup.
create or replace function public.claim_omdb_call(p_limit integer)
returns boolean
language plpgsql
as $$
declare
  used integer;
begin
  if p_limit < 1 then
    return false;
  end if;

  insert into public.omdb_usage as u (day, calls)
  values (current_date, 1)
  on conflict (day) do update
    set calls = u.calls + 1
    where u.calls < p_limit
  returning u.calls into used;

  return used is not null;
end;
$$;

-- Not callable from the browser: only the server's service role may use it.
revoke all on function public.claim_omdb_call(integer) from public, anon, authenticated;
grant execute on function public.claim_omdb_call(integer) to service_role;
