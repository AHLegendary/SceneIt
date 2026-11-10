import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeBackend, goTo, launch, ready, screen, useMenu, waitFor, within } from './helpers/harness.js'

const BAD_CREDENTIALS = 'Email, username, or password is incorrect. Check them and try again.'
const NETWORK_ERROR = "Couldn't reach SceneIt. Check your connection and try again."
const SERVER_ERROR = 'Something went wrong on our end. Try again in a moment, or log in with your email.'

let backend
let alice

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99', email: 'alice@example.com', password: 'correct-horse' })
})

// Every test starts the app against the backend seeded in beforeEach.
const open = (options) => launch({ backend, ...options })
// The Log in button inside the "Log in to start ranking" prompt (the header has one too).
const promptLogin = () =>
  within(screen.getByRole('heading', { name: 'Log in to start ranking' }).closest('section')).getByRole('button', { name: 'Log in' })
const nav = () => within(screen.getByRole('navigation', { name: 'Main' }))
const form = () => screen.getByLabelText('Password').closest('form')

async function fillLogin(user, identifier, password) {
  if (identifier !== null) await user.type(screen.getByLabelText('Email or username'), identifier)
  if (password !== null) await user.type(screen.getByLabelText('Password'), password)
}

async function submitLogin(user, identifier, password) {
  await fillLogin(user, identifier, password)
  await user.click(within(form()).getByRole('button', { name: 'Log in' }))
}

async function fillSignUp(user, { username, email, password }) {
  if (username !== undefined) await user.type(screen.getByLabelText('Username'), username)
  if (email !== undefined) await user.type(screen.getByLabelText('Email'), email)
  if (password !== undefined) await user.type(screen.getByLabelText('Password'), password)
}

async function submitSignUp(user, fields) {
  await fillSignUp(user, fields)
  await user.click(within(form()).getByRole('button', { name: 'Create account' }))
}

