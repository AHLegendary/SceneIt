import { expect, test } from './helpers.js'

test('home shows the welcome strip and main navigation', async ({ page }) => {
  await page.goto('/#/home')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome to SceneIt')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByText('Home')).toBeVisible()
  await expect(nav.getByText('Community')).toBeVisible()
})

test('nav link switches page and updates the URL hash', async ({ page }) => {
  await page.goto('/#/home')
  await page.getByRole('navigation', { name: 'Main' }).getByText('Community').click()
  await expect(page).toHaveURL(/#\/community/)
})

test('account-only pages ask a logged-out visitor to log in', async ({ page }) => {
  for (const hash of ['#/my-list', '#/watchlist', '#/friends', '#/blends']) {
    await page.goto(`/${hash}`)
    await expect(page.getByRole('button', { name: 'Log in' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create an account' })).toBeVisible()
  }
})

test('Log in button on the prompt opens the login page', async ({ page }) => {
  await page.goto('/#/my-list')
  await page.getByRole('heading', { name: 'Log in to start ranking' }).waitFor()
  await page.getByRole('button', { name: 'Log in', exact: true }).last().click()
  await expect(page.getByRole('heading', { name: 'Log in to SceneIt' })).toBeVisible()
})

test('unknown hash still renders the app', async ({ page }) => {
  await page.goto('/#/no-such-page')
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
})

test('search box accepts text and can be cleared', async ({ page }) => {
  await page.goto('/#/home')
  const box = page.getByRole('combobox', { name: 'Search movies' }).or(page.getByLabel('Search movies'))
  await box.first().fill('inception')
  await expect(box.first()).toHaveValue('inception')
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(box.first()).toHaveValue('')
})
