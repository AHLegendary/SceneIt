import { defineConfig } from '@playwright/test'

const PORT = 5199

// Runs the real app (vite dev server) in Chromium. Supabase is never reached:
// tests/e2e/helpers.js answers its requests. Env vars are fakes for the same reason.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_SUPABASE_URL: 'https://fake-project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fake',
    },
  },
})
