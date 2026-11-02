// Runs the serverless functions in api/ inside `npm run dev`, so the app and
// its API work locally without `vercel dev`. Only used by the dev server;
// on Vercel the real functions run instead.
//
// It mimics the parts of Vercel's Node runtime our handlers use:
//   * file routing: /api/movies/search -> api/movies/search.js,
//     /api/movies/27205 -> api/movies/[id].js with req.query.id = '27205'
//   * req.query, req.body (JSON), res.status(), res.json()
//   * server-only env vars from .env (TMDB_READ_TOKEN, SUPABASE_SECRET_KEY...)

import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { loadEnv } from 'vite'

const API_DIR = path.resolve('api')

// Finds the handler file for a URL path, filling in [param] segments.
// Returns { file, params } or null. Folders starting with _ are private.
export function resolveRoute(urlPath, apiDir = API_DIR) {
  const segments = urlPath.replace(/^\/api\/?/, '').split('/').filter(Boolean)
  if (!segments.length || segments.some((s) => s.startsWith('_') || s.startsWith('.'))) return null
  let dir = apiDir
  const params = {}
  for (let i = 0; i < segments.length; i++) {
    const segment = decodeURIComponent(segments[i])
    const last = i === segments.length - 1
    const entries = existsSync(dir) ? readdirSync(dir) : []
    const dynamic = (ext) => entries.find((e) => /^\[\w+\]/.test(e) && e.endsWith(ext))
    if (last) {
      const exact = entries.includes(`${segment}.js`) ? `${segment}.js` : null
      const match = exact || dynamic('].js')
      if (!match) return null
      if (!exact) params[match.slice(1, -4)] = segment
      return { file: path.join(dir, match), params }
    }
    const exactDir = entries.includes(segment) && statSync(path.join(dir, segment)).isDirectory() ? segment : null
    const match = exactDir || dynamic(']')
    if (!match) return null
    if (!exactDir) params[match.slice(1, -1)] = segment
    dir = path.join(dir, match)
  }
  return null
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export default function apiDevPlugin() {
  return {
    name: 'sceneit-api-dev',
    apply: 'serve',
    configureServer(server) {
      // Load every .env variable (not just VITE_ ones) for the handlers.
      const env = loadEnv(server.config.mode, process.cwd(), '')
      for (const [key, value] of Object.entries(env)) {
        if (!(key in process.env)) process.env[key] = value
      }

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return next()

        const route = resolveRoute(url.pathname)
        res.status = (code) => {
          res.statusCode = code
          return res
        }
        res.json = (body) => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
          return res
        }
        if (!route) return res.status(404).json({ error: 'Not found' })

        try {
          req.query = { ...Object.fromEntries(url.searchParams), ...route.params }
          req.body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : undefined
          const { default: handler } = await server.ssrLoadModule(route.file)
          await handler(req, res)
        } catch (error) {
          console.error(`[api] ${req.method} ${url.pathname} failed:`, error)
          if (!res.headersSent) res.status(500).json({ error: 'Internal error' })
        }
      })
    },
  }
}
