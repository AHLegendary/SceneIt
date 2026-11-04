import { useMemo } from 'react'
import { genreStats } from '../features/stats/genreStats.js'

// A user's stat window: a glowing radar with one axis per genre, leaning back
// in 3D like a city grid at night. The filled shape is their stat per genre;
// every ranked movie is a point of light on the axes of its genres, placed by
// how high it sits in their list (outer edge = #1). Labels float above the
// plane untilted so they stay readable. No card: it sits on the dark page.
const TILT = 38 // degrees the plane leans back
const PERSPECTIVE = 1400 // matches .statwin__stage in App.css

export default function StatWindow({ tiers, compact = false, highlight = null }) {
  const stats = useMemo(() => genreStats(tiers), [tiers])
  const movies = useMemo(() => tiers.flat(), [tiers])
  const n = stats.axes.length
  const S = compact ? 320 : 600
  const cx = S / 2
  const cy = S / 2
  const r = S * 0.4
  const tilt = (TILT * Math.PI) / 180

  const angleOf = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n
  const point = (i, value, angleOffset = 0) => {
    const a = angleOf(i) + angleOffset
    const d = (r * value) / 100
    return [cx + d * Math.cos(a), cy + d * Math.sin(a)]
  }
  const ring = (value) => stats.axes.map((_, i) => point(i, value).join(',')).join(' ')
  const shape = stats.axes.map((a, i) => point(i, Math.max(a.value, 3)).join(',')).join(' ')
  const axisIndex = new Map(stats.axes.map((a, i) => [a.genre, i]))

  // Where a point on the tilted plane lands on screen, so the untilted HTML
  // labels line up with the SVG axes they belong to.
  const project = (x, y) => {
    const dy = y - cy
    const z = dy * Math.sin(tilt)
    const s = PERSPECTIVE / (PERSPECTIVE - z)
    return [cx + (x - cx) * s, cy + dy * Math.cos(tilt) * s]
  }
  // The plane's on-screen height after tilting, so the stage reserves room.
  const stageHeight = Math.round(S * Math.cos(tilt) * 0.96 + (compact ? 44 : 60))

  // One light per (movie, genre): radius from list position, a small
  // deterministic sideways offset so lights on the same axis don't stack.
  const lights = []
  const total = movies.length
  movies.forEach((movie, position) => {
    const liking = total > 1 ? 1 - position / (total - 1) : 1
    for (const genre of movie.genres ?? []) {
      const i = axisIndex.get(genre)
      if (i === undefined) continue
      let h = 0
      for (const ch of `${movie.id}${genre}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0
      const jitter = ((h % 1000) / 1000 - 0.5) * 0.16 // radians
      const [x, y] = point(i, 10 + liking * 88, jitter)
      lights.push({ key: `${movie.id}-${genre}`, x, y, liking, delay: ((h >> 8) % 100) / 40, title: `${movie.title} · ${genre}`, hot: highlight === genre })
    }
  })

  return (
    <div className={`statwin${compact ? ' statwin--compact' : ''}`} aria-label="Your genre stats">
      <div className="statwin__stage" style={{ height: stageHeight, '--tilt': `${TILT}deg` }}>
        <span className="statwin__base" aria-hidden="true" />
        <svg
          className="statwin__plane"
          viewBox={`0 0 ${S} ${S}`}
          width={S}
          height={S}
          role="img"
          aria-label={`Genre stats: ${stats.axes.filter((a) => a.count > 0).map((a) => `${a.genre} ${a.value}`).join(', ') || 'nothing ranked yet'}`}
        >
          <defs>
            <radialGradient id="sw-fill" cx="50%" cy="50%" r="55%">
              <stop offset="0" stopColor="#bdf0ff" stopOpacity="0.6" />
              <stop offset="0.6" stopColor="#66d1ff" stopOpacity="0.3" />
              <stop offset="1" stopColor="#2aa6e6" stopOpacity="0.14" />
            </radialGradient>
            <filter id="sw-light" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="2.4" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* the grid */}
          {[20, 40, 60, 80, 100].map((v) => (
            <polygon key={v} points={ring(v)} className={`statwin__ring${v === 100 ? ' statwin__ring--outer' : ''}`} />
          ))}
          {stats.axes.map((a, i) => {
            const [x, y] = point(i, 100)
            return <line key={a.genre} x1={cx} y1={cy} x2={x} y2={y} className="statwin__axis" />
          })}

          {/* the stat shape, glow underneath */}
          {stats.ranked > 0 && (
            <>
              <polygon points={shape} className="statwin__shape-glow" />
              <polygon points={shape} className="statwin__shape" fill="url(#sw-fill)" />
              {stats.axes.map((a, i) => {
                if (!a.count) return null
                const [x, y] = point(i, a.value)
                return <circle key={a.genre} cx={x} cy={y} r={4} className={`statwin__dot${highlight === a.genre ? ' is-hot' : ''}`} />
              })}
            </>
          )}

          {/* every movie as a light on its genre axes */}
          {lights.map((l) => (
            <circle
              key={l.key}
              cx={l.x}
              cy={l.y}
              r={1.8 + l.liking * 2.6}
              className={`statwin__light${l.hot ? ' is-hot' : ''}`}
              style={{ opacity: 0.5 + l.liking * 0.5, '--d': l.delay }}
              filter="url(#sw-light)"
            >
              <title>{l.title}</title>
            </circle>
          ))}
        </svg>

        {/* genre labels, floating above the plane */}
        <div className="statwin__labels" style={{ width: S, height: S }} aria-hidden="true">
          {stats.axes.map((a, i) => {
            const [x, y] = project(...point(i, compact ? 124 : 116))
            const hot = highlight === a.genre
            return (
              <span
                key={a.genre}
                className={`statwin__tag${hot ? ' is-hot' : ''}${a.count ? '' : ' is-empty'}`}
                style={{ left: x, top: y }}
              >
                {a.label}
                <b>{a.count ? a.value : '–'}</b>
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
