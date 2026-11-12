import { useEffect, useId, useState } from 'react'
import Icon from './Icon.jsx'
import Poster from './Poster.jsx'
import TopTen, { TOP_TEN } from './TopTen.jsx'
import { topGenre } from '../features/profile/topGenre.js'
import { scoreTiers } from '../features/ranking/scores.js'
import { posterUrl } from '../lib/localStore.js'

// The two compact cards at the top of a profile: Top Movie (the #1, with a
// button that opens their top 10) and Top Genre (the genre they've ranked the
// most, shown with one of its best movies). The same on your own profile and
// on everyone else's, so `onStartRanking` is only passed for your own: it
// turns the empty state into an invitation.
export default function ProfileHighlights({ tiers, onOpen, onStartRanking }) {
  const [topTenOpen, setTopTenOpen] = useState(false)
  const ranked = tiers.flat()
  const top = ranked[0] ?? null
  const genre = topGenre(tiers)

  return (
    <section className="highlights" aria-label="Highlights">
      <article className="hcard" aria-labelledby="hcard-movie">
        <h2 className="hcard__label" id="hcard-movie">Top Movie</h2>
        {top ? (
          <div className="hcard__row">
            <button type="button" className="hcard__poster" onClick={() => onOpen?.(top.id)} aria-label={`Open ${top.title}`}>
              <Poster title={top.title} src={posterUrl(top, 'w342')} size="md" />
            </button>
            <div className="hcard__info">
              <p className="hcard__name">{top.title}</p>
              <button type="button" className="btn btn--sm btn--light" onClick={() => setTopTenOpen(true)}>
                View Top 10
              </button>
            </div>
          </div>
        ) : (
          <div className="hcard__empty">
            <strong>Nothing ranked yet</strong>
            <span>{onStartRanking ? 'Your number one movie shows up here.' : 'Their number one movie shows up here.'}</span>
            {onStartRanking && (
              <button type="button" className="btn btn--accent btn--sm" onClick={onStartRanking}>Start ranking</button>
            )}
          </div>
        )}
      </article>

      <article className="hcard" aria-labelledby="hcard-genre">
        <h2 className="hcard__label" id="hcard-genre">Top Genre</h2>
        {genre ? (
          <div className="hcard__row">
            <button type="button" className="hcard__poster" onClick={() => onOpen?.(genre.movie.id)} aria-label={`Open ${genre.movie.title}`}>
              <Poster title={genre.movie.title} src={posterUrl(genre.movie, 'w342')} size="md" />
            </button>
            <div className="hcard__info">
              <p className="hcard__name">{genre.genre}</p>
              <p className="hcard__meta">{genre.count} {genre.count === 1 ? 'movie' : 'movies'}</p>
            </div>
          </div>
        ) : (
          <div className="hcard__empty">
            <strong>No favorite genre yet</strong>
            <span>Rank a few movies to find out which genre comes out on top.</span>
          </div>
        )}
      </article>

      {topTenOpen && (
        <TopTenDialog
          tiers={tiers}
          onClose={() => setTopTenOpen(false)}
          onOpen={(id) => {
            setTopTenOpen(false)
            onOpen?.(id)
          }}
        />
      )}
    </section>
  )
}

// The top 10 in a dialog, reusing the poster strip. Escape, the close button
// and a click outside all close it.
function TopTenDialog({ tiers, onClose, onOpen }) {
  const titleId = useId()
  const ranked = tiers.flat()

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay overlay--top overlay--center" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog topten" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="dialog__head">
          <h2 className="dialog__title" id={titleId}>
            <Icon name="star" size={22} />
            {ranked.length >= TOP_TEN ? 'Top 10' : 'Top movies'}
          </h2>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Close" autoFocus>
            <Icon name="close" size={18} />
          </button>
        </div>
        <TopTen ranked={ranked} scores={scoreTiers(tiers)} onOpen={onOpen} />
      </div>
    </div>
  )
}
