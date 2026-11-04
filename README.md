# SceneIt

SceneIt is a social movie-ranking web application that helps users rank movies through head-to-head comparisons instead of traditional star or numerical ratings. Users can track movies they have watched, write reviews, connect with friends, and discover movies based on their personal preferences and their friends’ rankings.

## Goals and Features

SceneIt aims to make movie discovery more personalized, expressive, and social. Its main features include:

- **Head-to-Head Movie Rankings:** Compare movies to build a personalized ranking list, with options to tie or rerank movies.
- **Personalized Recommendations:** Discover movies based on individual rankings and viewing preferences.
- **Movie Blend:** Collaborate with up to five friends to find movies that match everyone's interests.
- **Reviews and Social Interaction:** Write movie reviews, explore friends’ rankings, and comment on their reviews.
- **Community Leaderboards:** View weekly and monthly rankings based on the SceneIt community.
- **Customizable Profiles:** Display favorite movies, bios, pronouns, achievements, and other profile details.
- **Community Safety:** Report inappropriate reviews and comments.

## Tech Stack

- **Frontend:** React
- **Backend and Database:** Supabase and PostgreSQL
- **Movie Data:** TMDb API
- **Deployment:** Vercel
- **Version Control:** Git and GitHub

## Repository Structure

The repository is organized around the frontend application, backend configuration, and project documentation.

```text
SceneIt/
├── .github/
│   └── workflows/
│       └── ci.yml                 # GitHub Actions: tests and production build
│
├── public/                        # Static files served directly
│   ├── favicon.svg                # Browser tab icon
│   └── icons.svg                  # Reusable SVG icon library for the UI
│
├── src/
│   ├── assets/                    # Imported images, logos, and icons
│   ├── components/                # Reusable UI components
│   ├── features/                  # Feature-specific code
│   ├── pages/                     # Full application pages
│   ├── lib/                       # Shared utilities and API clients
│   ├── App.jsx                    # Main React application
│   ├── App.css                    # Application-specific styles
│   ├── index.css                  # Global styles
│   └── main.jsx                   # React entry point
│
├── tests/
│   ├── unit/                      # Unit tests
│   │   └── example.test.js
│   ├── integration/               # Integration tests (add when needed)
│   └── e2e/                       # End-to-end browser tests (add later)
│
├── supabase/                      # Database migrations and seed data
│
├── performance/
│   └── k6/                        # Load and performance tests (optional)
│
│
├── .gitignore                     # Files Git should ignore
├── .env.example                   # Template for required environment variables
├── index.html                     # HTML entry point
├── package.json                   # Dependencies and npm scripts
├── package-lock.json              # Locked dependency versions
├── vite.config.js                 # Vite configuration
└── README.md                      # Project overview and setup instructions
```

### Directory Guidelines

- **`public/`**: Files that need a fixed URL or should be served without being imported into JavaScript.
- **`src/assets/`**: Static assets imported into React components or CSS.
- **`src/components/`**: Reusable interface elements, such as movie cards, buttons, and navigation bars.
- **`src/features/`**: Code organized around features, such as movie ranking, reviews, and user profiles.
- **`src/pages/`**: Full pages, such as the home page, movie details page, and user profile.
- **`src/lib/`**: Shared utilities, API clients, and configuration helpers.
- **`tests/unit/`**: Tests for individual functions or components.
- **`tests/integration/`**: Tests that verify multiple components or modules work together.
- **`tests/e2e/`**: Browser-based tests that verify complete user workflows.
- **`.github/workflows/`**: Automated GitHub Actions workflows for testing and other development tasks.
- **`supabase/`**: Database migrations and seed files when database development begins.
- **`performance/k6/`**: Optional scripts for testing application performance under load.

*Note: This is the planned structure. Some directories can be added when their corresponding features or tests are implemented.*


## Getting Started

Follow these steps to set up SceneIt locally and start contributing.

### Prerequisites

Make sure you have the following installed:

