# Database (Supabase)

- `migrations/20261031000000_init_schema.sql`: tables, RLS policies, and database functions
- `migrations/20261102000000_friend_requests.sql`: `get_friendships` and `send_friend_request`
- `migrations/20261103000000_ranking_categories.sql`: `rankings.category` (loved / okay / meh), category-aware `save_ranking` and leaderboard scores
- `migrations/20261104000000_movie_blends.sql`: Movie Blend tables, invites, the 5-member limit and group recommendations
- `migrations/20261108000000_movie_ratings.sql`: `movie_ratings`, a cache of OMDb scores (IMDb, Rotten Tomatoes) filled by `/api/movies/ratings?id=`
- `migrations/20261108000100_omdb_budget.sql`: `omdb_usage` and `claim_omdb_call`, a shared daily budget (900) for OMDb lookups
- `migrations/20261113000000_reviews_comments_reports.sql`: `reviews`, `review_comments` (one level of replies) and `reports`, with RLS; `remove_ranking` now also deletes the movie's review
- `migrations/20261113000100_reviews_grants.sql`: table grants for the three tables above (without them the API can't reach them)
- `migrations/20261114000000_review_discussion.sql`: signed-out visitors can read public reviews and comments, and `get_review_comments` (a review's comments with commenters' usernames)
- `migrations/20261115000000_review_feed.sql`: `get_review_feed`, a page of reviews for the Community page (everyone or friends, newest or most discussed)
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
| `rankings` | `(user_id, movie_id, position, category)`. `position` is the tier index, 0 = best, and ties share a position. `category` is `loved`, `okay` or `meh`, and the list is always ordered loved → okay → meh | same as the owner's profile | the owner, through `save_ranking` / `remove_ranking` |
| `watchlist` | `(user_id, movie_id, added_at)` | same as the owner's profile | the owner |
| `friendships` | `requester_id → addressee_id`, `pending` or `accepted` | the two people involved | requester inserts, addressee accepts, either one deletes |
| `blends` | `owner_id` of a Movie Blend | its members | through the blend functions only |
| `blend_members` | `(blend_id, user_id, joined_at)`, 5 at most per blend (enforced by a trigger) | the blend's members | through the blend functions only |
| `blend_invites` | `inviter_id → invitee_id`, `pending`, `accepted`, `declined` or `expired`, with `expires_at` | the inviter and invitee | through the blend functions only |
| `reviews` | `(id, user_id, movie_id, body, is_spoiler, created_at, updated_at)`, one per user and movie, `body` 1 to 2000 characters. Only for movies the user has ranked; un-ranking deletes it | same as the author's profile (signed-out visitors too, for public profiles) | the author; edits can change only `body` and `is_spoiler` |
| `review_comments` | `(id, review_id, user_id, parent_id, body, ...)`. `parent_id` is null for a top-level comment, or a top-level comment's id for a reply (a trigger refuses replies to replies) | anyone who can see the review (use `get_review_comments` to also get usernames) | the commenter inserts, edits (only `body`) and deletes; the review's author can also delete any comment on their review |
| `reports` | `(reporter_id, target_type 'review' or 'comment', target_id, reason)`, one per reporter and target | nobody through the app (read them in the dashboard) | any signed-in user, as themselves, about a review or comment they can see |

RLS is on for every table. Passwords are stored only in Supabase Auth.

## Functions (call them with `supabase.rpc`)

```js
// Signup: the username goes in metadata, and a trigger creates the profile.
// An invalid or taken username makes the signup fail.
await supabase.auth.signUp({ email, password, options: { data: { username } } })

// Place or rerank a movie. Works the same as placeMovie() in src/lib/localStore.js.
// p_position is inside the category (0 = best "okay" movie), not the whole list.
await supabase.rpc('save_ranking', { p_movie_id: 693134, p_category: 'okay', p_position: 2, p_tied: false })
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

// Comments on a review, oldest first, each with the commenter's username (even
// when their own profile is private). Empty if you can't see the review.
// Use src/lib/reviews.js (fetchComments) from the UI.
//   [{ id, review_id, user_id, parent_id, body, created_at, updated_at, username }]
await supabase.rpc('get_review_comments', { p_review_id: reviewId })

// Community reviews feed: a page of reviews you may see, with the author's
// username, the movie, the comment count, and the author's score for the movie
// (null until they've ranked 10 movies). scope: 'everyone' | 'friends' (accepted
// friends, not you); sort: 'recent' | 'discussed' (most comments first).
// limit is capped at 200. Open to signed-out visitors (public profiles only).
// Use src/lib/reviewFeed.js from the UI.
await supabase.rpc('get_review_feed', { p_scope: 'everyone', p_sort: 'recent', p_limit: 20, p_offset: 0 })

// Movie Blend. Use src/features/blends/blends.js from the UI instead of calling these.
// Failures raise short messages like 'blend_full' or 'invite_expired'.
const { data: blendId } = await supabase.rpc('create_blend', { p_friend_ids: [friendId] })  // 15+ rankings, 1 to 4 friends
await supabase.rpc('invite_to_blend', { p_blend_id: blendId, p_user_id: friendId })         // owner only
await supabase.rpc('respond_to_blend_invite', { p_invite_id: inviteId, p_accept: true })
await supabase.rpc('leave_blend', { p_blend_id: blendId })  // returns 'left' | 'deleted' (the owner leaving disbands the blend)
await supabase.rpc('get_my_blends')
await supabase.rpc('get_my_blend_invites')
await supabase.rpc('get_blend_members', { p_blend_id: blendId })
await supabase.rpc('get_blend_sent_invites', { p_blend_id: blendId })
// Blend recommendations come from GET /api/blends/recommendations?id=<blendId> (server-side, group-level facts only)
```

Accepted friends can read each other's `rankings` even when a profile is private. That's what friend-based recommendations build on.

Scores and leaderboards are calculated when you ask for them, not stored. In SQL the formula lives in one place, `user_movie_scores()`, which `get_leaderboard` and `get_review_feed` read. The "scores unlock at 10 ranked movies" line (`SCORE_UNLOCK`) is repeated in `get_review_feed`, so change that together with `scores.js` too. `src/features/ranking/scores.js` is the only other copy (the browser scores a list it already has), so change the two together.

## Not here yet (later migrations)

Achievements. Add each one as a new file in `migrations/`, and don't edit this one after it has been applied.
