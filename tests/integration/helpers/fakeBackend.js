// An in-memory stand-in for everything outside the browser, for integration tests:
//
//   * Supabase: auth, the tables the app reads and writes (with the same row
//     level security rules as supabase/migrations), and the SQL functions the
//     app calls (save_ranking, remove_ranking, get_friendships,
//     send_friend_request, search_users, get_leaderboard). Storage too, for
//     profile pictures.
//   * The network: fetch() sends /api/* requests to the REAL handlers in api/
//     (through the same router the dev server uses) and TMDb requests to a
//     fake TMDb.
//
// What this can't check is the real SQL and RLS. The functions below are ports
// of the migrations, and fakeBackend.test.js pins them to the behaviour the
// migrations document. Real database tests would need `supabase test db`.
//
// Usage: see harness.js. Seed data with addUser / addFriendship / seedList,
// break things with the fail* methods, and look at what happened in `calls`.

import MOVIES from '../../../src/data/movies.json'
import { resolveRoute } from '../../../scripts/vite-api-plugin.js'

export const SUPABASE_URL = 'https://fake-project.supabase.co'
export const PUBLISHABLE_KEY = 'sb_publishable_fake'
export const SERVICE_KEY = 'sb_secret_fake'
export const TMDB_TOKEN = 'tmdb-test-token'

const CATEGORY_ORDER = { loved: 0, okay: 1, meh: 2 }
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/

// ------------------------------------------------------------------ helpers

const clone = (value) => (value === undefined ? undefined : structuredClone(value))

function pgError(message, code, extra = {}) {
  return { message, code, ...extra }
}

// Splits "a, b, movies(x, y)" on commas that aren't inside parentheses.
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

