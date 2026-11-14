// The fake backend stands in for Supabase in every other integration test, so
// these pin it to what the migrations in supabase/migrations say. If you change
// a SQL function or policy, change the fake and these tests with it.
import { describe, expect, it, beforeEach, vi } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, OMDB_KEY, PUBLISHABLE_KEY, SERVICE_KEY, SUPABASE_URL, TMDB_TOKEN } from './helpers/fakeBackend.js'

let b
let alice
let bob
let cara

// A client logged in as `user`, like the browser's (separate from the app's).
async function clientFor(user) {
  const client = b.createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password })
  expect(error).toBeNull()
  return client
}

const tmdb = (id) => b.catalog(id).tmdb_id
const save = (client, id, category, position, tied = false) =>
  client.rpc('save_ranking', { p_movie_id: tmdb(id), p_category: category, p_position: position, p_tied: tied })

beforeEach(() => {
  b = new FakeBackend()
  alice = b.addUser({ username: 'alice' })
  bob = b.addUser({ username: 'bob' })
  cara = b.addUser({ username: 'cara', is_public: false })
})

describe('save_ranking', () => {
  it('puts the first movie at position 0', async () => {
    const client = await clientFor(alice)
    expect((await save(client, 'inception-2010', 'loved', 0)).error).toBeNull()
    expect(b.listOf(alice)).toEqual([['inception-2010']])
  })

  it('inserts above existing movies and shifts the rest down', async () => {
    const client = await clientFor(alice)
    await save(client, 'inception-2010', 'loved', 0)
    await save(client, 'interstellar-2014', 'loved', 0)
    expect(b.listOf(alice)).toEqual([['interstellar-2014'], ['inception-2010']])
  })

  it('keeps categories in order: loved, then okay, then meh', async () => {
    const client = await clientFor(alice)
    await save(client, 'inception-2010', 'meh', 0)
    await save(client, 'interstellar-2014', 'loved', 0)
    await save(client, 'the-dark-knight-2008', 'okay', 0)
    expect(b.listOf(alice)).toEqual([['interstellar-2014'], ['the-dark-knight-2008'], ['inception-2010']])
    expect(b.rankingOf(alice, tmdb('the-dark-knight-2008')).category).toBe('okay')
  })

  it('treats the position as relative to the category and clamps it to the end', async () => {
    const client = await clientFor(alice)
    await save(client, 'inception-2010', 'loved', 0)
    await save(client, 'interstellar-2014', 'loved', 99)
    expect(b.listOf(alice)).toEqual([['inception-2010'], ['interstellar-2014']])
  })

  it('ties a movie with the one already at that position', async () => {
    const client = await clientFor(alice)
    await save(client, 'inception-2010', 'loved', 0)
    await save(client, 'interstellar-2014', 'loved', 0, true)
    expect(b.listOf(alice)).toHaveLength(1)
    expect(b.listOf(alice)[0].sort()).toEqual(['inception-2010', 'interstellar-2014'])
  })

  it('moves an already ranked movie and closes the gap it left', async () => {
    const client = await clientFor(alice)
    await save(client, 'inception-2010', 'loved', 0)
    await save(client, 'interstellar-2014', 'loved', 1)
    await save(client, 'the-dark-knight-2008', 'loved', 2)
    await save(client, 'inception-2010', 'loved', 2)
    expect(b.listOf(alice)).toEqual([['interstellar-2014'], ['the-dark-knight-2008'], ['inception-2010']])
  })

  it('moves a movie between categories', async () => {
    const client = await clientFor(alice)
    await save(client, 'inception-2010', 'loved', 0)
    await save(client, 'interstellar-2014', 'loved', 1)
    await save(client, 'inception-2010', 'meh', 0)
    expect(b.listOf(alice)).toEqual([['interstellar-2014'], ['inception-2010']])
    expect(b.rankingOf(alice, tmdb('inception-2010')).category).toBe('meh')
  })

  it('keeps the original created_at when a movie is re-ranked', async () => {
    const client = await clientFor(alice)
    await save(client, 'inception-2010', 'loved', 0)
    const first = b.rankingOf(alice, tmdb('inception-2010')).created_at
    await save(client, 'inception-2010', 'okay', 0)
    expect(b.rankingOf(alice, tmdb('inception-2010')).created_at).toBe(first)
  })

  it('only changes the caller\'s own list', async () => {
    const a = await clientFor(alice)
    const bo = await clientFor(bob)
    await save(a, 'inception-2010', 'loved', 0)
    await save(bo, 'interstellar-2014', 'loved', 0)
    expect(b.listOf(alice)).toEqual([['inception-2010']])
    expect(b.listOf(bob)).toEqual([['interstellar-2014']])
  })

  it('rejects a bad category, a negative position, an unknown movie, and a logged-out caller', async () => {
    const client = await clientFor(alice)
    expect((await save(client, 'inception-2010', 'great', 0)).error.message).toMatch(/category/i)
    expect((await save(client, 'inception-2010', 'loved', -1)).error.message).toMatch(/position/i)
    expect((await client.rpc('save_ranking', { p_movie_id: 999999999, p_category: 'loved', p_position: 0 })).error.message).toMatch(/foreign key/i)

    const anon = b.createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } })
    expect((await save(anon, 'inception-2010', 'loved', 0)).error.message).toMatch(/not signed in/i)
  })
})

describe('remove_ranking', () => {
  it('removes a movie and closes the gap', async () => {
    const client = await clientFor(alice)
    b.seedList(alice, ['inception-2010', 'interstellar-2014', 'the-dark-knight-2008'])
    await client.rpc('remove_ranking', { p_movie_id: tmdb('interstellar-2014') })
    expect(b.listOf(alice)).toEqual([['inception-2010'], ['the-dark-knight-2008']])
  })

  it('leaves the other movie in a tie where it is', async () => {
    const client = await clientFor(alice)
    b.seedList(alice, ['inception-2010', { movie: 'interstellar-2014', tied: true }, 'the-dark-knight-2008'])
    await client.rpc('remove_ranking', { p_movie_id: tmdb('inception-2010') })
    expect(b.listOf(alice)).toEqual([['interstellar-2014'], ['the-dark-knight-2008']])
  })

  it('does nothing for a movie that isn\'t ranked', async () => {
    const client = await clientFor(alice)
    expect((await client.rpc('remove_ranking', { p_movie_id: tmdb('inception-2010') })).error).toBeNull()
  })
})

describe('friend requests', () => {
  it('sends a request, then reports it as already sent', async () => {
    const client = await clientFor(alice)
    expect((await client.rpc('send_friend_request', { p_user_id: bob.id })).data).toBe('sent')
    expect((await client.rpc('send_friend_request', { p_user_id: bob.id })).data).toBe('already_sent')
  })

  it('accepts when the other person had already asked', async () => {
    const a = await clientFor(alice)
    const bo = await clientFor(bob)
    await a.rpc('send_friend_request', { p_user_id: bob.id })
    expect((await bo.rpc('send_friend_request', { p_user_id: alice.id })).data).toBe('accepted')
    expect((await a.rpc('send_friend_request', { p_user_id: bob.id })).data).toBe('already_friends')
  })

  it('refuses yourself and unknown users', async () => {
    const client = await clientFor(alice)
    expect((await client.rpc('send_friend_request', { p_user_id: alice.id })).error.message).toMatch(/yourself/i)
    expect((await client.rpc('send_friend_request', { p_user_id: b.id() })).error.message).toMatch(/not found/i)
  })

  it('lists friendships with the right direction for each side', async () => {
    b.addFriendship(alice, bob, 'pending') // alice asked bob
    b.addFriendship(cara, alice, 'accepted')
    const a = await clientFor(alice)
    const bo = await clientFor(bob)
    const mine = (await a.rpc('get_friendships')).data
    expect(mine.find((f) => f.username === 'bob').direction).toBe('outgoing')
    expect(mine.find((f) => f.username === 'cara').direction).toBe('friends')
    expect((await bo.rpc('get_friendships')).data[0]).toMatchObject({ username: 'alice', direction: 'incoming' })
  })
})

