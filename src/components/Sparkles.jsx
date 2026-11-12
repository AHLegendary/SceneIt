import { useMemo } from 'react'

// Twinkling white-and-blue stars over whatever this sits in (the parent
// needs position: relative). Pure CSS animation, a few dozen tiny elements,
// nothing running in JS after the first render. Used on first place in the
// leaderboard podium and on the ranking result.
export default function Sparkles({ count = 22, seed = 1 }) {
  const stars = useMemo(() => {
    // deterministic positions so re-renders don't reshuffle the sky
    let h = seed * 2654435761
    const made = []
    for (let i = 0; i < count; i++) {
      // six values per star, in this order: x, y, size, delay, period, tint
      const v = []
      for (let k = 0; k < 6; k++) {
        h = (h * 1664525 + 1013904223) >>> 0
        v.push(h / 4294967296)
      }
      made.push({ i, x: 4 + v[0] * 92, y: 2 + v[1] * 96, size: 6 + v[2] * 10, delay: v[3] * 2.4, period: 1.6 + v[4] * 1.8, blue: v[5] > 0.55 })
    }
    return made
  }, [count, seed])

  return (
    <span className="sparkles" aria-hidden="true">
      {stars.map((s) => (
        <i
          key={s.i}
          className={`sparkle${s.blue ? ' sparkle--blue' : ''}`}
          style={{ left: `${s.x}%`, top: `${s.y}%`, '--s': `${s.size}px`, '--d': `${s.delay}s`, '--p': `${s.period}s` }}
        />
      ))}
    </span>
  )
}