// PostgREST ilike pattern -> RegExp. "\x" is a literal x, "%" any run, "_" any one character.
function likeToRegExp(pattern) {
  let source = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '\\' && i + 1 < pattern.length) source += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    else if (ch === '%') source += '.*'
    else if (ch === '_') source += '.'
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`, 'is')
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    json: async () => clone(body),
    text: async () => JSON.stringify(body),
  }
}

// ------------------------------------------------------------------ backend

export class FakeBackend {
  constructor() {
    this.seq = 0
    this.tick = 0
    this.users = [] // { id, email, password, username, confirmed }
    this.profiles = [] // { id, username, bio, pronouns, is_public, created_at }
    this.movies = [] // the `movies` table
    this.rankings = [] // { user_id, movie_id, position, category, created_at, updated_at }
    this.friendships = [] // { requester_id, addressee_id, status, created_at }
    this.buckets = new Map()
    this.files = new Map()
    this.validTokens = new Set()
    this.tokenSeq = 0

    // Supabase behaviour switches.
    this.confirmEmails = false // sign-up returns no session until the email is confirmed
    this.hideExistingEmails = false // sign-up with a used email "succeeds" with no identities
    this.failRefresh = false // refreshSession() fails (a dead refresh token)

    this.initialUserId = null // logged in when the browser client starts
    this.browser = null // the client the app's supabase.js created
    this.calls = [] // log of everything that happened: [{ key, args }]
    this.failures = [] // injected failures, see fail*()
    this.holds = [] // gates, see hold()
    this.clockBase = Date.now()
    this.closed = false // set after a test ends: late requests never answer

    this.tmdb = { movies: [], trending: [], recommendations: new Map(), down: false, failing: new Set() }
    this.seedCatalogMovies()

    this.fetch = this.fetch.bind(this)
  }

  // ---------------------------------------------------------------- time

  // Strictly increasing timestamps, so "newest first" is deterministic.
  now() {
    this.tick += 1
    return new Date(this.clockBase + this.tick).toISOString()
  }

  // ISO timestamp `days` ago, for ranking old rows into the leaderboard windows.
  daysAgo(days) {
    return new Date(Date.now() - days * 86400000).toISOString()
  }

  id() {
    this.seq += 1
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`
  }

  // ---------------------------------------------------------------- seeding

  // The shared `movies` table starts with the app's catalog, like seed.sql.
  seedCatalogMovies() {
    for (const m of MOVIES) {
      this.movies.push({
        tmdb_id: m.tmdb_id,
        title: m.title,
        year: m.year,
        poster_path: m.poster_path ?? null,
        genres: m.genres ?? [],
        overview: m.overview ?? '',
      })
    }
  }

  catalog(id) {
    const movie = MOVIES.find((m) => m.id === id)
    if (!movie) throw new Error(`Not a catalog movie: ${id}`)
    return movie
  }

  // A movie that isn't in the catalog (what live search finds). Adds it to the
  // fake TMDb (search, details) and, with { saved: true }, to the movies table.
  addTmdbMovie({ id, title, year = 2020, genres = ['Drama'], overview = `${title} overview.`, runtime = 100, director = 'Jane Director', cast = ['Actor One', 'Actor Two'], saved = false, trending = false, poster_path = `/p${id}.jpg`, vote_average = 7.5, vote_count = 5000 } = {}) {
    const raw = {
      id,
      title,
      release_date: `${year}-06-01`,
      poster_path,
      backdrop_path: `/b${id}.jpg`,
      genre_ids: [],
      genres: genres.map((name, i) => ({ id: i + 1, name })),
      overview,
      runtime,
      tagline: `The tagline of ${title}`,
      vote_average,
      vote_count,
      adult: false,
      credits: {
        crew: [{ job: 'Director', name: director }],
        cast: cast.map((name, order) => ({ name, order })),
      },
    }
    this.tmdb.movies.push(raw)
    if (trending) this.tmdb.trending.push(raw)
    if (saved) this.movies.push({ tmdb_id: id, title, year, poster_path, genres, overview })
    return raw
  }

  // Makes catalog movies show up in live search (the fake TMDb only knows what it's told about).
  tmdbKnows(...catalogIds) {
    for (const id of catalogIds) this.tmdb.movies.push(this.rawFromCatalog(id, { genres: (this.catalog(id).genres ?? []).map((name) => ({ name })) }))
  }

  // What TMDb recommends for a seed movie (TMDb ids of movies added with addTmdbMovie
  // or, for catalog movies, raw objects built from the catalog).
  setTmdbRecommendations(seedTmdbId, rawMovies) {
    this.tmdb.recommendations.set(seedTmdbId, rawMovies)
  }

  rawFromCatalog(id, extra = {}) {
    const m = this.catalog(id)
    return { id: m.tmdb_id, title: m.title, release_date: `${m.year}-01-01`, poster_path: m.poster_path, genre_ids: [], overview: m.overview, vote_average: 8, vote_count: 10000, adult: false, ...extra }
  }

  addUser({ username, email = `${username.toLowerCase()}@example.com`, password = 'password123', is_public = true, bio = null, pronouns = null, confirmed = true } = {}) {
    const id = this.id()
    const user = { id, email, password, username, confirmed }
    this.users.push(user)
    this.profiles.push({ id, username, bio, pronouns, is_public, created_at: this.now() })
    return user
  }

  addFriendship(a, b, status = 'accepted') {
    this.friendships.push({ requester_id: a.id, addressee_id: b.id, status, created_at: this.now() })
  }

  // Ranks movies for a user, in order, each into its category (default 'loved').
  // entries: catalog ids, or { movie, category, tied, createdAt }.
  seedList(user, entries) {
    for (const entry of entries) {
      const { movie, category = 'loved', tied = false, createdAt } = typeof entry === 'string' || typeof entry === 'number' ? { movie: entry } : entry
      const tmdbId = typeof movie === 'number' ? movie : this.catalog(movie).tmdb_id
      const tiersInCategory = new Set(this.rankings.filter((r) => r.user_id === user.id && r.category === category).map((r) => r.position)).size
      this.saveRanking(user.id, tmdbId, category, tied ? Math.max(0, tiersInCategory - 1) : tiersInCategory, tied)
      if (createdAt) {
        const row = this.rankings.find((r) => r.user_id === user.id && r.movie_id === tmdbId)
        row.created_at = createdAt
      }
    }
  }

  // A user's list as [[catalogId or tmdb id, ...], ...] best first (one array per tier).
  listOf(user) {
    const byPosition = new Map()
    for (const r of this.rankings.filter((row) => row.user_id === user.id)) {
      if (!byPosition.has(r.position)) byPosition.set(r.position, [])
      byPosition.get(r.position).push(r)
    }
    return [...byPosition.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, rows]) => rows.map((r) => MOVIES.find((m) => m.tmdb_id === r.movie_id)?.id ?? `tmdb-${r.movie_id}`))
  }

  rankingOf(user, tmdbId) {
    return this.rankings.find((r) => r.user_id === user.id && r.movie_id === tmdbId) ?? null
  }

  profileOf(user) {
    return this.profiles.find((p) => p.id === user.id)
  }

  // Start the browser already logged in as `user` (a saved session).
  signInAs(user) {
    this.initialUserId = user.id
  }

  // ---------------------------------------------------------------- failures and gates

  // Keys: 'rpc:<name>', 'from:<table>:<select|insert|update|delete|upsert>',
  // 'auth:<method>', and for the network 'GET /api/movies/search'.
  // error: for Supabase, { message, status?, code? } or a string; for the
  // network, { status, body } or { network: true }.
  fail(key, error = 'Something broke', { times = Infinity } = {}) {
    this.failures.push({ key, error, times })
  }

  failRpc(name, error, opts) {
    this.fail(`rpc:${name}`, error, opts)
  }

  failQuery(table, op, error, opts) {
    this.fail(`from:${table}:${op}`, error, opts)
  }

  failAuth(method, error, opts) {
    this.fail(`auth:${method}`, error, opts)
  }

  // Make a network request fail: { status: 500 } for an error response, or
  // { network: true } for no response at all.
  failApi(request, error = { status: 500, body: { error: 'Boom' } }, opts) {
    this.fail(request, error, opts)
  }

  // Called when a test ends. Anything still in flight just never resolves.
  close() {
    this.closed = true
  }

  async whileOpen() {
    if (this.closed) await new Promise(() => {})
  }

  tmdbDown() {
    this.tmdb.down = true
  }

  takeFailure(key) {
    const failure = this.failures.find((f) => f.key === key && f.times > 0)
    if (!failure) return null
    failure.times -= 1
    return failure.error
  }

  // Pauses the next call with this key until release() is called, to look at loading states.
  hold(key) {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    this.holds.push({ key, gate })
    return { release }
  }

  async gate(key) {
    const at = this.holds.findIndex((h) => h.key === key)
    if (at === -1) return
    const [{ gate }] = this.holds.splice(at, 1)
    await gate
  }

  log(key, args) {
    this.calls.push({ key, args })
  }

  callsTo(key) {
    return this.calls.filter((c) => c.key === key)
  }

  // ---------------------------------------------------------------- auth

  makeSession(user) {
    this.tokenSeq += 1
    const access_token = `at-${user.id}-${this.tokenSeq}`
    this.validTokens.add(access_token)
    return {
      access_token,
      refresh_token: `rt-${user.id}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: user.id, email: user.email, user_metadata: { username: user.username } },
    }
  }

  // Makes every access token issued so far invalid on the server (but the
  // browser still holds them): what an expired token looks like.
  invalidateTokens(user) {
    for (const token of [...this.validTokens]) if (token.startsWith(`at-${user.id}-`)) this.validTokens.delete(token)
  }

  userByToken(token) {
    if (!this.validTokens.has(token)) return null
    const id = /^at-(.+)-\d+$/.exec(token)?.[1]
    return this.users.find((u) => u.id === id) ?? null
  }

  // ---------------------------------------------------------------- row level security

  areFriends(a, b) {
    return this.friendships.some(
      (f) => f.status === 'accepted' && ((f.requester_id === a && f.addressee_id === b) || (f.requester_id === b && f.addressee_id === a)),
    )
  }

  canView(uid, target) {
    return target === uid || Boolean(this.profiles.find((p) => p.id === target)?.is_public) || (uid !== null && this.areFriends(uid, target))
  }

  // ---------------------------------------------------------------- SQL functions

  // Port of save_ranking in 20261103000000_ranking_categories.sql.
  saveRanking(uid, movieId, category, position, tied = false) {
    if (!uid) throw pgError('Not signed in', '28000')
    if (!(category in CATEGORY_ORDER)) throw pgError('Category must be loved, okay or meh', '22023')
    if (position === null || position === undefined || position < 0) throw pgError('Position must be 0 or more', '22023')
    if (!this.movies.some((m) => m.tmdb_id === movieId)) {
      throw pgError('insert or update on table "rankings" violates foreign key constraint "rankings_movie_id_fkey"', '23503')
    }

    const mine = () => this.rankings.filter((r) => r.user_id === uid)
    let firstRanked = null
    const existing = this.rankings.findIndex((r) => r.user_id === uid && r.movie_id === movieId)
    if (existing !== -1) {
      const [old] = this.rankings.splice(existing, 1)
      firstRanked = old.created_at
      if (!mine().some((r) => r.position === old.position)) {
        for (const r of mine()) if (r.position > old.position) r.position -= 1
      }
    }

    const distinct = (rows) => new Set(rows.map((r) => r.position)).size
    const offsetTiers = distinct(mine().filter((r) => CATEGORY_ORDER[r.category] < CATEGORY_ORDER[category]))
    const categoryTiers = distinct(mine().filter((r) => r.category === category))
    const localPos = Math.min(position, categoryTiers)
    const at = offsetTiers + localPos

    if (!(tied && localPos < categoryTiers)) {
      for (const r of mine()) if (r.position >= at) r.position += 1
    }
    const stamp = this.now()
    this.rankings.push({ user_id: uid, movie_id: movieId, position: at, category, created_at: firstRanked ?? stamp, updated_at: stamp })
  }

  // Port of remove_ranking in the init migration.
  removeRanking(uid, movieId) {
    if (!uid) throw pgError('Not signed in', '28000')
    const at = this.rankings.findIndex((r) => r.user_id === uid && r.movie_id === movieId)
    if (at === -1) return
    const [old] = this.rankings.splice(at, 1)
    if (!this.rankings.some((r) => r.user_id === uid && r.position === old.position)) {
      for (const r of this.rankings) if (r.user_id === uid && r.position > old.position) r.position -= 1
    }
  }

  getFriendships(uid) {
    if (!uid) return []
    return this.friendships
      .filter((f) => f.requester_id === uid || f.addressee_id === uid)
      .map((f) => {
        const otherId = f.requester_id === uid ? f.addressee_id : f.requester_id
        const profile = this.profiles.find((p) => p.id === otherId)
        return profile && {
          user_id: profile.id,
          username: profile.username,
          direction: f.status === 'accepted' ? 'friends' : f.addressee_id === uid ? 'incoming' : 'outgoing',
          created_at: f.created_at,
        }
      })
      .filter(Boolean)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  }

  sendFriendRequest(uid, other) {
    if (!uid) throw pgError('Not signed in', '28000')
    if (!other || other === uid) throw pgError("You can't add yourself", '22023')
    if (!this.profiles.some((p) => p.id === other)) throw pgError('User not found', 'P0002')
    const existing = this.friendships.find(
      (f) => (f.requester_id === uid && f.addressee_id === other) || (f.requester_id === other && f.addressee_id === uid),
    )
    if (!existing) {
      this.friendships.push({ requester_id: uid, addressee_id: other, status: 'pending', created_at: this.now() })
      return 'sent'
    }
    if (existing.status === 'accepted') return 'already_friends'
    if (existing.requester_id === uid) return 'already_sent'
    existing.status = 'accepted'
    return 'accepted'
  }

  searchUsers(uid, q) {
    const text = String(q ?? '').trim()
    if (!uid || text.length < 2) return []
    return this.profiles
      .filter((p) => p.username.toLowerCase().startsWith(text.toLowerCase()))
      .sort((a, b) => a.username.localeCompare(b.username))
      .slice(0, 20)
      .map((p) => ({ id: p.id, username: p.username }))
  }

  // Port of get_leaderboard (latest version, in the ranking_categories migration).
  getLeaderboard(period = 'weekly', category = 'highest', limit = 10) {
    const days = { weekly: 7, monthly: 30 }[period]
    if (!days) return []
    const cutoff = Date.now() - days * 86400000

    const scored = []
    const byUser = new Map()
    for (const r of this.rankings) {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, [])
      byUser.get(r.user_id).push(r)
    }
    for (const rows of byUser.values()) {
      for (const r of rows) {
        const catTotal = rows.filter((x) => x.category === r.category).length
        const tierSize = rows.filter((x) => x.position === r.position).length
        const throughTier = rows.filter((x) => x.category === r.category && x.position <= r.position).length
        const fromTop = catTotal - 1 > 0 ? 1 - ((throughTier - tierSize) + (tierSize - 1) / 2) / (catTotal - 1) : 0.5
        const [min, max] = { loved: [6.0, 10.0], okay: [4.0, 5.9], meh: [0.0, 3.9] }[r.category]
        if (new Date(r.created_at).getTime() >= cutoff) scored.push({ movie_id: r.movie_id, score: min + (max - min) * fromTop })
      }
    }

    const byMovie = new Map()
    for (const s of scored) {
      if (!byMovie.has(s.movie_id)) byMovie.set(s.movie_id, [])
      byMovie.get(s.movie_id).push(s.score)
    }
    const rows = []
    for (const [movieId, scores] of byMovie) {
      const movie = this.movies.find((m) => m.tmdb_id === movieId)
      if (!movie) continue
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length
      rows.push({ movie_id: movieId, title: movie.title, year: movie.year, poster_path: movie.poster_path, score: Math.round(avg * 10) / 10, rankers: scores.length })
    }
    rows.sort((a, b) =>
      (category === 'watched' ? b.rankers - a.rankers : 0) || b.score - a.score || b.rankers - a.rankers || a.title.localeCompare(b.title),
    )
    const cap = Math.min(Math.max(limit ?? 10, 1), 100)
    return rows.slice(0, cap).map((row, i) => ({ ...row, rank: i + 1 }))
  }

  // ---------------------------------------------------------------- clients

  // What `createClient` from @supabase/supabase-js returns in tests.
  //   service key                          -> admin client (skips RLS)
  //   publishable key, persistSession:false -> a server-side client (api/login.js)
  //   publishable key otherwise            -> the browser client (supabase.js)
  createClient(url, key, options = {}) {
    if (key === SERVICE_KEY) return new FakeClient(this, { role: 'service' })
    if (options?.auth?.persistSession === false) return new FakeClient(this, { role: 'user' })
    const client = new FakeClient(this, { role: 'user', browser: true })
    this.browser = client
    return client
  }

  // ---------------------------------------------------------------- network

  async fetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input.href ?? String(input), 'http://localhost')
    const method = (init.method ?? 'GET').toUpperCase()
    const key = `${method} ${url.pathname}`
    this.log(`fetch:${key}`, { url: url.href, init })
    await this.whileOpen()

    const injected = this.takeFailure(key)
    if (injected) {
      if (injected.network) throw new TypeError('Failed to fetch')
      return jsonResponse(injected.status ?? 500, injected.body ?? { error: 'Boom' })
    }
    await this.gate(key)

    if (url.hostname === 'api.themoviedb.org') return this.tmdbRequest(url, init)
    if (url.pathname.startsWith('/api/')) return this.callHandler(url, method, init)
    return jsonResponse(404, { error: 'Not found' })
  }

  // Runs the real handler in api/ the way scripts/vite-api-plugin.js does.
  async callHandler(url, method, init) {
    const route = resolveRoute(url.pathname)
    if (!route) return jsonResponse(404, { error: 'Not found' })

    let body
    if (['POST', 'PUT', 'PATCH'].includes(method) && init.body) {
      try { body = JSON.parse(init.body) } catch { body = init.body }
    }
    const headers = {}
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = v
    const req = { method, query: { ...Object.fromEntries(url.searchParams), ...route.params }, body, headers }
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(payload) { this.payload = payload; return this },
      setHeader() {},
    }
    try {
      const { default: handler } = await import(/* @vite-ignore */ route.file)
      await handler(req, res)
    } catch (error) {
      return jsonResponse(500, { error: `Internal error: ${error.message}` })
    }
    return jsonResponse(res.statusCode, res.payload ?? {})
  }

  // The parts of TMDb the app uses (api/_lib/tmdb.js talks to https://api.themoviedb.org/3).
  tmdbRequest(url, init) {
    const t = this.tmdb
    this.log(`tmdb:${url.pathname}`, { url: url.href })
    const auth = init.headers?.Authorization ?? init.headers?.authorization
    if (auth !== `Bearer ${TMDB_TOKEN}`) return jsonResponse(401, { status_message: 'Invalid API key' })
    if (t.down) return jsonResponse(503, { status_message: 'Service unavailable' })
    const path = url.pathname.replace(/^\/3/, '')

    if (path === '/search/movie') {
      const q = (url.searchParams.get('query') ?? '').toLowerCase()
      return jsonResponse(200, { results: t.movies.filter((m) => m.title.toLowerCase().includes(q)) })
    }
    if (path === '/trending/movie/week') return jsonResponse(200, { results: t.trending })

    const recs = /^\/movie\/(\d+)\/recommendations$/.exec(path)
    if (recs) {
      const id = Number(recs[1])
      if (t.failing.has(id)) return jsonResponse(500, { status_message: 'Boom' })
      return jsonResponse(200, { results: t.recommendations.get(id) ?? [] })
    }

    const details = /^\/movie\/(\d+)$/.exec(path)
    if (details) {
      const id = Number(details[1])
      if (t.failing.has(id)) return jsonResponse(500, { status_message: 'Boom' })
      const known = t.movies.find((m) => m.id === id)
      if (known) return jsonResponse(200, known)
      const catalog = MOVIES.find((m) => m.tmdb_id === id)
      if (catalog) return jsonResponse(200, this.rawFromCatalog(catalog.id, { genres: (catalog.genres ?? []).map((name) => ({ name })) }))
      return jsonResponse(404, { status_message: 'The resource you requested could not be found.' })
    }
    return jsonResponse(404, { status_message: 'Not found' })
  }
}

// ------------------------------------------------------------------ client

class FakeClient {
  constructor(backend, { role, browser = false }) {
    this.backend = backend
    this.role = role // 'user' | 'service'
    this.session = null
    this.listeners = new Set()

    if (browser && backend.initialUserId) {
      const user = backend.users.find((u) => u.id === backend.initialUserId)
      if (user) this.session = backend.makeSession(user)
    }

    this.auth = this.buildAuth()
    this.storage = this.buildStorage()
    this.rpc = this.rpc.bind(this)
  }

  // Who the database sees: a valid access token, no session, or an expired token.
  context() {
    if (this.role === 'service') return { uid: null, service: true, expired: false }
    if (!this.session) return { uid: null, service: false, expired: false }
    const valid = this.backend.validTokens.has(this.session.access_token)
    return { uid: valid ? this.session.user.id : null, service: false, expired: !valid }
  }

  notify(event) {
    // Supabase calls listeners asynchronously, like this.
    for (const listener of [...this.listeners]) Promise.resolve().then(() => listener(event, this.session))
  }

  setSession(session, event) {
    this.session = session
    this.notify(event)
  }

  from(table) {
    return new Query(this, table)
  }

  async rpc(name, args = {}) {
    const b = this.backend
    const key = `rpc:${name}`
    b.log(key, args)
    await Promise.resolve()
    await b.whileOpen()
    const injected = b.takeFailure(key)
    if (injected) return { data: null, error: typeof injected === 'string' ? { message: injected } : injected }
    await b.gate(key)

    const ctx = this.context()
    if (ctx.expired) return { data: null, error: pgError('JWT expired', 'PGRST303') }
    const uid = ctx.uid
    try {
      switch (name) {
        case 'save_ranking':
          b.saveRanking(uid, args.p_movie_id, args.p_category, args.p_position, args.p_tied ?? false)
          return { data: null, error: null }
        case 'remove_ranking':
          b.removeRanking(uid, args.p_movie_id)
          return { data: null, error: null }
        case 'get_friendships':
          return { data: b.getFriendships(uid), error: null }
        case 'send_friend_request':
          return { data: b.sendFriendRequest(uid, args.p_user_id), error: null }
        case 'search_users':
          return { data: b.searchUsers(uid, args.q), error: null }
        // Movie Blend isn't simulated: everyone just has no blends and no invites.
        case 'get_my_blends':
        case 'get_my_blend_invites':
          return { data: [], error: null }
        case 'get_leaderboard':
          return { data: b.getLeaderboard(args.p_period, args.p_category, args.p_limit), error: null }
        default:
          return { data: null, error: pgError(`Could not find the function public.${name}`, 'PGRST202') }
      }
    } catch (error) {
      return { data: null, error: error.code ? error : { message: error.message } }
    }
  }

  buildAuth() {
    const client = this
    const b = this.backend
    // Shared by the methods below: record the call, apply injected failures.
    const enter = async (method, args) => {
      b.log(`auth:${method}`, args)
      await Promise.resolve()
      await b.whileOpen()
      const injected = b.takeFailure(`auth:${method}`)
      if (injected) return typeof injected === 'string' ? { message: injected } : injected
      await b.gate(`auth:${method}`)
      return null
    }
    const authError = (status, message) => ({ status, message, name: 'AuthApiError' })

    return {
      onAuthStateChange(callback) {
        client.listeners.add(callback)
        Promise.resolve().then(() => callback('INITIAL_SESSION', client.session))
        return { data: { subscription: { unsubscribe: () => client.listeners.delete(callback) } } }
      },

      async getSession() {
        const error = await enter('getSession', {})
        return error ? { data: { session: null }, error } : { data: { session: client.session }, error: null }
      },

      async refreshSession() {
        const error = await enter('refreshSession', {})
        if (error) return { data: { session: null, user: null }, error }
        const user = client.session && b.users.find((u) => u.id === client.session.user.id)
        if (!user || b.failRefresh) return { data: { session: null, user: null }, error: authError(400, 'Invalid Refresh Token: Refresh Token Not Found') }
        client.setSession(b.makeSession(user), 'TOKEN_REFRESHED')
        return { data: { session: client.session, user: client.session.user }, error: null }
      },

      async signOut() {
        const error = await enter('signOut', {})
        if (error) return { error }
        client.setSession(null, 'SIGNED_OUT')
        return { error: null }
      },

      async signInWithPassword({ email, password }) {
        const error = await enter('signInWithPassword', { email })
        if (error) return { data: { user: null, session: null }, error }
        const user = b.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase())
        if (!user || user.password !== password) {
          return { data: { user: null, session: null }, error: authError(400, 'Invalid login credentials') }
        }
        if (!user.confirmed) return { data: { user: null, session: null }, error: authError(400, 'Email not confirmed') }
        const session = b.makeSession(user)
        // The browser client keeps its session and tells listeners; server-side clients just return it.
        if (client === b.browser) client.setSession(session, 'SIGNED_IN')
        else client.session = session
        return { data: { user: session.user, session }, error: null }
      },

      async setSession({ access_token, refresh_token }) {
        const error = await enter('setSession', {})
        if (error) return { data: { user: null, session: null }, error }
        const user = b.userByToken(access_token)
        if (!user) return { data: { user: null, session: null }, error: authError(401, 'invalid JWT') }
        const session = { ...b.makeSession(user), refresh_token }
        client.setSession(session, 'SIGNED_IN')
        return { data: { user: session.user, session }, error: null }
      },

      async signUp({ email, password, options = {} }) {
        const error = await enter('signUp', { email, options })
        if (error) return { data: { user: null, session: null }, error }
        if (String(password ?? '').length < 6) return { data: { user: null, session: null }, error: authError(422, 'Password should be at least 6 characters.') }
        if (b.users.some((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
          if (b.hideExistingEmails) return { data: { user: { id: b.id(), identities: [] }, session: null }, error: null }
          return { data: { user: null, session: null }, error: authError(422, 'User already registered') }
        }
        // The on_auth_user_created trigger inserts the profile; a bad or taken username fails the whole sign-up.
        const username = options?.data?.username
        const taken = b.profiles.some((p) => p.username.toLowerCase() === String(username).toLowerCase())
        if (!USERNAME_PATTERN.test(username ?? '') || taken) {
          return { data: { user: null, session: null }, error: authError(500, 'Database error saving new user') }
        }
        const user = b.addUser({ username, email, password, confirmed: !b.confirmEmails })
        if (b.confirmEmails) return { data: { user: { id: user.id, email, identities: [{}] }, session: null }, error: null }
        const session = b.makeSession(user)
        client.setSession(session, 'SIGNED_IN')
        return { data: { user: session.user, session }, error: null }
      },

      // Server-side (service role) helpers used by api/ handlers.
      async getUser(token) {
        const error = await enter('getUser', {})
        if (error) return { data: { user: null }, error }
        const user = b.userByToken(token)
        return user
          ? { data: { user: { id: user.id, email: user.email, user_metadata: { username: user.username } } }, error: null }
          : { data: { user: null }, error: authError(401, 'invalid JWT: token is expired') }
      },
      admin: {
        async getUserById(id) {
          const error = await enter('getUserById', { id })
          if (error) return { data: { user: null }, error }
          const user = b.users.find((u) => u.id === id)
          return user
            ? { data: { user: { id: user.id, email: user.email } }, error: null }
            : { data: { user: null }, error: authError(404, 'User not found') }
        },
      },
    }
  }

  buildStorage() {
    const b = this.backend
    return {
      async getBucket(name) {
        return b.buckets.has(name) ? { data: { name, ...b.buckets.get(name) }, error: null } : { data: null, error: { message: 'Bucket not found' } }
      },
      async createBucket(name, options) {
        if (b.buckets.has(name)) return { data: null, error: { message: 'The resource already exists' } }
        b.buckets.set(name, options)
        return { data: { name }, error: null }
      },
      from(bucket) {
        return {
          async upload(path, bytes, options) {
            const key = `${bucket}/${path}`
            if (b.takeFailure('storage:upload')) return { data: null, error: { message: 'Upload failed' } }
            if (b.files.has(key) && !options?.upsert) return { data: null, error: { message: 'The resource already exists' } }
            b.files.set(key, { bytes, contentType: options?.contentType })
            return { data: { path }, error: null }
          },
          async remove(paths) {
            if (b.takeFailure('storage:remove')) return { data: null, error: { message: 'Remove failed' } }
            for (const path of paths) b.files.delete(`${bucket}/${path}`)
            return { data: paths.map((name) => ({ name })), error: null }
          },
          getPublicUrl(path) {
            return { data: { publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}` } }
          },
        }
      },
    }
  }
}

