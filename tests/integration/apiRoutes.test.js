// The real handlers in api/, called through the same router the dev server uses,
// against the fake database, storage and TMDb (see helpers/fakeBackend.js).
// The UI tests cover the happy paths from the browser; this covers what the
// browser never sends: no token, bad input, wrong methods, and failures.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import { FakeBackend, PUBLISHABLE_KEY, SERVICE_KEY, SUPABASE_URL, TMDB_TOKEN } from './helpers/fakeBackend.js'

let backend
let alice
let bob

beforeEach(() => {
  backend = new FakeBackend()
  alice = backend.addUser({ username: 'Alice_99', email: 'alice@example.com', password: 'correct-horse' })
  bob = backend.addUser({ username: 'bob', email: 'bob@example.com', password: 'bobs-password' })
  globalThis.__sceneit = { backend }
  // The handlers call fetch() to reach TMDb; send that to the fake TMDb, never the real one.
  vi.stubGlobal('fetch', backend.fetch)
  // A fresh copy of every handler per test: supabaseAdmin.js and media.js keep module-level caches.
  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE_URL)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE_KEY)
  vi.stubEnv('SUPABASE_URL', SUPABASE_URL)
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY)
  vi.stubEnv('TMDB_READ_TOKEN', TMDB_TOKEN)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

// Calls an /api route like the browser's fetch would. Returns { status, body }.
async function call(method, path, { body, token, headers = {} } = {}) {
  const init = { method, headers: { ...headers } }
  if (token) init.headers.Authorization = `Bearer ${token}`
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const res = await backend.fetch(path, init)
  return { status: res.status, body: await res.json() }
}

// An access token the server accepts for this user (like the one in the browser's session).
const tokenFor = (user) => backend.makeSession(user).access_token

describe('GET /api/health', () => {
  it('says whether the TMDb token is configured', async () => {
    expect(await call('GET', '/api/health')).toEqual({ status: 200, body: { tmdbConfigured: true } })
    vi.stubEnv('TMDB_READ_TOKEN', '')
    expect((await call('GET', '/api/health')).body).toEqual({ tmdbConfigured: false })
  })
})