describe('search_users', () => {
  it('matches the start of a username, ignoring case, and needs two characters', async () => {
    b.addUser({ username: 'Albert' })
    const client = await clientFor(bob)
    expect((await client.rpc('search_users', { q: 'al' })).data.map((u) => u.username)).toEqual(['alice', 'Albert'].sort((x, y) => x.localeCompare(y)))
    expect((await client.rpc('search_users', { q: 'a' })).data).toEqual([])
    expect((await client.rpc('search_users', { q: 'zz' })).data).toEqual([])
  })

  it('finds private users too (it only returns id and username)', async () => {
    const client = await clientFor(alice)
    expect((await client.rpc('search_users', { q: 'ca' })).data).toEqual([{ id: cara.id, username: 'cara' }])
  })

  it('returns nothing when logged out', async () => {
    const anon = b.createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } })
    expect((await anon.rpc('search_users', { q: 'al' })).data).toEqual([])
  })
})

describe('row level security', () => {
  it('shows public profiles to everyone, including logged-out visitors', async () => {
    const anon = b.createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } })
    const { data } = await anon.from('profiles').select('username').eq('id', alice.id).maybeSingle()
    expect(data).toEqual({ username: 'alice' })
  })

  it('hides a private profile from strangers and logged-out visitors, but not from the owner or friends', async () => {
    const anon = b.createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } })
    const hidden = async (client) => (await client.from('profiles').select('username').eq('id', cara.id).maybeSingle()).data
    expect(await hidden(anon)).toBeNull()
    expect(await hidden(await clientFor(alice))).toBeNull()
    expect(await hidden(await clientFor(cara))).toEqual({ username: 'cara' })

    b.addFriendship(alice, cara, 'accepted')
    expect(await hidden(await clientFor(alice))).toEqual({ username: 'cara' })
  })

  it('does not count a pending request as friendship', async () => {
    b.addFriendship(alice, cara, 'pending')
    const client = await clientFor(alice)
    expect((await client.from('profiles').select('username').eq('id', cara.id).maybeSingle()).data).toBeNull()
  })

  it('applies the same rule to rankings', async () => {
    b.seedList(cara, ['inception-2010'])
    b.seedList(alice, ['interstellar-2014'])
    const bo = await clientFor(bob)
    const read = async (client, user) =>
      (await client.from('rankings').select('movie_id, position, movies(title)').eq('user_id', user.id)).data
    expect(await read(bo, cara)).toEqual([])
    expect(await read(bo, alice)).toEqual([{ movie_id: tmdb('interstellar-2014'), position: 0, movies: { title: b.catalog('interstellar-2014').title } }])
  })

  it('lets you update only your own profile, and enforces the length limits', async () => {
    const client = await clientFor(alice)
    const own = await client.from('profiles').update({ bio: 'Hi' }).eq('id', alice.id).select('bio').single()
    expect(own.data).toEqual({ bio: 'Hi' })

    const other = await client.from('profiles').update({ bio: 'Hacked' }).eq('id', bob.id).select('bio').single()
    expect(other.error.code).toBe('PGRST116')
    expect(b.profileOf(bob).bio).toBeNull()

    const tooLong = await client.from('profiles').update({ bio: 'x'.repeat(301) }).eq('id', alice.id)
    expect(tooLong.error.message).toMatch(/check constraint/)
  })

  it('only lets the addressee accept a friend request', async () => {
    b.addFriendship(alice, bob, 'pending')
    const a = await clientFor(alice)
    const bo = await clientFor(bob)
    const byRequester = await a.from('friendships').update({ status: 'accepted' }).eq('requester_id', alice.id).eq('addressee_id', bob.id).select('requester_id')
    expect(byRequester.data).toEqual([])
    const byAddressee = await bo.from('friendships').update({ status: 'accepted' }).eq('requester_id', alice.id).eq('addressee_id', bob.id).select('requester_id')
    expect(byAddressee.data).toEqual([{ requester_id: alice.id }])
  })

  it('lets either side delete a friendship, and nobody else', async () => {
    b.addFriendship(alice, bob, 'accepted')
    const pair = `and(requester_id.eq.${alice.id},addressee_id.eq.${bob.id}),and(requester_id.eq.${bob.id},addressee_id.eq.${alice.id})`
    const stranger = await clientFor(cara)
    await stranger.from('friendships').delete().or(pair)
    expect(b.friendships).toHaveLength(1)
    const bo = await clientFor(bob)
    await bo.from('friendships').delete().or(pair)
    expect(b.friendships).toHaveLength(0)
  })

  it('only lets the service role write to movies', async () => {
    const client = await clientFor(alice)
    const row = { tmdb_id: 123, title: 'X', year: 2020, poster_path: null, genres: [], overview: '' }
    expect((await client.from('movies').upsert(row, { onConflict: 'tmdb_id' }).select().single()).error.code).toBe('42501')
    const admin = b.createClient(SUPABASE_URL, SERVICE_KEY)
    expect((await admin.from('movies').upsert(row, { onConflict: 'tmdb_id' }).select().single()).data.tmdb_id).toBe(123)
  })

  it('treats "_" in a username literally when escaped, like escapeLike does', async () => {
    b.addUser({ username: 'a_c' })
    b.addUser({ username: 'abc' })
    const admin = b.createClient(SUPABASE_URL, SERVICE_KEY)
    const found = await admin.from('profiles').select('username').ilike('username', 'a\\_c')
    expect(found.data).toEqual([{ username: 'a_c' }])
  })
})