// ------------------------------------------------------------------ queries

// Which table an embedded select (movies(...)) points at, per table.
const EMBEDS = { rankings: { movies: { local: 'movie_id', foreign: 'tmdb_id', table: 'movies' } } }

// A query builder like supabase-js's: chain filters, then await it.
class Query {
  constructor(client, table) {
    this.client = client
    this.backend = client.backend
    this.table = table
    this.op = 'select'
    this.cols = '*'
    this.filters = []
    this.orders = []
    this.limitTo = null
    this.expect = null // 'single' | 'maybe'
    this.returning = false
  }

  select(cols = '*') {
    if (this.op === 'select') this.cols = cols
    else {
      this.returning = true
      this.cols = cols
    }
    return this
  }

  insert(row) { this.op = 'insert'; this.row = row; return this }
  upsert(row, { onConflict } = {}) { this.op = 'upsert'; this.row = row; this.conflict = onConflict; return this }
  update(patch) { this.op = 'update'; this.patch = patch; return this }
  delete() { this.op = 'delete'; return this }

  eq(col, value) { this.filters.push((r) => r[col] === value); return this }
  in(col, values) { this.filters.push((r) => values.includes(r[col])); return this }
  ilike(col, pattern) {
    const re = likeToRegExp(pattern)
    this.filters.push((r) => re.test(String(r[col] ?? '')))
    return this
  }