describe('POST /api/login', () => {
  const login = (username, password) => call('POST', '/api/login', { body: { username, password } })

  it('returns a session\'s tokens, and nothing else, for the right username and password', async () => {
    const { status, body } = await login('Alice_99', 'correct-horse')

    expect(status).toBe(200)
    expect(Object.keys(body)).toEqual(['session'])
    expect(Object.keys(body.session).sort()).toEqual(['access_token', 'refresh_token'])
    expect(backend.userByToken(body.session.access_token).id).toBe(alice.id)
    expect(JSON.stringify(body)).not.toContain('alice@example.com')
    expect(JSON.stringify(body)).not.toContain(SERVICE_KEY)
  })

  it('ignores capitalization in the username', async () => {
    expect((await login('aLiCe_99', 'correct-horse')).status).toBe(200)
  })

  it('treats "_" literally, so one username can\'t match another', async () => {
    backend.addUser({ username: 'AliceX99', email: 'x@example.com', password: 'other-password' })
    const { body } = await login('Alice_99', 'other-password')
    expect(body).toEqual({ error: 'invalid_credentials' }) // would have matched AliceX99 if "_" were a wildcard
  })

  it('answers a wrong password and an unknown username identically', async () => {
    const wrongPassword = await login('Alice_99', 'nope')
    const unknownUser = await login('nobody_here', 'nope')

    expect(wrongPassword).toEqual({ status: 401, body: { error: 'invalid_credentials' } })
    expect(unknownUser).toEqual(wrongPassword)
  })

  it('does not reveal an account whose email is not confirmed', async () => {
    backend.addUser({ username: 'pending_one', email: 'p@example.com', password: 'pending-pass', confirmed: false })
    expect(await login('pending_one', 'pending-pass')).toEqual({ status: 401, body: { error: 'invalid_credentials' } })
  })

  it.each([
    ['no body', undefined],
    ['no password', { username: 'Alice_99' }],
    ['an empty password', { username: 'Alice_99', password: '' }],
    ['a non-string username', { username: ['Alice_99'], password: 'x' }],
    ['a username that is too short', { username: 'ab', password: 'x' }],
    ['a username that is too long', { username: 'a'.repeat(21), password: 'x' }],
    ['an email instead of a username', { username: 'alice@example.com', password: 'correct-horse' }],
    ['characters a username can\'t have', { username: "alice'; drop table", password: 'x' }],
  ])('rejects %s without touching the database', async (_label, body) => {
    const res = await call('POST', '/api/login', { body })
    expect(res).toEqual({ status: 401, body: { error: 'invalid_credentials' } })
    expect(backend.callsTo('from:profiles:select')).toHaveLength(0)
    expect(backend.callsTo('auth:signInWithPassword')).toHaveLength(0)
  })

  it('only accepts POST', async () => {
    expect((await call('GET', '/api/login')).status).toBe(405)
  })

  it('reports a server that is not set up', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    expect(await login('Alice_99', 'correct-horse')).toEqual({ status: 500, body: { error: 'server_not_configured' } })
  })

  it('reports a failed username lookup', async () => {
    backend.failQuery('profiles', 'select', 'db down')
    expect(await login('Alice_99', 'correct-horse')).toEqual({ status: 500, body: { error: 'lookup_failed' } })
  })

  it('treats a missing auth user as a bad login', async () => {
    backend.failAuth('getUserById', { status: 404, message: 'User not found' })
    expect(await login('Alice_99', 'correct-horse')).toEqual({ status: 401, body: { error: 'invalid_credentials' } })
  })

  it('reports when Supabase auth itself is failing', async () => {
    backend.failAuth('signInWithPassword', { status: 500, message: 'auth down' })
    expect(await login('Alice_99', 'correct-horse')).toEqual({ status: 502, body: { error: 'auth_unavailable' } })
  })
})

describe('GET /api/movies/:id', () => {
  beforeEach(() => {
    backend.addTmdbMovie({ id: 980001, title: 'Pika Planet', year: 2021, genres: ['Animation'], runtime: 88, director: 'Dee Rector', cast: ['One', 'Two'] })
  })

  it('returns a movie with its details', async () => {
    const { status, body } = await call('GET', '/api/movies/980001')

    expect(status).toBe(200)
    expect(body.movie).toMatchObject({ tmdb_id: 980001, title: 'Pika Planet', year: 2021, genres: ['Animation'], runtime: 88, directors: ['Dee Rector'], cast: ['One', 'Two'], tagline: 'The tagline of Pika Planet' })
  })

  it('sends TMDb the token, and asks for credits', async () => {
    await call('GET', '/api/movies/980001')
    const url = new URL(backend.callsTo('tmdb:/3/movie/980001')[0].args.url)
    expect(url.searchParams.get('append_to_response')).toBe('credits')
  })

  it('answers 404 for a movie TMDb doesn\'t have', async () => {
    expect(await call('GET', '/api/movies/1')).toEqual({ status: 404, body: { error: 'Movie not found' } })
  })

  it.each([['abc'], ['12.5'], ['-1'], ['12345678901']])('rejects the invalid id %s without asking TMDb', async (id) => {
    expect((await call('GET', `/api/movies/${id}`)).status).toBe(400)
    expect(backend.calls.filter((c) => c.key.startsWith('tmdb:'))).toHaveLength(0)
  })

  it.each([
    ['TMDb is down', () => backend.tmdbDown()],
    ['TMDb fails for this movie', () => backend.tmdb.failing.add(980001)],
  ])('answers 502 when %s', async (_label, breakIt) => {
    breakIt()
    expect(await call('GET', '/api/movies/980001')).toEqual({ status: 502, body: { error: "Couldn't load movie, try again later." } })
  })

  it.each([['PUT'], ['DELETE'], ['PATCH']])('refuses %s', async (method) => {
    expect((await call(method, '/api/movies/980001')).status).toBe(405)
  })
})