describe('reviews', () => {
  const DUNE = 'dune-part-two-2024'
  const INCEPTION = 'inception-2010'

  const insertReview = (client, user, id, body = 'Great') =>
    client.from('reviews').insert({ user_id: user.id, movie_id: tmdb(id), body, is_spoiler: false }).select('*').single()

  it('can be written for a movie you have ranked, by you', async () => {
    b.seedList(alice, [DUNE])
    const client = await clientFor(alice)
    const { data, error } = await insertReview(client, alice, DUNE)
    expect(error).toBeNull()
    expect(data).toMatchObject({ user_id: alice.id, movie_id: tmdb(DUNE), body: 'Great', is_spoiler: false })
    expect(b.reviews).toHaveLength(1)
  })

  it('is refused for a movie you have not ranked, or as someone else', async () => {
    b.seedList(alice, [DUNE])
    b.seedList(bob, [INCEPTION])
    const client = await clientFor(alice)
    expect((await insertReview(client, alice, INCEPTION)).error.code).toBe('42501')
    expect((await insertReview(client, bob, INCEPTION)).error.code).toBe('42501')
    expect(b.reviews).toEqual([])
  })

  it('allows one review per user and movie, and 1 to 2000 characters', async () => {
    b.seedList(alice, [DUNE])
    const client = await clientFor(alice)
    await insertReview(client, alice, DUNE)
    expect((await insertReview(client, alice, DUNE, 'Again')).error.code).toBe('23505')
    b.reviews.length = 0
    expect((await insertReview(client, alice, DUNE, '')).error.code).toBe('23514')
    expect((await insertReview(client, alice, DUNE, 'a'.repeat(2001))).error.code).toBe('23514')
    expect((await insertReview(client, alice, DUNE, 'a'.repeat(2000))).error).toBeNull()
  })

  it('follows profile privacy: public, own and friends can read; strangers cannot', async () => {
    b.seedList(cara, [DUNE])
    b.addReview(cara, DUNE, { body: 'Private thoughts' })
    b.seedList(bob, [INCEPTION])
    b.addReview(bob, INCEPTION, { body: 'Public thoughts' })

    const asAlice = await clientFor(alice)
    const seen = (await asAlice.from('reviews').select('body')).data.map((r) => r.body)
    expect(seen).toEqual(['Public thoughts']) // cara is private and not a friend

    b.addFriendship(alice, cara)
    expect((await asAlice.from('reviews').select('body')).data.map((r) => r.body).sort()).toEqual(['Private thoughts', 'Public thoughts'])

    const asCara = await clientFor(cara)
    expect((await asCara.from('reviews').select('body')).data.map((r) => r.body).sort()).toEqual(['Private thoughts', 'Public thoughts'])
  })

  it('lets only the author edit, and only the text and spoiler flag', async () => {
    b.seedList(alice, [DUNE])
    const review = b.addReview(alice, DUNE, { body: 'Before' })
    const asAlice = await clientFor(alice)
    const asBob = await clientFor(bob)

    const edited = await asAlice.from('reviews').update({ body: 'After', is_spoiler: true }).eq('id', review.id).select('*')
    expect(edited.data).toHaveLength(1)
    expect(edited.data[0]).toMatchObject({ body: 'After', is_spoiler: true })
    expect(edited.data[0].updated_at > edited.data[0].created_at).toBe(true)

    expect((await asBob.from('reviews').update({ body: 'Hijacked' }).eq('id', review.id).select('*')).data).toEqual([])
    expect((await asAlice.from('reviews').update({ movie_id: 1 }).eq('id', review.id).select('*')).error.code).toBe('42501')
    expect(b.reviews[0].body).toBe('After')
  })

  it('lets only the author delete', async () => {
    b.seedList(alice, [DUNE])
    const review = b.addReview(alice, DUNE)
    const asBob = await clientFor(bob)
    await asBob.from('reviews').delete().eq('id', review.id)
    expect(b.reviews).toHaveLength(1)
    const asAlice = await clientFor(alice)
    await asAlice.from('reviews').delete().eq('id', review.id)
    expect(b.reviews).toEqual([])
  })

  it('is deleted when the movie is un-ranked (remove_ranking)', async () => {
    b.seedList(alice, [DUNE, INCEPTION])
    b.addReview(alice, DUNE)
    b.addReview(alice, INCEPTION)
    const client = await clientFor(alice)
    await client.rpc('remove_ranking', { p_movie_id: tmdb(DUNE) })
    expect(b.reviews.map((r) => r.movie_id)).toEqual([tmdb(INCEPTION)])
  })
})

describe('review comments', () => {
  const DUNE = 'dune-part-two-2024'
  let review

  // alice's public review; bob and cara can see it (cara is private, but the review isn't hers)
  beforeEach(() => {
    b.seedList(alice, [DUNE])
    review = b.addReview(alice, DUNE, { body: 'Thoughts.' })
  })

  const comment = (client, user, body = 'Agreed', parentId = null) =>
    client.from('review_comments').insert({ review_id: review.id, user_id: user.id, parent_id: parentId, body }).select('*').single()

  it('can be written as yourself on a review you can see', async () => {
    const asBob = await clientFor(bob)
    const { data, error } = await comment(asBob, bob)
    expect(error).toBeNull()
    expect(data).toMatchObject({ review_id: review.id, user_id: bob.id, parent_id: null, body: 'Agreed' })
    expect((await comment(asBob, alice)).error.code).toBe('42501') // as someone else
  })

  it('cannot be written on a review you cannot see', async () => {
    b.seedList(cara, [DUNE])
    const hidden = b.addReview(cara, DUNE) // cara is private
    const asBob = await clientFor(bob)
    const { error } = await asBob.from('review_comments').insert({ review_id: hidden.id, user_id: bob.id, body: 'Hi' })
    expect(error.code).toBe('42501')
  })

  it('takes 1 to 2000 characters', async () => {
    const asBob = await clientFor(bob)
    expect((await comment(asBob, bob, '')).error.code).toBe('23514')
    expect((await comment(asBob, bob, 'a'.repeat(2001))).error.code).toBe('23514')
    expect((await comment(asBob, bob, 'a'.repeat(2000))).error).toBeNull()
  })

  it('allows one level of replies and refuses replies to replies', async () => {
    const asBob = await clientFor(bob)
    const top = (await comment(asBob, bob, 'Top')).data
    const reply = await comment(asBob, bob, 'Reply', top.id)
    expect(reply.error).toBeNull()
    expect((await comment(asBob, bob, 'Reply to reply', reply.data.id)).error.code).toBe('23514')
    expect((await comment(asBob, bob, 'Orphan', '00000000-0000-4000-8000-0000000000ff')).error.code).toBe('23503')
  })

  it('refuses a reply that points at a comment on another review', async () => {
    b.seedList(bob, [DUNE])
    const other = b.addReview(bob, DUNE)
    const elsewhere = b.addComment(bob, other, { body: 'Elsewhere' })
    const asBob = await clientFor(bob)
    expect((await comment(asBob, bob, 'Cross', elsewhere.id)).error.code).toBe('23514')
  })

  it('lets only the commenter edit, and only the body', async () => {
    const mine = b.addComment(bob, review, { body: 'Before' })
    const asBob = await clientFor(bob)
    const asAlice = await clientFor(alice)

    const edited = await asBob.from('review_comments').update({ body: 'After' }).eq('id', mine.id).select('*')
    expect(edited.data[0].body).toBe('After')
    expect(edited.data[0].updated_at > edited.data[0].created_at).toBe(true)
    expect((await asAlice.from('review_comments').update({ body: 'Hijack' }).eq('id', mine.id).select('*')).data).toEqual([])
    expect((await asBob.from('review_comments').update({ review_id: 'x' }).eq('id', mine.id).select('*')).error.code).toBe('42501')
  })

  it('lets the commenter or the review author delete, and nobody else', async () => {
    const byBob = b.addComment(bob, review)
    const byBob2 = b.addComment(bob, review)
    const asCara = await clientFor(cara)
    await asCara.from('review_comments').delete().eq('id', byBob.id)
    expect(b.review_comments).toHaveLength(2) // a stranger can't

    const asBob = await clientFor(bob)
    await asBob.from('review_comments').delete().eq('id', byBob.id)
    expect(b.review_comments.map((c) => c.id)).toEqual([byBob2.id]) // the commenter can

    const asAlice = await clientFor(alice)
    await asAlice.from('review_comments').delete().eq('id', byBob2.id)
    expect(b.review_comments).toEqual([]) // the review's author can delete anyone's
  })

  it('deleting a comment deletes its replies, and deleting a review deletes its comments', async () => {
    const top = b.addComment(bob, review)
    b.addComment(cara, review, { parentId: top.id })
    const asBob = await clientFor(bob)
    await asBob.from('review_comments').delete().eq('id', top.id)
    expect(b.review_comments).toEqual([])

    b.addComment(bob, review)
    const asAlice = await clientFor(alice)
    await asAlice.from('reviews').delete().eq('id', review.id)
    expect(b.review_comments).toEqual([])
  })

  it('un-ranking the movie deletes the review and its comments', async () => {
    b.addComment(bob, review)
    const asAlice = await clientFor(alice)
    await asAlice.rpc('remove_ranking', { p_movie_id: tmdb(DUNE) })
    expect(b.reviews).toEqual([])
    expect(b.review_comments).toEqual([])
  })

  it('get_review_comments returns the thread with usernames, even for a private commenter', async () => {
    b.addComment(cara, review, { body: 'From a private profile' }) // cara is private, bob is not her friend
    b.addComment(bob, review, { body: 'Second' })
    const asBob = await clientFor(bob)
    const { data, error } = await asBob.rpc('get_review_comments', { p_review_id: review.id })
    expect(error).toBeNull()
    expect(data.map((c) => [c.username, c.body])).toEqual([['cara', 'From a private profile'], ['bob', 'Second']])
  })

  it('get_review_comments returns nothing for a review you cannot see', async () => {
    b.seedList(cara, [DUNE])
    const hidden = b.addReview(cara, DUNE)
    b.addComment(cara, hidden)
    const asBob = await clientFor(bob)
    expect((await asBob.rpc('get_review_comments', { p_review_id: hidden.id })).data).toEqual([])
    const asCara = await clientFor(cara)
    expect((await asCara.rpc('get_review_comments', { p_review_id: hidden.id })).data).toHaveLength(1)
  })
})

