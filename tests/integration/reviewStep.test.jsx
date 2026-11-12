import { fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, launch, ready, screen, waitFor, within } from './helpers/harness.js'

const [A, B] = MOVIES.slice(0, 2)
const SAVE_REVIEW_ERROR = "Couldn't save your review. Check your connection and try again."
const FLAGGED = "That text can't be posted because it may break our community rules. Edit it and try again."

let backend
let alice

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
})

async function open() {
  const app = await launch({ backend, as: alice, hash: '#/my-list' })
  await ready({ loggedIn: true })
  return app
}

// Ranks a movie as the given feeling. With an empty list (or a different
// category from everything already ranked) there are no comparisons, so the
// flow goes straight to saving and then the review step.
async function rankMovie(user, movie, feelingLabel = 'Loved it') {
  backend.tmdbKnows(movie.id)
  await user.click(await screen.findByRole('button', { name: /^Rank a movie$|^Rerank/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Rank a movie' })
  await user.type(within(dialog).getByRole('searchbox', { name: 'Search movies' }), movie.title)
  await user.click(await within(dialog).findByRole('button', { name: `Rank ${movie.title}` }))
  await user.click(screen.getByRole('button', { name: new RegExp(`^${feelingLabel}`) }))
}

const reviewBox = () => screen.findByRole('textbox', { name: `Your review of ${A.title}` })
const type = (box, text) => fireEvent.change(box, { target: { value: text } })

describe('the review step', () => {
  it('appears after the ranking is saved, before the result screen', async () => {
    const { user } = await open()
    await rankMovie(user, A)

    expect(await screen.findByRole('heading', { name: `Add a review of ${A.title}?` })).toBeTruthy()
    expect(screen.getByText('Optional. Your ranking is already saved.')).toBeTruthy()
    expect(backend.listOf(alice)).toEqual([[A.id]]) // saved already
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull() // result screen not yet
    expect(screen.getByRole('button', { name: 'Finish' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy()
  })

  it('Skip goes to the result screen and saves no review', async () => {
    const { user } = await open()
    await rankMovie(user, A)
    await user.type(await reviewBox(), 'Never mind')
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    expect(await screen.findByRole('button', { name: 'Rank another' })).toBeTruthy()
    expect(backend.reviews).toEqual([])
    expect(backend.listOf(alice)).toEqual([[A.id]])
  })

  it('Finish saves the review, with the spoiler flag, then shows the result screen', async () => {
    const { user } = await open()
    await rankMovie(user, A)
    await user.type(await reviewBox(), 'Stunning.')
    await user.click(screen.getByRole('checkbox', { name: 'Contains spoilers' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))

    expect(await screen.findByRole('button', { name: 'Rank another' })).toBeTruthy()
    expect(backend.reviews).toHaveLength(1)
    expect(backend.reviews[0]).toMatchObject({ user_id: alice.id, movie_id: A.tmdb_id, body: 'Stunning.', is_spoiler: true })
  })

  it('Finish with an empty or blank box saves nothing', async () => {
    const { user } = await open()
    await rankMovie(user, A)
    await user.type(await reviewBox(), '   ')
    await user.click(screen.getByRole('button', { name: 'Finish' }))

    expect(await screen.findByRole('button', { name: 'Rank another' })).toBeTruthy()
    expect(backend.reviews).toEqual([])
  })

  it('counts characters as you type and turns red near the limit', async () => {
    const { user } = await open()
    await rankMovie(user, A)
    const box = await reviewBox()
    const count = () => screen.getByText(/ \/ 2000$/)

    expect(count().textContent).toBe('0 / 2000')
    await user.type(box, 'Great')
    expect(count().textContent).toBe('5 / 2000')
    expect(count().classList.contains('is-near')).toBe(false)

    type(box, 'x'.repeat(1799))
    expect(count().classList.contains('is-near')).toBe(false)
    type(box, 'x'.repeat(1800))
    expect(count().textContent).toBe('1800 / 2000')
    expect(count().classList.contains('is-near')).toBe(true)
    expect(box.maxLength).toBe(2000)
  })

  it('blocks text the content check flags, and lets you fix it', async () => {
    const { user } = await open()
    await rankMovie(user, A)
    const box = await reviewBox()
    await user.type(box, 'just kys')
    await user.click(screen.getByRole('button', { name: 'Finish' }))

    expect((await screen.findByRole('alert')).textContent).toBe(FLAGGED)
    expect(backend.reviews).toEqual([])
    expect(screen.queryByRole('button', { name: 'Rank another' })).toBeNull() // still on the step
    expect(backend.callsTo('from:reviews:insert')).toHaveLength(0)

    // Typing again clears the message, and the fixed text goes through.
    type(box, 'Loved the score.')
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(await screen.findByRole('button', { name: 'Rank another' })).toBeTruthy()
    expect(backend.reviews.map((r) => r.body)).toEqual(['Loved the score.'])
  })

  it('keeps your text and says so when the save fails, and saves on retry', async () => {
    backend.failQuery('reviews', 'insert', 'boom', { times: 1 })
    const { user } = await open()
    await rankMovie(user, A)
    const box = await reviewBox()
    await user.type(box, 'Worth the hype.')
    await user.click(screen.getByRole('button', { name: 'Finish' }))

    expect((await screen.findByRole('alert')).textContent).toBe(SAVE_REVIEW_ERROR)
    expect(box.value).toBe('Worth the hype.')
    expect(backend.reviews).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(await screen.findByRole('button', { name: 'Rank another' })).toBeTruthy()
    expect(backend.reviews.map((r) => r.body)).toEqual(['Worth the hype.'])
  })

  it('is skipped when the ranking fails to save: you get the retry on the result screen', async () => {
    backend.failRpc('save_ranking', 'boom', { times: 1 })
    const { user } = await open()
    await rankMovie(user, A)

    expect((await screen.findByRole('alert')).textContent).toContain('boom')
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    // After the retry succeeds, the review step shows.
    expect(await screen.findByRole('heading', { name: `Add a review of ${A.title}?` })).toBeTruthy()
  })

  it('fills in an existing review when you rerank, and Finish updates it in place', async () => {
    backend.seedList(alice, [A.id, B.id])
    const review = backend.addReview(alice, A.id, { body: 'First thoughts.', isSpoiler: true })
    const { user } = await open()

    await waitFor(() => expect(screen.getByRole('button', { name: `Rerank ${A.title}` })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: `Rerank ${A.title}` }))
    await user.click(await screen.findByRole('button', { name: /^Not a fan/ })) // empty category: no comparisons

    const box = await reviewBox()
    await waitFor(() => expect(box.value).toBe('First thoughts.'))
    expect(screen.getByRole('checkbox', { name: 'Contains spoilers' }).checked).toBe(true)

    type(box, 'Second thoughts.')
    await user.click(screen.getByRole('checkbox', { name: 'Contains spoilers' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))

    expect(await screen.findByRole('button', { name: 'Done' })).toBeTruthy()
    expect(backend.reviews).toHaveLength(1)
    expect(backend.reviews[0]).toMatchObject({ id: review.id, body: 'Second thoughts.', is_spoiler: false })
  })

  it('clearing an existing review and pressing Finish leaves it alone', async () => {
    backend.seedList(alice, [A.id, B.id])
    backend.addReview(alice, A.id, { body: 'Keep me.' })
    const { user } = await open()

    await waitFor(() => expect(screen.getByRole('button', { name: `Rerank ${A.title}` })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: `Rerank ${A.title}` }))
    await user.click(await screen.findByRole('button', { name: /^Not a fan/ }))
    const box = await reviewBox()
    await waitFor(() => expect(box.value).toBe('Keep me.'))
    type(box, '')
    await user.click(screen.getByRole('button', { name: 'Finish' }))

    expect(await screen.findByRole('button', { name: 'Done' })).toBeTruthy()
    expect(backend.reviews.map((r) => r.body)).toEqual(['Keep me.'])
  })
})
