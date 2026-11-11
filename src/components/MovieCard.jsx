import { useState } from 'react'
import { m } from 'motion/react'
import { imageUrl, posterUrl } from '../lib/localStore.js'

// Wide movie card for the homepage rows: backdrop (or poster) with the
// title over a gradient. Shows a shimmer until the image loads and a tinted
// placeholder if there is no image or it fails.
export default function MovieCard({ movie, onOpen, rank, caption, badge, ranked = false }) {
  const [state, setState] = useState('loading') // 'loading' | 'ready' | 'failed'
  const wide = imageUrl(movie.backdrop_path, 'w500')
  const src = wide || posterUrl(movie, 'w342')
  const showImage = src && state !== 'failed'

  // Motion drives the lift on hover and the press on tap (a spring, so it
  // settles rather than snaps); colour and glow stay in CSS (.card:hover).
  return (
    <m.button
      type="button"
      className={`card${wide ? '' : ' card--poster'}${state === 'loading' && src ? ' is-loading' : ''}`}
      onClick={() => onOpen(movie.id)}
      aria-label={`${movie.title}${movie.year ? ` (${movie.year})` : ''}`}
      whileHover={{ y: -4, scale: 1.04 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 420, damping: 28, mass: 0.6 }}
    >
      {showImage ? (
        <img
          className="card__img"
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setState('ready')}
          onError={() => setState('failed')}
        />
      ) : (
        <span className="card__blank" aria-hidden="true" />
      )}
      <span className="card__scrim" aria-hidden="true" />
      {rank !== undefined && <span className="card__rank" aria-hidden="true">{rank}</span>}
      {badge && <span className="card__badge">{badge}</span>}
      {ranked && <span className="card__ranked" title="In your list">✓</span>}
      <span className="card__text">
        <span className="card__title">{movie.title}</span>
        {caption ? (
          <span className="card__caption">{caption}</span>
        ) : (
          movie.year && <span className="card__caption">{movie.year}</span>
        )}
      </span>
    </m.button>
  )
}