describe('reports', () => {
  const DUNE = 'dune-part-two-2024'
  let review
  let commentRow

  beforeEach(() => {
    b.seedList(alice, [DUNE])
    review = b.addReview(alice, DUNE)
    commentRow = b.addComment(alice, review)
  })

  const report = (client, user, type, id, reason = 'Spam') =>
    client.from('reports').insert({ reporter_id: user.id, target_type: type, target_id: id, reason })

  it('can be filed as yourself about a review or a comment you can see', async () => {
    const asBob = await clientFor(bob)
    expect((await report(asBob, bob, 'review', review.id)).error).toBeNull()
    expect((await report(asBob, bob, 'comment', commentRow.id)).error).toBeNull()
    expect(b.reports.map((r) => r.target_type)).toEqual(['review', 'comment'])
  })

  it('is refused as someone else, or about something you cannot see or that does not exist', async () => {
    b.seedList(cara, [DUNE])
    const hidden = b.addReview(cara, DUNE)
    const asBob = await clientFor(bob)
    expect((await report(asBob, alice, 'review', review.id)).error.code).toBe('42501')
    expect((await report(asBob, bob, 'review', hidden.id)).error.code).toBe('42501')
    expect((await report(asBob, bob, 'comment', '00000000-0000-4000-8000-0000000000ff')).error.code).toBe('42501')
    expect((await report(asBob, bob, 'user', review.id)).error.code).toBe('42501')
  })

  it('takes a reason of 1 to 500 characters, once per reporter and target', async () => {
    const asBob = await clientFor(bob)
    expect((await report(asBob, bob, 'review', review.id, '')).error.code).toBe('23514')
    expect((await report(asBob, bob, 'review', review.id, 'a'.repeat(501))).error.code).toBe('23514')
    expect((await report(asBob, bob, 'review', review.id)).error).toBeNull()
    expect((await report(asBob, bob, 'review', review.id, 'Again')).error.code).toBe('23505')
  })

  it('cannot be read back through the API', async () => {
    const asBob = await clientFor(bob)
    await report(asBob, bob, 'review', review.id)
    const read = await asBob.from('reports').select('*')
    expect(read.error?.code).toBe('42501') // no select privilege at all
  })
})

describe('table privileges on the review tables', () => {
  const DUNE = 'dune-part-two-2024'
  const anonClient = () => b.createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } })

  it('lets a signed-out visitor read the reviews and comments of public profiles, and only those', async () => {
    b.seedList(bob, [DUNE])
    const open = b.addReview(bob, DUNE, { body: 'Public' })
    b.addComment(alice, open)
    b.seedList(cara, [DUNE])
    b.addReview(cara, DUNE, { body: 'Private' })

    const anon = anonClient()
    expect((await anon.from('reviews').select('body')).data.map((r) => r.body)).toEqual(['Public'])
    expect((await anon.from('review_comments').select('body')).data).toHaveLength(1)
    expect((await anon.rpc('get_review_comments', { p_review_id: open.id })).data).toHaveLength(1)
  })

  it('does not let a signed-out visitor write anything', async () => {
    b.seedList(bob, [DUNE])
    const review = b.addReview(bob, DUNE)
    const anon = anonClient()
    expect((await anon.from('reviews').insert({ user_id: bob.id, movie_id: tmdb(DUNE), body: 'x' })).error.code).toBe('42501')
    expect((await anon.from('review_comments').insert({ review_id: review.id, user_id: bob.id, body: 'x' })).error.code).toBe('42501')
    expect((await anon.from('reports').insert({ reporter_id: bob.id, target_type: 'review', target_id: review.id, reason: 'x' })).error.code).toBe('42501')
    expect((await anon.from('reviews').delete().eq('id', review.id)).error.code).toBe('42501')
    expect(b.reviews).toHaveLength(1)
  })
})

