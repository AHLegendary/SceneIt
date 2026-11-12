// The fake backend stands in for Supabase in every other integration test, so
// these pin it to what the migrations in supabase/migrations say. If you change
// a SQL function or policy, change the fake and these tests with it.
import { describe, expect, it, beforeEach, vi } from 'vitest'
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
