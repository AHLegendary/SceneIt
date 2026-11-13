# SceneIt

SceneIt is a social movie-ranking web application that helps users rank movies through head-to-head comparisons instead of traditional star or numerical ratings. Users can track movies they have watched, connect with friends, and discover movies based on their personal preferences and their friends' rankings.

**Live site:** https://sceneitmovies.vercel.app — the quickest way to try SceneIt. Sign up with any email (email confirmation is off) and start ranking.

This README has two parts:

- **[User Manual](#user-manual)** — what SceneIt does and how to use it: [Features](#goals-and-features), [Using SceneIt](#using-sceneit), [Use Cases](#operational-use-cases), [Reporting a Bug](#reporting-a-bug).
- **[Developer Guidelines](#developer-guidelines)** — how to work on SceneIt: [Tech Stack](#tech-stack), [Repository Structure](#repository-structure), [Build, Test and Run](#getting-started), [Adding a Test](#adding-a-test), [CI](#automated-testing-and-ci), [Coding Guidelines](#coding-guidelines), [Database Changes and Deployment](#database-changes-and-deployment), [Bug Tracking](#bug-tracking).

# User Manual

## Goals and Features

SceneIt aims to make movie discovery more personalized, expressive, and social.

**Available in the beta:**

- **Head-to-Head Movie Rankings:** Pick how you felt about a movie (loved it / it was okay / not a fan), then compare it head-to-head against movies in that category to place it in your list. Ties and reranking are supported.
- **Personalized Recommendations:** The For You page suggests movies from TMDb based on your own rankings and your friends' rankings. The built-in 60-movie catalog is only a fallback when TMDb has nothing.
- **Movie Blend:** Make a blend with up to four friends (five people in all) and get movies the whole group should like, including ones nobody in it has ranked yet.
- **Reviews and Comments:** Write a review of a movie you ranked, mark spoilers, and comment on and reply to other users' reviews.
- **Community:** A reviews feed (everyone or friends, newest or most discussed) and weekly and monthly leaderboards (highest ranked and most watched), with IMDb and Rotten Tomatoes scores shown as extra info.
- **Community Safety:** Report inappropriate reviews and comments.
- **Friends:** Search users, send and accept friend requests, and view friends' profiles and ranked lists.
- **Customizable Profiles:** Bio, pronouns, public/private setting, top movies list, profile picture, and banner.

**Planned (not in the beta yet):**

- **Achievements** on profiles.

## Using SceneIt

**No install needed:** open the [live site](https://sceneitmovies.vercel.app) in any modern browser (desktop or phone). To run your own copy instead, follow [Getting Started](#getting-started) in the Developer Guidelines.

You can browse the Home page, the Community page, and movie details without an account. Ranking, recommendations, friends, reviews, and Movie Blend need you to log in.

### Sign up and log in

1. Click **Log in** in the top bar, then switch to **Sign up**.
2. Enter an email, a username, and a password (8+ characters). You're logged in right away.
3. Next time, log in with your email **or** your username and your password.

### Find a movie

Type in the search bar at the top of every page (*Search movies, shows, actors, or genres...*). Results come from all of TMDb. Click a movie to open its details: poster, overview, cast, director, IMDb and Rotten Tomatoes scores, the SceneIt community score, and your own rank and score once you've ranked it.

### Rank a movie

1. Open a movie and click **Rank it** (or use **Rank Movies** in the Profile menu to search for one).
2. Pick how you felt: **Loved it**, **It was okay**, or **Not a fan** (keys `1`, `2`, `3`).
3. Answer **Which did you like more?** by clicking a poster (or `←` / `→`). Click **It's a tie** (or `Space` / `↓`) if you can't choose. **Undo** goes back one answer. Each answer halves the range, so even a long list takes only a few comparisons.
4. When it's placed, the ranking is saved. You can **Add a review** right there (optional), or **Skip**, then **Finish**.

Your score for each movie (1–10) comes from its place in your list and shows up after you've ranked **10 movies**.

### My List

Open **My List** from the Profile menu. It shows your movies best first, grouped as Loved it / It was okay / Not a fan, with a **Tier list** view too. **Rerank** a movie to place it again, or **Remove** it (which also deletes your review of it).

### Recommendations

- **For You** (top bar) unlocks after you rank **15 movies**. It suggests movies from TMDb based on what you loved and disliked, and on friends with similar taste. Each pick says why ("Because you liked …" or "*friend* loved it").
- The **Home** page shows Trending Now, Top Ranked and Most Watched for everyone, and when you're logged in: **Because You Loved …** (picks for one of your top five favorites, changing daily), **More <genre> for You**, and **Recently Ranked by Friends**.

### Friends

Open **Friends** from the Profile menu. Search usernames (*Search usernames to add a friend…*) and click **Add friend**. Incoming requests appear with **Accept** and **Decline**; you can **Cancel request** on ones you sent. A red badge on **Profile** shows pending requests. Friends can see each other's lists even when a profile is private.

### Movie Blend

A blend finds movies a group of friends should all like.

1. Rank at least **15 movies**, then open **Movie Blend** in the top bar and click **New blend**.
2. Pick 1 to 4 friends to invite (five people at most). They see the invite as a badge on **Movie Blend** and can accept or decline.
3. Open the blend to see **Recommended for your group**. Each pick says why: "Loved by 2 of 4" or "Like *movie*, a group favorite". Anything a member marked **Not a fan** is left out, and so are movies everyone already ranked.
4. The owner can **Invite a friend** later. Anyone can **Leave blend**; if the owner leaves, the blend is deleted.

### Reviews, comments, and the Community page

- Write a review right after ranking or reranking a movie (**Add a review**). Tick **Spoiler** to blur it until a reader clicks. To change it later, open the **…** menu on your review and pick **Edit** or **Delete**.
- Click a review to open its discussion. Comment, or reply to a comment.
- **Community** (top bar) has two tabs: **Reviews** (filter **Everyone** / **Friends**, sort **Recent** / **Most discussed**) and **Leaderboard** (this week or this month, highest ranked or most watched).
- See something inappropriate? Click **Report** under a review or comment and give a reason. Reports go to the team.

### Your profile

Open **Bio** from the Profile menu to edit your bio, pronouns, top movies (up to 3), profile picture, and banner, and to make your profile **Public** or **Private**. Private profiles and lists are visible only to you and your friends. Click any username to see that person's profile and list.

## Operational Use Cases

These use cases work end to end on the live site and on a local setup with all environment variables configured (see [Configure Environment Variables](#4-configure-environment-variables)).

1. **Sign up and log in** with an email or username and a password.
2. **Search for any movie and rank it** (touches every major component): a logged-in user searches for a movie → the React frontend calls `GET /api/movies/search` (Vercel serverless function) → the function queries the TMDb API and caches the movie in Supabase → the user picks a category and does head-to-head comparisons → the ranking is saved to PostgreSQL through the `save_ranking` function → the movie appears in **My List** and counts toward the **Leaderboard**.
3. **View and manage My List:** filter by category, rerank a movie, or remove it.
4. **Browse the Leaderboard** for this week or this month, by highest ranked or most watched (no login needed).
5. **Get recommendations** on the For You page, based on your rankings and your friends' rankings.
6. **Add friends:** search by username, send a request, accept incoming requests.
7. **Edit your profile** (bio, pronouns, public/private) and **view other users' profiles and lists**.
8. **Make a Movie Blend:** once you've ranked 15+ movies, invite up to four friends, then see the group's recommendations on the blend's page (`GET /api/blends/recommendations`).
9. **Review and discuss:** write a review of a ranked movie, comment or reply on reviews, report one, and browse the Community reviews feed.
10. **Browse the Home page:** Trending Now, Top Ranked, Most Watched, and (when logged in) Because You Loved…, More <genre> for You and Recently Ranked by Friends.

## Reporting a Bug

Found something broken? Report it on [GitHub Issues](https://github.com/AHLegendary/SceneIt/issues) (you need a free GitHub account). Check the [open bugs](https://github.com/AHLegendary/SceneIt/issues?q=is%3Aissue+is%3Aopen+label%3Abug) first; if yours is already there, add a comment instead.

1. Go to the **Issues** tab and click **New issue**.
2. Give it a short, specific title (for example, "Leaderboard is empty after ranking a movie").
3. In the description, include:
   - **Steps to reproduce:** what you clicked or typed, in order.
   - **Expected:** what should have happened.
   - **Actual:** what happened instead, including any error message.
   - **Where:** live site or local, and your browser.
   - **Screenshot**, if it helps.
4. Add a label (see below).

# Developer Guidelines

Everything a developer needs to build, test, and change SceneIt. `coding-guidelines.md` is the team's original design document (architecture, schema, use cases, schedule); the rules below are the ones we follow today.

## Tech Stack

- **Frontend:** React + Vite
- **Backend:** Vercel serverless functions (`api/`)
- **Database and Auth:** Supabase (PostgreSQL)
- **Movie Data:** TMDb API (OMDb for IMDb / Rotten Tomatoes scores)
- **Testing and CI:** Vitest and GitHub Actions
- **Deployment:** Vercel
- **Version Control and Bug Tracking:** Git, GitHub, and GitHub Issues

## Repository Structure

```text
SceneIt/
├── .github/
│   └── workflows/
│       └── ci.yml                 # GitHub Actions: tests and production build
│
├── api/                           # Vercel serverless functions (backend)
│   ├── _lib/                      # Shared server helpers (TMDb and OMDb clients, Supabase admin client)
│   ├── blends/                    # Movie Blend recommendations
│   ├── movies/                    # Search, trending, recommendations, movie details, IMDb / RT ratings
│   ├── profile/                   # Profile picture and banner uploads
│   ├── login.js                   # Login with email or username
│   └── health.js                  # Health check
│
├── public/                        # Static files served directly
│   ├── favicon.svg                # Browser tab icon
│   └── icons.svg                  # Reusable SVG icon library for the UI
│
├── scripts/                       # Data and dev scripts (movie data, ratings, demo users, dev API)
│
├── src/
│   ├── assets/                    # Imported images, logos, and icons
│   ├── components/                # Reusable UI components
│   ├── data/                      # Built-in 60-movie catalog (movies.json)
│   ├── features/                  # Feature-specific code (ranking, recommendations, blends, profile)
│   ├── pages/                     # Full application pages
│   ├── lib/                       # Shared utilities, Supabase queries, and API clients
│   ├── App.jsx                    # Main React application
│   ├── App.css                    # Application-specific styles
│   ├── index.css                  # Global styles
│   └── main.jsx                   # React entry point
│
├── supabase/                      # Database migrations, seed data, and database docs
│
├── tests/
│   ├── unit/                      # Unit tests (Vitest)
│   └── integration/               # Page-level tests in jsdom with a fake backend (Vitest)
│
├── .gitignore                     # Files Git should ignore
├── .env.example                   # Template for required environment variables
├── coding-guidelines.md           # Team coding guidelines
├── index.html                     # HTML entry point
├── package.json                   # Dependencies and npm scripts
├── package-lock.json              # Locked dependency versions
├── vite.config.js                 # Vite configuration
└── README.md                      # Project overview and setup instructions
```

### Directory Guidelines

- **`api/`**: Server-side code. Anything that needs a secret key (TMDb token, Supabase service role key) lives here, never in `src/`.
- **`public/`**: Files that need a fixed URL or should be served without being imported into JavaScript.
- **`src/assets/`**: Static assets imported into React components or CSS.
- **`src/components/`**: Reusable interface elements, such as movie cards, buttons, and navigation bars.
- **`src/features/`**: Code organized around features, such as movie ranking, recommendations, and Movie Blend.
- **`src/pages/`**: Full pages, such as the home page, leaderboard, and user profile.
- **`src/lib/`**: Shared utilities, Supabase queries, and configuration helpers.
- **`tests/unit/`**: Tests for individual functions or modules.
- **`tests/integration/`**: Tests that render whole pages against a fake backend and click through them. See `tests/integration/README.md` for how the harness works.
- **`.github/workflows/`**: Automated GitHub Actions workflows for testing and other development tasks.
- **`supabase/`**: Database migrations and seed files. See `supabase/README.md` for the tables and database functions.

**Planned:** `tests/e2e/` for browser tests (for example, with Playwright) that click through complete user workflows against a real deployment.

## Getting Started

Follow these steps to build, test, and run SceneIt locally.

### Prerequisites

- [Git](https://git-scm.com/downloads) — for version control.
- [Node.js 22 and npm](https://nodejs.org/) — for running the React + Vite application and managing dependencies.
- [GitHub CLI](https://cli.github.com/) (optional) — for creating and managing pull requests from the terminal. You can also create PRs through the GitHub website.

Verify that Git, Node.js, and npm are installed:

```bash
git --version
node -v
npm -v
```

## 1. Clone the Repository

```bash
git clone https://github.com/AHLegendary/SceneIt.git
cd SceneIt
```

## 2. Install Dependencies

Run the following command from the project root:

```bash
npm ci
```

This installs the project's dependencies using `package-lock.json`, including React, Vite, and Vitest. Run this during initial setup or when dependencies change.

## 3. Build and Test

**No environment variables are needed for this step.** Run from the project root:

```bash
npm run test:run   # runs every Vitest test (unit + integration) once
npm run build      # builds the app for production into dist/
```

- **`npm run test:run`** — Runs all tests once and prints the results.
- **`npm run test:unit`** / **`npm run test:integration`** — Run just one of the two suites.
- **`npm test`** — Runs the tests in watch mode (reruns on file changes) while you develop.
- **`npm run build`** — Checks that the application compiles for deployment.
- **`npm run lint`** — Runs the oxlint linter. CI fails on lint errors.

If the tests pass and the build succeeds, the project is set up correctly. Together with `npm run lint`, these are the checks CI runs on every pull request.

**Reading the test summary.** A healthy run ends with a line like `Tests  1321 passed`. A test marked `todo` is **not a failure**: it is an `it.todo(...)` placeholder for behavior we know is missing (see `tests/integration/README.md`). A real failure shows as `failed` in red with the assertion that broke. If `npm ci` complains that `package.json` and `package-lock.json` are out of sync, run `npm install` once and try again.

## 4. Configure Environment Variables

Running the app (step 5) needs a Supabase project and a TMDb token. **If you just want to try SceneIt, use the [live site](https://sceneitmovies.vercel.app) instead** — it already has these set up and has real users and rankings.

To run it locally, copy the template:

```bash
cp .env.example .env
```

Then fill in the values below. Never commit `.env`; it is already in `.gitignore`.

### Supabase (required, about 10 minutes, free)

1. Create an account at [supabase.com](https://supabase.com) and create a new project.
2. Open the **SQL Editor**. Paste and run every migration in `supabase/migrations/`, one at a time, oldest first (the file names start with the date, so alphabetical order is the right order). `supabase/README.md` says what each one adds.
3. Paste and run `supabase/seed.sql` to load the 60-movie catalog.
4. Go to **Authentication → Providers → Email**. Leave email signups on and turn **Confirm email** off, so new accounts can log in right away.
5. Go to **Project Settings → API** and copy these values into `.env`:

| Value in Supabase | Variable in `.env` |
|---|---|
| Project URL | `VITE_SUPABASE_URL` and `SUPABASE_URL` |
| Publishable key | `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Secret (service role) key | `SUPABASE_SERVICE_ROLE_KEY` |

The service role key bypasses database security, so keep it secret. It is only used by the server code in `api/` and the scripts.

### TMDb (required for search, trending, and recommendations, about 5 minutes, free)

1. Create an account at [themoviedb.org](https://www.themoviedb.org/).
2. Go to **Settings → API** and request an API key.
3. Copy the **API Read Access Token** (the long token, not the short API key) into `TMDB_READ_TOKEN`.

### OMDb (optional, about 2 minutes, free)

`OMDB_API_KEY` gives IMDb and Rotten Tomatoes scores. The app uses it through `GET /api/movies/ratings` for movies outside the built-in catalog (cached in the `movie_ratings` table, at most 900 lookups a day), and `npm run ratings` uses it to refresh the catalog's scores. You can skip it. Free keys: [omdbapi.com](https://www.omdbapi.com/apikey.aspx).

### What breaks if a variable is missing

| Missing | What happens |
|---|---|
| `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY` | The app shows a blank page (the Supabase client can't start). |
| `SUPABASE_SERVICE_ROLE_KEY` | Logging in with a username fails (logging in with an email still works), movies found through search can't be saved (so they can't be ranked), profile pictures and banners can't be uploaded, and Movie Blend recommendations fail to load. |
| `TMDB_READ_TOKEN` | Search and the Trending Now row fall back to the built-in 60-movie catalog, movies outside that catalog can't be ranked, For You only uses the catalog, and blend recommendations only come from the members' own lists. |
| `OMDB_API_KEY` | Movies outside the built-in catalog show no IMDb or Rotten Tomatoes scores, and `npm run ratings` fails. Everything else works. |

### Your Supabase project starts empty

A new Supabase project has no users besides the ones you create, so the leaderboard, friends, reviews feed, Movie Blend, and friend-based recommendations will be empty at first. To see them working, either:

- **Create a second account** in another browser (or a private window), rank some movies with both, and send a friend request between them, or
- **Seed demo accounts:** add `DEMO_PASSWORD=<any 8+ character password>` to `.env`, then run:

  ```bash
  npm run demo-users
  ```

  This creates 8 demo accounts with rankings and friendships. Every demo account uses the password you chose.

## 5. Run the App

```bash
npm run dev
```

Open the URL printed in the terminal, usually `http://localhost:5173`. The dev server also runs the `api/` functions locally, so search, recommendations, and login work the same as on the live site (as long as the variables from step 4 are set).

## Adding a Test

Tests live in `tests/` and run with Vitest. Any file named `*.test.js` or `*.test.jsx` in `tests/unit/` or `tests/integration/` is picked up automatically (see `vite.config.js`); no registration needed.

**A unit test** (one function or module, runs in Node):

1. Create `tests/unit/<thing>.test.js`, or add to the existing file for that module.
2. Import the code under test with a relative path and write cases with `describe` / `it` / `expect`:

   ```js
   import { describe, expect, it } from 'vitest'
   import { blendRecLabel } from '../../src/features/blends/blendRecs.js'

   describe('blendRecLabel', () => {
     it('says how many members loved it', () => {
       expect(blendRecLabel({ lovedCount: 2, memberCount: 4, because: null })).toBe('Loved by 2 of 4')
     })
   })
   ```

3. Mock the network instead of calling real services: `vi.stubGlobal('fetch', ...)` for TMDb and the API, `vi.mock(...)` for the Supabase client. `tests/unit/blendRecsApi.test.js` shows both for an API route.

**An integration test** (a whole page in jsdom against a fake backend): create `tests/integration/<page>.test.jsx`, seed a `FakeBackend`, `launch()` the app, and click through it like a user. `tests/integration/README.md` explains the harness with an example.

Run it with `npm run test:unit` or `npm run test:integration` (or `npx vitest run tests/unit/<file>` for one file). Check that a new test **fails** when the code it tests is broken, then passes when it's fixed. Every bug fix should come with a test that would have caught it.

## Automated Testing and CI

SceneIt uses Vitest for unit testing and GitHub Actions for continuous integration (CI).

- **Vitest:** Unit tests in `tests/unit/` cover the ranking logic, recommendations (personal and Movie Blend), leaderboard, friends, reviews, login, validation, API handlers, and Supabase queries (with the network mocked). Integration tests in `tests/integration/` render each page in jsdom against a fake backend and exercise real user flows (search, ranking, friends, profile, leaderboard, Movie Blend, reviews and the Community page).
- **GitHub Actions:** `.github/workflows/ci.yml` installs dependencies, then runs `npm run test:unit`, `npm run test:integration`, `npm run build`, and `npm run lint` on every pull request that targets `main` and on every push to `main`.
- **Production build:** Verifies that the application can be compiled for deployment.

**Build history:** every CI run is listed under the repository's [Actions tab](https://github.com/AHLegendary/SceneIt/actions) (workflow "SceneIt CI"), and each pull request shows its checks at the bottom of the PR page. Vercel also posts a preview deployment link on each pull request.

Passing CI checks does not replace teammate review. Both the required checks and approvals must be satisfied before merging into `main`.

## Coding Guidelines

- **Branches and pull requests:** never commit to `main`. Work on a feature branch, open a pull request, and get a teammate's approval and green CI before merging. Put `Fixes #<issue>` in the description when it closes an issue.
- **Keep secrets on the server:** anything that needs the TMDb token, OMDb key, or Supabase service role key goes in `api/`, never in `src/`. Only `VITE_`-prefixed variables reach the browser.
- **Where code goes:** follow [Directory Guidelines](#directory-guidelines). Pure logic (scoring, recommendations) stays free of fetching and React so it can be unit tested; pages and components call it.
- **Reuse before adding:** check `src/lib/` and `src/features/` for an existing helper before writing a new one. Don't add a dependency for something a few lines can do.
- **Style:** plain JavaScript (ES modules) and React function components with hooks. Match the formatting of the file you're editing. `npm run lint` (oxlint) must pass; CI runs it.
- **Comments:** explain *why*, not what. Each exported function gets a short comment saying what it returns and any non-obvious rule.
- **Tests with every change:** new logic and bug fixes come with a test (see [Adding a Test](#adding-a-test)). Run `npm run test:run` and `npm run lint` before pushing.
- **Docs with every change:** update this README, `supabase/README.md`, or `tests/integration/README.md` in the same PR when you change what they describe.

## Database Changes and Deployment

- **Database changes:** add a new file in `supabase/migrations/` named `<YYYYMMDDHHMMSS>_<what>.sql`. Never edit a migration that has already been applied. Describe it in `supabase/README.md`, and update the fake backend in `tests/integration/helpers/fakeBackend.js` if it changes what the app sees.
- **Applying to the live database:** after the PR merges, a teammate with access pastes the new migration into the Supabase **SQL Editor** for the live project and runs it. If the migration removes something the old frontend still uses, merge (deploy) the frontend first.
- **Deploying the app:** Vercel deploys automatically. Every push to `main` (a merged PR) goes to https://sceneitmovies.vercel.app within a few minutes; pull requests get their own preview URL. Environment variables for production are set in the Vercel project settings, not in the repo.

## Homepage Data

The homepage's **Trending Now** row comes from `GET /api/movies/trending` (TMDb's weekly trending list, needs `TMDB_READ_TOKEN`). Without the API it falls back to the most-rated movies in the built-in catalog and is labelled "Popular on SceneIt". **Top Ranked** and **Most Watched** come from the public leaderboard; **Because You Loved…** and **More <genre> for You** (TMDb's picks for your top five "Loved it" movies, through `GET /api/movies/recommendations`) and **Recently Ranked by Friends** only appear for logged-in users and only from their own list and friends.

## Profile Pictures and Banners

Users can add a profile picture and banner from their Profile page. The browser resizes the image, then `PUT /api/profile/media` stores it in the public `profile-media` Storage bucket at `<user id>/avatar.jpg` or `banner.jpg` (the bucket is created on first use with the server's secret key, so no migration is needed). Pages build the image URL from the user id and fall back to an initial / the top movie's backdrop when there is none.

## Movie Data

SceneIt searches all of TMDb at runtime through `api/movies/search`. Any movie a user searches for and ranks is cached in the Supabase `movies` table.

The repository also ships a built-in 60-movie catalog in `src/data/movies.json` (loaded into the database by `supabase/seed.sql`). It is used as a fallback when TMDb isn't configured. To fill in or refresh its posters, details (overview, runtime, director, cast, backdrop) and TMDb's related movies, add `TMDB_READ_TOKEN` to your `.env` and run:

```bash
npm run movie-data          # only fills what's missing
npm run movie-data -- --all # refresh every movie
```

This makes about one or two TMDb requests per movie, once. Commit the updated `movies.json` afterwards. Movies without a poster show a placeholder card, and the details panel hides anything a movie doesn't have.

## Bug Tracking

We track bugs and planned work with [GitHub Issues](https://github.com/AHLegendary/SceneIt/issues). Users file bugs as described in [Reporting a Bug](#reporting-a-bug).

### Labels

- `bug` — something is broken.
- `enhancement` — a new feature or an improvement to an existing one.
- `in progress` — someone is actively working on it.
- `high priority` — needs to be fixed before the next release.

### Triage

- Whoever opens an issue assigns it, to themselves or to the teammate who owns that part of the app.
- If a bug needs more than one person's attention (for example, it touches both the frontend and the database), the person who opened it raises it in the team group chat and the team will collectively decide how to handle it.
- The pull request that fixes an issue includes `Fixes #<issue number>` in its description, so the issue closes automatically when the PR is merged into `main`.

## Important Notes

- Do not commit directly to `main`; use feature branches and pull requests.
- Do not commit secrets or your local `.env` file. Keep local environment files excluded through `.gitignore`.
- If dependencies change, commit both `package.json` and `package-lock.json` so other teammates can install the same dependencies.
- If you encounter setup issues, check the terminal output and confirm that you're running commands from the SceneIt project root.
