import { useEffect, useId, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import Poster from './Poster.jsx'
import { tierRanks } from '../features/ranking/binaryInsertion.js'
import { scoreTiers } from '../features/ranking/scores.js'
import { fetchCommunityStats } from '../lib/leaderboard.js'
import { isCatalogMovie, posterUrl } from '../lib/localStore.js'
import { formatRuntime, formatVotes, hasRatings } from '../lib/movieDetails.js'
import { getMovie as fetchMovie } from '../lib/movies.js'
import { useMyTiers } from '../lib/useMyList.js'

// Details panel for one movie, as a glass card over its blurred backdrop:
// poster on the left; title, facts, your rank, community rank, outside
// scores, overview and credits on the right; Rank / Rerank at the bottom.
// Catalog movies carry their details already; anything else (live search,
// trending, friends' picks) is filled in from the API the first time it opens.
export default function MovieDetails({ movie, signedIn = true, onClose, onRank, onRerank }) {
  const tiers = useMyTiers()
  const titleId = useId()
  const closeButton = useRef(null)
  const downOnBackdrop = useRef(false)
  // Bumps when details arrive for a non-catalog movie (the movie object is
  // shared, so it's filled in place and this just triggers a re-render).
  const [, setFilled] = useState(0)
  const [detailsFailed, setDetailsFailed] = useState(false)

  const tierIndex = tiers.findIndex((tier) => tier.some((m) => m.id === movie.id))
  const ranked = tierIndex !== -1
  const count = tiers.reduce((n, tier) => n + tier.length, 0)
  const myRank = ranked ? tierRanks(tiers)[tierIndex] : null
  const myScore = ranked ? scoreTiers(tiers)?.get(movie.id) ?? null : null
  const tied = ranked && tiers[tierIndex].length > 1
  // { id, weekly, monthly } once loaded. If it fails, the line just stays hidden:
  // it's extra info, and the rest of the panel works without it.
  const [communityFor, setCommunityFor] = useState(null)
  const community = communityFor?.id === movie.id ? communityFor : { weekly: null, monthly: null }
  const runtime = formatRuntime(movie.runtime)
  const outside = hasRatings(movie) ? movie.ratings : null
  const facts = [movie.year, runtime, movie.genres?.slice(0, 3).join(', ')].filter(Boolean)
  const needsDetails = !isCatalogMovie(movie) && !('runtime' in movie) && movie.tmdb_id
  const loadingDetails = needsDetails && !detailsFailed

  useEffect(() => {
    if (!needsDetails) return undefined
    let current = true
    fetchMovie(movie.tmdb_id).then(
      (full) => {
        if (!current) return
        // Fill the shared movie object so every card that shows it benefits.
        for (const key of ['overview', 'tagline', 'runtime', 'directors', 'cast']) {
          if (full[key] !== undefined) movie[key] = full[key]
        }
        if (!movie.backdrop_path && full.backdrop_path) movie.backdrop_path = full.backdrop_path
        if (!movie.genres?.length && full.genres?.length) movie.genres = full.genres
        if (!('runtime' in movie)) movie.runtime = null
        setFilled((n) => n + 1)
      },
      () => current && setDetailsFailed(true),
    )
    return () => {
      current = false
    }
  }, [movie, needsDetails])

  useEffect(() => {
    let current = true
    fetchCommunityStats(movie.id).then(
      (stats) => current && setCommunityFor({ id: movie.id, ...stats }),
      () => {},
    )
    return () => {
      current = false
    }
  }, [movie.id, tiers])

  useEffect(() => {
    closeButton.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const best = community.weekly || community.monthly

  return (
    <div
      className="overlay overlay--top overlay--glass"
      onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose() }}
    >
      <article className="glass" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button ref={closeButton} type="button" className="dialog__close glass__close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={18} strokeWidth={2.2} />
        </button>

        <div className="glass__poster">
          <Poster title={movie.title} src={posterUrl(movie, 'w500')} size="lg" />
        </div>

        <div className="glass__body">
          <header className="glass__head">
            <h2 className="glass__title" id={titleId}>{movie.title}</h2>
            {facts.length > 0 && <p className="glass__facts">{facts.join(' · ')}</p>}
            {movie.tagline && <p className="glass__tagline">{movie.tagline}</p>}
          </header>

          {/* Signed out: only the outside scores (IMDb, Rotten Tomatoes). Your
              rank and the community rank need an account. */}
          <div className="glass__stats">
            {signedIn && (
              <div className="gstat">
                <span className="gstat__label">Your rank</span>
                {ranked ? (
                  <span className="gstat__value">
                    #{myRank}
                    <small> of {count}{tied ? ' · tied' : ''}</small>
                  </span>
                ) : (
                  <span className="gstat__value gstat__value--muted">Not ranked</span>
                )}
              </div>
            )}
            {ranked && (
              <div className="gstat">
                <span className="gstat__label">Your score</span>
                <span className={`gstat__value${myScore === null ? ' gstat__value--muted' : ''}`}>
                  {myScore === null ? 'At 10 movies' : myScore.toFixed(1)}
                </span>
              </div>
            )}
            {signedIn && best && (
              <div className="gstat">
                <span className="gstat__label">Community</span>
                <span className="gstat__value">
                  {best.score.toFixed(1)}
                  <small> #{best.rank} {community.weekly ? 'this week' : 'this month'}</small>
                </span>
              </div>
            )}
            {outside?.imdb !== null && outside?.imdb !== undefined && (
              <div className="gstat gstat--outside">
                <span className="gstat__label">IMDb</span>
                <span className="gstat__value">
                  {outside.imdb.toFixed(1)}
                  <small>/10{outside.imdb_votes ? ` · ${formatVotes(outside.imdb_votes)}` : ''}</small>
                </span>
              </div>
            )}
            {outside?.rt !== null && outside?.rt !== undefined && (
              <div className="gstat gstat--outside">
                <span className="gstat__label">Rotten Tomatoes</span>
                <span className="gstat__value">{outside.rt}%<small> critics</small></span>
              </div>
            )}
          </div>

          <div className="glass__scroll">
            {movie.overview ? (
              <p className="glass__overview">{movie.overview}</p>
            ) : loadingDetails ? (
              <p className="glass__overview glass__overview--loading" aria-busy="true">Loading details…</p>
            ) : null}

            {(movie.directors?.length > 0 || movie.cast?.length > 0) && (
              <dl className="glass__credits">
                {movie.directors?.length > 0 && (
                  <div>
                    <dt>{movie.directors.length > 1 ? 'Directors' : 'Director'}</dt>
                    <dd>{movie.directors.join(', ')}</dd>
                  </div>
                )}
                {movie.cast?.length > 0 && (
                  <div>
                    <dt>Cast</dt>
                    <dd>{movie.cast.join(', ')}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>

          <footer className="glass__actions">
            {ranked ? (
              <>
                <span className="glass__ranked">
                  <Icon name="check" size={16} />
                  Ranked #{myRank}
                </span>
                {count > 1 && (
                  <button type="button" className="btn btn--light" onClick={() => onRerank(movie)}>
                    <Icon name="swords" size={16} />
                    Rerank
                  </button>
                )}
              </>
            ) : (
              <button type="button" className="btn btn--accent" onClick={() => onRank(movie)}>
                <Icon name="swords" size={16} />
                {signedIn ? 'Rank it' : 'Log in to rank'}
              </button>
            )}
            <span className="glass__links">
              {movie.imdb_id && (
                <a href={`https://www.imdb.com/title/${movie.imdb_id}/`} target="_blank" rel="noreferrer">IMDb</a>
              )}
              {movie.tmdb_id && (
                <a href={`https://www.themoviedb.org/movie/${movie.tmdb_id}`} target="_blank" rel="noreferrer">TMDB</a>
              )}
            </span>
          </footer>
        </div>
      </article>
    </div>
  )
}