describe('POST /api/movies/:id (saving a movie so it can be ranked)', () => {
  beforeEach(() => {
    backend.addTmdbMovie({ id: 980002, title: 'Koala Kingdom', year: 2020, genres: ['Adventure'], overview: 'Koalas rule.' })
  })
  const save = (id, token, body) => call('POST', `/api/movies/${id}`, { token, body })

  it('saves the movie from TMDb and returns it', async () => {
    const { status, body } = await save(980002, tokenFor(alice))

    expect(status).toBe(201)
    expect(body.movie).toEqual({ tmdb_id: 980002, title: 'Koala Kingdom', year: 2020, poster_path: '/p980002.jpg', genres: ['Adventure'], overview: 'Koalas rule.' })
    expect(backend.movies.find((m) => m.tmdb_id === 980002)).toMatchObject({ title: 'Koala Kingdom' })
  })

  it('saves what TMDb says, never what the client sent', async () => {
    await save(980002, tokenFor(alice), { title: 'Hacked', year: 1900, overview: 'nope' })
    expect(backend.movies.find((m) => m.tmdb_id === 980002)).toMatchObject({ title: 'Koala Kingdom', year: 2020, overview: 'Koalas rule.' })
  })

  it('returns the saved movie the second time without asking TMDb again', async () => {
    await save(980002, tokenFor(alice))
    const again = await save(980002, tokenFor(bob))

    expect(again.status).toBe(200)
    expect(again.body.movie.title).toBe('Koala Kingdom')
    expect(backend.callsTo('tmdb:/3/movie/980002')).toHaveLength(1)
  })

  it('does not ask TMDb at all for a movie already in the catalog', async () => {
    const dune = MOVIES.find((m) => m.id === 'dune-part-two-2024')
    const res = await save(dune.tmdb_id, tokenFor(alice))

    expect(res.status).toBe(200)
    expect(res.body.movie.title).toBe(dune.title)
    expect(backend.calls.filter((c) => c.key.startsWith('tmdb:'))).toHaveLength(0)
  })

  it.each([
    ['no Authorization header', undefined],
    ['a token that isn\'t one', 'garbage'],
    ['an empty token', ''],
  ])('refuses %s', async (_label, token) => {
    const res = await save(980002, token)
    expect(res).toEqual({ status: 401, body: { error: 'Log in to rank movies.' } })
    expect(backend.movies.some((m) => m.tmdb_id === 980002)).toBe(false)
  })

  it('refuses a token the server no longer accepts', async () => {
    const token = tokenFor(alice)
    backend.invalidateTokens(alice)
    expect((await save(980002, token)).status).toBe(401)
  })

  it('refuses a malformed Authorization header', async () => {
    const res = await call('POST', '/api/movies/980002', { headers: { Authorization: tokenFor(alice) } })
    expect(res.status).toBe(401)
  })

  it('answers 404 when TMDb doesn\'t have the movie', async () => {
    expect(await save(2, tokenFor(alice))).toEqual({ status: 404, body: { error: 'Movie not found' } })
    expect(backend.movies.some((m) => m.tmdb_id === 2)).toBe(false)
  })

  it('answers 502 when TMDb is down, or the database refuses', async () => {
    backend.tmdbDown()
    expect((await save(980002, tokenFor(alice))).status).toBe(502)

    backend.tmdb.down = false
    backend.failQuery('movies', 'upsert', 'db down')
    expect(await save(980002, tokenFor(alice))).toEqual({ status: 502, body: { error: "Couldn't save that movie, try again." } })
  })

  it('rejects an invalid id before checking who is asking', async () => {
    expect((await save('abc', tokenFor(alice))).status).toBe(400)
    expect(backend.callsTo('auth:getUser')).toHaveLength(0)
  })
})

