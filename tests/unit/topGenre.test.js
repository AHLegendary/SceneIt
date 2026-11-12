import { describe, expect, it } from 'vitest'
import { topGenre } from '../../src/features/profile/topGenre.js'

// A ranked movie. Tests build tiers by hand, best first.
const m = (id, genres, category = 'loved') => ({ id, title: id, genres, category })

describe('topGenre', () => {
  it('returns null with nothing ranked, or no genre data', () => {
    expect(topGenre([])).toBeNull()
    expect(topGenre([[m('a', [])], [m('b', undefined)]])).toBeNull()
  })

  it('picks the genre with the most movies', () => {
    const result = topGenre([[m('a', ['Drama'])], [m('b', ['Comedy'])], [m('c', ['Comedy'])]])
    expect(result.genre).toBe('Comedy')
    expect(result.count).toBe(2)
  })

  it('counts a multi-genre movie toward each of its genres', () => {
    const result = topGenre([
      [m('a', ['Drama', 'Crime'])],
      [m('b', ['Crime', 'Thriller'])],
      [m('c', ['Drama'])],
      [m('d', ['Crime'])],
    ])
    expect(result.genre).toBe('Crime') // a, b, d
    expect(result.count).toBe(3)
  })

  it('breaks a tie by the higher average score', () => {
    // Two movies each, so the count ties. Whichever genre holds the two
    // best-ranked movies has the higher average.
    const comedyWins = topGenre([[m('b', ['Comedy'])], [m('c', ['Comedy'])], [m('a', ['Drama'])], [m('d', ['Drama'])]])
    expect(comedyWins.genre).toBe('Comedy')
    const dramaWins = topGenre([[m('a', ['Drama'])], [m('d', ['Drama'])], [m('b', ['Comedy'])], [m('c', ['Comedy'])]])
    expect(dramaWins.genre).toBe('Drama')
  })

  it('breaks tie-breaks by the average score, even before scores unlock (fewer than 10 ranked)', () => {
    // Only 4 movies, so the app shows no scores, but the order still decides.
    const result = topGenre([[m('x', ['Horror'])], [m('y', ['Western'])]])
    expect(result.genre).toBe('Horror')
  })

  it('uses category bands, so a loved movie outweighs a not-a-fan one', () => {
    const result = topGenre([
      [m('a', ['Action'], 'loved')],
      [m('b', ['Romance'], 'meh')],
    ])
    expect(result.genre).toBe('Action')
  })

  it('falls back to alphabetical order when count and average are identical', () => {
    // One tier holds both, so they share a score.
    const result = topGenre([[m('a', ['Western']), m('b', ['Action'])]])
    expect(result.genre).toBe('Action')
  })

  it('shows the best movie in the genre that is not the #1', () => {
    const result = topGenre([
      [m('top', ['Drama'])],
      [m('b', ['Comedy'])],
      [m('c', ['Drama'])],
      [m('d', ['Drama'])],
    ])
    expect(result.genre).toBe('Drama')
    expect(result.movie.id).toBe('c')
  })

  it('shows the best movie of the genre when #1 is not in it', () => {
    const result = topGenre([
      [m('top', ['Action'])],
      [m('b', ['Comedy'])],
      [m('c', ['Comedy'])],
    ])
    expect(result.genre).toBe('Comedy')
    expect(result.movie.id).toBe('b')
  })

  it('falls back to the #1 when it is the only movie in the genre', () => {
    const result = topGenre([[m('top', ['Drama'])]])
    expect(result.movie.id).toBe('top')
    const result2 = topGenre([[m('top', ['Drama', 'Crime'])], [m('b', ['Crime'])], [m('c', ['Crime'])]])
    expect(result2.genre).toBe('Crime')
    expect(result2.movie.id).toBe('b')
  })

  it('ignores duplicate genre names on one movie', () => {
    expect(topGenre([[m('a', ['Drama', 'Drama'])]]).count).toBe(1)
  })
})
