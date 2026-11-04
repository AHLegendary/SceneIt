import { tierRanks } from './binaryInsertion.js'

// Flattens tiers into display rows, best first, optionally stopping after
// `limit` movies. Each row knows its shared rank and where it sits in a tie so
// the list can draw tied movies as a group, even when the limit cuts a tie.
export function listRows(tiers, limit = Infinity) {
  const ranks = tierRanks(tiers)
  const rows = []
  for (let t = 0; t < tiers.length && rows.length < limit; t++) {
    const tier = tiers[t]
    const take = Math.min(tier.length, limit - rows.length)
    for (let k = 0; k < take; k++) {
      rows.push({
        movie: tier[k],
        rank: ranks[t],
        tied: tier.length > 1,
        tieStart: k === 0,
        tieEnd: k === take - 1,
      })
    }
  }
  return rows
}