describe('GET /api/movies/search', () => {
  beforeEach(() => {
    backend.addTmdbMovie({ id: 981001, title: 'Wombat Wars', year: 2018, genres: ['Action'] })
    backend.addTmdbMovie({ id: 981002, title: 'Wombat Wedding', year: 2019, genres: ['Romance'] })
  })

  it('returns matches in the app\'s movie shape', async () => {
    const { status, body } = await call('GET', '/api/movies/search?q=wombat')

    expect(status).toBe(200)
    expect(body.results.map((m) => m.title)).toEqual(['Wombat Wars', 'Wombat Wedding'])
    expect(body.results[0]).toMatchObject({ tmdb_id: 981001, year: 2018, poster_path: '/p981001.jpg' })
  })

  it('trims the query, and asks TMDb for non-adult results', async () => {
    await call('GET', '/api/movies/search?q=%20%20wombat%20%20')
    const url = new URL(backend.callsTo('tmdb:/3/search/movie')[0].args.url)
    expect(url.searchParams.get('query')).toBe('wombat')
    expect(url.searchParams.get('include_adult')).toBe('false')
  })

  it('returns an empty list when nothing matches', async () => {
    expect(await call('GET', '/api/movies/search?q=zzzzqq')).toEqual({ status: 200, body: { results: [] } })
  })

  it.each([
    ['no query', '/api/movies/search'],
    ['an empty query', '/api/movies/search?q='],
    ['a blank query', '/api/movies/search?q=%20%20'],
    ['a query over 100 characters', `/api/movies/search?q=${'a'.repeat(101)}`],
  ])('rejects %s without asking TMDb', async (_label, path) => {
    expect((await call('GET', path)).status).toBe(400)
    expect(backend.calls.filter((c) => c.key.startsWith('tmdb:'))).toHaveLength(0)
  })

  it('answers 502 when TMDb is down, and only accepts GET', async () => {
    backend.tmdbDown()
    expect((await call('GET', '/api/movies/search?q=wombat')).status).toBe(502)
    expect((await call('POST', '/api/movies/search?q=wombat')).status).toBe(405)
  })
})

describe('GET /api/movies/trending', () => {
  it('returns what TMDb says is trending', async () => {
    backend.addTmdbMovie({ id: 982001, title: 'Hot Right Now', year: 2025, trending: true })
    const { status, body } = await call('GET', '/api/movies/trending')
    expect(status).toBe(200)
    expect(body.results.map((m) => m.title)).toEqual(['Hot Right Now'])
  })

  it('answers 502 when TMDb is down, and only accepts GET', async () => {
    backend.tmdbDown()
    expect((await call('GET', '/api/movies/trending')).status).toBe(502)
    expect((await call('POST', '/api/movies/trending')).status).toBe(405)
  })
})

