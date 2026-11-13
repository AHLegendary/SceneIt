# Integration tests

These render the real app (`src/App.jsx`) in jsdom and drive it like a user would,
against a fake backend. They cover whole features end to end: the UI, the stores,
`src/lib`, and the real handlers in `api/`.

```
npm run test:integration   # just these
npm run test:unit          # just tests/unit
npm run test:run           # everything
```

## Node version

The integration tests run in jsdom 30, which supports Node **22.22+, 24.15+ or 26+**.
They also pass on Node 25, because `helpers/setup.js` replaces Node 25's broken
built-in `localStorage` (it has no methods, and hides jsdom's) with a plain in-memory
one. Check your version with `node -v`. Node 20 can't start the test workers at all.

## What is real and what is fake

| Real | Fake (`helpers/fakeBackend.js`) |
| --- | --- |
| React app, hooks, stores, routing | `@supabase/supabase-js`: auth, tables, storage, RPCs |
| `src/lib/*`, including `supabase.js` | TMDb (`api.themoviedb.org`) |
| Every handler in `api/`, reached through the same router the dev server uses | The browser's `fetch` for `/api/*` |

The fake database applies the same row level security as `supabase/migrations`
and ports the SQL functions (`save_ranking`, `remove_ranking`, `get_friendships`,
`send_friend_request`, `search_users`, `get_leaderboard`, `get_review_comments`,
`get_review_feed`, plus `get_my_blends` and `get_blend_members` for blends seeded with `addBlend`) and
the policies, constraints and cascades of `reviews`, `review_comments` and `reports`.
For those tables it also enforces table privileges per role (the `GRANTS` map in
`fakeBackend.js`), because a missing grant makes the API refuse the request before
RLS is looked at. Real jsdom has no layout, so `setup.js` stubs `IntersectionObserver`
(fire it with `scrollToEnd()`), and tests that need scrolling fake `window.scrollY`
(see `scrollRestore.test.jsx`).

**What this cannot catch:** mistakes in the real SQL or policies. The fake is a
port of them, pinned by `fakeBackend.test.js`. If you change a migration, change
the fake and its tests in the same PR. Testing the real database would need
`supabase test db` (pgTAP).

## Writing a test

```js
import { FakeBackend, launch, ready, screen } from './helpers/harness.js'

const backend = new FakeBackend()
const alice = backend.addUser({ username: 'Alice_99' })
backend.seedList(alice, ['inception-2010', 'interstellar-2014']) // catalog ids

const { user } = await launch({ backend, as: alice, hash: '#/my-list' })
await ready({ loggedIn: true })
await user.click(await screen.findByRole('button', { name: /^Rerank / }))
```

- `launch()` re-imports the app each time, because the stores are module-level
  singletons. Every test starts clean.
- Pass the backend you seeded. `launch()` without one gives an empty backend.
- Use `relaunch(app, { as: bob })` to look at the same data as someone else. It
  removes the first app from the page first.
- Break things with `backend.failRpc / failQuery / failAuth / failApi`, pause
  them with `backend.hold(key)`, and read what happened from `backend.calls` /
  `backend.callsTo(key)`.
- Select by role and label (`getByRole('button', { name: 'Rank it' })`), not by
  CSS class, so style changes don't break tests.
- Any `fetch` the fake doesn't answer throws. Integration tests never reach the
  real network.

## Files

| File | Covers |
| --- | --- |
| `fakeBackend.test.js` | The fake itself, pinned to the migrations (SQL functions, RLS) |
| `apiRoutes.test.js` | Every handler in `api/`: tokens, validation, methods, failures |
| `auth.test.jsx` | Log in (email and username), sign up, sessions, log out, return-to |
| `navigation.test.jsx` | Routing, header, Profile menu |
| `friends.test.jsx` | Search, requests, accept/decline/cancel, unfriend |
| `profile.test.jsx` | Your profile: edit, visibility, pictures, stats |
| `userProfile.test.jsx` | Other people's profiles and lists, public and private |
| `ranking.test.jsx` | My List, head-to-head ranking, categories, rerank, remove |
| `search.test.jsx` | Header search and the Rank a movie dialog |
| `movieDetails.test.jsx` | Details panel: scores, your rank, community rank |
| `leaderboard.test.jsx` | Periods, sorting, podium |
| `home.test.jsx` | Hero, trending, community, picks, friends |
| `forYou.test.jsx` | Unlock, picks, TMDb and friends' signals |
| `blendRecs.test.jsx` | Blend recommendations: group picks, vetoes, TMDb discoveries, privacy, failures |

## Known gaps

Tests marked `it.todo` describe behavior that is currently missing or broken.
Each one should carry a `// Known gap:` comment saying why. When you fix one, turn the `todo` into a test.
There are none right now.