describe('notifications', () => {
  const DUNE = 'dune-part-two-2024'
  let review // alice's review of Dune

  beforeEach(() => {
    b.seedList(alice, [DUNE])
    review = b.addReview(alice, DUNE, { body: 'Thoughts.' })
  })

  const comment = async (user, parentId = null, body = 'Agreed') => {
    const client = await clientFor(user)
    const { data, error } = await client
      .from('review_comments')
      .insert({ review_id: review.id, user_id: user.id, parent_id: parentId, body })
      .select('*')
      .single()
    expect(error).toBeNull()
    return data
  }
  const mine = async (user) => {
    const { data, error } = await (await clientFor(user)).rpc('get_notifications')
    expect(error).toBeNull()
    return data
  }

  describe('comment triggers', () => {
    it('tells the review author about a top-level comment', async () => {
      const c = await comment(bob)
      expect(await mine(alice)).toEqual([
        expect.objectContaining({
          type: 'comment',
          actor_username: 'bob',
          review_id: review.id,
          comment_id: c.id,
          review_author_username: 'alice',
          movie_title: b.catalog(DUNE).title,
          preview: 'Agreed',
          available: true,
          seen_at: null,
          read_at: null,
        }),
      ])
      expect(await mine(bob)).toEqual([])
    })

    it('does not tell you about your own comment on your own review', async () => {
      await comment(alice)
      expect(b.notifications).toEqual([])
    })

    it('tells the parent author about a reply, and the review author too', async () => {
      const top = await comment(bob)
      const reply = await comment(cara, top.id, 'Same')
      expect(await mine(bob)).toEqual([expect.objectContaining({ type: 'reply', actor_username: 'cara', comment_id: reply.id })])
      const forAlice = await mine(alice)
      expect(forAlice.map((n) => n.type).sort()).toEqual(['comment', 'comment'])
      expect(forAlice.find((n) => n.comment_id === reply.id).actor_username).toBe('cara')
    })

    it('sends only one notification when the review author is the parent author', async () => {
      const top = await comment(alice)
      const reply = await comment(bob, top.id)
      expect(b.notifications).toEqual([expect.objectContaining({ recipient_id: alice.id, type: 'reply', comment_id: reply.id })])
    })

    it('gives nothing for replying to yourself, and nothing extra when you own the review', async () => {
      const top = await comment(bob)
      b.notifications.length = 0
      await comment(bob, top.id) // bob replies to bob: only the review author hears
      expect(b.notifications.map((n) => [n.recipient_id, n.type])).toEqual([[alice.id, 'comment']])
      b.notifications.length = 0
      await comment(alice, top.id) // alice (review author) replies to bob: only bob hears
      expect(b.notifications.map((n) => [n.recipient_id, n.type])).toEqual([[bob.id, 'reply']])
    })
  })

  describe('friend requests', () => {
    it('notifies the addressee of a new request', async () => {
      const asBob = await clientFor(bob)
      await asBob.rpc('send_friend_request', { p_user_id: alice.id })
      expect(await mine(alice)).toEqual([expect.objectContaining({ type: 'friend_request', actor_username: 'bob', available: true })])
      expect(await mine(bob)).toEqual([])
    })

    it('does not notify when a mutual request is accepted', async () => {
      await (await clientFor(bob)).rpc('send_friend_request', { p_user_id: alice.id })
      const before = b.notifications.length
      await (await clientFor(alice)).rpc('send_friend_request', { p_user_id: bob.id })
      expect(b.notifications).toHaveLength(before)
      expect(b.notifications.every((n) => n.recipient_id === alice.id)).toBe(true)
    })

    it('marks the notification read when the request is accepted, declined or cancelled', async () => {
      const asAlice = await clientFor(alice)
      const asBob = await clientFor(bob)
      const asCara = await clientFor(cara)
      await asBob.rpc('send_friend_request', { p_user_id: alice.id })
      await asCara.rpc('send_friend_request', { p_user_id: alice.id })
      expect(b.notifications.every((n) => n.read_at === null)).toBe(true)

      await asAlice.from('friendships').update({ status: 'accepted' }).eq('requester_id', bob.id).eq('addressee_id', alice.id)
      await asAlice.from('friendships').delete().eq('requester_id', cara.id).eq('addressee_id', alice.id)
      const rows = await mine(alice)
      expect(rows).toHaveLength(2)
      for (const row of rows) {
        expect(row.read_at).not.toBeNull()
        expect(row.seen_at).not.toBeNull()
      }
      expect(rows.find((r) => r.actor_username === 'bob').available).toBe(false) // accepted: not pending any more
    })

    it('says "not available" once the sender cancels', async () => {
      const asBob = await clientFor(bob)
      await asBob.rpc('send_friend_request', { p_user_id: alice.id })
      await asBob.from('friendships').delete().eq('requester_id', bob.id)
      expect((await mine(alice))[0]).toMatchObject({ available: false, read_at: expect.any(String) })
    })
  })

  describe('blend invites', () => {
    let blend
    beforeEach(() => {
      blend = b.addBlend(bob)
    })

    it('notifies the invitee', async () => {
      b.addBlendInvite(blend, bob, alice)
      expect(await mine(alice)).toEqual([expect.objectContaining({ type: 'blend_invite', actor_username: 'bob', available: true })])
      expect(await mine(bob)).toEqual([])
    })

    it('marks it read when the invite is accepted or declined, and then it is not available', async () => {
      const accepted = b.addBlendInvite(blend, bob, alice)
      const declined = b.addBlendInvite(blend, bob, cara)
      b.setBlendInviteStatus(accepted, 'accepted')
      b.setBlendInviteStatus(declined, 'declined')
      for (const user of [alice, cara]) {
        expect(await mine(user)).toEqual([expect.objectContaining({ available: false, read_at: expect.any(String) })])
      }
    })

    it('is not available once it has expired', async () => {
      b.addBlendInvite(blend, bob, alice, { expiresAt: new Date(Date.now() - 1000).toISOString() })
      expect((await mine(alice))[0].available).toBe(false)
    })
  })

  describe('when the target is gone', () => {
    it('keeps the notification but says it is unavailable and drops the preview, when the comment is deleted', async () => {
      const c = await comment(bob)
      await (await clientFor(bob)).from('review_comments').delete().eq('id', c.id)
      expect(await mine(alice)).toEqual([expect.objectContaining({ comment_id: c.id, available: false, preview: null })])
    })

    it('does the same when the whole review is deleted', async () => {
      await comment(bob)
      await (await clientFor(alice)).from('reviews').delete().eq('id', review.id)
      expect(await mine(alice)).toEqual([
        expect.objectContaining({ available: false, preview: null, review_author_username: null, movie_title: null }),
      ])
    })

    it('does the same when the movie is un-ranked (which deletes the review)', async () => {
      await comment(bob)
      await (await clientFor(alice)).rpc('remove_ranking', { p_movie_id: tmdb(DUNE) })
      expect(b.reviews).toEqual([])
      expect(await mine(alice)).toEqual([expect.objectContaining({ available: false, preview: null })])
    })

    it('is unavailable, and reveals nothing, when you cannot see the review author', async () => {
      const top = await comment(alice)
      b.profiles.find((p) => p.id === alice.id).is_public = false // bob isn't alice's friend
      const n = b.addNotification(bob.id, cara.id, 'reply', { review_id: review.id, comment_id: top.id })
      expect((await mine(bob)).find((row) => row.id === n.id)).toMatchObject({
        available: false,
        preview: null,
        review_author_username: null,
        movie_title: null,
      })
    })

    it('a report on its own changes nothing', async () => {
      const c = await comment(bob)
      await (await clientFor(cara)).from('reports').insert({ reporter_id: cara.id, target_type: 'comment', target_id: c.id, reason: 'rude' })
      expect((await mine(alice))[0]).toMatchObject({ available: true, preview: 'Agreed' })
    })
  })

  describe('open_notification', () => {
    it('marks it read and seen, and returns where to go', async () => {
      const c = await comment(bob)
      const asAlice = await clientFor(alice)
      const id = (await mine(alice))[0].id
      const { data, error } = await asAlice.rpc('open_notification', { p_id: id })
      expect(error).toBeNull()
      expect(data).toEqual([{ available: true, type: 'comment', review_id: review.id, comment_id: c.id, review_author_username: 'alice' }])
      expect((await mine(alice))[0]).toMatchObject({ read_at: expect.any(String), seen_at: expect.any(String) })
    })

    it('checks availability at click time', async () => {
      const c = await comment(bob)
      const id = (await mine(alice))[0].id
      await (await clientFor(bob)).from('review_comments').delete().eq('id', c.id)
      const { data } = await (await clientFor(alice)).rpc('open_notification', { p_id: id })
      expect(data).toEqual([expect.objectContaining({ available: false, type: 'comment' })])
    })

    it("returns nothing, and changes nothing, for someone else's notification", async () => {
      await comment(bob)
      const id = (await mine(alice))[0].id
      const { data, error } = await (await clientFor(cara)).rpc('open_notification', { p_id: id })
      expect(error).toBeNull()
      expect(data).toEqual([])
      expect(b.notifications[0].read_at).toBeNull()
    })

    it('needs a signed-in user', async () => {
      const anon = b.createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } })
      expect((await anon.rpc('open_notification', { p_id: b.id() })).error.code).toBe('28000')
      expect((await anon.rpc('get_notifications')).error.code).toBe('28000')
    })
  })

  describe('get_notifications', () => {
    it('lists newest first and clamps the limit to 1..100', async () => {
      const first = await comment(bob, null, 'one')
      const second = await comment(cara, null, 'two')
      const asAlice = await clientFor(alice)
      expect((await mine(alice)).map((n) => n.comment_id)).toEqual([second.id, first.id])
      expect((await asAlice.rpc('get_notifications', { p_limit: 1 })).data.map((n) => n.comment_id)).toEqual([second.id])
      expect((await asAlice.rpc('get_notifications', { p_limit: 0 })).data).toHaveLength(1)
      expect((await asAlice.rpc('get_notifications', { p_limit: 1000 })).data).toHaveLength(2)
    })

    it('cuts the preview at 120 characters', async () => {
      await comment(bob, null, 'x'.repeat(300))
      expect((await mine(alice))[0].preview).toHaveLength(120)
    })
  })

  describe('privileges and row level security', () => {
    it('lets you read only your own, and anon nothing', async () => {
      await comment(bob)
      const asAlice = await clientFor(alice)
      expect((await asAlice.from('notifications').select('id')).data).toHaveLength(1)
      expect((await (await clientFor(cara)).from('notifications').select('id')).data).toEqual([])
      const anon = b.createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } })
      expect((await anon.from('notifications').select('id')).error.code).toBe('42501')
    })

    it('lets you update only seen_at and read_at, and only on your own rows', async () => {
      await comment(bob)
      const id = b.notifications[0].id
      const stamp = new Date().toISOString()
      const asAlice = await clientFor(alice)

      expect((await asAlice.from('notifications').update({ seen_at: stamp }).eq('id', id).select('id')).data).toHaveLength(1)
      expect((await asAlice.from('notifications').update({ read_at: stamp }).eq('id', id)).error).toBeNull()
      expect(b.notifications[0]).toMatchObject({ seen_at: stamp, read_at: stamp })

      for (const patch of [{ recipient_id: cara.id }, { type: 'reply' }, { comment_id: b.id() }, { actor_id: alice.id }]) {
        expect((await asAlice.from('notifications').update(patch).eq('id', id)).error.code).toBe('42501')
      }
      // someone else's row: no error, nothing changes
      const asCara = await clientFor(cara)
      const res = await asCara.from('notifications').update({ read_at: null }).eq('id', id).select('id')
      expect(res.data).toEqual([])
      expect(b.notifications[0].read_at).toBe(stamp)
      const anon = b.createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } })
      expect((await anon.from('notifications').update({ read_at: null }).eq('id', id)).error.code).toBe('42501')
    })

    it('has no insert or delete for the app', async () => {
      await comment(bob)
      const asAlice = await clientFor(alice)
      const row = { recipient_id: alice.id, actor_id: bob.id, type: 'friend_request' }
      expect((await asAlice.from('notifications').insert(row)).error.code).toBe('42501')
      expect((await asAlice.from('notifications').delete().eq('id', b.notifications[0].id)).error.code).toBe('42501')
      expect(b.notifications).toHaveLength(1)
    })
  })
})