describe('GET /api/movies/recommendations', () => {
  const [A, B] = [MOVIES[0], MOVIES[1]]
  const pick = () => backend.addTmdbMovie({ id: 983001, title: 'Recommended One', year: 2022, vote_count: 4000, vote_average: 7.9 })

  it('returns TMDb\'s recommendations for each seed, in order, with ratings', async () => {
    backend.setTmdbRecommendations(A.tmdb_id, [pick()])
    const { status, body } = await call('GET', `/api/movies/recommendations?ids=${A.tmdb_id},${B.tmdb_id}`)

    expect(status).toBe(200)
    expect(body.results.map((r) => r.seed)).toEqual([A.tmdb_id, B.tmdb_id])
    expect(body.results[0].movies[0]).toMatchObject({ tmdb_id: 983001, title: 'Recommended One', tmdb_rating: 7.9, tmdb_votes: 4000 })
    expect(body.results[1].movies).toEqual([])
  })

  it('leaves out a seed TMDb can\'t answer for, and keeps the rest', async () => {
    backend.tmdb.failing.add(A.tmdb_id)
    backend.setTmdbRecommendations(B.tmdb_id, [pick()])
    const { status, body } = await call('GET', `/api/movies/recommendations?ids=${A.tmdb_id},${B.tmdb_id}`)

    expect(status).toBe(200)
    expect(body.results.map((r) => r.seed)).toEqual([B.tmdb_id])
  })

  it('answers 502 only when every seed fails', async () => {
    backend.tmdb.failing.add(A.tmdb_id)
    expect((await call('GET', `/api/movies/recommendations?ids=${A.tmdb_id}`)).status).toBe(502)
  })

  it('removes duplicate seeds', async () => {
    const { body } = await call('GET', `/api/movies/recommendations?ids=${A.tmdb_id},${A.tmdb_id}`)
    expect(body.results).toHaveLength(1)
    expect(backend.callsTo(`tmdb:/3/movie/${A.tmdb_id}/recommendations`)).toHaveLength(1)
  })

  it.each([
    ['no ids', '/api/movies/recommendations'],
    ['an empty list', '/api/movies/recommendations?ids='],
    ['a non-numeric id', '/api/movies/recommendations?ids=abc'],
    ['a negative id', '/api/movies/recommendations?ids=-5'],
    ['more than twelve seeds', `/api/movies/recommendations?ids=${Array.from({ length: 13 }, (_, i) => i + 1).join(',')}`],
  ])('rejects %s without asking TMDb', async (_label, path) => {
    expect((await call('GET', path)).status).toBe(400)
    expect(backend.calls.filter((c) => c.key.startsWith('tmdb:'))).toHaveLength(0)
  })

  it('only accepts GET', async () => {
    expect((await call('POST', `/api/movies/recommendations?ids=${A.tmdb_id}`)).status).toBe(405)
  })
})

