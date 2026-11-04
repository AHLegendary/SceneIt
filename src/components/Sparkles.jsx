import { useMemo } from 'react'

// Twinkling white-and-blue stars over whatever this sits in (the parent
// needs position: relative). Pure CSS animation, a few dozen tiny elements,
// nothing running in JS after the first render. Used on first place in the
// leaderboard podium and on the ranking result.
export default function Sparkles({ count = 22, seed = 1 }) {
  const stars = useMemo(() => {
    // deterministic positions so re-renders don't reshuffle the sky
    let h = seed * 2654435761
    const next = () => {
      h = (h * 1664525 + 1013904223) >>> 0
      return h / 4294967296
    }
    return Array.from({ length: count }, (_, i) => ({
      i,
      x: 4 + next() * 92,
      y: 2 + next() * 96,
      size: 6 + next() * 10,
      delay: next() * 2.4,
      period: 1.6 + next() * 1.8,
      blue: next() > 0.55,
    }))
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
