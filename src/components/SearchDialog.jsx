import { useEffect, useId, useRef, useState } from 'react'
import Poster from './Poster.jsx'
import { getSuggestions, movieFromDb, posterUrl, searchMovies as searchCatalog } from '../lib/localStore.js'
import { searchMovies as searchTmdb } from '../lib/movies.js'
import { useMyList } from '../lib/useMyList.js'

const DEBOUNCE_MS = 300
const LIVE_ERROR = "Live search isn't working right now, so these are only SceneIt's built-in movies."

// Search every movie on TMDb (through our API) and pick one to rank.
// Typing waits briefly before searching so we don't send a request per key.
// If the API fails, it falls back to the built-in catalog.
// Esc or clicking outside closes it.
export default function SearchDialog({ onClose, onPick, onOpen }) {
  const [query, setQuery] = useState('')
  const list = useMyList()
  const input = useRef(null)
  const titleId = useId()
  // { query, results, error } for the latest finished search
  const [live, setLive] = useState(null)

  const inList = new Set(list.map((m) => m.id))
  const trimmed = query.trim()

  useEffect(() => {
    if (!trimmed) return undefined
    let current = true // ignore answers for an older query
    const timer = setTimeout(() => {
      searchTmdb(trimmed).then(
        (rows) => current && setLive({ query: trimmed, results: rows.map(movieFromDb).filter(Boolean), error: null }),
        () => current && setLive({ query: trimmed, results: searchCatalog(trimmed), error: LIVE_ERROR }),
      )
    }, DEBOUNCE_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [trimmed])

  const done = trimmed && live?.query === trimmed ? live : null
  const searching = Boolean(trimmed) && !done
  // While a search is running, keep showing the previous results instead of
  // flashing an empty list.
  const results = !trimmed ? getSuggestions() : done ? done.results : live?.results ?? []

  useEffect(() => {
    input.current?.focus()
    // Esc closes the top-most panel only; movie details can sit on top of search.
    const onKey = (e) => e.key === 'Escape' && !document.querySelector('.overlay--top') && onClose()
    window.addEventListener('keydown', onKey)
    // keep the page behind from scrolling while the dialog is open
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="dialog__head">
          <h2 className="dialog__title" id={titleId}>Rank a movie</h2>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <label className="search">
          <svg className="search__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
            <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <input
            ref={input}
            className="search__input"
            type="search"
            placeholder="Search for a movie you've watched"
            aria-label="Search movies"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck="false"
          />
        </label>

        <p className="dialog__section" aria-live="polite">
          {!trimmed
            ? 'Popular picks'
            : searching
              ? 'Searching…'
              : results.length
                ? `${results.length} ${results.length === 1 ? 'result' : 'results'}`
                : ''}
        </p>

        {done?.error && (
          <p className="notice notice--error dialog__notice" role="alert">
            <span>{done.error}</span>
          </p>
        )}

        {done && results.length === 0 ? (
          <p className="dialog__empty">No movies match “{trimmed}”. Try another title.</p>
        ) : (
          <ul className={`results${searching ? ' is-stale' : ''}`}>
            {results.map((movie) => {
              const added = inList.has(movie.id)
              return (
                <li className="result" key={movie.id}>
                  <Poster title={movie.title} src={posterUrl(movie, 'w154')} size="sm" />
                  <div className="row__info">
                    <button type="button" className="row__title row__link" onClick={() => onOpen(movie.id)}>
                      {movie.title}
                    </button>
                    <span className="row__meta">
                      {[movie.year, movie.genres?.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`btn btn--sm${added ? ' is-done' : ''}`}
                    disabled={added}
                    onClick={() => onPick(movie)}
                    aria-label={added ? `${movie.title} is already ranked` : `Rank ${movie.title}`}
                  >
                    {added ? 'Ranked' : 'Rank'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