describe('get_review_feed', () => {
  const firstMovies = (n) => MOVIES.slice(0, n).map((m) => m.id)
  const DUNE = 'dune-part-two-2024'
  const INCEPTION = 'inception-2010'
  const feed = async (user, args = {}) => {
    const client = user ? await clientFor(user) : b.createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } })
    return client.rpc('get_review_feed', { p_scope: 'everyone', p_sort: 'recent', p_limit: 20, p_offset: 0, ...args })
  }
  const bodies = (result) => result.data.map((row) => row.body)

  it('returns what a review card needs: author, movie, counts and dates', async () => {
    b.seedList(bob, [DUNE])
    const review = b.addReview(bob, DUNE, { body: 'Great', isSpoiler: true })
    b.addComment(cara, review)
    b.addComment(alice, review)

    const { data, error } = await feed(alice)

    expect(error).toBeNull()
    expect(data).toEqual([expect.objectContaining({
      id: review.id, user_id: bob.id, username: 'bob', movie_id: tmdb(DUNE), title: 'Dune: Part Two',
      body: 'Great', is_spoiler: true, comment_count: 2, score: null,
    })])
    expect(data[0].genres.length).toBeGreaterThan(0)
  })

  it('shows reviews from public profiles, yours, and friends\' private ones, but not strangers\' private ones', async () => {
    b.seedList(alice, [DUNE])
    b.seedList(bob, [DUNE])
    b.seedList(cara, [DUNE])
    b.addReview(alice, DUNE, { body: 'mine' })
    b.addReview(bob, DUNE, { body: 'public' })
    b.addReview(cara, DUNE, { body: 'private stranger' }) // cara is private in this file's setup
    expect(bodies(await feed(alice)).sort()).toEqual(['mine', 'public'])

    b.addFriendship(alice, cara, 'accepted')
    expect(bodies(await feed(alice)).sort()).toEqual(['mine', 'private stranger', 'public'])
  })

  it('shows a signed-out visitor only public profiles\' reviews', async () => {
    b.seedList(bob, [DUNE])
    b.seedList(cara, [DUNE])
    b.addReview(bob, DUNE, { body: 'public' })
    b.addReview(cara, DUNE, { body: 'private' })
    expect(bodies(await feed(null))).toEqual(['public'])
  })

  it('"friends" is accepted friends only, never yourself', async () => {
    b.seedList(alice, [DUNE])
    b.seedList(bob, [DUNE])
    b.seedList(cara, [DUNE])
    b.addReview(alice, DUNE, { body: 'mine' })
    b.addReview(bob, DUNE, { body: 'friend' })
    b.addReview(cara, DUNE, { body: 'pending' })
    b.addFriendship(alice, bob, 'accepted')
    b.addFriendship(alice, cara, 'pending')

    expect(bodies(await feed(alice, { p_scope: 'friends' }))).toEqual(['friend'])
    expect(bodies(await feed(null, { p_scope: 'friends' }))).toEqual([]) // logged out has no friends
  })

  it('sorts by newest first, or by most comments with the newest breaking ties', async () => {
    b.seedList(bob, [DUNE, INCEPTION, 'interstellar-2014'])
    const old = b.addReview(bob, DUNE, { body: 'old, busy', createdAt: '2026-01-01T00:00:00.000Z' })
    b.addReview(bob, INCEPTION, { body: 'middle, quiet', createdAt: '2026-02-01T00:00:00.000Z' })
    b.addReview(bob, 'interstellar-2014', { body: 'new, quiet', createdAt: '2026-03-01T00:00:00.000Z' })
    b.addComment(cara, old)
    b.addComment(alice, old)

    expect(bodies(await feed(alice))).toEqual(['new, quiet', 'middle, quiet', 'old, busy'])
    expect(bodies(await feed(alice, { p_sort: 'discussed' }))).toEqual(['old, busy', 'new, quiet', 'middle, quiet'])
  })

  it('pages with limit and offset, and caps the limit at 200', async () => {
    b.seedList(bob, firstMovies(5))
    firstMovies(5).forEach((id, i) => b.addReview(bob, id, { body: `r${i}`, createdAt: `2026-01-0${i + 1}T00:00:00.000Z` }))
    expect(bodies(await feed(alice, { p_limit: 2 }))).toEqual(['r4', 'r3'])
    expect(bodies(await feed(alice, { p_limit: 2, p_offset: 2 }))).toEqual(['r2', 'r1'])
    expect(bodies(await feed(alice, { p_limit: 2, p_offset: 4 }))).toEqual(['r0'])
    expect(bodies(await feed(alice, { p_limit: 5000 }))).toHaveLength(5)
    expect(bodies(await feed(alice, { p_limit: 0 }))).toHaveLength(1) // at least one
  })

  it('has a score only once the author has ranked 10 movies', async () => {
    b.seedList(bob, firstMovies(9))
    b.addReview(bob, firstMovies(9)[0], { body: 'nine ranked' })
    expect((await feed(alice)).data[0].score).toBeNull()

    b.seedList(bob, [firstMovies(10)[9]])
    const top = (await feed(alice)).data[0]
    expect(top.score).toBe(10) // their #1
  })

  it('refuses a scope or sort it does not know', async () => {
    expect((await feed(alice, { p_scope: 'nobody' })).error.code).toBe('22023')
    expect((await feed(alice, { p_sort: 'random' })).error.code).toBe('22023')
  })

  it('does not include a review once its movie is un-ranked', async () => {
    b.seedList(bob, [DUNE])
    b.addReview(bob, DUNE)
    const asBob = await clientFor(bob)
    await asBob.rpc('remove_ranking', { p_movie_id: tmdb(DUNE) })
    expect((await feed(alice)).data).toEqual([])
  })
})