describe('logged out', () => {
  it('shows Log in and Sign up in the header, and no Profile button', async () => {
    await open()
    await ready({ loggedIn: false })

    expect(nav().getByRole('button', { name: 'Log in' })).toBeTruthy()
    expect(nav().getByRole('button', { name: 'Sign up' })).toBeTruthy()
    expect(nav().queryByRole('button', { name: /^profile/i })).toBeNull()
  })

  it.each([
    ['My List', '#/my-list'],
    ['For You', '#/for-you'],
    ['Friends', '#/friends'],
    ['Profile', '#/profile'],
  ])('asks you to log in instead of showing %s', async (_name, hash) => {
    await open({ hash })
    expect(await screen.findByRole('heading', { name: 'Log in to start ranking' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create an account' })).toBeTruthy()
  })

  it('keeps the leaderboard and home open to everyone', async () => {
    await open({ hash: '#/leaderboard' })
    await ready({ loggedIn: false })
    expect(screen.queryByRole('heading', { name: 'Log in to start ranking' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: /leaderboard/i })).toBeTruthy()
  })

  it('opens the login page from the header and the sign-up page from Sign up', async () => {
    const { user } = await open()
    await ready({ loggedIn: false })

    await user.click(nav().getByRole('button', { name: 'Sign up' }))
    expect(await screen.findByRole('heading', { name: 'Create your SceneIt account' })).toBeTruthy()
    expect(window.location.hash).toBe('#/signup')

    await user.click(nav().getByRole('button', { name: 'Log in' }))
    expect(await screen.findByRole('heading', { name: 'Log in to SceneIt' })).toBeTruthy()
    expect(window.location.hash).toBe('#/login')
  })

  it('opens straight into sign-up mode from #/signup', async () => {
    await open({ hash: '#/signup' })
    expect(await screen.findByRole('heading', { name: 'Create your SceneIt account' })).toBeTruthy()
    expect(screen.getByLabelText('Username')).toBeTruthy()
  })
})

describe('logging in with an email', () => {
  it('logs in, lands on the home page, and shows the Profile button', async () => {
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    await submitLogin(user, 'alice@example.com', 'correct-horse')

    await ready({ loggedIn: true })
    expect(window.location.hash).toBe('#/home')
    expect(nav().queryByRole('button', { name: 'Log in' })).toBeNull()
    expect(backend.callsTo('auth:signInWithPassword')[0].args.email).toBe('alice@example.com')
  })

  it('trims spaces around the email', async () => {
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    await submitLogin(user, '  alice@example.com  ', 'correct-horse')

    await ready({ loggedIn: true })
    expect(backend.callsTo('auth:signInWithPassword')[0].args.email).toBe('alice@example.com')
  })

  it('treats the email as case-insensitive', async () => {
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    await submitLogin(user, 'ALICE@Example.com', 'correct-horse')

    await ready({ loggedIn: true })
  })

  it('says the credentials are wrong for a bad password, and stays logged out', async () => {
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    await submitLogin(user, 'alice@example.com', 'wrong-password')

    expect((await screen.findByRole('alert')).textContent).toBe(BAD_CREDENTIALS)
    expect(nav().getByRole('button', { name: 'Log in' })).toBeTruthy()
    expect(window.location.hash).toBe('#/login')
  })

  it('says the same thing for an email that has no account', async () => {
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    await submitLogin(user, 'nobody@example.com', 'whatever123')

    expect((await screen.findByRole('alert')).textContent).toBe(BAD_CREDENTIALS)
  })

  it('shows a connection message when Supabase can\'t be reached', async () => {
    backend.failAuth('signInWithPassword', { status: 502, message: 'Bad gateway' })
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    await submitLogin(user, 'alice@example.com', 'correct-horse')

    expect((await screen.findByRole('alert')).textContent).toBe(NETWORK_ERROR)
  })

  it('disables the form and shows "Logging in…" while waiting', async () => {
    const gate = backend.hold('auth:signInWithPassword')
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    await fillLogin(user, 'alice@example.com', 'correct-horse')
    await user.click(within(form()).getByRole('button', { name: 'Log in' }))

    const busy = await within(form()).findByRole('button', { name: 'Logging in…' })
    expect(busy.disabled).toBe(true)
    expect(screen.getByLabelText('Password').disabled).toBe(true)

    gate.release()
    await ready({ loggedIn: true })
  })
})

describe('logging in with a username (through api/login.js)', () => {
  it('logs in and starts a session', async () => {
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    await submitLogin(user, 'Alice_99', 'correct-horse')

    await ready({ loggedIn: true })
    expect(backend.callsTo('fetch:POST /api/login')).toHaveLength(1)
    expect(backend.callsTo('auth:setSession')).toHaveLength(1)
    // The email stays on the server: the browser only ever sent the username.
    expect(JSON.parse(backend.callsTo('fetch:POST /api/login')[0].args.init.body)).toEqual({ username: 'Alice_99', password: 'correct-horse' })
  })

  it('ignores capitalization in the username', async () => {
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    await submitLogin(user, 'aLiCe_99', 'correct-horse')

    await ready({ loggedIn: true })
  })

  it('treats "_" in a username literally (it is not a wildcard)', async () => {
    backend.addUser({ username: 'AliceX99', email: 'x@example.com', password: 'other-password' })
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    // "Alice_99" must not also match "AliceX99": logging in as it with Alice's password works for Alice only.
    await submitLogin(user, 'Alice_99', 'correct-horse')
    await ready({ loggedIn: true })
    expect(backend.browser.session.user.id).toBe(alice.id)
  })

  it('gives one message for a wrong password and for a username that doesn\'t exist', async () => {
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    await submitLogin(user, 'Alice_99', 'wrong-password')
    const wrongPassword = (await screen.findByRole('alert')).textContent

    await user.clear(screen.getByLabelText('Email or username'))
    await user.clear(screen.getByLabelText('Password'))
    await submitLogin(user, 'nobody_here', 'wrong-password')
    await waitFor(() => expect(backend.callsTo('fetch:POST /api/login')).toHaveLength(2))

    expect(wrongPassword).toBe(BAD_CREDENTIALS)
    expect((await screen.findByRole('alert')).textContent).toBe(BAD_CREDENTIALS)
    expect(backend.callsTo('auth:setSession')).toHaveLength(0)
  })

  it('shows a server message when the endpoint fails', async () => {
    backend.failApi('POST /api/login', { status: 500, body: { error: 'server_not_configured' } })
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    await submitLogin(user, 'Alice_99', 'correct-horse')

    expect((await screen.findByRole('alert')).textContent).toBe(SERVER_ERROR)
  })

  it('shows a connection message when the request never arrives', async () => {
    backend.failApi('POST /api/login', { network: true })
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    await submitLogin(user, 'Alice_99', 'correct-horse')

    expect((await screen.findByRole('alert')).textContent).toBe(NETWORK_ERROR)
  })

  it('explains a missing API route in development, and shows the server message in production', async () => {
    backend.failApi('POST /api/login', { status: 404, body: {} }, { times: 2 })
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    await submitLogin(user, 'Alice_99', 'correct-horse')
    expect((await screen.findByRole('alert')).textContent).toMatch(/needs the API server/)

    vi.stubEnv('DEV', false)
    await user.click(within(form()).getByRole('button', { name: 'Log in' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(SERVER_ERROR))
  })

  it('shows the server message if the session can\'t be started afterwards', async () => {
    backend.failAuth('setSession', { status: 500, message: 'nope' })
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    await submitLogin(user, 'Alice_99', 'correct-horse')

    expect((await screen.findByRole('alert')).textContent).toBe(SERVER_ERROR)
    expect(nav().getByRole('button', { name: 'Log in' })).toBeTruthy()
  })
})

describe('login form validation', () => {
  it('asks for both fields without contacting anything', async () => {
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    await user.click(within(form()).getByRole('button', { name: 'Log in' }))

    expect(await screen.findByText('Enter your email or username.')).toBeTruthy()
    expect(screen.getByText('Enter your password.')).toBeTruthy()
    expect(screen.getByLabelText('Email or username').getAttribute('aria-invalid')).toBe('true')
    expect(backend.callsTo('auth:signInWithPassword')).toHaveLength(0)
    expect(backend.callsTo('fetch:POST /api/login')).toHaveLength(0)
  })

  it('rejects something that is neither a valid username nor an email', async () => {
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    await submitLogin(user, 'no spaces!', 'whatever123')

    expect(await screen.findByText('Enter a valid email or username.')).toBeTruthy()
    expect(backend.callsTo('fetch:POST /api/login')).toHaveLength(0)
  })

  it('rejects a malformed email', async () => {
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })

    await submitLogin(user, 'alice@', 'whatever123')

    expect(await screen.findByText('Enter a valid email, like name@example.com.')).toBeTruthy()
  })

  it('shows and hides the password', async () => {
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })
    const password = screen.getByLabelText('Password')

    expect(password.type).toBe('password')
    await user.click(screen.getByRole('button', { name: 'Show' }))
    expect(password.type).toBe('text')
    await user.click(screen.getByRole('button', { name: 'Hide' }))
    expect(password.type).toBe('password')
  })
})

describe('creating an account', () => {
  it('signs up, creates the profile, and logs you in', async () => {
    const { user } = await open({ hash: '#/signup' })
    await screen.findByRole('heading', { name: 'Create your SceneIt account' })

    await submitSignUp(user, { username: 'newbie', email: 'new@example.com', password: 'longenough' })

    await ready({ loggedIn: true })
    expect(window.location.hash).toBe('#/home')
    expect(backend.profiles.find((p) => p.username === 'newbie')).toMatchObject({ bio: null, pronouns: null, is_public: true })
    expect(backend.callsTo('auth:signUp')[0].args.options).toEqual({ data: { username: 'newbie' } })
  })

  it('shows the new username in the Profile menu', async () => {
    const { user } = await open({ hash: '#/signup' })
    await screen.findByRole('heading', { name: 'Create your SceneIt account' })
    await submitSignUp(user, { username: 'newbie', email: 'new@example.com', password: 'longenough' })
    await ready({ loggedIn: true })

    await user.click(screen.getByRole('button', { name: /^profile/i }))
    expect(within(screen.getByRole('menu', { name: 'Profile menu' })).getByText('newbie')).toBeTruthy()
  })

  it('lets the new user log in again by username, ignoring capitalization', async () => {
    const { user } = await open({ hash: '#/signup' })
    await screen.findByRole('heading', { name: 'Create your SceneIt account' })
    await submitSignUp(user, { username: 'NewBie', email: 'new@example.com', password: 'longenough' })
    await ready({ loggedIn: true })
    await useMenu(user, 'Log out')
    await ready({ loggedIn: false })

    await user.click(nav().getByRole('button', { name: 'Log in' }))
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })
    await submitLogin(user, 'newbie', 'longenough')
    await ready({ loggedIn: true })
  })

  it('says the username is taken, in any capitalization', async () => {
    const { user } = await open({ hash: '#/signup' })
    await screen.findByRole('heading', { name: 'Create your SceneIt account' })

    await submitSignUp(user, { username: 'ALICE_99', email: 'new@example.com', password: 'longenough' })

    expect(await screen.findByText('That username is taken. Try another.')).toBeTruthy()
    expect(screen.getByLabelText('Username').getAttribute('aria-invalid')).toBe('true')
    expect(backend.users.some((u) => u.email === 'new@example.com')).toBe(false)
  })

  it('says the email already has an account', async () => {
    const { user } = await open({ hash: '#/signup' })
    await screen.findByRole('heading', { name: 'Create your SceneIt account' })

    await submitSignUp(user, { username: 'someone', email: 'alice@example.com', password: 'longenough' })

    expect(await screen.findByText('An account with this email already exists. Log in instead.')).toBeTruthy()
  })

  it('says the same when Supabase hides existing emails', async () => {
    backend.hideExistingEmails = true
    const { user } = await open({ hash: '#/signup' })
    await screen.findByRole('heading', { name: 'Create your SceneIt account' })

    await submitSignUp(user, { username: 'someone', email: 'alice@example.com', password: 'longenough' })

    expect(await screen.findByText('An account with this email already exists. Log in instead.')).toBeTruthy()
    expect(nav().getByRole('button', { name: 'Log in' })).toBeTruthy()
  })

  it('asks you to confirm your email when the project requires it, and switches to log in', async () => {
    backend.confirmEmails = true
    const { user } = await open({ hash: '#/signup' })
    await screen.findByRole('heading', { name: 'Create your SceneIt account' })

    await submitSignUp(user, { username: 'newbie', email: 'new@example.com', password: 'longenough' })

    expect((await screen.findByRole('status')).textContent).toBe('Account created. Check your email for a link to confirm it, then log in.')
    expect(screen.getByRole('heading', { name: 'Log in to SceneIt' })).toBeTruthy()
    expect(nav().getByRole('button', { name: 'Log in' })).toBeTruthy()
  })

  it('tells you to wait when rate limited', async () => {
    backend.failAuth('signUp', { status: 429, message: 'rate limit' })
    const { user } = await open({ hash: '#/signup' })
    await screen.findByRole('heading', { name: 'Create your SceneIt account' })

    await submitSignUp(user, { username: 'newbie', email: 'new@example.com', password: 'longenough' })

    expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts. Wait a minute and try again.')
  })

  it('shows Supabase\'s own message for a rejected sign-up', async () => {
    backend.failAuth('signUp', { status: 422, message: 'Signups not allowed for this instance' })
    const { user } = await open({ hash: '#/signup' })
    await screen.findByRole('heading', { name: 'Create your SceneIt account' })

    await submitSignUp(user, { username: 'newbie', email: 'new@example.com', password: 'longenough' })

    expect((await screen.findByRole('alert')).textContent).toBe('Signups not allowed for this instance')
  })

  it('shows a connection message for an unexpected failure', async () => {
    backend.failAuth('signUp', { status: 502, message: 'Bad gateway' })
    const { user } = await open({ hash: '#/signup' })
    await screen.findByRole('heading', { name: 'Create your SceneIt account' })

    await submitSignUp(user, { username: 'newbie', email: 'new@example.com', password: 'longenough' })

    expect((await screen.findByRole('alert')).textContent).toBe(NETWORK_ERROR)
  })

  it('validates every field before contacting Supabase', async () => {
    const { user } = await open({ hash: '#/signup' })
    await screen.findByRole('heading', { name: 'Create your SceneIt account' })

    await user.click(within(form()).getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Choose a username.')).toBeTruthy()
    expect(screen.getByText('Enter your email.')).toBeTruthy()
    expect(screen.getByText('Create a password.')).toBeTruthy()
    expect(backend.callsTo('auth:signUp')).toHaveLength(0)
  })

  it.each([
    ['a username that is too short', { username: 'ab', email: 'a@b.co', password: 'longenough' }, 'Use 3 to 20 letters, numbers, or underscores.'],
    ['a username with spaces', { username: 'has space', email: 'a@b.co', password: 'longenough' }, 'Use 3 to 20 letters, numbers, or underscores.'],
    ['a username that is too long', { username: 'a'.repeat(21), email: 'a@b.co', password: 'longenough' }, 'Use 3 to 20 letters, numbers, or underscores.'],
    ['an invalid email', { username: 'newbie', email: 'not-an-email', password: 'longenough' }, 'Enter a valid email, like name@example.com.'],
    ['a short password', { username: 'newbie', email: 'a@b.co', password: '1234567' }, 'Use at least 8 characters.'],
  ])('rejects %s', async (_label, fields, message) => {
    const { user } = await open({ hash: '#/signup' })
    await screen.findByRole('heading', { name: 'Create your SceneIt account' })

    await submitSignUp(user, fields)

    expect(await screen.findByText(message)).toBeTruthy()
    expect(backend.callsTo('auth:signUp')).toHaveLength(0)
  })
})

