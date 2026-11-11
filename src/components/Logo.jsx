// SceneIt wordmark. The sky-blue film-strip "S" is a drawn mark that doubles
// as the first letter, so the rest of the word is just "cene" + "It".
// SceneMark alone is the compact logo (favicon, avatars, loading states).

export function SceneMark({ size = 32, className = '', title }) {
  // The S is a strip of film: a swept cyan ribbon with a row of sprocket
  // holes along each edge. Three strokes on one path do it: the ribbon, a
  // dashed light stroke the same width (the holes), then the ribbon's centre
  // band back on top so the holes only show at the edges.
  const path = 'M49 16.5 C47 8 20 6.5 17.5 19 C15 31 49 28.5 47 44 C45.5 56 16 56 14 47'
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
        <linearGradient id="sceneit-s" x1="12" y1="6" x2="54" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8fe3ff" />
          <stop offset="0.5" stopColor="#66d1ff" />
          <stop offset="1" stopColor="#2aa6e6" />
        </linearGradient>
        <linearGradient id="sceneit-band" x1="12" y1="6" x2="54" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7fdcff" />
          <stop offset="0.5" stopColor="#5cc8f7" />
          <stop offset="1" stopColor="#2aa0de" />
        </linearGradient>
      </defs>
      <g transform="skewX(-12) translate(8 0)" fill="none" strokeLinejoin="round">
        <path d={path} stroke="url(#sceneit-s)" strokeWidth="14" strokeLinecap="butt" />
        <path d={path} stroke="#eaf9ff" strokeWidth="14" strokeLinecap="butt" strokeDasharray="2.6 3.2" strokeDashoffset="1.6" />
        <path d={path} stroke="url(#sceneit-band)" strokeWidth="8.6" strokeLinecap="butt" />
      </g>
    </svg>
  )
}

export default function Logo({ size = 30, onClick, href = '#/home' }) {
  const inner = (
    <>
      <SceneMark size={size * 1.55} className="logo__s" />
      <span className="logo__word" aria-hidden="true">
        cene<em>It</em>
      </span>
    </>
  )
  return (
    <a className="logo" href={href} onClick={onClick} aria-label="SceneIt home" style={{ '--logo-size': `${size}px` }}>
      {inner}
    </a>
  )
}
