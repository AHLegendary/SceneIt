import { test as base, expect } from '@playwright/test'

// Logged-out visitor with an empty backend: Supabase answers with empty data,
// /api/* answers with no results. Nothing leaves the machine.
export const test = base.extend({
  page: async ({ page }, provide) => {
    await page.route('https://fake-project.supabase.co/**', (route) => {
      const url = route.request().url()
      if (url.includes('/auth/v1/token')) {
        return route.fulfill({ status: 400, json: { error: 'invalid_grant', error_description: 'Invalid login credentials' } })
      }
      if (url.includes('/auth/v1/')) return route.fulfill({ status: 200, json: {} })
      return route.fulfill({ status: 200, json: [] })
    })
    await page.route('**/api/**', (route) => route.fulfill({ status: 200, json: { results: [] } }))
    await provide(page)
  },
})

export { expect }
