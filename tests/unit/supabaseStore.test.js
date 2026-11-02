import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fake Supabase client. Tests set `db.rows`, `db.username`, and the
// `fail*` flags, then fire login/logout through `fireAuth`.
const db = vi.hoisted(() => ({
  rows: [],
  username: 'reil',
  failLoad: false,
  failRpc: false,
  failSignOut: false,
  rpcCalls: [],
  authCallback: null,
  saveCalls: [],
  failSaveMovie: false,
}))

// Fake API client: records which movies the store asked the server to save.
vi.mock('../../src/lib/movies.js', () => ({
  saveMovie: async (tmdbId, token) => {
    db.saveCalls.push({ tmdbId, token })
    if (db.failSaveMovie) throw new Error('server down')
    return { tmdb_id: tmdbId }
  },
}))

vi.mock('../../src/lib/supabase.js', () => {
  // Mimics supabase.from(table).select().eq().order()... : chainable and awaitable.
  function query(table) {
    const result = () =>
      table === 'profiles'
        ? { data: { username: db.username }, error: null }
        : db.failLoad
          ? { data: null, error: { message: 'network down' } }
          : { data: db.rows, error: null }
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      maybeSingle: () => Promise.resolve(result()),
      then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
    }
    return chain
  }
  return {
    supabase: {
      from: query,
      rpc: async (name, args) => {
        db.rpcCalls.push({ name, args })
        return db.failRpc ? { data: null, error: { message: 'boom' } } : { data: null, error: null }
      },
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'token-123' } }, error: null }),
        onAuthStateChange: (callback) => {
          db.authCallback = callback
          return { data: { subscription: { unsubscribe() {} } } }
        },
        signOut: async () => {
          if (db.failSignOut) return { error: { message: 'nope' } }
          db.authCallback('SIGNED_OUT', null)
          return { error: null }
        },
      },
    },
  }
})

// Lets the store's deferred auth handling and async loads finish.
const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

const USER = { id: 'user-1', user_metadata: { username: 'reil_meta' } }
const tierIds = (tiers) => tiers.map((tier) => tier.map((m) => m.id))

// TMDb ids of a few catalog movies (see src/data/movies.json).
const DUNE = 693134 // dune-part-two-2024
const PAST_LIVES = 666277 // past-lives-2023
const SPIDER_VERSE = 569094 // spider-man-across-the-spider-verse-2023
// A movie outside the catalog, as the joined `movies` row returns it.
const PADDINGTON = 346648 // Paddington 2, not in the catalog
const PADDINGTON_ROW = { tmdb_id: PADDINGTON, title: 'Paddington 2', year: 2017, poster_path: '/a.jpg', genres: ['Drama'], overview: '' }

let store

async function freshStore() {
  vi.resetModules()
  store = await import('../../src/lib/supabaseStore.js')
  store.startAuth()
}

async function logIn() {
  db.authCallback('SIGNED_IN', { user: USER })
  await settle()
}

beforeEach(async () => {
  Object.assign(db, {
    rows: [],
    username: 'reil',
    failLoad: false,
    failRpc: false,
    failSignOut: false,
    rpcCalls: [],
    saveCalls: [],
    failSaveMovie: false,
  })
  await freshStore()
})

