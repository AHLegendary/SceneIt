// A user's "stat window": one score per genre from their ranked list, like a
// character stat card. Pure functions, no React.
//
// For every genre:
//   taste  = how high they rank movies of that genre (top of the list = 100)
//   volume = how many they've ranked, relative to their biggest genre
//   stat   = 60% taste + 40% volume, 0–100
// Total is the average stat; the grade letter follows the S/A/B/C... scale.

// Every TMDb movie genre, in the order they go around the radar.
export const ALL_GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 'Thriller', 'War', 'Western']
export const AXES = ALL_GENRES.length

export const GRADES = [
  { letter: 'S', min: 90 },
  { letter: 'A', min: 80 },
  { letter: 'B', min: 70 },
  { letter: 'C', min: 60 },
  { letter: 'D', min: 50 },
  { letter: 'E', min: 40 },
  { letter: 'F', min: 30 },
  { letter: 'G', min: 0 },
]


export function gradeFor(total) {
  return GRADES.find((g) => total >= g.min)?.letter ?? 'G'
}

// Short labels for the radar; long names wrap badly.
export function shortGenre(genre) {
  return { 'Science Fiction': 'Sci-Fi', Documentary: 'Docs' }[genre] ?? genre
}

// tiers: [[movie], [movie, movie], ...], best first.
// Returns { axes: [{ genre, label, value, count, taste }], total, grade, ranked }.
export function genreStats(tiers, axisCount = AXES) {
  const ranked = tiers.flat()
  const n = ranked.length
  // liking: 1 at the top of the list, 0 at the bottom (tied movies share)
  const liking = new Map()
  let start = 0
  for (const tier of tiers) {
    const middle = start + (tier.length - 1) / 2
    const like = n > 1 ? 1 - middle / (n - 1) : 1
    for (const movie of tier) liking.set(movie.id, like)
    start += tier.length
  }

  const byGenre = new Map()
  for (const movie of ranked) {
    for (const genre of movie.genres ?? []) {
      if (!byGenre.has(genre)) byGenre.set(genre, { count: 0, likeSum: 0 })
      const g = byGenre.get(genre)
      g.count += 1
      g.likeSum += liking.get(movie.id)
    }
  }

  const chosen = axisCount === ALL_GENRES.length ? ALL_GENRES : [...ALL_GENRES].slice(0, axisCount)

  const maxCount = Math.max(1, ...chosen.map((g) => byGenre.get(g)?.count ?? 0))
  const axes = chosen.map((genre) => {
    const g = byGenre.get(genre)
    const count = g?.count ?? 0
    const taste = count ? Math.round((g.likeSum / count) * 100) : 0
    const volume = Math.round((count / maxCount) * 100)
    const value = count ? Math.round(0.6 * taste + 0.4 * volume) : 0
    return { genre, label: shortGenre(genre), value, count, taste }
  })
  // Total is the average of the genres they actually watch (empty axes would
  // drag everyone to zero), so it reads as "how strong is your taste".
  const watched = axes.filter((a) => a.count > 0)
  const total = watched.length ? Math.round(watched.reduce((sum, a) => sum + a.value, 0) / watched.length) : 0
  return { axes, total, grade: gradeFor(total), ranked: n }
}

// A brief read on what kind of movie watcher this is, from the stats alone.
// Used when the AI summary isn't available. Returns { title, text }.
const ARCHETYPES = {
  Action: 'Adrenaline Seeker', Adventure: 'Explorer', Animation: 'Young at Heart', Comedy: 'Comfort Watcher',
  Crime: 'Case Cracker', Documentary: 'Truth Seeker', Drama: 'Deep Feeler', Family: 'Big-Hearted Viewer',
  Fantasy: 'World Builder', History: 'Time Traveler', Horror: 'Thrill Chaser', Music: 'Rhythm Hunter',
  Mystery: 'Puzzle Solver', Romance: 'Hopeless Romantic', 'Science Fiction': 'Future Dreamer',
  Thriller: 'Edge-of-Seat Watcher', War: 'Epic Chaser', Western: 'Frontier Spirit',
}
export function describeViewer(stats) {
  const watched = stats.axes.filter((a) => a.count > 0)
  if (!watched.length) return { title: 'Blank Slate', text: 'Rank a few movies and your watcher profile appears here.' }
  const byValue = [...watched].sort((a, b) => b.value - a.value)
  const byTaste = [...watched].sort((a, b) => b.taste - a.taste || b.count - a.count)
  const top = byValue[0]
  const second = byValue[1]
  const loved = byTaste[0]
  const breadth = watched.length >= 10 ? 'with wide-ranging taste' : watched.length <= 4 ? 'who knows exactly what they like' : 'with a few favorite lanes'
  let text = `A ${top.genre.toLowerCase()} fan ${breadth}`
  if (second && second.genre !== top.genre) text += `, often drifting into ${second.genre.toLowerCase()}`
  if (loved && loved.genre !== top.genre) text += `; ${loved.genre.toLowerCase()} is what you rank highest`
  return { title: ARCHETYPES[top.genre] ?? 'Eclectic Viewer', text: `${text}.` }
}
