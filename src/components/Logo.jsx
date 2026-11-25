// SceneIt logo: the brand artwork, used as-is so it matches the design exactly.
//   public/logo.png       film-strip "S" + "cene" + cyan "It" (transparent PNG)
//   public/logo-mark.png  the film-strip "S" on its own, square (favicon,
//                         avatars, loading states)
// SceneMark alone is the compact logo.

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
      <img className="logo__img" src="/logo.png" alt="" width="720" height="262" draggable="false" />
    </a>
  )
}
