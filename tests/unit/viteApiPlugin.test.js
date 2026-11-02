import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveRoute } from '../../scripts/vite-api-plugin.js'

const API = path.resolve('api')
const rel = (route) => route && { file: path.relative(API, route.file), params: route.params }

describe('resolveRoute', () => {
  it('maps paths to files like Vercel does', () => {
    expect(rel(resolveRoute('/api/health'))).toEqual({ file: 'health.js', params: {} })
    expect(rel(resolveRoute('/api/movies/search'))).toEqual({ file: path.join('movies', 'search.js'), params: {} })
  })

  it('fills [id] from the path', () => {
    expect(rel(resolveRoute('/api/movies/27205'))).toEqual({ file: path.join('movies', '[id].js'), params: { id: '27205' } })
  })

  it('never serves private _lib files or unknown paths', () => {
    expect(resolveRoute('/api/_lib/tmdb')).toBeNull()
    expect(resolveRoute('/api/movies/_lib')).toBeNull()
    expect(resolveRoute('/api/nope')).toBeNull()
    expect(resolveRoute('/api/')).toBeNull()
  })
})
