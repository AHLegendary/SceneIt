import { useState } from 'react'
import ArrowScroller from './ArrowScroller.jsx'
import Icon from './Icon.jsx'
import Poster from './Poster.jsx'
import { posterUrl } from '../lib/localStore.js'

// How many posters a profile shows before "View all".
export const WATCHLIST_PREVIEW = 6

// A list item, or a plain group inside the scroller (a <li> needs a <ul> parent).
function Item({ row, children, ...props }) {
  return row ? <div role="group" {...props}>{children}</div> : <li {...props}>{children}</li>
}

// A profile's watchlist: posters of movies they want to watch. Movies already
// ranked are hidden (you've seen them), so `rankedIds` is the profile's ranked
// list. Pass `onRemove` only for your own watchlist; it adds a remove button.
// On a profile it's a preview: `limit` caps the posters and `fullHref` links
// to the whole watchlist page; `row` lays the posters out as one row that
// scrolls sideways (the full pages use a wrapping grid instead).
//
//   status     'loading' | 'ready' | 'error'
//   movies     movie objects, newest added first
//   onOpen     opens a movie's details (movie id)
//   onRemove   (movie) => Promise, rejects with a user-facing message
//   onRank     (movie) => void; adds a Rank it button (for movies you have now watched)
export default function Watchlist({ status, movies, rankedIds, onRetry, onOpen, onRemove, onRank, limit = Infinity, fullHref, heading = true, row = false }) {
  const [error, setError] = useState(null)
  const unranked = movies.filter((movie) => !rankedIds.has(movie.id))
  const visible = unranked.slice(0, limit)

  async function remove(movie) {
    setError(null)
    try {
      await onRemove(movie)
    } catch (e) {
      setError(e.message)
    }
  }

  let body
  if (status === 'error') {
    body = (
      <div className="profile__alert" role="alert">
        Couldn't load the watchlist.{' '}
        <button type="button" className="profile__link" onClick={onRetry}>Try again</button>
      </div>
    )
  } else if (status !== 'ready') {
    body = <p className="uprofile__muted">Loading watchlist…</p>
  } else if (visible.length === 0) {
    body = (
      <p className="uprofile__muted">
        {onRemove ? 'Nothing saved yet. Open a movie and choose Save to watchlist.' : 'Nothing on the watchlist yet.'}
      </p>
    )
  } else {
    const Wrap = row ? ArrowScroller : 'ul'
    body = (
      <Wrap {...(row ? { label: 'watchlist', className: 'wlist wlist--row' } : { className: 'wlist' })}>
        {visible.map((movie) => (
          <Item key={movie.id} className="wlist__item" row={row}>
            <button type="button" className="wlist__open" onClick={() => onOpen(movie.id)} aria-label={`Open ${movie.title}`}>
              <Poster title={movie.title} src={posterUrl(movie, 'w342')} size="md" />
              <span className="wlist__title">{movie.title}</span>
            </button>
            {onRank && (
              <button type="button" className="wlist__rank" onClick={() => onRank(movie)} aria-label={`Rank ${movie.title}`}>
                <Icon name="swords" size={14} />
                Rank it
              </button>
            )}
            {onRemove && (
              <button type="button" className="wlist__remove" onClick={() => remove(movie)} aria-label={`Remove ${movie.title} from watchlist`}>
                <Icon name="close" size={14} strokeWidth={2.4} />
              </button>
            )}
          </Item>
        ))}
      </Wrap>
    )
  }

  return (
    <section className="watchlist" aria-label="Watchlist">
      {heading && (
        <div className="recent__head">
          <h2 className="recs__title"><Icon name="bookmark" size={20} /> Watchlist</h2>
          {fullHref && status === 'ready' && unranked.length > 0 && (
            <a className="profile__link" href={fullHref}>View all{unranked.length > visible.length ? ` (${unranked.length})` : ''}</a>
          )}
        </div>
      )}
      {error && <div className="notice notice--error" role="alert"><span>{error}</span></div>}
      {body}
    </section>
  )
}