describe('switching between log in and sign up', () => {
  it('swaps the form and clears errors and the password', async () => {
    const { user } = await open({ hash: '#/login' })
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })
    await user.click(within(form()).getByRole('button', { name: 'Log in' }))
    expect(await screen.findByText('Enter your password.')).toBeTruthy()
    await user.type(screen.getByLabelText('Password'), 'secret-secret')

    await user.click(screen.getByRole('button', { name: 'Create an account' }))

    expect(await screen.findByRole('heading', { name: 'Create your SceneIt account' })).toBeTruthy()
    expect(screen.queryByText('Enter your password.')).toBeNull()
    expect(screen.getByLabelText('Password').value).toBe('')

    await user.click(within(screen.getByText(/already have an account/i).parentElement).getByRole('button', { name: 'Log in' }))
    expect(await screen.findByRole('heading', { name: 'Log in to SceneIt' })).toBeTruthy()
  })
})

describe('coming back to what you were doing', () => {
  it('returns to the page that asked you to log in', async () => {
    const { user } = await open({ hash: '#/my-list' })
    await screen.findByRole('heading', { name: 'Log in to start ranking' })

    await user.click(promptLogin())
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })
    await submitLogin(user, 'alice@example.com', 'correct-horse')

    await ready({ loggedIn: true })
    await waitFor(() => expect(window.location.hash).toBe('#/my-list'))
    expect(await screen.findByRole('heading', { level: 1, name: /my list/i })).toBeTruthy()
  })

  it('opens the sign-up page, then returns to the page, when you choose "Create an account"', async () => {
    const { user } = await open({ hash: '#/friends' })
    await screen.findByRole('heading', { name: 'Log in to start ranking' })

    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    await screen.findByRole('heading', { name: 'Create your SceneIt account' })
    await submitSignUp(user, { username: 'newbie', email: 'new@example.com', password: 'longenough' })

    await ready({ loggedIn: true })
    await waitFor(() => expect(window.location.hash).toBe('#/friends'))
  })

  it('forgets the remembered page once it has been used', async () => {
    const { user } = await open({ hash: '#/my-list' })
    await screen.findByRole('heading', { name: 'Log in to start ranking' })
    await user.click(promptLogin())
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })
    await submitLogin(user, 'alice@example.com', 'correct-horse')
    await ready({ loggedIn: true })
    await waitFor(() => expect(window.location.hash).toBe('#/my-list'))

    await useMenu(user, 'Log out')
    await ready({ loggedIn: false })
    await user.click(nav().getByRole('button', { name: 'Log in' }))
    await screen.findByRole('heading', { name: 'Log in to SceneIt' })
    await submitLogin(user, 'alice@example.com', 'correct-horse')

    await ready({ loggedIn: true })
    await waitFor(() => expect(window.location.hash).toBe('#/home'))
  })
})

