import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, goTo, launch, ready, relaunch, screen, useMenu, waitFor, within } from './helpers/harness.js'

const ids = (n) => MOVIES.slice(0, n).map((m) => m.id)
const title = (id) => MOVIES.find((m) => m.id === id).title

const LOAD_ERROR = "Couldn't load your profile. Check your connection and try again."
const SAVE_ERROR = "Couldn't save your profile. Check your connection and try again."

let backend
let alice
let bob

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99', bio: 'I love slow-burn thrillers.', pronouns: 'she/her' })
  bob = backend.addUser({ username: 'bob' })
})

async function open({ hash = '#/profile', as = alice } = {}) {
  const app = await launch({ backend, as, hash })
  await ready({ loggedIn: true })
  await screen.findByRole('heading', { level: 1, name: as.username })
  return app
}
async function startEditing(user) {
  await user.click(await screen.findByRole('button', { name: 'Edit profile' }))
  return screen.getByLabelText('Bio')
}
// The movie cards in "Top of your list" (the region also has scroll arrow buttons).
const favCards = () => [...document.querySelectorAll('.profile-favs .rec')]
const rowCount = () => document.querySelectorAll('.row .row__title').length
const hero = () => document.querySelector('.profile-hero')
const save = () => screen.getByRole('button', { name: /^(Save changes|Saving…)$/ })

// Replaces a field's value in one go (typing 300 characters one key at a time is slow).
async function setField(user, label, text) {
  const field = screen.getByLabelText(label)
  await user.clear(field)
  if (text) {
    await user.click(field)
    await user.paste(text)
  }
}

describe('your profile', () => {
  it('shows your name, handle, pronouns, visibility and bio', async () => {
    await open()

    expect(within(hero()).getByText('@Alice_99')).toBeTruthy()
    expect(within(hero()).getByText('she/her')).toBeTruthy()
    expect(within(hero()).getByText('Public profile')).toBeTruthy()
    expect(within(hero()).getByText('I love slow-burn thrillers.')).toBeTruthy()
  })

  it('shows a private profile as private', async () => {
    backend.profileOf(alice).is_public = false
    await open()
    expect(await within(hero()).findByText('Private profile')).toBeTruthy()
  })

  it('invites you to write a bio when you haven\'t', async () => {
    backend.profileOf(alice).bio = null
    backend.profileOf(alice).pronouns = null
    await open()

    expect(await screen.findByText('No bio yet. Tell people what you like to watch.')).toBeTruthy()
    expect(hero().querySelector('.chip')).toBeNull()
  })

  it('shows a loading message, then your details', async () => {
    const gate = backend.hold('from:profiles:select')
    await launch({ backend, as: alice, hash: '#/profile' })
    await ready({ loggedIn: true })
    // (the first profile read is the one that fills in your name at login)
    gate.release()
    expect(await screen.findByText('I love slow-burn thrillers.')).toBeTruthy()
  })

  it('shows an error with a retry when the profile can\'t be loaded', async () => {
    const { user } = await launch({ backend, as: alice, hash: '#/leaderboard' })
    await ready({ loggedIn: true })
    backend.failQuery('profiles', 'select', 'boom', { times: 1 })
    await goTo('#/profile')

    expect((await screen.findByRole('alert')).textContent).toContain(LOAD_ERROR)
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('I love slow-burn thrillers.')).toBeTruthy()
  })

  it('opens from the "Bio" shortcut in the Profile menu', async () => {
    const { user } = await launch({ backend, as: alice, hash: '#/home' })
    await ready({ loggedIn: true })
    await useMenu(user, 'Bio')
    expect(await screen.findByRole('heading', { level: 1, name: 'Alice_99' })).toBeTruthy()
    expect(window.location.hash).toBe('#/profile')
  })
})

