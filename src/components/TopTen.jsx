import ArrowScroller from './ArrowScroller.jsx'
import Poster from './Poster.jsx'
import { posterUrl } from '../lib/localStore.js'

export const TOP_TEN = 10

// A user's best ten movies as a scrolling strip of posters: rank and title,
// then the score once scores exist (otherwise the year). `ranked` is the flat
// list, best first; `scores` is scoreTiers() output or null. Used for "View
// Top 10" on every profile.
export default function TopTen({ ranked, scores, onOpen }) {
  return (
    <ArrowScroller label="top movies" className="profile-favs__list">
      {ranked.slice(0, TOP_TEN).map((movie, i) => (
        <div key={movie.id} className="profile-favs__item">
          <button type="button" className="rec" onClick={() => onOpen?.(movie.id)}>
            <Poster title={movie.title} src={posterUrl(movie, 'w342')} size="md" />
            <span className="rec__title">#{i + 1} {movie.title}</span>
            <span className="rec__meta">{scores ? `${scores.get(movie.id).toFixed(1)} score` : movie.year}</span>
          </button>
        </div>
      ))}
    </ArrowScroller>
  )
}
