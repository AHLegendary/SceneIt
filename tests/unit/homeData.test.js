import { describe, expect, it } from 'vitest'
import MOVIES from '../../src/data/movies.json'
import { catalogPopular, rowsToActivity } from '../../src/lib/homeData.js'

const kevin = { id: 'k', username: 'kevin' }
const maria = { id: 'm', username: 'maria' }
const row = (user, movie, at) => ({
  user_id: user,
  movie_id: movie.tmdb_id,
  updated_at: at,
  movies: { tmdb_id: movie.tmdb_id, title: movie.title, year: movie.year, poster_path: movie.poster_path, genres: movie.genres, overview: movie.overview },
})

describe('rowsToActivity', () => {
  it('pairs each ranking with the friend who made it, newest first', () => {
    const items = rowsToActivity([row('k', MOVIES[0], '2026-11-03T10:00:00Z'), row('m', MOVIES[1], '2026-11-03T09:00:00Z')], [kevin, maria])
    expect(items.map((i) => [i.movie.id, i.friend.username])).toEqual([
      [MOVIES[0].id, 'kevin'],
      [MOVIES[1].id, 'maria'],
    ])
  })

  it('shows a movie once, credited to the most recent friend', () => {
    const items = rowsToActivity([row('k', MOVIES[0], '2'), row('m', MOVIES[0], '1')], [kevin, maria])
    expect(items).toHaveLength(1)
    expect(items[0].friend.username).toBe('kevin')
  })

  it('skips rows from people who are not friends and rows without a movie', () => {
    const items = rowsToActivity([row('stranger', MOVIES[0], '1'), { user_id: 'k', movie_id: 0, movies: null }], [kevin])
    expect(items).toEqual([])
  })

  it('handles missing rows', () => {
    expect(rowsToActivity(null, [kevin])).toEqual([])
  })
})

describe('catalogPopular', () => {
  it('returns catalog movies, most-rated first, without repeats', () => {
    const movies = catalogPopular(12)
    expect(movies).toHaveLength(12)
    expect(new Set(movies.map((m) => m.id)).size).toBe(12)
    expect(movies.every((m) => MOVIES.includes(m))).toBe(true)
  })
})