describe('rowsToTiers', () => {
  it('groups rows that share a position into one tier, best first', () => {
    const tiers = store.rowsToTiers([
      { movie_id: SPIDER_VERSE, position: 1 },
      { movie_id: DUNE, position: 0 },
      { movie_id: PAST_LIVES, position: 1 },
    ])
    expect(tierIds(tiers)).toEqual([
      ['dune-part-two-2024'],
      ['spider-man-across-the-spider-verse-2023', 'past-lives-2023'],
    ])
  })

  it('builds movies outside the catalog from the joined movies row', () => {
    const tiers = store.rowsToTiers([
      { movie_id: DUNE, position: 0 },
      { movie_id: PADDINGTON, position: 1, movies: PADDINGTON_ROW },
    ])
    expect(tierIds(tiers)).toEqual([['dune-part-two-2024'], ['tmdb-346648']])
    expect(tiers[1][0]).toMatchObject({ title: 'Paddington 2', year: 2017, genres: ['Drama'] })
  })

  it('skips rows it cannot build a movie for and closes the gap', () => {
    const tiers = store.rowsToTiers([
      { movie_id: DUNE, position: 0 },
      { movie_id: 999999999, position: 1 },
      { movie_id: PAST_LIVES, position: 2 },
    ])
    expect(tierIds(tiers)).toEqual([['dune-part-two-2024'], ['past-lives-2023']])
  })

  it('handles no rows', () => {
    expect(store.rowsToTiers([])).toEqual([])
    expect(store.rowsToTiers(null)).toEqual([])
  })
})

describe('login state', () => {
  it('starts loading, then is signed out when there is no saved session', async () => {
    expect(store.getState().status).toBe('loading')
    db.authCallback('INITIAL_SESSION', null)
    await settle()
    expect(store.getState()).toMatchObject({ status: 'signed-out', user: null, tiers: [] })
  })

  it('loads the list and username after login', async () => {
    db.rows = [{ movie_id: DUNE, position: 0 }, { movie_id: PAST_LIVES, position: 1 }]
    await logIn()
    expect(store.getState().status).toBe('ready')
    expect(store.getState().username).toBe('reil')
    expect(store.getMyList().map((m) => m.id)).toEqual(['dune-part-two-2024', 'past-lives-2023'])
    expect(store.isInList('dune-part-two-2024')).toBe(true)
    expect(store.isInList('whiplash-2014')).toBe(false)
  })

  it('goes to the error state if the list fails to load, and recovers on retry', async () => {
    db.failLoad = true
    await logIn()
    expect(store.getState()).toMatchObject({ status: 'error', error: store.LOAD_ERROR })
    db.failLoad = false
    db.rows = [{ movie_id: DUNE, position: 0 }]
    await store.loadMyList()
    expect(store.getState()).toMatchObject({ status: 'ready', error: null })
    expect(store.getMyList()).toHaveLength(1)
  })

  it('clears the list on log out', async () => {
    db.rows = [{ movie_id: DUNE, position: 0 }]
    await logIn()
    await store.signOut()
    await settle()
    expect(store.getState()).toMatchObject({ status: 'signed-out', user: null, tiers: [] })
  })

  it('reports a failed log out', async () => {
    await logIn()
    db.failSignOut = true
    await expect(store.signOut()).rejects.toThrow(store.SIGN_OUT_ERROR)
    expect(store.getState().status).toBe('ready')
  })

  it('does not reload on a token refresh for the same user', async () => {
    await logIn()
    const before = store.getState()
    db.authCallback('TOKEN_REFRESHED', { user: USER })
    await settle()
    expect(store.getState()).toBe(before)
  })

  it('notifies subscribers when the state changes', async () => {
    const listener = vi.fn()
    store.subscribe(listener)
    await logIn()
    expect(listener).toHaveBeenCalled()
  })
})