describe('an existing session', () => {
  it('starts you logged in, with your username in the menu', async () => {
    const { user } = await open({ as: alice })
    await ready({ loggedIn: true })

    expect(nav().queryByRole('button', { name: 'Log in' })).toBeNull()
    expect(nav().queryByRole('button', { name: 'Sign up' })).toBeNull()
    await user.click(screen.getByRole('button', { name: /^profile/i }))
    expect(within(screen.getByRole('menu', { name: 'Profile menu' })).getByText('Alice_99')).toBeTruthy()
  })

  it('lets you open pages that need an account', async () => {
    await open({ as: alice, hash: '#/my-list' })
    await ready({ loggedIn: true })
    expect(screen.queryByRole('heading', { name: 'Log in to start ranking' })).toBeNull()
  })

  it('sends you away from the login page when you are already logged in', async () => {
    await open({ as: alice, hash: '#/login' })
    await ready({ loggedIn: true })
    await waitFor(() => expect(window.location.hash).toBe('#/home'))
    expect(screen.queryByRole('heading', { name: 'Log in to SceneIt' })).toBeNull()
  })

  it('does the same for the sign-up page', async () => {
    await open({ as: alice, hash: '#/signup' })
    await ready({ loggedIn: true })
    await waitFor(() => expect(window.location.hash).toBe('#/home'))
  })
})

describe('logging out', () => {
  it('returns you to the home page, logged out', async () => {
    const { user } = await open({ as: alice, hash: '#/my-list' })
    await ready({ loggedIn: true })

    await useMenu(user, 'Log out')

    await ready({ loggedIn: false })
    expect(window.location.hash).toBe('#/home')
    expect(backend.browser.session).toBeNull()
  })

  it('locks the pages that need an account again', async () => {
    const { user } = await open({ as: alice })
    await ready({ loggedIn: true })
    await useMenu(user, 'Log out')
    await ready({ loggedIn: false })

    await goTo('#/my-list')
    expect(await screen.findByRole('heading', { name: 'Log in to start ranking' })).toBeTruthy()
  })

  it('shows the error and keeps you logged in if logging out fails', async () => {
    backend.failAuth('signOut', { status: 500, message: 'Could not sign out' })
    const { user } = await open({ as: alice })
    await ready({ loggedIn: true })

    await useMenu(user, 'Log out')

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("Couldn't log you out. Try again."))
    expect(screen.getByRole('button', { name: /^profile/i })).toBeTruthy()
  })
})
