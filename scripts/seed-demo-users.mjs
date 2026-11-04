// Creates demo accounts with ranked lists and friendships, for demos and for
// testing friend-based recommendations. See scripts/demo-users-plan.js for
// who the accounts are and how their data is made up.
//
// Safe to re-run: existing demo accounts are reused, and their rankings and
// friendships are wiped and rebuilt the same way each time (same seed).
//
// Real (non-demo) accounts get 3 demo friends each, plus 1 pending request
// from another demo account. Re-running resets every friendship between a
// real account and a demo account.
//
// Usage (needs SUPABASE_URL or VITE_SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY,
// in .env or the environment; run the seed.sql catalog first):
//   npm run demo-users                  # create or rebuild the demo accounts
//   npm run demo-users -- --no-real     # don't friend real accounts
//   npm run demo-users -- --remove      # delete the demo accounts entirely
//
// Password for every demo account: DEMO_PASSWORD from .env (required). The
// repo is public, so it's never hardcoded here; share it with the team
// privately. Log in with the username (for example john_sceneit).

import { existsSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { buildDemoPlan, DEMO_USERS } from './demo-users-plan.js'

const EMAIL_DOMAIN = 'demo.sceneit.app' // never receives mail; accounts are pre-confirmed

const CATALOG = new URL('../src/data/movies.json', import.meta.url)
const ENV_FILE = new URL('../.env', import.meta.url)

function readEnv(name) {
  if (process.env[name]) return process.env[name]
  if (!existsSync(ENV_FILE)) return null
  const line = readFileSync(ENV_FILE, 'utf8')
    .split('\n')
    .find((l) => l.trim().startsWith(`${name}=`))
  return line ? line.split('=').slice(1).join('=').split(' #')[0].trim().replace(/^["']|["']$/g, '') : null
}

function fail(message) {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

// Supabase returns { data, error }; turn errors into exceptions with context.
function check({ data, error }, what) {
  if (error) fail(`${what}: ${error.message}`)
  return data
}

const url = readEnv('SUPABASE_URL') ?? readEnv('VITE_SUPABASE_URL')
const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY') ?? readEnv('SUPABASE_SECRET_KEY')
if (!url || !serviceKey) fail('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.')

const password = readEnv('DEMO_PASSWORD')
if (!password || password.length < 8) fail('Set DEMO_PASSWORD in .env (8+ characters). Every demo account gets this password.')

const args = new Set(process.argv.slice(2))
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const demoNames = DEMO_USERS.map((u) => u.username)

// Existing demo profiles, by lowercase username.
async function findDemoProfiles() {
  const rows = check(await db.from('profiles').select('id, username'), 'Reading profiles')
  const demo = new Map()
  const real = []
  for (const row of rows) {
    if (demoNames.includes(row.username.toLowerCase())) demo.set(row.username.toLowerCase(), row.id)
    else real.push(row)
  }
  return { demo, real }
}

async function removeAll() {
  const { demo } = await findDemoProfiles()
  for (const [username, id] of demo) {
    // Deleting the auth user cascades to the profile, rankings and friendships.
    check(await db.auth.admin.deleteUser(id), `Deleting ${username}`)
    console.log(`  removed ${username}`)
  }
  console.log(demo.size ? `\n✓ Removed ${demo.size} demo accounts.` : 'No demo accounts to remove.')
}

async function ensureAccount(username, existingId) {
  if (existingId) {
    // Keep the password in sync with DEMO_PASSWORD.
    check(await db.auth.admin.updateUserById(existingId, { password }), `Updating ${username}`)
    return existingId
  }
  const data = check(
    await db.auth.admin.createUser({
      email: `${username}@${EMAIL_DOMAIN}`,
      password,
      email_confirm: true,
      user_metadata: { username }, // the signup trigger makes the profile from this
    }),
    `Creating ${username}`,
  )
  return data.user.id
}

async function seed() {
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'))
  const inDb = new Set(
    check(await db.from('movies').select('tmdb_id').in('tmdb_id', catalog.map((m) => m.tmdb_id)), 'Reading movies')
      .map((m) => m.tmdb_id),
  )
  const usable = catalog.filter((m) => inDb.has(m.tmdb_id))
  if (usable.length < 30) {
    fail(`Only ${usable.length} of ${catalog.length} catalog movies are in the database. Run supabase/seed.sql first.`)
  }

  const { demo, real } = await findDemoProfiles()
  const realUsers = args.has('--no-real') ? [] : real
  const plan = buildDemoPlan(usable, realUsers.map((u) => u.id))

  // 1. Accounts
  const ids = new Map()
  for (const user of plan.users) {
    const id = await ensureAccount(user.username, demo.get(user.username))
    ids.set(user.username, id)
    check(await db.from('profiles').update({ is_public: !user.private }).eq('id', id), `Updating ${user.username}'s profile`)
    console.log(`  ${demo.has(user.username) ? 'updated' : 'created'} ${user.username}`)
  }
  const idOf = (nameOrId) => ids.get(nameOrId) ?? nameOrId
  const allDemoIds = [...ids.values()]

  // 2. Rankings: replace each demo user's list.
  check(await db.from('rankings').delete().in('user_id', allDemoIds), 'Clearing demo rankings')
  const rankingRows = plan.users.flatMap((user) =>
    user.rankings.map((r) => ({
      user_id: ids.get(user.username),
      movie_id: r.tmdb_id,
      position: r.position,
      category: r.category,
      created_at: r.created_at,
      updated_at: r.created_at,
    })),
  )
  check(await db.from('rankings').insert(rankingRows), 'Saving rankings')

  // 3. Friendships: replace everything involving a demo user.
  const idList = allDemoIds.join(',')
  check(
    await db.from('friendships').delete().or(`requester_id.in.(${idList}),addressee_id.in.(${idList})`),
    'Clearing demo friendships',
  )
  const friendshipRows = plan.friendships.map((f) => ({
    requester_id: idOf(f.requester),
    addressee_id: idOf(f.addressee),
    status: f.status,
  }))
  check(await db.from('friendships').insert(friendshipRows), 'Saving friendships')

  // Summary
  const nameOf = new Map([...[...ids].map(([n, id]) => [id, n]), ...real.map((u) => [u.id, u.username])])
  console.log('\n✓ Demo accounts ready')
  console.log('  password for all: DEMO_PASSWORD from your .env\n')
  for (const user of plan.users) {
    const id = ids.get(user.username)
    const friends = friendshipRows
      .filter((f) => f.status === 'accepted' && (f.requester_id === id || f.addressee_id === id))
      .map((f) => nameOf.get(f.requester_id === id ? f.addressee_id : f.requester_id))
    const visibility = user.private ? ' · private' : ''
    console.log(`  ${user.username.padEnd(15)} ${String(user.rankings.length).padStart(2)} ranked · likes ${user.likes.join(', ')}${visibility}`)
    console.log(`  ${''.padEnd(15)} friends: ${friends.join(', ') || '(none)'}`)
  }
  if (realUsers.length) {
    console.log(`\n  Also friended ${realUsers.length} real account(s): ${realUsers.map((u) => u.username).join(', ')}`)
    console.log('  (3 demo friends each + 1 pending request)')
  }
}

if (args.has('--remove')) await removeAll()
else await seed()
