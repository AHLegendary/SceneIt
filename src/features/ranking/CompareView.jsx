import { useEffect, useId, useRef, useState } from 'react'
import { m } from 'motion/react'
import Icon from '../../components/Icon.jsx'
import Poster from '../../components/Poster.jsx'
import Sparkles from '../../components/Sparkles.jsx'
import BlueFire from './BlueFire.jsx'
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

// How long a pick's animation runs before the answer is applied.
const PICK_MS = 900

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
  const [saveError, setSaveError] = useState(null)
  const titleId = useId()

  const state = history[history.length - 1] ?? null
  const done = state !== null && isDone(state)
  const opponent = state && !done ? nextOpponent(state) : null

  function pickCategory(id) {
    setCategory(id)
    setHistory([startInsertion(tiersInCategory(setup.others, id), movie)])
  }

  // A pick plays a short animation first: the winner grows and shifts toward
  // the middle, the loser burns up in blue fire, then the answer is applied
  // and the next opponent slides in.
  const [anim, setAnim] = useState(null) // { choice, opponentId }
  const reduced = useRef(false)
  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  function choose(choice) {
    if (!state || done || anim) return
    const apply = () => {
      setAnim(null)
      setHistory((h) => [...h, answer(h[h.length - 1], choice)])
    }
    if (reduced.current) return apply()
    setAnim({ choice, opponentId: opponent.id })
    setTimeout(apply, PICK_MS)
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
    } catch (e) {
      setSaveError(e.message)
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
      else if (e.key === 'ArrowDown' || e.key === '=' || e.key === ' ' || e.code === 'Space') {
        e.preventDefault() // space would also "click" whichever poster has focus
        choose(TIE)
      }
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
        saveError={saveError}
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
          <span className="compare__bar" aria-hidden="true">
            <m.span
              initial={false}
              animate={{ width: `${Math.min(100, ((state.comparisons + 1) / Math.max(1, maxComparisons(state.tiers.length))) * 100)}%` }}
              transition={{ type: 'spring', stiffness: 160, damping: 26 }}
            />
          </span>
        </header>

        <div className={`duel${anim ? ' is-animating' : ''}${anim?.choice === TIE ? ' is-tie' : ''}`}>
          <PickCard
            movie={movie}
            badge={rerank ? 'Reranking' : 'Just watched'}
            onPick={() => choose(NEW)}
            hint="←"
            state={anim ? (anim.choice === NEW ? 'win win-left' : anim.choice === TIE ? 'tie' : 'burn') : null}
          />
          <span className="duel__vs" aria-hidden="true">vs</span>
          <PickCard
            key={opponent.id}
            movie={opponent}
            onPick={() => choose(OPPONENT)}
            hint="→"
            state={anim ? (anim.choice === OPPONENT ? 'win win-right' : anim.choice === TIE ? 'tie' : 'burn') : 'enter'}
          />
        </div>

        <footer className="compare__foot">
          <button type="button" className="ghost" onClick={undo}>
            <Icon name="undo" size={16} />
            {history.length > 1 ? 'Undo' : 'Back'}
          </button>
          <button type="button" className="ghost ghost--tie" onClick={() => choose(TIE)}>
            <Icon name="equal" size={16} />
            It's a tie
            <kbd className="pick__key" aria-hidden="true">↓</kbd>
          </button>
          <span className="compare__keys">Click a poster, or press ← / → (Space for a tie)</span>
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

function PickCard({ movie, badge, onPick, hint, state }) {
  return (
    <button
      type="button"
      className={`pick${state ? ` ${state.split(' ').map((k) => `pick--${k}`).join(' ')}` : ''}`}
      onClick={onPick}
      aria-label={`I liked ${movie.title} more`}
    >
      {state === 'burn' && <BlueFire duration={PICK_MS} />}
      {badge && <span className="pick__badge">{badge}</span>}
      <span className="pick__body">
        <Poster title={movie.title} src={posterUrl(movie, 'w342')} size="lg" />
        <span className="pick__title">{movie.title}</span>
        <span className="pick__meta">
          {movie.year}
          <kbd className="pick__key" aria-hidden="true">{hint}</kbd>
        </span>
      </span>
    </button>
  )
}

// Result screen: where the movie landed, its score once unlocked, and the
// movies around it for context.
function Placed({ titleId, movie, category, tiers, tied, oldRank, saveStatus, saveError, onRetry, onRankAnother, onSeeList }) {
  const ranks = tierRanks(tiers)
  const rows = tiers.flatMap((tier, i) => tier.map((m) => ({ movie: m, rank: ranks[i], tier: i })))
  const at = rows.findIndex((r) => r.movie.id === movie.id)
  const { rank, tier } = rows[at]
  const count = rows.length
  const newRow = useRef(null)
  // Scroll the list so the new movie sits in the middle, once it exists.
  useEffect(() => {
    newRow.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])
  // The rank counts up from the bottom to its final spot.
  const [shown, setShown] = useState(count === 1 ? 1 : rows.length)
  useEffect(() => {
    if (shown <= rank) return undefined
    const step = Math.max(1, Math.round((rows.length - rank) / 18))
    const t = setTimeout(() => setShown((v) => Math.max(rank, v - step)), 40)
    return () => clearTimeout(t)
  }, [shown, rank, rows.length])
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
    <m.div
      className="placed"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <Sparkles count={34} seed={3} />
      <p className="placed__eyebrow">{eyebrow}</p>
      <span className="placed__burst" aria-hidden="true">
        {Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--i': i }} />)}
      </span>
      <h2 className="placed__rank" id={titleId}>
        #{shown}
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

      <ol className="placed__list placed__list--scroll" aria-label="Your ranked list">
        {rows.map((r) => (
          <li key={r.movie.id} ref={r.movie.id === movie.id ? newRow : undefined} className={r.movie.id === movie.id ? 'is-new' : undefined}>
            <span className="placed__num">{r.rank}</span>
            <Poster title={r.movie.title} src={posterUrl(r.movie, 'w154')} size="sm" />
            <span className="placed__name">{r.movie.title}</span>
            {scores && <span className="placed__val">{scores.get(r.movie.id).toFixed(1)}</span>}
          </li>
        ))}
      </ol>
      <p className="placed__scrollhint">Scroll to see the rest of your list</p>

      {saveStatus === 'saving' && (
        <p className="placed__save" role="status">Saving…</p>
      )}
      {saveStatus === 'failed' && (
        <div className="notice notice--error" role="alert">
          <span>{saveError || "Couldn't save your ranking. Check your connection and try again."}</span>
          {/session has expired/i.test(saveError ?? '') ? (
            <button type="button" className="btn btn--sm" onClick={() => { window.location.hash = '/login' }} autoFocus>Log in</button>
          ) : (
            <button type="button" className="btn btn--sm" onClick={onRetry} autoFocus>Try again</button>
          )}
        </div>
      )}

      <div className="placed__actions">
        {onRankAnother ? (
          <>
            <button type="button" className="btn btn--light" onClick={onSeeList} disabled={saveStatus !== 'saved'}>
              See my list
            </button>
            <button type="button" className="btn btn--accent" onClick={onRankAnother} disabled={saveStatus !== 'saved'} autoFocus>
              <Icon name="swords" size={16} />
              Rank another
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--accent" onClick={onSeeList} disabled={saveStatus !== 'saved'} autoFocus>
            Done
          </button>
        )}
      </div>

    </m.div>
  )
}
