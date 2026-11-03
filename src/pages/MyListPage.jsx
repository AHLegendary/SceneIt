import { useState } from 'react'
import Poster from '../components/Poster.jsx'
import { tierRanks } from '../features/ranking/binaryInsertion.js'
import Segmented from '../components/Segmented.jsx'
import {
  categoryOf,
  countByCategory,
  moviesUntilScores,
  SCORE_CATEGORIES,
  SCORE_UNLOCK,
  scoreTiers,
} from '../features/ranking/scores.js'
import { posterUrl } from '../lib/localStore.js'
import { removeMovie } from '../lib/supabaseStore.js'
import { useMyTiers } from '../lib/useMyList.js'

// The signed-in user's ranked list. Starts empty; "Rank a movie" opens search.
// Tied movies share a rank. Scores appear once 10+ movies are ranked, and
// with them a filter by score category (Loved it / It was okay / Not a fan).
// highlightId briefly marks the movie that was just ranked.
export default function MyListPage({ onAdd, onRerank, onOpen, highlightId }) {
  const tiers = useMyTiers()
  const ranks = tierRanks(tiers)
  const count = tiers.reduce((n, tier) => n + tier.length, 0)
  const scores = scoreTiers(tiers)
  const toUnlock = moviesUntilScores(count)
  const [removing, setRemoving] = useState(null) // id of the movie being removed
  const [removeError, setRemoveError] = useState(null)
  const [filter, setFilter] = useState('all')
  // No scores (under 10 movies) means no categories, so show everything.
  const activeFilter = scores ? filter : 'all'
  const counts = countByCategory(scores)
  const filterOptions = [
    { id: 'all', label: `All · ${count}` },
    ...SCORE_CATEGORIES.map((c) => ({ id: c.id, label: `${c.label} · ${counts[c.id]}` })),
  ]
  const category = SCORE_CATEGORIES.find((c) => c.id === activeFilter)
  const shows = (movie) => activeFilter === 'all' || categoryOf(scores.get(movie.id)) === activeFilter
  const shownCount = activeFilter === 'all' ? count : counts[activeFilter]

  async function remove(movie) {
    setRemoving(movie.id)
    setRemoveError(null)
    try {
      await removeMovie(movie.id)
    } catch (error) {
      setRemoveError(error.message)
    } finally {
      setRemoving(null)
    }
  }

  return (
    <section className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">My List</h1>
          <p className="page__sub">
            {count
              ? `${count} ranked ${count === 1 ? 'movie' : 'movies'}`
              : 'Every movie you rank lands here, best at the top.'}
          </p>
        </div>
        {count > 0 && (
          <button type="button" className="btn" onClick={onAdd}>
            Rank a movie
          </button>
        )}
      </header>

      {removeError && (
        <div className="notice notice--error" role="alert">
          <span>{removeError}</span>
          <button type="button" className="row__btn" onClick={() => setRemoveError(null)}>Dismiss</button>
        </div>
      )}

      {count > 0 && !scores && (
        <div className="unlock" role="status">
          <div className="unlock__text">
            <strong>Rank {toUnlock} more {toUnlock === 1 ? 'movie' : 'movies'} to unlock scores</strong>
            <span>Once you've ranked {SCORE_UNLOCK}, every movie gets a score out of 10 based on where it sits.</span>
          </div>
          <div
            className="unlock__bar"
            role="progressbar"
            aria-label="Movies ranked toward scores"
            aria-valuemin={0}
            aria-valuemax={SCORE_UNLOCK}
            aria-valuenow={count}
          >
            <span style={{ width: `${(count / SCORE_UNLOCK) * 100}%` }} />
          </div>
        </div>
      )}

      {scores && (
        <div className="listfilter">
          <Segmented label="Filter by how much you liked it" options={filterOptions} value={activeFilter} onChange={setFilter} />
          {category && <span className="listfilter__range">Scores {category.range}</span>}
        </div>
      )}

      {count > 0 && shownCount === 0 ? (
        <div className="notice" role="status">
          <span>No movies in “{category.label}” yet.</span>
          <button type="button" className="row__btn" onClick={() => setFilter('all')}>Show all</button>
        </div>
      ) : count === 0 ? (
        <div className="empty">
          <div className="empty__stack" aria-hidden="true">
            <span /><span /><span />
          </div>
          <h2 className="empty__title">Your list is empty</h2>
          <p className="empty__text">
            Add a movie you've watched to start your ranking. After the first one,
            SceneIt asks you to compare each new movie head-to-head.
          </p>
          <button type="button" className="btn" onClick={onAdd}>
            Rank a movie
          </button>
        </div>
      ) : (
        <ol className="board">
          {tiers.map((tier, t) =>
            tier.map((movie, k) => {
              if (!shows(movie)) return null
              const isTied = tier.length > 1
              const classes = ['row', 'row--mine', 'row--link']
              if (isTied) classes.push('is-tied')
              if (isTied && k === 0) classes.push('is-tie-start')
              if (isTied && k === tier.length - 1) classes.push('is-tie-end')
              if (movie.id === highlightId) classes.push('is-new')
              return (
                <li className={classes.join(' ')} key={movie.id} onClick={() => onOpen(movie.id)}>
                  <span className="row__rank">{ranks[t]}</span>
                  <Poster title={movie.title} src={posterUrl(movie, 'w154')} size="sm" />
                  <div className="row__info">
                    <button type="button" className="row__title row__link" onClick={(e) => { e.stopPropagation(); onOpen(movie.id) }}>
                      {movie.title}
                    </button>
                    <span className="row__meta">
                      {movie.year}
                      {isTied && <span className="chip">Tied</span>}
                    </span>
                  </div>
                  <div className="row__end">
                    <div className="row__actions" onClick={(e) => e.stopPropagation()}>
                      {count > 1 && (
                        <button type="button" className="row__btn" onClick={() => onRerank(movie)} aria-label={`Rerank ${movie.title}`}>
                          Rerank
                        </button>
                      )}
                      <button
                        type="button"
                        className="row__btn"
                        onClick={() => remove(movie)}
                        disabled={removing !== null}
                        aria-label={`Remove ${movie.title}`}
                      >
                        {removing === movie.id ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                    {scores && (
                      <div className="row__stat">
                        <span className="row__value">{scores.get(movie.id).toFixed(1)}</span>
                        <span className="row__label">score</span>
                      </div>
                    )}
                  </div>
                </li>
              )
            }),
          )}
        </ol>
      )}
    </section>
  )
}
