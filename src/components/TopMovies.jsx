import { listRows } from '../features/ranking/listRows.js'
import { scoreTiers } from '../features/ranking/scores.js'
import MovieRows from './MovieRows.jsx'

export const TOP_COUNT = 5

// A user's top movies with a link to the full list. Used on every profile:
// viewAllHref is #/my-list on your own, #/u/<name>/my-list on someone else's.
// status: 'ready' | 'error' | anything else counts as still loading.
export default function TopMovies({ tiers, status = 'ready', onRetry, viewAllHref, onOpen, limit = TOP_COUNT }) {
  const count = tiers.reduce((n, tier) => n + tier.length, 0)

  let body
  if (status === 'error') {
    body = (
      <div className="profile__alert" role="alert">
        Couldn't load these movies.{' '}
        {onRetry && (
          <button type="button" className="profile__link" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    )
  } else if (status !== 'ready') {
    body = <p className="uprofile__muted">Loading movies…</p>
  } else if (count === 0) {
    body = <p className="uprofile__muted">No ranked movies yet.</p>
  } else {
    body = <MovieRows rows={listRows(tiers, limit)} scores={scoreTiers(tiers)} onOpen={onOpen} />
  }

  return (
    <section className="topmovies" aria-labelledby="topmovies-title">
      <div className="topmovies__head">
        <h2 id="topmovies-title" className="topmovies__title">
          {count >= limit ? `Top ${limit}` : 'Top movies'}
        </h2>
        {status === 'ready' && count > 0 && (
          <a className="profile__link" href={viewAllHref}>
            {count > limit ? `View all ${count} movies` : 'View full list'}
          </a>
        )}
      </div>
      {body}
    </section>
  )
}