describe('/api/profile/media', () => {
  const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
  const put = (token, body) => call('PUT', '/api/profile/media', { token, body })
  const del = (token, kind) => call('DELETE', `/api/profile/media${kind ? `?kind=${kind}` : ''}`, { token })
  const path = (user, kind) => `profile-media/${user.id}/${kind}.jpg`

  it('uploads to <user id>/<kind>.jpg and returns a cache-busted public URL', async () => {
    const { status, body } = await put(tokenFor(alice), { kind: 'avatar', image: JPEG })

    expect(status).toBe(200)
    expect(body.url).toMatch(new RegExp(`^${SUPABASE_URL}/storage/v1/object/public/profile-media/${alice.id}/avatar\\.jpg\\?v=\\d+$`))
    expect(backend.files.get(path(alice, 'avatar'))).toMatchObject({ contentType: 'image/jpeg' })
    expect(Buffer.from(backend.files.get(path(alice, 'avatar')).bytes).toString('base64')).toBe('/9j/4AAQSkZJRg==')
  })

  it('creates the public bucket the first time, with a size and type limit', async () => {
    await put(tokenFor(alice), { kind: 'avatar', image: JPEG })
    expect(backend.buckets.get('profile-media')).toEqual({ public: true, fileSizeLimit: 2 * 1024 * 1024, allowedMimeTypes: ['image/jpeg'] })
  })

  it('works when the bucket already exists, and replaces an existing picture', async () => {
    backend.buckets.set('profile-media', { public: true })
    await put(tokenFor(alice), { kind: 'avatar', image: JPEG })
    await put(tokenFor(alice), { kind: 'avatar', image: 'data:image/jpeg;base64,AAAA' })

    expect(Buffer.from(backend.files.get(path(alice, 'avatar')).bytes).toString('base64')).toBe('AAAA')
    expect(backend.files.size).toBe(1)
  })

  it('keeps avatar and banner apart, and each user\'s files under their own id', async () => {
    await put(tokenFor(alice), { kind: 'avatar', image: JPEG })
    await put(tokenFor(alice), { kind: 'banner', image: JPEG })
    await put(tokenFor(bob), { kind: 'avatar', image: JPEG })

    expect([...backend.files.keys()].sort()).toEqual([path(alice, 'avatar'), path(alice, 'banner'), path(bob, 'avatar')].sort())
  })

  it('ignores any path or user id the client tries to send', async () => {
    await put(tokenFor(alice), { kind: 'avatar', image: JPEG, path: `${bob.id}/avatar.jpg`, userId: bob.id })
    expect([...backend.files.keys()]).toEqual([path(alice, 'avatar')])
  })

  it('deletes a picture, and doesn\'t mind when there isn\'t one', async () => {
    await put(tokenFor(alice), { kind: 'banner', image: JPEG })

    expect(await del(tokenFor(alice), 'banner')).toEqual({ status: 200, body: { ok: true } })
    expect(backend.files.has(path(alice, 'banner'))).toBe(false)
    expect((await del(tokenFor(alice), 'banner')).status).toBe(200)
  })

  it('only deletes the asking user\'s file', async () => {
    await put(tokenFor(alice), { kind: 'avatar', image: JPEG })
    await put(tokenFor(bob), { kind: 'avatar', image: JPEG })

    await del(tokenFor(bob), 'avatar')

    expect(backend.files.has(path(alice, 'avatar'))).toBe(true)
    expect(backend.files.has(path(bob, 'avatar'))).toBe(false)
  })

  it.each([
    ['PUT', (t) => put(t, { kind: 'avatar', image: JPEG })],
    ['DELETE', (t) => del(t, 'avatar')],
  ])('refuses %s without a valid token', async (_method, request) => {
    expect(await request(undefined)).toEqual({ status: 401, body: { error: 'Log in to change your profile.' } })
    expect(await request('garbage')).toEqual({ status: 401, body: { error: 'Log in to change your profile.' } })
    expect(backend.files.size).toBe(0)
  })

  it.each([
    ['no kind', { image: JPEG }],
    ['an unknown kind', { kind: 'cover', image: JPEG }],
    ['a path-like kind', { kind: '../avatar', image: JPEG }],
  ])('rejects %s', async (_label, body) => {
    expect(await put(tokenFor(alice), body)).toEqual({ status: 400, body: { error: 'kind must be avatar or banner' } })
  })

  it.each([
    ['a missing image', { kind: 'avatar' }],
    ['a PNG', { kind: 'avatar', image: 'data:image/png;base64,AAAA' }],
    ['text that isn\'t a data URL', { kind: 'avatar', image: 'hello' }],
    ['a non-string image', { kind: 'avatar', image: 12345 }],
    ['characters that aren\'t base64', { kind: 'avatar', image: 'data:image/jpeg;base64,not base64!' }],
  ])('rejects %s', async (_label, body) => {
    expect(await put(tokenFor(alice), body)).toEqual({ status: 400, body: { error: 'image must be a JPEG data URL' } })
    expect(backend.files.size).toBe(0)
  })

  it('rejects an image over 2 MB', async () => {
    const big = `data:image/jpeg;base64,${'A'.repeat(Math.ceil((2 * 1024 * 1024 * 4) / 3) + 8)}`
    expect(await put(tokenFor(alice), { kind: 'avatar', image: big })).toEqual({ status: 413, body: { error: 'Image is too large' } })
    expect(backend.files.size).toBe(0)
  })

  it('rejects an unknown kind on DELETE too, and any other method', async () => {
    expect((await del(tokenFor(alice))).status).toBe(400)
    expect((await call('GET', '/api/profile/media')).status).toBe(405)
    expect((await call('POST', '/api/profile/media', { token: tokenFor(alice), body: { kind: 'avatar', image: JPEG } })).status).toBe(405)
  })

  it('answers 502 when storage fails', async () => {
    backend.fail('storage:upload', 'disk full', { times: 1 })
    expect(await put(tokenFor(alice), { kind: 'avatar', image: JPEG })).toEqual({ status: 502, body: { error: "Couldn't save that image, try again later." } })

    backend.fail('storage:remove', 'nope', { times: 1 })
    expect((await del(tokenFor(alice), 'avatar')).status).toBe(502)
  })
})

describe('unknown routes', () => {
  it('answers 404', async () => {
    expect((await call('GET', '/api/nope')).status).toBe(404)
    expect((await call('GET', '/api/movies')).status).toBe(404)
  })
})
