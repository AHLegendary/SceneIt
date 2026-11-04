import { useEffect, useId, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import Poster from './Poster.jsx'
import { getCatalog, movieFromDb, posterUrl, searchMovies as searchCatalog } from '../lib/localStore.js'
import { searchMovies as searchTmdb } from '../lib/movies.js'

const DEBOUNCE_MS = 250
const LIMIT = 7
// TMDb's movie genres, in the order the chips show.
const GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Drama', 'Fantasy', 'Horror', 'Mystery', 'Romance', 'Science Fiction', 'Thriller']

// Header search: typing shows a dropdown of the top matches (TMDb through our
// API, falling back to the built-in catalog), with a row of genre chips to
// narrow them. With no text, a genre chip browses the catalog by genre.
// Picking a result opens its details. Esc / click outside closes.
export default function SearchBar({ onOpen }) {
  const [query, setQuery] = useState('')
  const [genre, setGenre] = useState(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  // { query, results, live } for the latest finished search
  const [live, setLive] = useState(null)
  const wrap = useRef(null)
  const input = useRef(null)
  const listId = useId()
  const q = query.trim()

  useEffect(() => {
    if (!q) return undefined
    let current = true
    const timer = setTimeout(() => {
      searchTmdb(q).then(
        (rows) => current && setLive({ query: q, results: rows.map(movieFromDb).filter(Boolean), live: true }),
        () => current && setLive({ query: q, results: searchCatalog(q, 40), live: false }),
      )
    }, DEBOUNCE_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [q])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && close()
    const onDown = (e) => wrap.current && !wrap.current.contains(e.target) && setOpen(false)
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  function close() {
    setOpen(false)
    setActive(-1)
    input.current?.blur()
  }

  const done = q && live?.query === q ? live : null
  const searching = Boolean(q) && !done
  const base = q ? (done ? done.results : live?.results ?? []) : genre ? getCatalog() : []
  const results = base.filter((m) => !genre || m.genres?.includes(genre)).slice(0, LIMIT)
  const showPanel = open && (q || genre)

  function pick(movie) {
    close()
    onOpen(movie.id)
  }

  function onKeyDown(e) {
    if (!showPanel) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const movie = results[active] ?? results[0]
      if (movie) pick(movie)
    }
  }

  return (
    <div className="sbar" ref={wrap} role="search">
      <Icon name="search" size={18} className="nav__search-icon" />
      <input
        ref={input}
        className="nav__search-input"
        type="search"
        placeholder="Search movies, shows, actors, or genres..."
        aria-label="Search movies"
        aria-expanded={Boolean(showPanel)}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        autoComplete="off"
        spellCheck="false"
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(-1)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {(q || genre) && (
        <button
          type="button"
          className="sbar__clear"
          aria-label="Clear search"
          onClick={() => {
            setQuery('')
            setGenre(null)
            input.current?.focus()
          }}
        >
          <Icon name="close" size={14} />
        </button>
      )}

      {showPanel && (
        <div className="sbar__panel">
          <div className="sbar__genres" role="group" aria-label="Filter by genre">
            {GENRES.map((g) => (
              <button
                key={g}
                type="button"
                className={`sbar__genre${genre === g ? ' is-on' : ''}`}
                aria-pressed={genre === g}
                onClick={() => {
                  setGenre((cur) => (cur === g ? null : g))
                  setActive(-1)
                }}
              >
                {g}
              </button>
            ))}
          </div>

          <ul className={`sbar__list${searching ? ' is-stale' : ''}`} id={listId} role="listbox" aria-label="Search results">
            {results.length === 0 ? (
              <li className="sbar__empty">
                {searching ? 'Searching…' : q ? `No ${genre ? `${genre.toLowerCase()} ` : ''}movies match “${q}”.` : `No ${genre.toLowerCase()} movies in the catalog yet.`}
              </li>
            ) : (
              results.map((movie, i) => (
                <li
                  key={movie.id}
                  role="option"
                  aria-selected={i === active}
                  className={`sbar__item${i === active ? ' is-active' : ''}`}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(movie)}
                >
                  <Poster title={movie.title} src={posterUrl(movie, 'w92')} size="sm" />
                  <span className="sbar__text">
                    <span className="sbar__title">{movie.title}</span>
                    <span className="sbar__meta">{[movie.year, movie.genres?.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}</span>
                  </span>
                  <Icon name="chevron" size={16} className="sbar__go" />
                </li>
              ))
            )}
          </ul>
          {done && !done.live && (
            <p className="sbar__note">Live search is unavailable, showing SceneIt's built-in movies.</p>
          )}
        </div>
      )}
    </div>
  )
}
