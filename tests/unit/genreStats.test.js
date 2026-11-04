import { describe, expect, it } from 'vitest'
import { ALL_GENRES, AXES, describeViewer, genreStats, gradeFor } from '../../src/features/stats/genreStats.js'

const m = (id, ...genres) => ({ id, title: id, genres })

describe('gradeFor', () => {
  it('follows the S to G scale', () => {
    expect(gradeFor(95)).toBe('S')
    expect(gradeFor(64)).toBe('C')
    expect(gradeFor(0)).toBe('G')
  })
})

describe('genreStats', () => {
  it('has an axis for every genre, all zero for an empty list', () => {
    const stats = genreStats([])
    expect(stats.axes).toHaveLength(AXES)
    expect(stats.axes.map((a) => a.genre)).toEqual(ALL_GENRES)
    expect(stats.axes.every((a) => a.value === 0)).toBe(true)
    expect(stats.total).toBe(0)
    expect(stats.grade).toBe('G')
  })

  it('picks the most-watched genres and scores taste by list position', () => {
    const tiers = [[m('a', 'Action')], [m('b', 'Action', 'Drama')], [m('c', 'Drama')], [m('d', 'Comedy')]]
    const stats = genreStats(tiers)
    const action = stats.axes.find((a) => a.genre === 'Action')
    const comedy = stats.axes.find((a) => a.genre === 'Comedy')
    expect(action.count).toBe(2)
    expect(action.value).toBeGreaterThan(comedy.value) // ranked higher and watched more
    expect(comedy.taste).toBe(0) // bottom of the list
  })

  it('shares a liking across tied movies', () => {
    const tiers = [[m('a', 'Horror'), m('b', 'Romance')], [m('c', 'Horror')]]
    const stats = genreStats(tiers)
    const horror = stats.axes.find((a) => a.genre === 'Horror')
    const romance = stats.axes.find((a) => a.genre === 'Romance')
    expect(romance.taste).toBe(75)
    expect(horror.count).toBe(2)
  })
})

describe('describeViewer', () => {
  it('names the watcher after their strongest genre', () => {
    const tiers = [[m('a', 'Horror')], [m('b', 'Horror', 'Thriller')], [m('c', 'Comedy')]]
    const persona = describeViewer(genreStats(tiers))
    expect(persona.title).toBe('Thrill Chaser')
    expect(persona.text).toMatch(/horror fan/)
  })
  it('has something to say for an empty list', () => {
    expect(describeViewer(genreStats([])).title).toBe('Blank Slate')
  })
})