describe('get_leaderboard', () => {
  it('scores a lone loved movie 8.0 and spreads several across 10 to 6', async () => {
    const client = await clientFor(bob)
    b.seedList(alice, ['inception-2010'])
    let rows = (await client.rpc('get_leaderboard', { p_period: 'weekly', p_category: 'highest', p_limit: 10 })).data
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ score: 8, rankers: 1, rank: 1 })

    b.seedList(bob, ['interstellar-2014', 'the-dark-knight-2008'])
    rows = (await client.rpc('get_leaderboard', { p_period: 'weekly', p_category: 'highest', p_limit: 10 })).data
    const score = (id) => rows.find((r) => r.movie_id === tmdb(id)).score
    expect(score('interstellar-2014')).toBe(10)
    expect(score('the-dark-knight-2008')).toBe(6)
  })

  it('keeps okay and meh in their own score bands', async () => {
    const client = await clientFor(bob)
    b.seedList(alice, [
      { movie: 'inception-2010', category: 'meh' },
      { movie: 'interstellar-2014', category: 'okay' },
    ])
    const rows = (await client.rpc('get_leaderboard', { p_period: 'weekly', p_category: 'highest', p_limit: 10 })).data
    const score = (id) => rows.find((r) => r.movie_id === tmdb(id)).score
    expect(score('interstellar-2014')).toBeGreaterThanOrEqual(4)
    expect(score('interstellar-2014')).toBeLessThanOrEqual(5.9)
    expect(score('inception-2010')).toBeLessThanOrEqual(3.9)
  })

  it('counts a movie only in the window where it was first ranked', async () => {
    const client = await clientFor(bob)
    b.seedList(alice, [
      { movie: 'inception-2010', createdAt: b.daysAgo(3) },
      { movie: 'interstellar-2014', createdAt: b.daysAgo(15) },
      { movie: 'the-dark-knight-2008', createdAt: b.daysAgo(60) },
    ])
    const titles = async (period) =>
      (await client.rpc('get_leaderboard', { p_period: period, p_category: 'highest', p_limit: 10 })).data.map((r) => r.title)
    expect(await titles('weekly')).toEqual([b.catalog('inception-2010').title])
    expect((await titles('monthly')).sort()).toEqual([b.catalog('inception-2010').title, b.catalog('interstellar-2014').title].sort())
  })

  it('sorts "watched" by number of rankers and "highest" by score', async () => {
    const client = await clientFor(cara)
    b.seedList(alice, ['inception-2010', 'interstellar-2014'])
    b.seedList(bob, ['interstellar-2014'])
    const first = async (category) =>
      (await client.rpc('get_leaderboard', { p_period: 'weekly', p_category: category, p_limit: 10 })).data[0].title
    expect(await first('watched')).toBe(b.catalog('interstellar-2014').title)
    expect(await first('highest')).toBe(b.catalog('inception-2010').title)
  })

  it('limits the result and numbers the rows', async () => {
    const client = await clientFor(cara)
    b.seedList(alice, ['inception-2010', 'interstellar-2014', 'the-dark-knight-2008'])
    const rows = (await client.rpc('get_leaderboard', { p_period: 'weekly', p_category: 'highest', p_limit: 2 })).data
    expect(rows.map((r) => r.rank)).toEqual([1, 2])
  })
})

describe('auth', () => {
  it('signs up with a username, creating the profile', async () => {
    const client = b.createClient(SUPABASE_URL, PUBLISHABLE_KEY)
    const { data, error } = await client.auth.signUp({ email: 'new@example.com', password: 'longenough', options: { data: { username: 'newbie' } } })
    expect(error).toBeNull()
    expect(data.session).not.toBeNull()
    expect(b.profiles.find((p) => p.username === 'newbie')).toMatchObject({ bio: null, pronouns: null, is_public: true })
  })

  it('fails the whole sign-up when the username is taken (any capitalization)', async () => {
    const client = b.createClient(SUPABASE_URL, PUBLISHABLE_KEY)
    const { error } = await client.auth.signUp({ email: 'x@example.com', password: 'longenough', options: { data: { username: 'ALICE' } } })
    expect(error.message).toMatch(/database error saving new user/i)
    expect(b.users.some((u) => u.email === 'x@example.com')).toBe(false)
  })

  it('refuses a used email, or hides it when configured to', async () => {
    const client = b.createClient(SUPABASE_URL, PUBLISHABLE_KEY)
    const attempt = () => client.auth.signUp({ email: alice.email, password: 'longenough', options: { data: { username: 'another' } } })
    expect((await attempt()).error.message).toMatch(/already registered/i)
    b.hideExistingEmails = true
    expect((await attempt()).data.user.identities).toEqual([])
  })

  it('withholds the session until the email is confirmed, when confirmation is on', async () => {
    b.confirmEmails = true
    const client = b.createClient(SUPABASE_URL, PUBLISHABLE_KEY)
    const { data } = await client.auth.signUp({ email: 'new@example.com', password: 'longenough', options: { data: { username: 'newbie' } } })
    expect(data.session).toBeNull()
    const login = await client.auth.signInWithPassword({ email: 'new@example.com', password: 'longenough' })
    expect(login.error.message).toMatch(/not confirmed/i)
  })

  it('rejects a wrong password with a 400, like Supabase', async () => {
    const client = b.createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } })
    const { error } = await client.auth.signInWithPassword({ email: alice.email, password: 'nope' })
    expect(error).toMatchObject({ status: 400 })
  })

  it('answers "JWT expired" once the server stops accepting a token', async () => {
    const client = await clientFor(alice)
    b.invalidateTokens(alice)
    expect((await save(client, 'inception-2010', 'loved', 0)).error.message).toMatch(/jwt expired/i)
    expect((await client.from('profiles').select('id')).error.message).toMatch(/jwt expired/i)
  })
})

