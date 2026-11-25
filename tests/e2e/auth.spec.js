import { expect, test } from './helpers.js'

test.describe('login form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/login')
  })

  test('empty submit shows field errors', async ({ page }) => {
    await page.getByRole('button', { name: 'Log in', exact: true }).last().click()
    await expect(page.locator('.field-error').first()).toBeVisible()
  })

  test('wrong credentials show an error alert', async ({ page }) => {
    await page.getByLabel('Email or username').fill('nobody@example.com')
    await page.getByLabel('Password').fill('wrongpassword1')
    await page.locator('button.login-submit').click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page).toHaveURL(/#\/login/)
  })

  test('switches to sign up and back', async ({ page }) => {
    await page.getByRole('button', { name: /sign up|create/i }).last().click()
    await expect(page.getByRole('heading', { name: 'Create your SceneIt account' })).toBeVisible()
    await expect(page.getByLabel('Username')).toBeVisible()
  })
})

test('sign up validates username, email and password', async ({ page }) => {
  await page.goto('/#/signup')
  await page.getByLabel('Username').fill('a')
  await page.getByLabel('Email').fill('not-an-email')
  await page.getByLabel('Password', { exact: false }).first().fill('x')
  await page.locator('button.login-submit').click()
  await expect(page.locator('.field-error').first()).toBeVisible()
  await expect(page).toHaveURL(/#\/signup/)
})
