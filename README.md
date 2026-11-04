# SceneIt

SceneIt is a social movie-ranking web application that helps users rank movies through head-to-head comparisons instead of traditional star or numerical ratings. Users can track movies they have watched, connect with friends, and discover movies based on their personal preferences and their friends' rankings.

**Live site:** https://sceneitmovies.vercel.app — the quickest way to try SceneIt. Sign up with any email (email confirmation is off) and start ranking.

## Goals and Features

SceneIt aims to make movie discovery more personalized, expressive, and social.

**Available in the beta:**

- **Head-to-Head Movie Rankings:** Pick how you felt about a movie (loved it / it was okay / not a fan), then compare it head-to-head against movies in that category to place it in your list. Ties and reranking are supported.
- **Personalized Recommendations:** The For You page suggests movies from TMDb based on your own rankings and your friends' rankings.
- **Community Leaderboards:** Weekly and monthly leaderboards (highest ranked and most watched) built from SceneIt users' rankings, with IMDb and Rotten Tomatoes scores shown as extra info.
- **Friends:** Search users, send and accept friend requests, and view friends' profiles and ranked lists.
- **Customizable Profiles:** Bio, pronouns, public/private setting, top movies list, profile picture, and banner.

**Planned (not in the beta yet):**

- **Movie Blend:** Collaborate with up to five friends to find movies that match everyone's interests (in progress).
- **Reviews and Social Interaction:** Write movie reviews and comment on friends' reviews.
- **Community Safety:** Report inappropriate reviews and comments.
- **Achievements** on profiles.

## Operational Use Cases

These use cases work end to end on the live site and on a local setup with all environment variables configured (see [Environment Setup](#3-configure-environment-variables)).

1. **Sign up and log in** with an email or username and a password.
2. **Search for any movie and rank it** (touches every major component): a logged-in user searches for a movie → the React frontend calls `GET /api/movies/search` (Vercel serverless function) → the function queries the TMDb API and caches the movie in Supabase → the user picks a category and does head-to-head comparisons → the ranking is saved to PostgreSQL through the `save_ranking` function → the movie appears in **My List** and counts toward the **Leaderboard**.
3. **View and manage My List:** filter by category, rerank a movie, or remove it.
4. **Browse the Leaderboard** for this week or this month, by highest ranked or most watched (no login needed).
5. **Get recommendations** on the For You page, based on your rankings and your friends' rankings.
6. **Add friends:** search by username, send a request, accept incoming requests.
7. **Edit your profile** (bio, pronouns, public/private) and **view other users' profiles and lists**.
8. **Browse the Home page:** Trending Now, Top Ranked, Most Watched, and (when logged in) Because You Ranked… and Friends Are Watching.

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
│   ├── _lib/                      # Shared server helpers (TMDb client, Supabase admin client)
│   ├── movies/                    # Search, trending, recommendations, movie details
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
│   ├── features/                  # Feature-specific code (ranking, recommendations)
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
│   └── unit/                      # Unit tests (Vitest)
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
- **`src/features/`**: Code organized around features, such as movie ranking and recommendations.
- **`src/pages/`**: Full pages, such as the home page, leaderboard, and user profile.
- **`src/lib/`**: Shared utilities, Supabase queries, and configuration helpers.
- **`tests/unit/`**: Tests for individual functions or modules.
- **`.github/workflows/`**: Automated GitHub Actions workflows for testing and other development tasks.
- **`supabase/`**: Database migrations and seed files. See `supabase/README.md` for the tables and database functions.

**Planned:** `tests/integration/` for tests that check several modules working together (for example, an API route talking to the database), and `tests/e2e/` for browser tests (for example, with Playwright) that click through complete user workflows.

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
npm run test:run   # runs all Vitest unit tests once
npm run build      # builds the app for production into dist/
```

- **`npm run test:run`** — Runs the project's unit tests once and prints the results.
- **`npm test`** — Runs the tests in watch mode (reruns on file changes) while you develop.
- **`npm run build`** — Checks that the application compiles for deployment.
- **`npm run lint`** — Runs the oxlint linter (optional).

If the tests pass and the build succeeds, the project is set up correctly. These are the same checks CI runs on every pull request.

## 4. Configure Environment Variables

Running the app (step 5) needs a Supabase project and a TMDb token. **If you just want to try SceneIt, use the [live site](https://sceneitmovies.vercel.app) instead** — it already has these set up and has real users and rankings.

To run it locally, copy the template:

```bash
cp .env.example .env
```

Then fill in the values below. Never commit `.env`; it is already in `.gitignore`.

### Supabase (required, about 10 minutes, free)

1. Create an account at [supabase.com](https://supabase.com) and create a new project.
2. Open the **SQL Editor**. Paste and run each migration in `supabase/migrations/`, in this order:
   1. `20261031000000_init_schema.sql`
   2. `20261102000000_friend_requests.sql`
   3. `20261103000000_ranking_categories.sql`
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

### OMDb (optional)

`OMDB_API_KEY` is only used by `npm run ratings`, which refreshes the IMDb and Rotten Tomatoes scores in the built-in catalog. You can skip it. Free keys: [omdbapi.com](https://www.omdbapi.com/apikey.aspx).

### What breaks if a variable is missing

| Missing | What happens |
|---|---|
| `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY` | The app shows a blank page (the Supabase client can't start). |
| `SUPABASE_SERVICE_ROLE_KEY` | Logging in with a username fails (logging in with an email still works), movies found through search can't be saved (so they can't be ranked), and profile pictures and banners can't be uploaded. |
| `TMDB_READ_TOKEN` | Search and the Trending Now row fall back to the built-in 60-movie catalog, movies outside that catalog can't be ranked, and recommendations only use the catalog. |
| `OMDB_API_KEY` | Only `npm run ratings` fails. The app is unaffected. |

### Your Supabase project starts empty

A new Supabase project has no users besides the ones you create, so the leaderboard, friends, and friend-based recommendations will be empty at first. To see them working, either:

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

## Homepage Data

The homepage's **Trending Now** row comes from `GET /api/movies/trending` (TMDb's weekly trending list, needs `TMDB_READ_TOKEN`). Without the API it falls back to the most-rated movies in the built-in catalog and is labelled "Popular on SceneIt". **Top Ranked** and **Most Watched** come from the public leaderboard; **Because You Ranked…** and **Friends Are Watching** only appear for logged-in users and only from their own list and friends.

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

## Automated Testing and CI

SceneIt uses Vitest for unit testing and GitHub Actions for continuous integration (CI).

- **Vitest:** Unit tests in `tests/unit/` cover the ranking logic, recommendations, leaderboard, friends, login, validation, API handlers, and Supabase queries (with the network mocked).
- **GitHub Actions:** `.github/workflows/ci.yml` installs dependencies, runs `npm run test:run`, and runs `npm run build` on every pull request that targets `main` and on every push to `main`.
- **Production build:** Verifies that the application can be compiled for deployment.

Passing CI checks does not replace teammate review. Both the required checks and approvals must be satisfied before merging into `main`.

## Bug Tracking

We track bugs and planned work with [GitHub Issues](https://github.com/AHLegendary/SceneIt/issues).

### Reporting a bug

1. Go to the **Issues** tab and click **New issue**.
2. Give it a short, specific title (for example, "Leaderboard is empty after ranking a movie").
3. In the description, include:
   - **Steps to reproduce:** what you clicked or typed, in order.
   - **Expected:** what should have happened.
   - **Actual:** what happened instead, including any error message.
   - **Where:** live site or local, and your browser.
   - **Screenshot**, if it helps.
4. Add a label (see below).

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