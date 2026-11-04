// SceneIt wordmark. The sky-blue "S" is a drawn mark that doubles as the
// first letter, so the rest of the word is just "cene" + "It".
// SceneMark alone is the compact logo (favicon, avatars, loading states).

export function SceneMark({ size = 32, className = '', title }) {
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
          <stop offset="0" stopColor="#b8efff" />
          <stop offset="0.45" stopColor="#66d1ff" />
          <stop offset="1" stopColor="#2aa6e6" />
        </linearGradient>
      </defs>
      {/* the S: one swept stroke, slanted like a film-reel ribbon */}
      <g transform="skewX(-12) translate(8 0)">
        <path
          d="M49 16.5 C47 8 20 6.5 17.5 19 C15 31 49 28.5 47 44 C45.5 56 16 56 14 47"
          fill="none"
          stroke="url(#sceneit-s)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      {/* sparkle */}
      <path d="M55 3.5 l1.6 4.3 4.3 1.6 -4.3 1.6 -1.6 4.3 -1.6 -4.3 -4.3 -1.6 4.3 -1.6z" fill="#cdf3ff" />
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
