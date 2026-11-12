import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent } from '@testing-library/react'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, goTo, launch, ready, screen, waitFor, within } from './helpers/harness.js'

const DUNE = MOVIES.find((m) => m.id === 'dune-part-two-2024')

const LOAD_ERROR = "Couldn't load this review. Check your connection and try again."
const COMMENTS_ERROR = "Couldn't load the comments. Check your connection and try again."
const COMMENT_SAVE_ERROR = "Couldn't post your comment. Check your connection and try again."
const COMMENT_DELETE_ERROR = "Couldn't delete that comment. Check your connection and try again."
const FLAGGED = "That text can't be posted because it may break our community rules. Edit it and try again."

let backend
let alice // the viewer, unless a test says otherwise
let bob // public; wrote the review
let cara // public
let dave // private

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
  bob = backend.addUser({ username: 'bob' })
  cara = backend.addUser({ username: 'cara' })
  dave = backend.addUser({ username: 'dave', is_public: false })
  backend.seedList(bob, [DUNE.id])
})

const reviewHash = (review, username = 'bob') => `#/u/${username}/review/${review.id}`

async function open(hash, { as = alice } = {}) {
  const app = await launch({ backend, as, hash })
  await ready({ loggedIn: Boolean(as) })
  return app
}
// Opens bob's review and waits for the page itself.
async function openReview(review, options) {
  const app = await open(reviewHash(review), options)
  await screen.findByRole('heading', { level: 1, name: `Review of ${DUNE.title}` })
  return app
}
const comment = (name) => screen.getByRole('article', { name: `Comment by ${name}` })
const commentIn = (name) => within(comment(name))
const composer = () => screen.getByRole('textbox', { name: 'Add a comment' })
const type = (box, text) => fireEvent.change(box, { target: { value: text } })

