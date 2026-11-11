// SceneIt wordmark: the film-strip "S" mark, then the full word "SceneIt"
// with a sky-blue italic "It" (concept A in the logo sheet).
// SceneMark alone is the compact logo (favicon, avatars, loading states).

export function SceneMark({ size = 32, className = '', title }) {
  // Concept A: a bold, slanted S folded out of a strip of film. The strip is
  // one angular path drawn three times: the ribbon (gradient), a dashed light
  // stroke the same width (sprocket holes), then the centre band back on top
  // so the holes only show along the two edges.
  const path = 'M54 13 H20 Q11 13 11 22 V26 Q11 34 20 34 H44 Q53 34 53 42 V46 Q53 55 44 55 H9'
  return (
    <svg
      className={`mark ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id="sceneit-s" x1="10" y1="10" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7fe0ff" />
          <stop offset="0.55" stopColor="#4cc8ff" />
          <stop offset="1" stopColor="#1f9ee6" />
        </linearGradient>
        <linearGradient id="sceneit-band" x1="10" y1="10" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6fd9ff" />
          <stop offset="0.55" stopColor="#3fbff7" />
          <stop offset="1" stopColor="#1a93d8" />
        </linearGradient>
      </defs>
      <g transform="skewX(-14) translate(9 0)" fill="none" strokeLinejoin="round" strokeLinecap="butt">
        <path d={path} stroke="url(#sceneit-s)" strokeWidth="13" />
        <path d={path} stroke="#eefaff" strokeWidth="13" strokeDasharray="2.6 3.2" strokeDashoffset="1" />
        <path d={path} stroke="url(#sceneit-band)" strokeWidth="7.6" />
      </g>
    </svg>
  )
}

export default function Logo({ size = 30, onClick, href = '#/home' }) {
  const inner = (
    <>
      <SceneMark size={size * 1.55} className="logo__s" />
      <span className="logo__word" aria-hidden="true">
        Scene<em>It</em>
      </span>
    </>
  )
  return (
    <a className="logo" href={href} onClick={onClick} aria-label="SceneIt home" style={{ '--logo-size': `${size}px` }}>
      {inner}
    </a>
  )
}