  // .or('and(a.eq.1,b.eq.2),and(a.eq.2,b.eq.1)')
  or(expression) {
    const groups = [...expression.matchAll(/and\(([^)]*)\)/g)].map((m) =>
      m[1].split(',').map((part) => {
        const [col, op, ...rest] = part.split('.')
        if (op !== 'eq') throw new Error(`fake or(): unsupported operator ${op}`)
        return [col, rest.join('.')]
      }),
    )
    this.filters.push((r) => groups.some((conds) => conds.every(([col, value]) => String(r[col]) === value)))
    return this
  }

  order(col, { ascending = true } = {}) { this.orders.push({ col, ascending }); return this }
  limit(n) { this.limitTo = n; return this }
  single() { this.expect = 'single'; return this }
  maybeSingle() { this.expect = 'maybe'; return this }

  then(resolve, reject) {
    return this.execute().then(resolve, reject)
  }

  // ---- the part that behaves like the database

  get rowsOfTable() {
    return this.backend[this.table]
  }

  // Row level security: may this user see this row?
  canSee(row, ctx) {
    if (ctx.service) return true
    const b = this.backend
    switch (this.table) {
      case 'profiles': return b.canView(ctx.uid, row.id)
      case 'rankings': return b.canView(ctx.uid, row.user_id)
      case 'friendships': return ctx.uid !== null && (row.requester_id === ctx.uid || row.addressee_id === ctx.uid)
      case 'movies': return true
      default: throw new Error(`fake: no RLS policy for table ${this.table}`)
    }
  }

  project(row, cols) {
    if (cols === '*') return { ...row }
    const out = {}
    for (const token of splitTopLevel(cols)) {
      const embed = /^(\w+)\((.*)\)$/s.exec(token)
      if (embed) {
        const spec = EMBEDS[this.table]?.[embed[1]]
        if (!spec) throw new Error(`fake: unknown embed ${embed[1]} on ${this.table}`)
        const target = this.backend[spec.table].find((r) => r[spec.foreign] === row[spec.local])
        out[embed[1]] = target ? this.project.call({ backend: this.backend, table: spec.table }, target, embed[2]) : null
      } else out[token] = row[token]
    }
    return out
  }

  async execute() {
    const b = this.backend
    const key = `from:${this.table}:${this.op}`
    b.log(key, { cols: this.cols })
    await Promise.resolve()
    await b.whileOpen()
    const injected = b.takeFailure(key)
    if (injected) return { data: null, error: typeof injected === 'string' ? { message: injected } : injected }
    await b.gate(key)

    const ctx = this.client.context()
    if (ctx.expired) return { data: null, error: pgError('JWT expired', 'PGRST303') }

    let rows
    try {
      rows = this.run(ctx)
    } catch (error) {
      return { data: null, error: error.code ? error : { message: error.message } }
    }

    if (this.expect) {
      if (rows.length > 1 || (this.expect === 'single' && rows.length === 0)) {
        return { data: null, error: pgError('JSON object requested, multiple (or no) rows returned', 'PGRST116') }
      }
      return { data: rows[0] ?? null, error: null }
    }
    const returnsRows = this.op === 'select' || this.returning
    return { data: returnsRows ? rows : null, error: null }
  }

  // Applies the operation and returns the affected (or selected) rows, projected.
  run(ctx) {
    const b = this.backend
    const matches = (row) => this.canSee(row, ctx) && this.filters.every((f) => f(row))
    const out = (rows) => rows.map((r) => clone(this.project(r, this.cols)))

    if (this.op === 'select') {
      let rows = this.rowsOfTable.filter(matches)
      rows = [...rows].sort((x, y) => {
        for (const { col, ascending } of this.orders) {
          if (x[col] === y[col]) continue
          return (x[col] > y[col] ? 1 : -1) * (ascending ? 1 : -1)
        }
        return 0
      })
      if (this.limitTo !== null) rows = rows.slice(0, this.limitTo)
      return out(rows)
    }

    if (this.op === 'update') {
      const allowed = (row) => {
        if (ctx.service) return true
        if (this.table === 'profiles') return row.id === ctx.uid
        // addressee accepts: only `status`, and only to 'accepted'
        if (this.table === 'friendships') return row.addressee_id === ctx.uid && Object.keys(this.patch).every((k) => k === 'status') && this.patch.status === 'accepted'
        return false
      }
      const hit = this.rowsOfTable.filter((r) => matches(r) && allowed(r))
      for (const row of hit) Object.assign(row, clone(this.patch))
      if (this.table === 'profiles') this.checkProfiles(hit)
      return out(hit)
    }

    if (this.op === 'delete') {
      const allowed = (row) => ctx.service || (this.table === 'friendships' && ctx.uid !== null && (row.requester_id === ctx.uid || row.addressee_id === ctx.uid))
      const hit = this.rowsOfTable.filter((r) => matches(r) && allowed(r))
      const keep = this.rowsOfTable.filter((r) => !hit.includes(r))
      b[this.table].splice(0, b[this.table].length, ...keep)
      return out(hit)
    }

    if (this.op === 'insert' || this.op === 'upsert') {
      if (!ctx.service) throw pgError(`new row violates row-level security policy for table "${this.table}"`, '42501')
      if (this.table !== 'movies') throw new Error(`fake: insert into ${this.table} isn't supported`)
      const row = clone(this.row)
      const at = this.rowsOfTable.findIndex((r) => r.tmdb_id === row.tmdb_id)
      if (at !== -1 && this.op === 'insert') throw pgError('duplicate key value violates unique constraint', '23505')
      if (at !== -1) Object.assign(this.rowsOfTable[at], row)
      else this.rowsOfTable.push(row)
      return out([this.rowsOfTable.find((r) => r.tmdb_id === row.tmdb_id)])
    }
    throw new Error(`fake: unsupported operation ${this.op}`)
  }

  // Check constraints on profiles (see the init migration).
  checkProfiles(rows) {
    for (const row of rows) {
      if (row.bio !== null && [...row.bio].length > 300) throw pgError('new row for relation "profiles" violates check constraint "profiles_bio_check"', '23514')
      if (row.pronouns !== null && [...row.pronouns].length > 30) throw pgError('new row for relation "profiles" violates check constraint "profiles_pronouns_check"', '23514')
    }
  }
}