describe('placeMovie', () => {
  it('saves with the TMDb id and reloads the list', async () => {
    await logIn()
    db.rows = [{ movie_id: DUNE, position: 0 }]
    await store.placeMovie('dune-part-two-2024', { index: 0 })
    expect(db.rpcCalls).toEqual([
      { name: 'save_ranking', args: { p_movie_id: DUNE, p_position: 0, p_tied: false } },
    ])
    expect(tierIds(store.getMyTiers())).toEqual([['dune-part-two-2024']])
  })

  it('passes ties through', async () => {
    db.rows = [{ movie_id: DUNE, position: 0 }]
    await logIn()
    await store.placeMovie('past-lives-2023', { index: 0, tied: true })
    expect(db.rpcCalls[0].args).toEqual({ p_movie_id: PAST_LIVES, p_position: 0, p_tied: true })
  })

  it('clamps the position to the list (Infinity = bottom, negative = top)', async () => {
    db.rows = [{ movie_id: DUNE, position: 0 }, { movie_id: PAST_LIVES, position: 1 }]
    await logIn()
    await store.placeMovie('whiplash-2014', { index: Infinity })
    await store.placeMovie('whiplash-2014', { index: -3 })
    expect(db.rpcCalls.map((c) => c.args.p_position)).toEqual([2, 0])
  })

  it('throws a user-facing error and keeps the list when the save fails', async () => {
    db.rows = [{ movie_id: DUNE, position: 0 }]
    await logIn()
    const before = store.getMyTiers()
    db.failRpc = true
    await expect(store.placeMovie('past-lives-2023', { index: 0 })).rejects.toThrow(store.SAVE_ERROR)
    expect(store.getMyTiers()).toBe(before)
  })

  it('refuses when nobody is logged in', async () => {
    db.authCallback('INITIAL_SESSION', null)
    await settle()
    await expect(store.placeMovie('dune-part-two-2024', { index: 0 })).rejects.toThrow('Log in')
    expect(db.rpcCalls).toEqual([])
  })

  it('refuses movies it has never seen', async () => {
    await logIn()
    await expect(store.placeMovie('not-a-movie', { index: 0 })).rejects.toThrow('Unknown movie')
    expect(db.rpcCalls).toEqual([])
  })

  it('does not ask the server to save catalog movies', async () => {
    await logIn()
    await store.placeMovie('dune-part-two-2024', { index: 0 })
    expect(db.saveCalls).toEqual([])
  })

  it('saves a searched movie through the API first, with the access token', async () => {
    await logIn()
    const local = await import('../../src/lib/localStore.js')
    local.movieFromDb(PADDINGTON_ROW) // what search does with an API result
    await store.placeMovie('tmdb-346648', { index: 0 })
    expect(db.saveCalls).toEqual([{ tmdbId: PADDINGTON, token: 'token-123' }])
    expect(db.rpcCalls[0].args.p_movie_id).toBe(PADDINGTON)
    // Second time it's known to be saved.
    await store.placeMovie('tmdb-346648', { index: 0 })
    expect(db.saveCalls).toHaveLength(1)
  })

  it('does not rank a searched movie the server could not save', async () => {
    await logIn()
    const local = await import('../../src/lib/localStore.js')
    local.movieFromDb(PADDINGTON_ROW)
    db.failSaveMovie = true
    await expect(store.placeMovie('tmdb-346648', { index: 0 })).rejects.toThrow(store.SAVE_ERROR)
    expect(db.rpcCalls).toEqual([])
  })

  it('treats movies loaded from the database as already saved', async () => {
    db.rows = [{ movie_id: PADDINGTON, position: 0, movies: PADDINGTON_ROW }]
    await logIn()
    await store.placeMovie('tmdb-346648', { index: 0 })
    expect(db.saveCalls).toEqual([])
  })
})

describe('removeMovie', () => {
  it('removes with the TMDb id and reloads the list', async () => {
    db.rows = [{ movie_id: DUNE, position: 0 }]
    await logIn()
    db.rows = []
    await store.removeMovie('dune-part-two-2024')
    expect(db.rpcCalls).toEqual([{ name: 'remove_ranking', args: { p_movie_id: DUNE } }])
    expect(store.getMyList()).toEqual([])
  })

  it('throws a user-facing error when the remove fails', async () => {
    db.rows = [{ movie_id: DUNE, position: 0 }]
    await logIn()
    db.failRpc = true
    await expect(store.removeMovie('dune-part-two-2024')).rejects.toThrow(store.REMOVE_ERROR)
    expect(store.getMyList()).toHaveLength(1)
  })
})