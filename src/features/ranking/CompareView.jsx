import { useEffect, useId, useRef, useState } from 'react'
import Poster from '../../components/Poster.jsx'
import { posterUrl } from '../../lib/localStore.js'
import { getMyTiers, placeMovie } from '../../lib/supabaseStore.js'
import {
  answer,
  applyPlacement,
  finalPlacement,
  isDone,
  maxComparisons,
  NEW,
  nextOpponent,
  OPPONENT,
  startInsertion,
  TIE,
  tierRanks,
} from './binaryInsertion.js'
import {
  categoryOffset,
  getCategory,
  moviesUntilScores,
  SCORE_CATEGORIES,
  scoreTiers,
  tiersInCategory,
} from './scores.js'

// Rank of a movie in a list of tiers, or null if it isn't there.
function rankOf(tiers, id) {
  const ranks = tierRanks(tiers)
  const at = tiers.findIndex((tier) => tier.some((m) => m.id === id))
  return at === -1 ? null : ranks[at]
}

// Full-screen flow for placing one movie in My List: a newly watched movie,
// or one being reranked. First the user says how they felt about it (Loved
// it / It was okay / Not a fan), then head-to-head comparisons place it among
// the movies already in that category. A category with nothing in it yet
// needs no comparisons. The list is only saved once the last comparison is
// answered, so closing early leaves the ranking untouched. If the save fails,
// the result screen says so and offers a retry.
export default function CompareView({ movie, rerank = false, onClose, onRankAnother, onSeeList }) {
  // Snapshot the list once. When reranking, the movie is compared against
  // everything except itself.
  const [setup] = useState(() => {
    const current = getMyTiers()
    const others = current.map((tier) => tier.filter((m) => m.id !== movie.id)).filter((tier) => tier.length)
    const previous = current.flat().find((m) => m.id === movie.id)
    return { oldRank: rerank ? rankOf(current, movie.id) : null, oldCategory: previous?.category ?? null, others }
  })
  const [category, setCategory] = useState(null)
  // Insertion states inside the chosen category; empty until one is picked.
  const [history, setHistory] = useState([])
  const saveStarted = useRef(false)
  // 'saving' | 'saved' | 'failed'
  const [saveStatus, setSaveStatus] = useState('saving')
  const titleId = useId()

  const state = history[history.length - 1] ?? null
  const done = state !== null && isDone(state)
  const opponent = state && !done ? nextOpponent(state) : null

  function pickCategory(id) {
    setCategory(id)
    setHistory([startInsertion(tiersInCategory(setup.others, id), movie)])
  }

  function choose(choice) {
    if (!state || done) return
    setHistory((h) => [...h, answer(h[h.length - 1], choice)])
  }

  // Undo the last comparison, or go back to the category question.
  function undo() {
    if (history.length > 1) setHistory((h) => h.slice(0, -1))
    else {
      setCategory(null)
      setHistory([])
    }
  }

  async function save() {
    setSaveStatus('saving')
    try {
      await placeMovie(movie.id, { category, ...finalPlacement(state) })
      setSaveStatus('saved')
    } catch {
      setSaveStatus('failed')
    }
  }

  // Save once, when the last comparison is answered. Retries go through save().
  useEffect(() => {
    if (done && !saveStarted.current) {
      saveStarted.current = true
      save()
    }
  })

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (done) return
      else if (!category) {
        const picked = SCORE_CATEGORIES[Number(e.key) - 1]
        if (picked) pickCategory(picked.id)
      }
      else if (e.key === 'ArrowLeft') choose(NEW)
      else if (e.key === 'ArrowRight') choose(OPPONENT)
      else if (e.key === 'ArrowDown' || e.key === '=') choose(TIE)
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  })

  // The whole list with the movie placed: its spot inside the category,
  // shifted down past the better categories.
  function placedTiers() {
    const { index, tied } = finalPlacement(state)
    const offset = categoryOffset(setup.others, category)
    return applyPlacement(setup.others, { ...movie, category }, { index: offset + index, tied })
  }

  let body
  if (!category) {
    body = (
      <FeelingStep
        titleId={titleId}
        movie={movie}
        rerank={rerank}
        current={setup.oldCategory}
        onPick={pickCategory}
      />
    )
  } else if (done) {
    body = (
      <Placed
        titleId={titleId}
        movie={movie}
        category={category}
        tiers={placedTiers()}
        tied={finalPlacement(state).tied}
        oldRank={setup.oldRank}
        saveStatus={saveStatus}
        onRetry={save}
        onRankAnother={onRankAnother}
        onSeeList={onSeeList}
      />
    )
  } else {
    body = (
      <>
        <header className="compare__head">
          <h2 className="compare__title" id={titleId}>Which did you like more?</h2>
          <p className="compare__progress" aria-live="polite">
            {getCategory(category).label} · Comparison {state.comparisons + 1} of up to {maxComparisons(state.tiers.length)}
          </p>
        </header>

        <div className="duel">
          <PickCard movie={movie} badge={rerank ? 'Reranking' : 'Just watched'} onPick={() => choose(NEW)} hint="←" />
          <span className="duel__vs" aria-hidden="true">vs</span>
          <PickCard key={opponent.id} movie={opponent} onPick={() => choose(OPPONENT)} hint="→" />
        </div>

        <footer className="compare__foot">
          <button type="button" className="ghost" onClick={undo}>
            {history.length > 1 ? 'Undo' : 'Back'}
          </button>
          <button type="button" className="ghost ghost--tie" onClick={() => choose(TIE)}>
            It's a tie
            <kbd className="pick__key" aria-hidden="true">↓</kbd>
          </button>
          <span className="compare__keys">Tap a poster, or use ← →</span>
        </footer>
      </>
    )
  }

  return (
    <div className="overlay overlay--solid">
      <div className="compare" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button type="button" className="dialog__close compare__close" onClick={onClose} aria-label="Close without saving">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
        {body}
      </div>
    </div>
  )
}

