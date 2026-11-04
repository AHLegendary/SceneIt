import Poster from './Poster.jsx'
import { posterUrl } from '../lib/localStore.js'

// Read-only ranked rows (rank, poster, title, year, score) for someone's list.
// `rows` comes from listRows(); `scores` is a Map of movie id -> score, or null.
export default function MovieRows({ rows, scores = null, onOpen }) {
  return (
    <ol className="board">
      {rows.map(({ movie, rank, tied, tieStart, tieEnd }) => {
        const classes = ['row', 'row--link']
        if (tied) classes.push('is-tied')
        if (tied && tieStart) classes.push('is-tie-start')
        if (tied && tieEnd) classes.push('is-tie-end')
        return (
          <li className={classes.join(' ')} key={movie.id} onClick={() => onOpen?.(movie.id)}>
            <span className="row__rank">{rank}</span>
            <Poster title={movie.title} src={posterUrl(movie, 'w154')} size="sm" />
            <div className="row__info">
              <button
                type="button"
                className="row__title row__link"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpen?.(movie.id)
                }}
              >
                {movie.title}
              </button>
              <span className="row__meta">
                {movie.year}
                {tied && <span className="chip">Tied</span>}
              </span>
            </div>
            {scores?.has(movie.id) && (
              <div className="row__end">
                <div className="row__stat">
                  <span className="row__value">{scores.get(movie.id).toFixed(1)}</span>
                  <span className="row__label">score</span>
                </div>
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
