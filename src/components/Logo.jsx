// SceneIt logo: the designed artwork (public/logo.png — film-strip S plus the
// "SceneIt" wordmark with a cyan "It"), used as-is so it matches the brand
// exactly. SceneMark is the square S on its own (favicon, avatars, loaders).

export function SceneMark({ size = 32, className = '', title }) {
  return (
    <img
      className={`mark ${className}`.trim()}
      src="/logo-mark.png"
      width={size}
      height={size}
      alt={title ?? ''}
      aria-hidden={title ? undefined : 'true'}
      draggable="false"
    />
  )
}

export default function Logo({ size = 30, onClick, href = '#/home' }) {
  return (
    <a className="logo" href={href} onClick={onClick} aria-label="SceneIt home" style={{ '--logo-size': `${size}px` }}>
      <img className="logo__img" src="/logo.png" alt="" draggable="false" />
    </a>
  )
}