describe('stats and top movies', () => {
  it('counts your ranked movies and friends, and links to each', async () => {
    backend.seedList(alice, ids(4))
    backend.addFriendship(alice, bob, 'accepted')
    const { user } = await open()

    const stats = within(screen.getByRole('region', { name: 'Your stats' }))
    await waitFor(() => expect(stats.getByText('4')).toBeTruthy())
    expect(stats.getByText('Movies ranked')).toBeTruthy()
    expect(stats.getByText('1')).toBeTruthy()

    await user.click(stats.getByRole('button', { name: /Friends/ }))
    expect(window.location.hash).toBe('#/friends')
  })

  it('takes you to My List from the Movies ranked count', async () => {
    const { user } = await open()
    await user.click(within(screen.getByRole('region', { name: 'Your stats' })).getByRole('button', { name: /Movies ranked/ }))
    expect(window.location.hash).toBe('#/my-list')
  })

  it('shows pending requests next to the friend count', async () => {
    const cara = backend.addUser({ username: 'cara' })
    backend.addFriendship(bob, alice, 'pending')
    backend.addFriendship(cara, alice, 'pending')
    await open()
    expect(await within(screen.getByRole('region', { name: 'Your stats' })).findByText('Friends · 2 pending')).toBeTruthy()
  })

  it('invites you to start ranking when your list is empty', async () => {
    const { user } = await open()

    expect(await screen.findByText('Nothing ranked yet')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Start ranking' }))
    expect(window.location.hash).toBe('#/my-list')
  })

  it('shows your ten highest-ranked movies in order, with years below ten ranked', async () => {
    backend.seedList(alice, ids(9))
    await open()

    const favs = within(screen.getByRole('region', { name: 'Your top movies' }))
    await waitFor(() => expect(favCards()).toHaveLength(9))
    expect(favs.getByText(`#1 ${title(ids(1)[0])}`)).toBeTruthy()
    expect(favs.queryByText(/score/)).toBeNull()
  })

  it('shows only ten of a longer list, with scores once you\'ve ranked ten', async () => {
    backend.seedList(alice, ids(12))
    await open()

    const favs = within(screen.getByRole('region', { name: 'Your top movies' }))
    await waitFor(() => expect(favCards()).toHaveLength(10))
    expect(favs.getByText('10.0 score')).toBeTruthy()
    expect(favs.queryByText(`#11 ${title(ids(11)[10])}`)).toBeNull()
  })

  it('opens a movie\'s details when you click it', async () => {
    backend.seedList(alice, ids(2))
    const { user } = await open()
    const favs = within(screen.getByRole('region', { name: 'Your top movies' }))
    await user.click(await favs.findByText(`#1 ${title(ids(1)[0])}`))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('hides the top movies while you are editing', async () => {
    backend.seedList(alice, ids(2))
    const { user } = await open()
    await screen.findByRole('region', { name: 'Your top movies' })
    await startEditing(user)
    expect(screen.queryByRole('region', { name: 'Your top movies' })).toBeNull()
  })
})

describe('editing', () => {
  it('opens a form with your current values and closes it again', async () => {
    const { user } = await open()
    const bio = await startEditing(user)

    expect(bio.value).toBe('I love slow-burn thrillers.')
    expect(screen.getByLabelText('Pronouns').value).toBe('she/her')
    expect(screen.getByRole('radio', { name: 'Public' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(`${[...'I love slow-burn thrillers.'].length}/300`)).toBeTruthy()
    expect(screen.getByText(`${[...'she/her'].length}/30`)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByLabelText('Bio')).toBeNull()
  })

  it('keeps Save disabled until something changes, and ignores whitespace-only changes', async () => {
    const { user } = await open()
    await startEditing(user)
    expect(save().disabled).toBe(true)

    await user.type(screen.getByLabelText('Bio'), '   ')
    expect(save().disabled).toBe(true)

    await user.type(screen.getByLabelText('Bio'), ' Also horror.')
    expect(save().disabled).toBe(false)
  })

  it('saves a new bio and pronouns, closes the form, and shows them', async () => {
    const { user } = await open()
    await startEditing(user)
    await setField(user, 'Bio', '  Sci-fi all day.  ')
    await setField(user, 'Pronouns', 'they/them')

    await user.click(save())

    await waitFor(() => expect(screen.queryByLabelText('Bio')).toBeNull())
    expect(within(hero()).getByText('Sci-fi all day.')).toBeTruthy()
    expect(within(hero()).getByText('they/them')).toBeTruthy()
    expect(backend.profileOf(alice)).toMatchObject({ bio: 'Sci-fi all day.', pronouns: 'they/them' })
  })

  it('stores a blank bio and blank pronouns as nothing', async () => {
    const { user } = await open()
    await startEditing(user)
    await setField(user, 'Bio', '')
    await setField(user, 'Pronouns', '')

    await user.click(save())

    await waitFor(() => expect(backend.profileOf(alice)).toMatchObject({ bio: null, pronouns: null }))
    expect(await screen.findByText('No bio yet. Tell people what you like to watch.')).toBeTruthy()
  })

  it('counts characters as the database does, so 300 emoji fit in a bio', async () => {
    const { user } = await open()
    await startEditing(user)

    await setField(user, 'Bio', '🎬'.repeat(300))

    expect(screen.getByText('300/300')).toBeTruthy()
    await user.click(save())
    await waitFor(() => expect(backend.profileOf(alice).bio).toBe('🎬'.repeat(300)))
  })

  it.each([
    ['Bio', 'x'.repeat(301), 'Keep your bio to 300 characters or fewer.'],
    ['Pronouns', 'x'.repeat(31), 'Keep pronouns to 30 characters or fewer.'],
  ])('refuses a %s that is too long, without saving', async (label, text, message) => {
    const { user } = await open()
    await startEditing(user)
    await setField(user, label, text)

    await user.click(save())

    expect(await screen.findByText(message)).toBeTruthy()
    expect(screen.getByLabelText(label).getAttribute('aria-invalid')).toBe('true')
    expect(backend.callsTo('from:profiles:update')).toHaveLength(0)
  })

  it('discards your edits', async () => {
    const { user } = await open()
    await startEditing(user)
    await setField(user, 'Bio', 'Something else')
    expect(screen.getByLabelText('Bio').value).toBe('Something else')

    await user.click(screen.getByRole('button', { name: 'Discard changes' }))

    expect(screen.getByLabelText('Bio').value).toBe('I love slow-burn thrillers.')
    expect(save().disabled).toBe(true)
  })

  it('shows "Saving…" and locks the form while saving', async () => {
    const gate = backend.hold('from:profiles:update')
    const { user } = await open()
    await startEditing(user)
    await setField(user, 'Bio', 'New bio')

    await user.click(save())

    expect((await screen.findByRole('button', { name: 'Saving…' })).disabled).toBe(true)
    expect(screen.getByLabelText('Bio').disabled).toBe(true)
    gate.release()
    await waitFor(() => expect(screen.queryByLabelText('Bio')).toBeNull())
  })

  it('shows an error and keeps your edits when saving fails, then lets you retry', async () => {
    backend.failQuery('profiles', 'update', 'boom', { times: 1 })
    const { user } = await open()
    await startEditing(user)
    await setField(user, 'Bio', 'New bio')

    await user.click(save())

    expect((await screen.findByRole('alert')).textContent).toContain(SAVE_ERROR)
    expect(screen.getByLabelText('Bio').value).toBe('New bio')
    expect(backend.profileOf(alice).bio).toBe('I love slow-burn thrillers.')

    await user.click(save())
    await waitFor(() => expect(backend.profileOf(alice).bio).toBe('New bio'))
    expect(screen.queryByLabelText('Bio')).toBeNull()
  })

  it('confirms with "Profile saved." after saving, and clears it when you edit again', async () => {
    const { user } = await open()
    await startEditing(user)
    await setField(user, 'Bio', 'New bio')

    await user.click(save())

    expect((await screen.findByRole('status')).textContent).toBe('Profile saved.')
    expect(screen.queryByLabelText('Bio')).toBeNull()

    await startEditing(user)
    expect(screen.queryByText('Profile saved.')).toBeNull()
  })

  it('keeps what you saved after a reload', async () => {
    const app = await open()
    const { user } = app
    await startEditing(user)
    await setField(user, 'Bio', 'Still here')
    await user.click(save())
    await waitFor(() => expect(backend.profileOf(alice).bio).toBe('Still here'))

    await relaunch(app, { as: alice, hash: '#/profile' })
    expect(await screen.findByText('Still here')).toBeTruthy()
    expect(screen.queryByText('I love slow-burn thrillers.')).toBeNull()
  })
})

describe('visibility', () => {
  it('explains each choice', async () => {
    const { user } = await open()
    await startEditing(user)

    expect(screen.getByText(/Anyone can see your profile and ranked list\./)).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'Private' }))
    expect(screen.getByRole('radio', { name: 'Private' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(/Only you and your friends can see your profile and ranked list\./)).toBeTruthy()
    expect(screen.getByText(/Your username can still be found when someone sends a friend request\./)).toBeTruthy()
  })

  it('makes your profile private, and strangers then see only a private notice', async () => {
    backend.seedList(alice, ids(3))
    const app = await open()
    const { user } = app
    await startEditing(user)
    await user.click(screen.getByRole('radio', { name: 'Private' }))
    await user.click(save())
    await waitFor(() => expect(backend.profileOf(alice).is_public).toBe(false))
    expect(await within(hero()).findByText('Private profile')).toBeTruthy()
    expect(backend.profileOf(alice).is_public).toBe(false)

    await relaunch(app, { as: bob, hash: '#/u/Alice_99' })
    await ready({ loggedIn: true })
    expect(await screen.findByText('This profile is private. Add them as a friend to see their profile.')).toBeTruthy()
    expect(screen.queryByText('I love slow-burn thrillers.')).toBeNull()
    expect(rowCount()).toBe(0)
  })

  it('lets a friend still see a private profile', async () => {
    backend.addFriendship(alice, bob, 'accepted')
    backend.profileOf(alice).is_public = false
    await launch({ backend, as: bob, hash: '#/u/Alice_99' })
    await ready({ loggedIn: true })

    expect(await screen.findByText('Private profile, shared with friends')).toBeTruthy()
    expect(screen.getByText('I love slow-burn thrillers.')).toBeTruthy()
  })

  it('makes a private profile public again', async () => {
    backend.profileOf(alice).is_public = false
    const app = await open()
    const { user } = app
    await startEditing(user)
    await user.click(screen.getByRole('radio', { name: 'Public' }))
    await user.click(save())
    await waitFor(() => expect(backend.profileOf(alice).is_public).toBe(true))

    await relaunch(app, { as: bob, hash: '#/u/Alice_99' })
    await ready({ loggedIn: true })
    expect(await screen.findByText('I love slow-burn thrillers.')).toBeTruthy()
  })

  it('shows what others see: your bio and pronouns on your public profile', async () => {
    await launch({ backend, as: bob, hash: '#/u/Alice_99' })
    await ready({ loggedIn: true })
    expect(await screen.findByText('she/her')).toBeTruthy()
    expect(screen.getByText('I love slow-burn thrillers.')).toBeTruthy()
  })
})

// jsdom can't decode images or draw on a canvas, so the browser parts of an upload are stubbed;
// the request, the real /api/profile/media handler and (fake) storage are all exercised.
function stubImageDecoding({ decodes = true } = {}) {
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
  vi.stubGlobal(
    'Image',
    class {
      width = 800
      height = 600
      set src(_value) {
        setTimeout(() => (decodes ? this.onload?.() : this.onerror?.()))
      }
    },
  )
  HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} })
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
}

const file = (type = 'image/png', name = 'pic.png') => new File(['fake-bytes'], name, { type })
const input = (kind) => document.querySelector(kind === 'avatar' ? '.profile-hero__avatar-wrap input[type=file]' : '.profile-hero__tools input[type=file]')
const choose = (kind, f) => fireEvent.change(input(kind), { target: { files: [f] } })
const picturePath = (kind) => `profile-media/${alice.id}/${kind}.jpg`

describe('profile picture and banner', () => {
  beforeEach(() => stubImageDecoding())

  it('shows your initial when there is no picture, and offers to add one', async () => {
    await open()
    fireEvent.error(document.querySelector('.profile-hero__avatar--img'))

    await waitFor(() => expect(document.querySelector('.profile-hero__avatar').textContent).toBe('A'))
    expect(screen.getByRole('button', { name: 'Add profile picture' })).toBeTruthy()
  })

  it('looks for the picture at <user id>/avatar.jpg in the public bucket', async () => {
    await open()
    expect(document.querySelector('.profile-hero__avatar--img').getAttribute('src')).toContain(`/storage/v1/object/public/profile-media/${alice.id}/avatar.jpg`)
  })

  it('uploads a picture through the API and shows it', async () => {
    await open()

    choose('avatar', file())

    await waitFor(() => expect(backend.files.has(picturePath('avatar'))).toBe(true))
    const put = backend.callsTo('fetch:PUT /api/profile/media')[0].args.init
    expect(JSON.parse(put.body)).toEqual({ kind: 'avatar', image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' })
    expect(put.headers.Authorization).toMatch(/^Bearer at-/)
    expect(backend.buckets.get('profile-media')).toMatchObject({ public: true })
    await waitFor(() => expect(document.querySelector('.profile-hero__avatar--img').getAttribute('src')).toMatch(/avatar\.jpg\?v=\d+/))
    expect(screen.getByRole('button', { name: 'Change profile picture' })).toBeTruthy()
  })

  it('uploads a banner, then offers Change banner and Remove', async () => {
    await open()
    fireEvent.error(hero().querySelector('img[hidden]')) // no banner on file yet, like in a browser
    expect(await screen.findByRole('button', { name: 'Add banner' })).toBeTruthy()

    choose('banner', file())

    await waitFor(() => expect(backend.files.has(picturePath('banner'))).toBe(true))
    expect(await screen.findByRole('button', { name: 'Change banner' })).toBeTruthy()
    expect(within(hero()).getByRole('button', { name: 'Remove' })).toBeTruthy()
  })

  it('shows "Uploading…" while the banner is on its way', async () => {
    const gate = backend.hold('PUT /api/profile/media')
    await open()

    choose('banner', file())

    expect((await screen.findByRole('button', { name: 'Uploading…' })).disabled).toBe(true)
    gate.release()
    await screen.findByRole('button', { name: 'Change banner' })
  })

  it('removes a banner', async () => {
    await open()
    choose('banner', file())
    const { user } = { user: (await import('@testing-library/user-event')).default.setup() }
    await screen.findByRole('button', { name: 'Change banner' })

    await user.click(within(hero()).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(backend.files.has(picturePath('banner'))).toBe(false))
    expect(await screen.findByRole('button', { name: 'Add banner' })).toBeTruthy()
  })

  it('removes your picture from the edit form', async () => {
    const { user } = await open()
    choose('avatar', file())
    await waitFor(() => expect(backend.files.has(picturePath('avatar'))).toBe(true))
    await startEditing(user)

    await user.click(await screen.findByRole('button', { name: 'Remove picture' }))

    await waitFor(() => expect(backend.files.has(picturePath('avatar'))).toBe(false))
    expect(screen.queryByRole('button', { name: 'Remove picture' })).toBeNull()
  })

  it('refuses a file that isn\'t an image, without calling the server', async () => {
    await open()

    choose('avatar', file('text/plain', 'notes.txt'))

    expect((await screen.findByRole('alert')).textContent).toContain('Choose an image file (JPEG, PNG or WebP).')
    expect(backend.callsTo('fetch:PUT /api/profile/media')).toHaveLength(0)
  })

  it('refuses an image the browser can\'t read', async () => {
    stubImageDecoding({ decodes: false })
    await open()

    choose('avatar', file())

    expect((await screen.findByRole('alert')).textContent).toContain('Choose an image file (JPEG, PNG or WebP).')
    expect(backend.callsTo('fetch:PUT /api/profile/media')).toHaveLength(0)
  })

  it('shows the server\'s message when saving the image fails, and lets you dismiss it', async () => {
    backend.fail('storage:upload', 'nope', { times: 1 })
    const { user } = await open()

    choose('avatar', file())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Couldn't save that image, try again later.")
    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('asks you to log in again if your session has expired', async () => {
    await open()
    backend.invalidateTokens(alice)

    choose('avatar', file())

    expect((await screen.findByRole('alert')).textContent).toContain('Log in to change your profile.')
    expect(backend.files.size).toBe(0)
  })

  it('shows an error if the request never arrives', async () => {
    backend.failApi('PUT /api/profile/media', { network: true })
    await open()

    choose('avatar', file())

    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
