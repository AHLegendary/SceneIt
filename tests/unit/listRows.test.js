import { describe, it, expect } from 'vitest'
import { listRows } from '../../src/features/ranking/listRows.js'

const m = (id) => ({ id, title: id })

describe('listRows', () => {
  it('returns nothing for an empty list', () => {
    expect(listRows([])).toEqual([])
  })

  it('numbers movies in order, one rank each, with no ties', () => {
    const rows = listRows([[m('a')], [m('b')], [m('c')]])
    expect(rows.map((r) => [r.movie.id, r.rank, r.tied])).toEqual([
      ['a', 1, false],
      ['b', 2, false],
      ['c', 3, false],
    ])
  })

  it('gives tied movies a shared rank and skips ahead after them', () => {
    const rows = listRows([[m('a')], [m('b'), m('c')], [m('d')]])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4])
  })

  it('marks where a tie starts and ends', () => {
    const rows = listRows([[m('a'), m('b'), m('c')]])
    expect(rows.map((r) => [r.tieStart, r.tieEnd])).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ])
  })

  it('stops after the limit', () => {
    const tiers = Array.from({ length: 8 }, (_, i) => [m(`m${i}`)])
    expect(listRows(tiers, 5).map((r) => r.movie.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
  })

  it('returns everything when there are fewer movies than the limit', () => {
    expect(listRows([[m('a')], [m('b')]], 5)).toHaveLength(2)
  })

  it('cuts a tie at the limit but still treats the shown movies as tied', () => {
    const rows = listRows([[m('a')], [m('b')], [m('c'), m('d'), m('e')]], 4)
    expect(rows.map((r) => r.movie.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(rows[2]).toMatchObject({ rank: 3, tied: true, tieStart: true, tieEnd: false })
    expect(rows[3]).toMatchObject({ rank: 3, tied: true, tieStart: false, tieEnd: true })
  })
})
