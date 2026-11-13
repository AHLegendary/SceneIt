// Movie Blend recommendations end to end: the blend page asks the real
// /api/blends/recommendations handler, which reads members' rankings from the
// fake database with the service role and asks the fake TMDb for discoveries.

import { beforeEach, describe, expect, it } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, launch, ready, screen, waitFor, within } from './helpers/harness.js'

const [A, B, C, D, E] = MOVIES.slice(0, 5).map((m) => m.id)
const title = (id) => MOVIES.find((m) => m.id === id).title
const tmdbId = (id) => MOVIES.find((m) => m.id === id).tmdb_id

let backend
let alice
let bob
let blendId

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99' })
  bob = backend.addUser({ username: 'bob' })
  backend.addFriendship(alice, bob)
  // Both loved A; Alice loved B, Bob marked it "Not a fan"; one loves C, the other D.
  backend.seedList(alice, [A, B, C])
  backend.seedList(bob, [A, D, { movie: B, category: 'meh' }])
  blendId = backend.addBlend(alice, [bob])
})

async function openBlend(as = alice, id = blendId) {
  const app = await launch({ backend, as, hash: `#/blends/${id}` })
  await ready({ loggedIn: true })
  return app
}
const recs = () => within(screen.getByRole('region', { name: 'Recommendations' }))
// [{ title, meta }] for each recommendation card, in order.
const cards = () =>
  recs()
    .queryAllByRole('button')
    .map((b) => ({ title: b.querySelector('.rec__title').textContent, meta: b.querySelector('.rec__meta').textContent }))

describe('blend recommendations', () => {
  it("suggests movies someone loved that someone else hasn't ranked, with group-level labels", async () => {
    await openBlend()

    await waitFor(() => expect(cards().length).toBe(2))
    expect(cards()).toEqual(
      expect.arrayContaining([
        { title: title(C), meta: 'Loved by 1 of 2' },
        { title: title(D), meta: 'Loved by 1 of 2' },
      ]),
    )
  })

  it('leaves out movies everyone already ranked', async () => {
    await openBlend()
    await waitFor(() => expect(cards().length).toBeGreaterThan(0))
    expect(cards().map((c) => c.title)).not.toContain(title(A))
  })

  it('leaves out a movie the group would otherwise pick if anyone marked it "Not a fan"', async () => {
    // Two of four loved E and Alice hasn't ranked it, so it would score well, but Erin vetoes it.
    const [cara, dave, erin] = ['cara', 'dave', 'erin'].map((username) => backend.addUser({ username }))
    backend.seedList(cara, [E])
    backend.seedList(dave, [E])
    backend.seedList(erin, [{ movie: D, category: 'meh' }, { movie: E, category: 'meh' }])
    const group = backend.addBlend(alice, [cara, dave, erin])
    await openBlend(alice, group)

    await waitFor(() => expect(cards().map((c) => c.title)).toContain(title(C)))
    expect(cards().map((c) => c.title)).not.toContain(title(E))
  })

  it("discovers a movie nobody ranked from TMDb's picks for a group favorite", async () => {
    const pick = backend.addTmdbMovie({ id: 960001, title: 'Gnu Gone Wild', year: 2023, vote_count: 9000 })
    backend.setTmdbRecommendations(tmdbId(A), [pick])
    await openBlend()

    await waitFor(() => expect(cards().map((c) => c.title)).toContain('Gnu Gone Wild'))
    expect(cards().find((c) => c.title === 'Gnu Gone Wild').meta).toBe(`Like ${title(A)}, a group favorite`)
  })

  it('never names a member on a recommendation', async () => {
    const pick = backend.addTmdbMovie({ id: 960001, title: 'Gnu Gone Wild', year: 2023, vote_count: 9000 })
    backend.setTmdbRecommendations(tmdbId(A), [pick])
    await openBlend()
    await waitFor(() => expect(cards().length).toBe(3))

    for (const { meta } of cards()) {
      expect(meta).not.toMatch(/Alice_99|bob/)
    }
  })

  it("still suggests from members' lists when TMDb is down", async () => {
    backend.tmdb.down = true
    await openBlend()
    await waitFor(() => expect(cards().map((c) => c.title).sort()).toEqual([title(C), title(D)].sort()))
  })

  it('waits for a second member before suggesting anything', async () => {
    const solo = backend.addBlend(alice)
    await openBlend(alice, solo)
    expect(await screen.findByText('Recommendations appear once a friend joins this blend.')).toBeTruthy()
  })

  it("says so when the group has nothing new to suggest", async () => {
    const cara = backend.addUser({ username: 'cara' })
    backend.seedList(cara, [A, { movie: E, category: 'okay' }])
    const same = backend.addBlend(alice, [cara])
    backend.seedList(alice, [E])
    // Alice's B and C: Cara hasn't ranked them, so they would show. Veto them.
    backend.seedList(cara, [{ movie: B, category: 'meh' }, { movie: C, category: 'meh' }])
    await openBlend(alice, same)

    expect(await screen.findByText(/Not enough ranking data yet/)).toBeTruthy()
  })

  it('offers a retry when recommendations fail to load', async () => {
    backend.failApi('GET /api/blends/recommendations', { status: 500, body: { error: 'boom' } }, { times: 1 })
    const { user } = await openBlend()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Couldn't load this blend.")
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(cards().length).toBe(2))
  })

  it("sends someone who isn't in the blend back to Movie Blend", async () => {
    const cara = backend.addUser({ username: 'cara' })
    await openBlend(cara)

    await waitFor(() => expect(window.location.hash).toBe('#/blends'))
    expect(await screen.findByText('That blend no longer exists.')).toBeTruthy()
  })
})
