import { useState } from 'react'

// Movie poster. Shows the real image when a URL is given and it loads;
// otherwise a placeholder card with the title, tinted per movie so a list
// doesn't look uniform.
const TINTS = ['#c9b8a6', '#a9b4b8', '#b7ad9c', '#b9a5a5', '#a8b29f', '#b3a9bb', '#c2b08f']

function tintFor(title) {
  let h = 0
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TINTS[h % TINTS.length]
}

export default function Poster({ title, src, size = 'md' }) {
  const [failed, setFailed] = useState(false)

  if (src && !failed) {
    return (
      <img
        className={`poster poster--${size}`}
        src={src}
        alt={`${title} poster`}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <div className={`poster poster--${size} poster--blank`} style={{ '--tint': tintFor(title) }} aria-hidden="true">
      <span>{title}</span>
    </div>
  )
}
