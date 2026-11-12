import { useState } from 'react'
import { profileImageUrl } from '../lib/profileMedia.js'

// A user's profile picture, or their initial when they haven't set one (the
// image fails to load). Decorative: put the username next to it, since the
// picture alone says nothing to a screen reader. `size` is in pixels.
export default function Avatar({ userId, username, size = 32 }) {
  // Remember which user's image failed, so changing userId tries again.
  const [failedFor, setFailedFor] = useState(null)
  const src = profileImageUrl(userId, 'avatar')
  const style = { '--size': `${size}px` }

  if (src && failedFor !== userId) {
    return <img className="avatar" style={style} src={src} alt="" loading="lazy" onError={() => setFailedFor(userId)} />
  }
  return (
    <span className="avatar avatar--initial" style={style} aria-hidden="true">
      {(username ?? '?').charAt(0).toUpperCase()}
    </span>
  )
}