describe('failure injection and holds', () => {
  it('fails a call the given number of times, then recovers', async () => {
    const client = await clientFor(alice)
    b.failRpc('save_ranking', 'boom', { times: 1 })
    expect((await save(client, 'inception-2010', 'loved', 0)).error.message).toBe('boom')
    expect((await save(client, 'inception-2010', 'loved', 0)).error).toBeNull()
  })

  it('can limit a failure to the query that selects certain columns', async () => {
    const client = await clientFor(alice)
    b.failQuery('rankings', 'select', 'boom', { times: 1, cols: /movies\(/ })
    expect((await client.from('rankings').select('movie_id, updated_at')).error).toBeNull() // other query: untouched
    expect((await client.from('rankings').select('movie_id, movies(title)')).error.message).toBe('boom')
    expect((await client.from('rankings').select('movie_id, movies(title)')).error).toBeNull() // used up
  })

  it('records when a request has been answered, as well as when it started', async () => {
    vi.stubEnv('TMDB_READ_TOKEN', TMDB_TOKEN)
    b.failApi('GET /api/health', { status: 503, body: { error: 'down' } }, { times: 1 })
    const pending = b.fetch('/api/health')
    expect(b.callsTo('fetch:GET /api/health')).toHaveLength(1)
    await pending
    expect(b.callsTo('fetched:GET /api/health').map((c) => c.args)).toEqual([{ status: 503 }])
    b.failApi('GET /api/health', { network: true }, { times: 1 })
    await expect(b.fetch('/api/health')).rejects.toThrow('Failed to fetch')
    expect(b.callsTo('fetched:GET /api/health').map((c) => c.args)).toEqual([{ status: 503 }, { status: null }])
  })

  it('pauses a call until it is released', async () => {
    const client = await clientFor(alice)
    const gate = b.hold('rpc:get_friendships')
    let done = false
    const pending = client.rpc('get_friendships').then(() => { done = true })
    await new Promise((r) => setTimeout(r, 20))
    expect(done).toBe(false)
    gate.release()
    await pending
    expect(done).toBe(true)
  })

  it('records what was called', async () => {
    const client = await clientFor(alice)
    await client.rpc('get_friendships')
    expect(b.callsTo('rpc:get_friendships')).toHaveLength(1)
  })
})

describe('network', () => {
  beforeEach(() => {
    vi.stubEnv('TMDB_READ_TOKEN', TMDB_TOKEN)
  })

  it('runs the real API handlers behind /api/*', async () => {
    const res = await b.fetch('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tmdbConfigured: true })
  })

  it('answers 404 for routes that don\'t exist', async () => {
    expect((await b.fetch('/api/nope')).status).toBe(404)
  })

  it('can fail a request with a status or like a dropped connection', async () => {
    b.failApi('GET /api/health', { status: 503, body: { error: 'down' } }, { times: 1 })
    expect((await b.fetch('/api/health')).status).toBe(503)
    b.failApi('GET /api/health', { network: true }, { times: 1 })
    await expect(b.fetch('/api/health')).rejects.toThrow('Failed to fetch')
  })
})

describe('OMDb, external ids and the ratings cache', () => {
  const omdb = async (imdbId, key = OMDB_KEY) => {
    const res = await b.fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${key}`)
    return { status: res.status, body: await res.json() }
  }
  const tmdbGet = async (path) => {
    const res = await b.fetch(`https://api.themoviedb.org/3${path}`, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } })
    return { status: res.status, body: await res.json() }
  }

  it('answers with the scores it was given, written the way OMDb writes them', async () => {
    b.addOmdbScores('tt0000001', { imdb: 8.1, votes: 1234567, rt: 91 })
    const { status, body } = await omdb('tt0000001')

    expect(status).toBe(200)
    expect(body).toMatchObject({ Response: 'True', imdbRating: '8.1', imdbVotes: '1,234,567' })
    expect(body.Ratings).toContainEqual({ Source: 'Rotten Tomatoes', Value: '91%' })
  })

  it('writes "N/A" and leaves out Rotten Tomatoes for scores it doesn\'t have', async () => {
    b.addOmdbScores('tt0000002', { imdb: null, votes: null, rt: null })
    const { body } = await omdb('tt0000002')

    expect(body).toMatchObject({ imdbRating: 'N/A', imdbVotes: 'N/A' })
    expect(body.Ratings.some((r) => r.Source === 'Rotten Tomatoes')).toBe(false)
  })

  it('says "Incorrect IMDb ID." for an id it doesn\'t know', async () => {
    expect((await omdb('tt9999999')).body).toEqual({ Response: 'False', Error: 'Incorrect IMDb ID.' })
  })

  it('refuses a wrong key and a used-up daily limit with HTTP 401, and can be down', async () => {
    b.addOmdbScores('tt0000001')
    expect(await omdb('tt0000001', 'wrong')).toEqual({ status: 401, body: { Response: 'False', Error: 'Invalid API key!' } })

    b.omdb.limitReached = true
    expect(await omdb('tt0000001')).toEqual({ status: 401, body: { Response: 'False', Error: 'Request limit reached!' } })

    b.omdb.limitReached = false
    b.omdb.down = true
    expect((await omdb('tt0000001')).status).toBe(503)
  })

  it('gives TMDb\'s IMDb id for a TMDb-only movie, a catalog movie, and 404 for neither', async () => {
    b.addTmdbMovie({ id: 777001, title: 'Has Id', imdb_id: 'tt7770001' })
    b.addTmdbMovie({ id: 777002, title: 'No Id' })
    const dune = b.catalog('dune-part-two-2024')

    expect((await tmdbGet('/movie/777001/external_ids')).body).toEqual({ id: 777001, imdb_id: 'tt7770001' })
    expect((await tmdbGet('/movie/777002/external_ids')).body).toEqual({ id: 777002, imdb_id: null })
    expect((await tmdbGet(`/movie/${dune.tmdb_id}/external_ids`)).body.imdb_id).toBe(dune.imdb_id)
    expect((await tmdbGet('/movie/1/external_ids')).status).toBe(404)
  })

  it('keeps movie_ratings from the browser, but lets the service role read and upsert it', async () => {
    const row = { tmdb_id: 777001, imdb_id: 'tt7770001', imdb: 7.5, imdb_votes: 1000, rt: 80, checked_at: new Date().toISOString() }
    const admin = b.createClient(SUPABASE_URL, SERVICE_KEY)
    expect((await admin.from('movie_ratings').upsert(row, { onConflict: 'tmdb_id' }).select().single()).data).toMatchObject({ imdb: 7.5 })
    await admin.from('movie_ratings').upsert({ ...row, imdb: 8.0 }, { onConflict: 'tmdb_id' })
    expect(b.movie_ratings).toHaveLength(1)
    expect(b.movie_ratings[0].imdb).toBe(8)

    const browser = await clientFor(alice)
    expect((await browser.from('movie_ratings').select('*')).data).toEqual([])
    expect((await browser.from('movie_ratings').upsert(row, { onConflict: 'tmdb_id' })).error.code).toBe('42501')
  })

  it('keeps the daily OMDb budget from the browser, and counts lookups for the service role', async () => {
    const browser = await clientFor(alice)
    expect((await browser.rpc('claim_omdb_call', { p_limit: 900 })).error.code).toBe('42501')

    const admin = b.createClient(SUPABASE_URL, SERVICE_KEY)
    expect((await admin.rpc('claim_omdb_call', { p_limit: 2 })).data).toBe(true)
    expect((await admin.rpc('claim_omdb_call', { p_limit: 2 })).data).toBe(true)
    expect((await admin.rpc('claim_omdb_call', { p_limit: 2 })).data).toBe(false)
    expect(b.omdbUsageToday()).toBe(2)
    expect((await admin.rpc('claim_omdb_call', { p_limit: 0 })).data).toBe(false)
  })

  it('passes the headers a handler sets back with the response', async () => {
    vi.stubEnv('TMDB_READ_TOKEN', TMDB_TOKEN)
    vi.stubEnv('SUPABASE_URL', SUPABASE_URL)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY)
    vi.stubEnv('OMDB_API_KEY', OMDB_KEY)
    globalThis.__sceneit = { backend: b }
    vi.stubGlobal('fetch', b.fetch)
    b.addTmdbMovie({ id: 777003, title: 'Cacheable', imdb_id: 'tt7770003' })
    b.addOmdbScores('tt7770003')

    const res = await b.fetch('/api/movies/ratings?id=777003')

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toMatch(/s-maxage=86400/)
  })
})