- [Git](https://git-scm.com/downloads) — for version control.
- [Node.js and npm](https://nodejs.org/) — for running the React + Vite application and managing dependencies.
- [GitHub CLI](https://cli.github.com/) (optional) — for creating and managing pull requests from the terminal. You can also create PRs through the GitHub website.
- A GitHub account with access to the SceneIt repository.

Verify that Git, Node.js, and npm are installed:

```bash
git --version
node -v
npm -v
```

If you plan to use GitHub CLI, verify its installation:

```bash
gh --version
```

## 1. Clone the Repository

Clone the SceneIt repository and navigate into the project directory:

```bash
git clone <REPOSITORY_URL>
cd SceneIt
```

Replace `<REPOSITORY_URL>` with the repository URL from GitHub.

## 2. Install Dependencies

Run the following command from the project root:

```bash
npm ci
```

This installs the project's dependencies using `package-lock.json`, including React, Vite, and Vitest.

Run this during initial setup or when dependencies change.

## 3. Configure Enviornment Variables

Create a `.env` file, and copy the `.env.example` contents over to `.env` and add the values to the keys.
It should look something like below the key-value pair below.

```
VITE_SUPABASE_URL=your-supabase-project-url
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

Make sure that .env is not tracked in git status.

## 4. Verify Your Setup

Run the following commands from the project root:

```bash
npm run test:run
npm run build
npm run dev
```

These commands serve different purposes:

- **`npm run test:run`** — Runs the project's Vitest unit tests.
- **`npm run build`** — Checks whether the application can be built for production.
- **`npm run dev`** — Starts the local development server. Open the URL printed in the terminal, usually `http://localhost:5173`, to view and interact with SceneIt.

The development server is for local development and manual testing, not automated end-to-end testing. Automated browser tests can be added later using a tool such as Playwright.

If the tests and build succeed and the application runs locally, you're ready to start contributing.

## Homepage Data

The homepage's **Trending Now** row comes from `GET /api/movies/trending` (TMDb's weekly trending list, needs `TMDB_READ_TOKEN`). Without the API it falls back to the most-rated movies in the built-in catalog and is labelled "Popular on SceneIt". **Top Ranked** and **Most Watched** come from the public leaderboard; **Because You Ranked…** and **Friends Are Watching** only appear for logged-in users and only from their own list and friends.

## Profile Pictures and Banners

Users can add a profile picture and banner from their Profile page. The browser resizes the image, then `PUT /api/profile/media` stores it in the public `profile-media` Storage bucket at `<user id>/avatar.jpg` or `banner.jpg` (the bucket is created on first use with the server's secret key, so no migration is needed). Pages build the image URL from the user id and fall back to an initial / the top movie's backdrop when there is none.

## Demo Movie Data

The local demo runs on a fixed catalog in `src/data/movies.json` and stores the guest's list in localStorage (see `src/lib/localStore.js`). No TMDb calls happen at runtime.

To fill in real posters, movie details (overview, runtime, director, cast, backdrop) and TMDb's related movies for recommendations, add `TMDB_READ_TOKEN` to your `.env` and run:

```bash
npm run movie-data          # only fills what's missing
npm run movie-data -- --all # refresh every movie
```

This makes about one or two TMDb requests per movie, once. Commit the updated `movies.json` afterwards. Movies without a poster show a placeholder card, and the details panel hides anything a movie doesn't have.

## Automated Testing and CI

SceneIt uses Vitest for unit testing and GitHub Actions for continuous integration (CI).

- **Vitest:** Tests individual functions and pieces of application logic.
- **GitHub Actions:** Automatically runs the configured tests and build checks when a PR targets `main` and when changes are pushed to `main`.
- **Production build:** Verifies that the application can be compiled for deployment.

Passing CI checks does not replace teammate review. Both the required checks and approvals must be satisfied before merging into `main`.

## Important Notes

- Do not commit directly to `main`; use feature branches and pull requests.
- Do not commit secrets or your local `.env` file. Keep local environment files excluded through `.gitignore`.
- If dependencies change, commit both `package.json` and `package-lock.json` so other teammates can install the same dependencies.
- If you encounter setup issues, check the terminal output and confirm that you're running commands from the SceneIt project root.
