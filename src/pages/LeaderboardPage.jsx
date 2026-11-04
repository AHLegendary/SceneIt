import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import Poster from '../components/Poster.jsx'
import Sparkles from '../components/Sparkles.jsx'
import Segmented from '../components/Segmented.jsx'
import { fetchLeaderboard } from '../lib/leaderboard.js'
import { posterUrl } from '../lib/localStore.js'
import { useMyTiers } from '../lib/useMyList.js'

const PERIOD_OPTIONS = [
  { id: 'weekly', label: 'This week' },
  { id: 'monthly', label: 'This month' },
]
const CATEGORY_OPTIONS = [
  { id: 'highest', label: 'Highest ranked' },
  { id: 'watched', label: 'Most watched' },
]

const EMPTY_TEXT = {
  weekly: "No one's ranked anything this week yet. Rank a few movies to get it started.",
  monthly: "No one's ranked anything this month yet. Rank a few movies to get it started.",
}

// Public community leaderboard from the database. Reloads when the filters
// change, and when the signed-in user's list changes so their own rankings
// show up right away.
export default function LeaderboardPage({ onOpen }) {
  const [period, setPeriod] = useState('weekly')
  const [category, setCategory] = useState('highest')
  const myTiers = useMyTiers()
  const [attempt, setAttempt] = useState(0) // bumped by "Try again"
  // { key, rows, error }: key says which filters the result is for, so a
  // filter change shows "Loading" instead of the previous board.
  const [result, setResult] = useState(null)
  const key = `${period}-${category}`

  useEffect(() => {
    let current = true // ignore answers that arrive after the filters changed
    fetchLeaderboard(period, category).then(
      (rows) => current && setResult({ key, rows, error: null }),
      (error) => current && setResult({ key, rows: [], error: error.message }),
    )
    return () => {
      current = false
    }
  }, [period, category, key, myTiers, attempt])

  const loaded = result?.key === key ? result : null
  const rows = loaded?.rows ?? []

  return (
    <section className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title"><Icon name="trophy" size={30} />Leaderboard</h1>
          <p className="page__sub">What the SceneIt community is ranking right now.</p>
        </div>
        <div className="page__controls">
          <Segmented label="Time period" options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
          <Segmented label="Sort by" options={CATEGORY_OPTIONS} value={category} onChange={setCategory} />
        </div>
      </header>

      {!loaded ? (
        <div className="notice" role="status"><span>Loading the leaderboard…</span></div>
      ) : loaded.error ? (
        <div className="notice notice--error" role="alert">
          <span>{loaded.error}</span>
          <button type="button" className="btn btn--sm" onClick={() => { setResult(null); setAttempt((n) => n + 1) }}>
            Try again
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <div className="empty__stack" aria-hidden="true">
            <span /><span /><span />
          </div>
          <h2 className="empty__title">Nothing here yet</h2>
          <p className="empty__text">{EMPTY_TEXT[period]}</p>
        </div>
      ) : (
        <>
        {rows.length >= 3 && <Podium rows={rows.slice(0, 3)} category={category} onOpen={onOpen} />}
        <ol className="board" key={key}>
          {rows.map((movie) => (
            <li className={`row row--link${movie.rank <= 3 ? ' is-top' : ''}`} key={movie.id} onClick={() => onOpen(movie.id)}>
              <span className="row__rank">{movie.rank}</span>
              <Poster title={movie.title} src={posterUrl(movie, 'w154')} size="sm" />
              <div className="row__info">
                <button type="button" className="row__title row__link" onClick={(e) => { e.stopPropagation(); onOpen(movie.id) }}>
                  {movie.title}
                </button>
                <span className="row__meta">{movie.year}</span>
              </div>
              <div className="row__stat">
                {category === 'watched' ? (
                  <>
                    <span className="row__value">{movie.rankers.toLocaleString()}</span>
                    <span className="row__label">rankers</span>
                  </>
                ) : (
                  <>
                    <span className="row__value">{movie.score.toFixed(1)}</span>
                    <span className="row__label">score</span>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
        </>
      )}
    </section>
  )
}

// The top three, posters first. Order on screen is 2 · 1 · 3 like a podium.
function Podium({ rows, category, onOpen }) {
  const order = [rows[1], rows[0], rows[2]]
  return (
    <ol className="podium" aria-label="Top three">
      {order.map((movie) => (
        <li key={movie.id} className={`podium__spot podium__spot--${movie.rank}`}>
          <button type="button" className="podium__btn" onClick={() => onOpen(movie.id)}>
            {movie.rank === 1 && <Sparkles count={26} seed={7} />}
            <Poster title={movie.title} src={posterUrl(movie, 'w342')} size="md" />
            <span className="podium__title">{movie.title}</span>
            <span className="podium__value">
              {category === 'watched' ? `${movie.rankers.toLocaleString()} rankers` : `${movie.score.toFixed(1)} score`}
            </span>
          </button>
          <span className="podium__stand" aria-hidden="true">{movie.rank}</span>
        </li>
      ))}
    </ol>
  )
}