// "How did you feel about it?" One button per category. When reranking, the
// movie's current category is marked so it's easy to keep.
function FeelingStep({ titleId, movie, rerank, current, onPick }) {
  return (
    <div className="feel">
      <Poster title={movie.title} src={posterUrl(movie, 'w342')} size="lg" />
      <h2 className="compare__title" id={titleId}>How did you feel about {movie.title}?</h2>
      <p className="compare__progress">
        {rerank ? 'Keep your answer, or change it.' : 'Then we\'ll compare it with others you felt the same about.'}
      </p>
      <div className="feel__options">
        {SCORE_CATEGORIES.map((c, i) => (
          <button
            type="button"
            key={c.id}
            className={`feel__btn feel__btn--${c.id}${c.id === current ? ' is-current' : ''}`}
            onClick={() => onPick(c.id)}
            autoFocus={i === 0}
          >
            <span className="feel__label">{c.label}</span>
            <span className="feel__range">{c.range}</span>
            {c.id === current && <span className="feel__now">Current</span>}
            <kbd className="pick__key" aria-hidden="true">{i + 1}</kbd>
          </button>
        ))}
      </div>
    </div>
  )
}

function PickCard({ movie, badge, onPick, hint }) {
  return (
    <button type="button" className="pick" onClick={onPick} aria-label={`I liked ${movie.title} more`}>
      {badge && <span className="pick__badge">{badge}</span>}
      <Poster title={movie.title} src={posterUrl(movie, 'w342')} size="lg" />
      <span className="pick__title">{movie.title}</span>
      <span className="pick__meta">
        {movie.year}
        <kbd className="pick__key" aria-hidden="true">{hint}</kbd>
      </span>
    </button>
  )
}

// Result screen: where the movie landed, its score once unlocked, and the
// movies around it for context.
function Placed({ titleId, movie, category, tiers, tied, oldRank, saveStatus, onRetry, onRankAnother, onSeeList }) {
  const ranks = tierRanks(tiers)
  const rows = tiers.flatMap((tier, i) => tier.map((m) => ({ movie: m, rank: ranks[i], tier: i })))
  const at = rows.findIndex((r) => r.movie.id === movie.id)
  const from = Math.max(0, Math.min(at - 1, rows.length - 3))
  const nearby = rows.slice(from, from + 3)
  const { rank, tier } = rows[at]
  const count = rows.length
  const tiedWith = tiers[tier].filter((m) => m.id !== movie.id)
  const scores = scoreTiers(tiers)
  const toUnlock = moviesUntilScores(count)

  let eyebrow = 'Ranked'
  let text = `${movie.title} is now #${rank} in your list.`
  const label = getCategory(category).label
  const inCategory = tiersInCategory(tiers, category).reduce((n, t) => n + t.length, 0)
  if (count === 1) {
    eyebrow = 'First movie added'
    text = `${movie.title} starts your list. Add another and SceneIt will ask you to compare them.`
  } else if (inCategory === 1 && oldRank === null) {
    eyebrow = label
    text = `${movie.title} is your first “${label}” movie, so there was nothing to compare it with.`
  } else if (tied) {
    eyebrow = 'Tied'
    text = `${movie.title} shares #${rank} with ${tiedWith.map((m) => m.title).join(', ')}.`
  } else if (oldRank !== null) {
    eyebrow = 'Reranked'
    text = oldRank === rank ? `${movie.title} stays at #${rank}.` : `${movie.title} moved from #${oldRank} to #${rank}.`
  }

  return (
    <div className="placed">
      <p className="placed__eyebrow">{eyebrow}</p>
      <h2 className="placed__rank" id={titleId}>
        #{rank}
        <span> of {count}</span>
      </h2>
      <p className="placed__text">{text}</p>
      {scores ? (
        <p className="placed__score">
          Score <strong>{scores.get(movie.id).toFixed(1)}</strong>
        </p>
      ) : (
        <p className="placed__unlock">
          Rank {toUnlock} more {toUnlock === 1 ? 'movie' : 'movies'} to unlock scores
        </p>
      )}

      <ol className="placed__list">
        {nearby.map((r) => (
          <li key={r.movie.id} className={r.movie.id === movie.id ? 'is-new' : undefined}>
            <span className="placed__num">{r.rank}</span>
            <Poster title={r.movie.title} src={posterUrl(r.movie, 'w154')} size="sm" />
            <span className="placed__name">{r.movie.title}</span>
            {scores && <span className="placed__val">{scores.get(r.movie.id).toFixed(1)}</span>}
          </li>
        ))}
      </ol>

      {saveStatus === 'saving' && (
        <p className="placed__save" role="status">Saving…</p>
      )}
      {saveStatus === 'failed' && (
        <div className="notice notice--error" role="alert">
          <span>Couldn't save your ranking. Check your connection and try again.</span>
          <button type="button" className="btn btn--sm" onClick={onRetry} autoFocus>Try again</button>
        </div>
      )}

      <div className="placed__actions">
        {onRankAnother ? (
          <>
            <button type="button" className="btn btn--light" onClick={onSeeList} disabled={saveStatus !== 'saved'}>
              See my list
            </button>
            <button type="button" className="btn" onClick={onRankAnother} disabled={saveStatus !== 'saved'} autoFocus>
              Rank another
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={onSeeList} disabled={saveStatus !== 'saved'} autoFocus>
            Done
          </button>
        )}
      </div>
    </div>
  )
}