describe('the discussion page', () => {
  it('shows the review, who wrote it and the comments', async () => {
    const review = backend.addReview(bob, DUNE.id, { body: 'A masterpiece of scale.' })
    backend.addComment(cara, review, { body: 'Totally agree.' })
    backend.addComment(alice, review, { body: 'Not for me.' })
    await openReview(review)

    expect(screen.getByText('A masterpiece of scale.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'bob' }).getAttribute('href')).toBe('#/u/bob')
    expect(await screen.findByRole('heading', { level: 2, name: 'Comments (2)' })).toBeTruthy()
    expect(commentIn('cara').getByText('Totally agree.')).toBeTruthy()
    expect(commentIn('Alice_99').getByText('Not for me.')).toBeTruthy()
    expect(commentIn('cara').getByRole('link', { name: 'cara' }).getAttribute('href')).toBe('#/u/cara')
    expect(commentIn('Alice_99').getByRole('link', { name: 'Alice_99' }).getAttribute('href')).toBe('#/profile')
  })

  it('says "you" when the review is yours', async () => {
    backend.seedList(alice, [DUNE.id])
    const review = backend.addReview(alice, DUNE.id, { body: 'Mine.' })
    await open(reviewHash(review, 'Alice_99'))
    await screen.findByRole('heading', { level: 1, name: `Review of ${DUNE.title}` })
    expect(screen.getByRole('link', { name: 'you' }).getAttribute('href')).toBe('#/profile')
  })

  it('blurs a spoiler review, like everywhere else', async () => {
    const review = backend.addReview(bob, DUNE.id, { body: 'The twist!', isSpoiler: true })
    await openReview(review)
    expect(screen.getByText('The twist!').classList.contains('is-blurred')).toBe(true)
  })

  it('says so when there are no comments yet', async () => {
    const review = backend.addReview(bob, DUNE.id)
    await openReview(review)
    expect(await screen.findByText(/No comments yet\. Be the first\./)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Comments' })).toBeTruthy()
  })

  it('marks edited comments', async () => {
    const review = backend.addReview(bob, DUNE.id)
    const edited = backend.addComment(cara, review, { body: 'Reworded.' })
    edited.updated_at = '2099-01-01T00:00:00.000Z'
    backend.addComment(alice, review, { body: 'Untouched.' })
    await openReview(review)

    await screen.findByText('Reworded.')
    expect(commentIn('cara').getByText('(edited)')).toBeTruthy()
    expect(commentIn('Alice_99').queryByText('(edited)')).toBeNull()
  })

  it('names commenters even when their own profile is private', async () => {
    const review = backend.addReview(bob, DUNE.id)
    backend.addComment(dave, review, { body: 'From a private profile.' })
    await openReview(review)
    expect(await screen.findByText('From a private profile.')).toBeTruthy()
    expect(commentIn('dave').getByRole('link', { name: 'dave' })).toBeTruthy()
  })

  it('shows the movie\'s score once the author has ranked enough movies', async () => {
    backend.seedList(bob, MOVIES.slice(1, 12).map((m) => m.id))
    const review = backend.addReview(bob, DUNE.id)
    await openReview(review)
    await waitFor(() => expect(document.querySelector('.rcard__score')).toBeTruthy())
  })

  it('opens the movie from the card', async () => {
    const review = backend.addReview(bob, DUNE.id)
    const { user } = await openReview(review)
    await user.click(screen.getByRole('button', { name: `Open ${DUNE.title}` }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })
})

describe('who can see a review', () => {
  it('says "not found" for a review that does not exist', async () => {
    await open('#/u/bob/review/00000000-0000-4000-8000-0000000000ff')
    expect(await screen.findByRole('heading', { level: 1, name: 'Review not found' })).toBeTruthy()
    expect(screen.getByText("This review doesn't exist, or it's on a private profile.")).toBeTruthy()
  })

  it('says the same for a private profile\'s review, so it does not give anything away', async () => {
    backend.seedList(dave, [DUNE.id])
    const review = backend.addReview(dave, DUNE.id, { body: 'Secret.' })
    await open(reviewHash(review, 'dave'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Review not found' })).toBeTruthy()
    expect(screen.queryByText('Secret.')).toBeNull()
  })

  it('is open to a friend of a private profile', async () => {
    backend.seedList(dave, [DUNE.id])
    const review = backend.addReview(dave, DUNE.id, { body: 'For friends.' })
    backend.addFriendship(alice, dave, 'accepted')
    await open(reviewHash(review, 'dave'))
    expect(await screen.findByText('For friends.')).toBeTruthy()
  })

  it('is readable without logging in, but only to read', async () => {
    const review = backend.addReview(bob, DUNE.id, { body: 'Public words.' })
    backend.addComment(cara, review, { body: 'A comment.' })
    const { user } = await open(reviewHash(review), { as: null })

    expect(await screen.findByText('Public words.')).toBeTruthy()
    expect(await screen.findByText('A comment.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Add a comment' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Report/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Reply/ })).toBeNull()

    const prompt = screen.getByText('Log in to join the discussion.').closest('.notice')
    await user.click(within(prompt).getByRole('button', { name: 'Log in' }))
    expect(window.location.hash).toBe('#/login')
  })

  it('does not show a private profile\'s review to someone logged out', async () => {
    backend.seedList(dave, [DUNE.id])
    const review = backend.addReview(dave, DUNE.id)
    await open(reviewHash(review, 'dave'), { as: null })
    expect(await screen.findByRole('heading', { level: 1, name: 'Review not found' })).toBeTruthy()
  })

  it('shows an error with a retry when the review will not load', async () => {
    const review = backend.addReview(bob, DUNE.id, { body: 'Eventually.' })
    backend.failQuery('reviews', 'select', 'boom', { times: 1 })
    const { user } = await open(reviewHash(review))

    const alert = await screen.findByText(LOAD_ERROR)
    await user.click(within(alert.closest('[role="alert"]')).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Eventually.')).toBeTruthy()
  })

  it('keeps the review and offers a retry when only the comments fail', async () => {
    const review = backend.addReview(bob, DUNE.id, { body: 'Still here.' })
    backend.addComment(cara, review, { body: 'Late comment.' })
    backend.failRpc('get_review_comments', 'boom', { times: 1 })
    const { user } = await open(reviewHash(review))

    const alert = await screen.findByText(COMMENTS_ERROR)
    expect(screen.getByText('Still here.')).toBeTruthy()
    await user.click(within(alert.closest('[role="alert"]')).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Late comment.')).toBeTruthy()
  })
})

describe('commenting', () => {
  let review
  beforeEach(() => {
    review = backend.addReview(bob, DUNE.id, { body: 'Review text.' })
    backend.addComment(cara, review, { body: 'First!' })
  })

  it('posts a comment under your name and clears the box', async () => {
    const { user } = await openReview(review)
    await screen.findByText('First!')
    expect(screen.getByText('0 / 2000')).toBeTruthy()

    await user.type(composer(), 'Great pick.')
    expect(screen.getByText('11 / 2000')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Comment' }))

    expect(await commentIn('Alice_99').findByText('Great pick.')).toBeTruthy()
    expect(composer().value).toBe('')
    expect(screen.getByRole('heading', { level: 2, name: 'Comments (2)' })).toBeTruthy()
    expect(backend.review_comments.map((c) => c.body)).toEqual(['First!', 'Great pick.'])
    expect(backend.review_comments[1]).toMatchObject({ user_id: alice.id, review_id: review.id, parent_id: null })
  })

  it('will not post an empty comment', async () => {
    const { user } = await openReview(review)
    await screen.findByText('First!')
    await user.type(composer(), '   ')
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Write something first.')
    expect(backend.review_comments).toHaveLength(1)
  })

  it('blocks text the content check flags, and posts it once fixed', async () => {
    const { user } = await openReview(review)
    await screen.findByText('First!')
    await user.type(composer(), 'just kys')
    await user.click(screen.getByRole('button', { name: 'Comment' }))

    expect((await screen.findByRole('alert')).textContent).toBe(FLAGGED)
    expect(backend.callsTo('from:review_comments:insert')).toHaveLength(0)
    type(composer(), 'Nice one.')
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    expect(await screen.findByText('Nice one.')).toBeTruthy()
  })

  it('keeps what you typed when posting fails, and posts on retry', async () => {
    backend.failQuery('review_comments', 'insert', 'boom', { times: 1 })
    const { user } = await openReview(review)
    await screen.findByText('First!')
    await user.type(composer(), 'Try me.')
    await user.click(screen.getByRole('button', { name: 'Comment' }))

    expect((await screen.findByRole('alert')).textContent).toBe(COMMENT_SAVE_ERROR)
    expect(composer().value).toBe('Try me.')
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    expect(await screen.findByText('Try me.', { selector: '.comment__body' })).toBeTruthy()
  })

  it('replies to a comment, one level deep', async () => {
    const { user } = await openReview(review)
    await screen.findByText('First!')
    await user.click(screen.getByRole('button', { name: 'Reply to cara' }))
    await user.type(screen.getByRole('textbox', { name: 'Reply to cara' }), 'Same here.')
    await user.click(screen.getByRole('button', { name: 'Reply' }))

    const replies = within(await screen.findByRole('list', { name: 'Replies to cara' }))
    expect(replies.getByText('Same here.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Reply to cara' })).toBeNull() // the box closes
    expect(backend.review_comments[1].parent_id).toBe(backend.review_comments[0].id)
    // A reply has no Reply button: replies can't have replies.
    expect(within(replies.getByRole('article', { name: 'Comment by Alice_99' })).queryByRole('button', { name: /^Reply/ })).toBeNull()
  })

  it('cancels a reply', async () => {
    const { user } = await openReview(review)
    await screen.findByText('First!')
    await user.click(screen.getByRole('button', { name: 'Reply to cara' }))
    await user.click(within(commentIn('cara').getByRole('textbox', { name: 'Reply to cara' }).closest('.composer')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Reply to cara' })).toBeNull()
    expect(backend.review_comments).toHaveLength(1)
  })

  it('shows replies under their comment, oldest first', async () => {
    const top = backend.review_comments[0]
    backend.addComment(bob, review, { body: 'Second reply', parentId: top.id })
    backend.review_comments[1].created_at = '2099-01-02T00:00:00.000Z'
    backend.addComment(alice, review, { body: 'First reply', parentId: top.id })
    backend.review_comments[2].created_at = '2099-01-01T00:00:00.000Z'
    await openReview(review)

    const replies = within(await screen.findByRole('list', { name: 'Replies to cara' }))
    expect(replies.getAllByRole('article').map((a) => a.querySelector('.comment__body').textContent)).toEqual(['First reply', 'Second reply'])
  })
})

describe('editing and deleting comments', () => {
  let review
  beforeEach(() => {
    review = backend.addReview(bob, DUNE.id, { body: 'Review text.' })
  })

  it('edits your own comment', async () => {
    backend.addComment(alice, review, { body: 'Before.' })
    const { user } = await openReview(review)
    await screen.findByText('Before.')
    await user.click(screen.getByRole('button', { name: 'Edit comment by Alice_99' }))

    const box = screen.getByRole('textbox', { name: 'Edit your comment' })
    expect(box.value).toBe('Before.')
    type(box, 'After.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('After.')).toBeTruthy()
    expect(backend.review_comments[0].body).toBe('After.')
    expect(commentIn('Alice_99').getByText('(edited)')).toBeTruthy()
  })

  it('blocks a flagged edit and keeps the original', async () => {
    backend.addComment(alice, review, { body: 'Fine.' })
    const { user } = await openReview(review)
    await screen.findByText('Fine.')
    await user.click(screen.getByRole('button', { name: 'Edit comment by Alice_99' }))
    type(screen.getByRole('textbox', { name: 'Edit your comment' }), 'kys')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('alert')).textContent).toBe(FLAGGED)
    expect(backend.review_comments[0].body).toBe('Fine.')
  })

  it('only offers Edit on your own comments', async () => {
    backend.addComment(cara, review, { body: 'Cara says.' })
    backend.addComment(alice, review, { body: 'Alice says.' })
    await openReview(review)
    await screen.findByText('Cara says.')
    expect(screen.queryByRole('button', { name: 'Edit comment by cara' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit comment by Alice_99' })).toBeTruthy()
  })

  it('deletes your own comment after asking', async () => {
    backend.addComment(alice, review, { body: 'Oops.' })
    const { user } = await openReview(review)
    await screen.findByText('Oops.')
    await user.click(screen.getByRole('button', { name: 'Delete comment by Alice_99' }))

    expect(screen.getByRole('alertdialog', { name: 'Delete comment' })).toBeTruthy()
    expect(backend.review_comments).toHaveLength(1)
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('Oops.')).toBeNull())
    expect(backend.review_comments).toEqual([])
  })

  it('can change its mind about deleting', async () => {
    backend.addComment(alice, review, { body: 'Keep.' })
    const { user } = await openReview(review)
    await screen.findByText('Keep.')
    await user.click(screen.getByRole('button', { name: 'Delete comment by Alice_99' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Keep.')).toBeTruthy()
    expect(backend.review_comments).toHaveLength(1)
  })

  it('deleting a comment removes its replies too, and says so', async () => {
    const top = backend.addComment(alice, review, { body: 'Top.' })
    backend.addComment(cara, review, { body: 'Reply.', parentId: top.id })
    const { user } = await openReview(review)
    await screen.findByText('Reply.')
    await user.click(screen.getByRole('button', { name: 'Delete comment by Alice_99' }))
    expect(screen.getByText('Delete this comment and its replies?')).toBeTruthy()
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('Top.')).toBeNull())
    expect(screen.queryByText('Reply.')).toBeNull()
    expect(backend.review_comments).toEqual([])
  })

  it('says it is only the one comment when deleting a reply', async () => {
    const top = backend.addComment(cara, review, { body: 'Top.' })
    backend.addComment(alice, review, { body: 'My reply.', parentId: top.id })
    const { user } = await openReview(review)
    await screen.findByText('My reply.')
    await user.click(screen.getByRole('button', { name: 'Delete comment by Alice_99' }))
    expect(screen.getByText('Delete this comment?')).toBeTruthy()
  })

  it('shows an error and keeps the comment when deleting fails', async () => {
    backend.addComment(alice, review, { body: 'Stuck.' })
    backend.failQuery('review_comments', 'delete', 'boom', { times: 1 })
    const { user } = await openReview(review)
    await screen.findByText('Stuck.')
    await user.click(screen.getByRole('button', { name: 'Delete comment by Alice_99' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))

    expect((await screen.findByRole('alert')).textContent).toBe(COMMENT_DELETE_ERROR)
    expect(screen.getByText('Stuck.')).toBeTruthy()
  })

  it('lets the review\'s author delete anyone\'s comment', async () => {
    backend.addComment(cara, review, { body: 'Rude words.' })
    const { user } = await openReview(review, { as: bob })
    await screen.findByText('Rude words.')
    expect(screen.queryByRole('button', { name: 'Edit comment by cara' })).toBeNull() // but not edit it
    await user.click(screen.getByRole('button', { name: 'Delete comment by cara' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('Rude words.')).toBeNull())
    expect(backend.review_comments).toEqual([])
  })

  it('does not offer Delete on other people\'s comments to anyone else', async () => {
    backend.addComment(cara, review, { body: 'Cara says.' })
    await openReview(review)
    await screen.findByText('Cara says.')
    expect(screen.queryByRole('button', { name: 'Delete comment by cara' })).toBeNull()
  })
})

describe('reporting', () => {
  let review
  beforeEach(() => {
    review = backend.addReview(bob, DUNE.id, { body: 'Review text.' })
  })

  it('reports a review with a reason', async () => {
    const { user } = await openReview(review)
    await user.click(screen.getByRole('button', { name: 'Report review' }))
    await user.type(screen.getByRole('textbox', { name: 'Why are you reporting this review?' }), 'It is spam.')
    await user.click(screen.getByRole('button', { name: 'Send report' }))

    expect(await screen.findByText("Reported. Thanks, we'll take a look.")).toBeTruthy()
    expect(backend.reports).toEqual([expect.objectContaining({ reporter_id: alice.id, target_type: 'review', target_id: review.id, reason: 'It is spam.' })])
  })

  it('reports a comment with a reason', async () => {
    const reported = backend.addComment(cara, review, { body: 'Nasty.' })
    const { user } = await openReview(review)
    await screen.findByText('Nasty.')
    await user.click(screen.getByRole('button', { name: 'Report comment by cara' }))
    await user.type(screen.getByRole('textbox', { name: 'Why are you reporting this comment?' }), 'Abusive.')
    await user.click(screen.getByRole('button', { name: 'Send report' }))

    expect(await screen.findByText("Reported. Thanks, we'll take a look.")).toBeTruthy()
    expect(backend.reports).toEqual([expect.objectContaining({ target_type: 'comment', target_id: reported.id, reason: 'Abusive.' })])
  })

  it('needs a reason', async () => {
    const { user } = await openReview(review)
    await user.click(screen.getByRole('button', { name: 'Report review' }))
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Tell us what is wrong first.')
    expect(backend.reports).toEqual([])
  })

  it('can be cancelled', async () => {
    const { user } = await openReview(review)
    await user.click(screen.getByRole('button', { name: 'Report review' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Report review' })).toBeTruthy()
    expect(backend.reports).toEqual([])
  })

  it('says so when you already reported it', async () => {
    backend.reports.push({ id: 'x', reporter_id: alice.id, target_type: 'review', target_id: review.id, reason: 'Before', created_at: backend.now() })
    const { user } = await openReview(review)
    await user.click(screen.getByRole('button', { name: 'Report review' }))
    await user.type(screen.getByRole('textbox', { name: 'Why are you reporting this review?' }), 'Again.')
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    expect((await screen.findByRole('alert')).textContent).toBe("You've already reported that.")
  })

  it('does not let you report your own review or comments', async () => {
    backend.seedList(alice, [DUNE.id])
    const mine = backend.addReview(alice, DUNE.id, { body: 'Mine.' })
    backend.addComment(alice, mine, { body: 'My own comment.' })
    await open(reviewHash(mine, 'Alice_99'))
    await screen.findByText('My own comment.')
    expect(screen.queryByRole('button', { name: /^Report/ })).toBeNull()
  })
})

describe('your own review on its page', () => {
  let review
  beforeEach(() => {
    backend.seedList(alice, [DUNE.id])
    review = backend.addReview(alice, DUNE.id, { body: 'Before.' })
  })

  const openMine = async () => {
    const app = await open(reviewHash(review, 'Alice_99'))
    await screen.findByRole('heading', { level: 1, name: `Review of ${DUNE.title}` })
    return app
  }

  it('can be edited from the page', async () => {
    const { user } = await openMine()
    await user.click(screen.getByRole('button', { name: 'Review options' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    type(screen.getByRole('textbox', { name: 'Edit your review' }), 'After.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('After.')).toBeTruthy()
    expect(backend.reviews[0].body).toBe('After.')
  })

  it('can be deleted from the page, which leaves for your profile', async () => {
    backend.addComment(bob, review, { body: 'A comment.' })
    const { user } = await openMine()
    await user.click(screen.getByRole('button', { name: 'Review options' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(window.location.hash).toBe('#/profile'))
    expect(backend.reviews).toEqual([])
    expect(backend.review_comments).toEqual([]) // the comments went with it
  })
})

describe('the back button', () => {
  it('goes to the author\'s profile when the page was opened directly', async () => {
    const review = backend.addReview(bob, DUNE.id)
    const { user } = await openReview(review)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(window.location.hash).toBe('#/u/bob')
    expect(await screen.findByRole('heading', { level: 1, name: 'bob' })).toBeTruthy()
  })

  it('goes to your own profile for your own review opened directly', async () => {
    backend.seedList(alice, [DUNE.id])
    const review = backend.addReview(alice, DUNE.id)
    const { user } = await open(reviewHash(review, 'Alice_99'))
    await user.click(await screen.findByRole('button', { name: 'Back' }))
    expect(window.location.hash).toBe('#/profile')
  })

  it('returns to the page you came from, via the browser history', async () => {
    const review = backend.addReview(bob, DUNE.id, { body: 'Come back from here.' })
    backend.addComment(cara, review)
    const { user } = await open('#/u/bob')
    await user.click(await screen.findByRole('link', { name: 'See 1 comment' }))
    await screen.findByRole('heading', { level: 1, name: `Review of ${DUNE.title}` })
    expect(window.location.hash).toBe(reviewHash(review))

    await user.click(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => expect(window.location.hash).toBe('#/u/bob'))
    expect(await screen.findByRole('heading', { level: 1, name: 'bob' })).toBeTruthy()
  })

  it('also works with the browser\'s own back button', async () => {
    const review = backend.addReview(bob, DUNE.id)
    const { user } = await open('#/u/bob')
    await user.click(await screen.findByRole('link', { name: 'Comment' }))
    await screen.findByRole('heading', { level: 1, name: `Review of ${DUNE.title}` })

    window.history.back()

    await waitFor(() => expect(window.location.hash).toBe('#/u/bob'))
    expect(await screen.findByRole('heading', { level: 1, name: 'bob' })).toBeTruthy()
    expect(review).toBeTruthy()
  })

  it('works from the "not found" page too', async () => {
    const { user } = await open('#/u/bob/review/00000000-0000-4000-8000-0000000000ff')
    await screen.findByRole('heading', { level: 1, name: 'Review not found' })
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(window.location.hash).toBe('#/home')
  })
})

describe('links to the discussion from the profile', () => {
  it('shows "Comment" on someone else\'s review with no comments, and counts them otherwise', async () => {
    backend.seedList(bob, [DUNE.id, MOVIES[1].id])
    const quiet = backend.addReview(bob, DUNE.id, { body: 'Quiet.' })
    const busy = backend.addReview(bob, MOVIES[1].id, { body: 'Busy.' })
    backend.addComment(cara, busy)
    backend.addComment(alice, busy)
    await open('#/u/bob')

    expect((await screen.findByRole('link', { name: 'Comment' })).getAttribute('href')).toBe(reviewHash(quiet))
    expect(screen.getByRole('link', { name: 'See 2 comments' }).getAttribute('href')).toBe(reviewHash(busy))
  })

  it('hides it on your own review until someone comments', async () => {
    backend.seedList(alice, [DUNE.id, MOVIES[1].id])
    backend.addReview(alice, DUNE.id, { body: 'Mine, quiet.' })
    const busy = backend.addReview(alice, MOVIES[1].id, { body: 'Mine, busy.' })
    backend.addComment(bob, busy)
    await open('#/profile')

    expect(await screen.findByRole('link', { name: 'See 1 comment' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Comment' })).toBeNull()
  })

  it('does not show it for a movie without a review', async () => {
    await open('#/u/bob')
    await goTo('#/u/bob')
    expect(screen.queryByRole('link', { name: /comment/i })).toBeNull()
  })
})
