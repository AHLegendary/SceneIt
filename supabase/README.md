# Database (Supabase)

- `migrations/20261031000000_init_schema.sql`: tables, RLS policies, and database functions
- `migrations/20261102000000_friend_requests.sql`: `get_friendships` and `send_friend_request`
- `seed.sql`: the 60-movie demo catalog from `src/data/movies.json`

## Apply to the hosted project (no Docker needed)

1. Open the Supabase dashboard, go to **SQL Editor**, paste each migration file (oldest first) that hasn't been run yet, and run it.
2. Paste `seed.sql` and run it. It's safe to run again.
3. Under **Authentication → Providers → Email**, leave email signups on. For testing, you can turn off "Confirm email" so new accounts can log in right away.

Or use the CLI: `npx supabase link --project-ref <ref>` and then `npx supabase db push`. Load `seed.sql` through the SQL editor.

## Run locally (needs Docker)

```bash
npx supabase start      # local Postgres + Auth; prints the URL and keys for .env
npx supabase db reset   # reruns all migrations and seed.sql
```

## Tables

| Table | What it holds | Who can read | Who can write |
|---|---|---|---|
| `profiles` | username, bio, pronouns, `is_public`, `top_movies` (max 3) | everyone if public; otherwise the owner and friends | the owner (`update` only; rows are created by the signup trigger) |
| `movies` | TMDb cache keyed by `tmdb_id` | everyone | server only (service role key) and the seed file |
| `rankings` | `(user_id, movie_id, position)`. `position` is the tier index, 0 = best, and ties share a position | same as the owner's profile | the owner, through `save_ranking` / `remove_ranking` |
| `watchlist` | `(user_id, movie_id, added_at)` | same as the owner's profile | the owner |
| `friendships` | `requester_id → addressee_id`, `pending` or `accepted` | the two people involved | requester inserts, addressee accepts, either one deletes |

RLS is on for every table. Passwords are stored only in Supabase Auth.

## Functions (call them with `supabase.rpc`)

```js
// Signup: the username goes in metadata, and a trigger creates the profile.
// An invalid or taken username makes the signup fail.
await supabase.auth.signUp({ email, password, options: { data: { username } } })

// Place or rerank a movie. Works the same as placeMovie() in src/lib/localStore.js.
await supabase.rpc('save_ranking', { p_movie_id: 693134, p_position: 2, p_tied: false })
await supabase.rpc('remove_ranking', { p_movie_id: 693134 })

// My list, best first (rows that share a position are ties)
await supabase.from('rankings').select('position, movies(*)').eq('user_id', userId).order('position')

// Leaderboard: period 'weekly' | 'monthly', category 'highest' | 'watched'
await supabase.rpc('get_leaderboard', { p_period: 'weekly', p_category: 'highest' })

// Search usernames when adding a friend (returns only id and username)
await supabase.rpc('search_users', { q: 'rei' })

// Friend requests. Use src/lib/friends.js from the UI instead of calling these.
// Your requests and friends, with usernames (even for private profiles):
//   [{ user_id, username, direction: 'incoming' | 'outgoing' | 'friends', created_at }]
await supabase.rpc('get_friendships')
// Send a request. If they already asked you, this accepts it instead.
// Returns 'sent' | 'accepted' | 'already_sent' | 'already_friends'.
await supabase.rpc('send_friend_request', { p_user_id: otherUserId })
// Accept: update the row's status (RLS only lets the addressee do this).
await supabase.from('friendships').update({ status: 'accepted' })
  .eq('requester_id', otherUserId).eq('addressee_id', myId)
// Decline, cancel, or unfriend: delete the row (either person can).
```

Accepted friends can read each other's `rankings` even when a profile is private. That's what friend-based recommendations build on.

Scores and leaderboards are calculated when you ask for them, not stored. `get_leaderboard` uses the same 10-to-1 formula as `src/features/ranking/scores.js`.

## Not here yet (later migrations)

These are `reviews`, `comments`, `reports`, `blends`, `blend_members` and achievements. Add each one as a new file in `migrations/`, and don't edit this one after it has been applied.
