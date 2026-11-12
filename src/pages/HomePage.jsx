import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import MovieCard from '../components/MovieCard.jsx'
import MovieRow from '../components/MovieRow.jsx'
import { buildRecommendations, RECS_UNLOCK } from '../features/recommendations/recommend.js'
import { loadFriendsActivity, loadTrending } from '../lib/homeData.js'
import { fetchLeaderboard } from '../lib/leaderboard.js'
import { getCatalog, getMovie, imageUrl } from '../lib/localStore.js'
import { useFriendGroups, useFriends } from '../lib/useFriends.js'
import { useMyTiers } from '../lib/useMyList.js'

// Backdrops for the hero, from the catalog (so they're real TMDb images the
// app already shows elsewhere). Rotates slowly; the dots pick one.
const HERO_IDS = ['the-dark-knight-2008', 'dune-part-two-2024', 'interstellar-2014']
const HERO_INTERVAL = 8000

// Homepage: hero + Netflix-style rows. Public rows (Trending, Top Ranked,
// Most Watched) show for everyone; personalized rows (recommendations,
// Friends Are Watching) only once the user is logged in and only from
// their real data.
export default function HomePage({ account, onOpen, onRank, onNavigate }) {
  const signedIn = account.status === 'ready'
  const tiers = useMyTiers()
  const inList = useMemo(() => new Set(tiers.flat().map((m) => m.id)), [tiers])

  return (
    <div className="home">
      <Hero onRank={onRank} />
      <div className="home__rows">
        {/* Picks go first so people actually find them (issue #38). */}
        {signedIn && <RecommendationRows tiers={tiers} onOpen={onOpen} onRank={onRank} onNavigate={onNavigate} />}
        <TrendingRow onOpen={onOpen} inList={inList} />
        <CommunityRow
          key="highest"
          category="highest"
          title="Top Ranked by the Community"
          icon="trophy"
          onOpen={onOpen}
          inList={inList}
          tiers={tiers}
          required
        />
        {signedIn && <FriendsRow onOpen={onOpen} onNavigate={onNavigate} inList={inList} tiers={tiers} />}
        <CommunityRow
          key="watched"
          category="watched"
          title="Most Watched This Month"
          icon="film"
          onOpen={onOpen}
          inList={inList}
          tiers={tiers}
        />
      </div>
    </div>
  )
}

function Hero({ onRank }) {
  const slides = useMemo(() => HERO_IDS.map(getMovie).filter(Boolean), [])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (slides.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    const timer = setInterval(() => setIndex((i) => (i + 1) % slides.length), HERO_INTERVAL)
    return () => clearInterval(timer)
  }, [slides.length])

  return (
    <section className="hero" aria-label="Welcome to SceneIt">
      <div className="hero__art" aria-hidden="true">
        {slides.map((movie, i) => (
          <img
            key={movie.id}
            className={`hero__img${i === index ? ' is-on' : ''}`}
            src={imageUrl(movie.backdrop_path, 'w1280')}
            alt=""
            loading={i === 0 ? 'eager' : 'lazy'}
            decoding="async"
          />
        ))}
        <span className="hero__fade" />
      </div>

      <div className="hero__content">
        <p className="hero__eyebrow">Rank · Review · Watch Together</p>
        <h1 className="hero__title">
          Welcome to <em>SceneIt</em>
        </h1>
        <p className="hero__text">
          A social movie platform to watch, review,
          <br />
          and rank your favorite movies.
        </p>
        <div className="hero__actions">
          <button type="button" className="btn btn--accent" onClick={onRank}>
            <Icon name="play" size={18} />
            Play Head-to-Head
          </button>
        </div>
      </div>

      {slides.length > 1 && (
        <div className="hero__dots" role="tablist" aria-label="Hero image">
          {slides.map((movie, i) => (
            <button
              key={movie.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={movie.title}
              className={`hero__dot${i === index ? ' is-on' : ''}`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function TrendingRow({ onOpen, inList }) {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(null) // { attempt, movies, live }
  const result = loaded?.attempt === attempt ? loaded : null

  useEffect(() => {
    let current = true
    loadTrending().then((r) => current && setLoaded({ attempt, ...r }))
    return () => {
      current = false
    }
  }, [attempt])

  return (
    <MovieRow
      title="Trending Now"
      status={result ? undefined : 'loading'}
      onRetry={() => setAttempt((n) => n + 1)}
      meta={result && !result.live ? <span className="row-note">Popular on SceneIt</span> : null}
    >
      {result?.movies.map((movie) => (
        <MovieCard key={movie.id} movie={movie} onOpen={onOpen} ranked={inList.has(movie.id)} />
      ))}
    </MovieRow>
  )
}

// Rows from the public leaderboard. `required` rows stay visible when empty
// (with a message); others disappear so the page doesn't show blank space.
function CommunityRow({ category, title, icon, onOpen, inList, tiers, required = false }) {
  const [result, setResult] = useState(null) // { rows, error }
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    fetchLeaderboard('monthly', category, 12).then(
      (rows) => current && setResult({ rows, error: null }),
      (error) => current && setResult({ rows: [], error: error.message }),
    )
    return () => {
      current = false
    }
  }, [category, attempt, tiers])

  if (result && !result.error && result.rows.length === 0 && !required) return null

  return (
    <MovieRow
      title={title}
      icon={icon}
      status={!result ? 'loading' : result.error ? 'error' : undefined}
      error={result?.error}
      onRetry={() => { setResult(null); setAttempt((n) => n + 1) }}
      empty={result && result.rows.length === 0 ? 'Nobody has ranked anything this month yet. Be the first.' : null}
    >
      {result?.rows.map((movie) => (
        <MovieCard
          key={movie.id}
          movie={movie}
          rank={movie.rank}
          caption={category === 'watched' ? `${movie.rankers.toLocaleString()} ${movie.rankers === 1 ? 'ranker' : 'rankers'}` : `${movie.score.toFixed(1)} community score`}
          onOpen={onOpen}
          ranked={inList.has(movie.id)}
        />
      ))}
    </MovieRow>
  )
}

// "Because you ranked X highly" from the existing recommendation engine.
// Unlocks at RECS_UNLOCK ranked movies; until then the row shows progress
// instead of guessing.
function RecommendationRows({ tiers, onOpen, onRank, onNavigate }) {
  const recs = useMemo(() => buildRecommendations(tiers, getCatalog(), { perRow: 12, becauseRows: 3 }), [tiers])
  const count = tiers.reduce((n, tier) => n + tier.length, 0)

  if (recs.locked) {
    return (
      <MovieRow
        title="Picked for You"
        icon="sparkle"
        empty={
          <div className="row-unlock">
            <div>
              <strong>Rank {recs.remaining} more {recs.remaining === 1 ? 'movie' : 'movies'} to unlock recommendations</strong>
              <span>SceneIt learns from what you put at the top of your list and steers away from the bottom. Once unlocked, find your picks here and under For You in the top bar.</span>
              <span className="unlock__bar" role="progressbar" aria-valuemin={0} aria-valuemax={RECS_UNLOCK} aria-valuenow={count} aria-label="Movies ranked toward recommendations">
                <span style={{ width: `${(count / RECS_UNLOCK) * 100}%` }} />
              </span>
            </div>
            <button type="button" className="btn btn--accent btn--sm" onClick={onRank}>Rank a movie</button>
          </div>
        }
      />
    )
  }

  // One "because" row with enough in it to scroll, then the top picks.
  const because = recs.rows.find((row) => row.because && row.items.length >= 4)
  const top = recs.rows.find((row) => row.id === 'top')
  const rows = [because, top].filter(Boolean)
  if (!rows.length) return null

  return rows.map((row) => (
    <MovieRow
      key={row.id}
      title={row.because ? `Because You Ranked ${row.because.title} Highly` : 'Top Picks for You'}
      icon="clapper"
      seeAll="See all picks"
      onSeeAll={() => onNavigate('for-you')}
    >
      {row.items.map(({ movie }) => (
        <MovieCard key={movie.id} movie={movie} onOpen={onOpen} />
      ))}
    </MovieRow>
  ))
}

// What the user's friends have been ranking lately. With no friends yet, the
// row invites them to add some instead of showing made-up activity.
function FriendsRow({ onOpen, onNavigate, inList, tiers }) {
  const { status } = useFriends()
  const { friends } = useFriendGroups()
  const [result, setResult] = useState(null) // { key, items, error }
  const [attempt, setAttempt] = useState(0)
  const key = friends.map((f) => f.id).join(',')

  useEffect(() => {
    if (status !== 'ready') return undefined
    let current = true
    loadFriendsActivity(friends).then(
      (items) => current && setResult({ key, items, error: null }),
      (error) => current && setResult({ key, items: [], error: error.message }),
    )
    return () => {
      current = false
    }
    // friends is derived from key
  }, [status, key, attempt, tiers]) // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'error') return null

  const loaded = result?.key === key ? result : null
  const watching = loaded ? new Map(loaded.items.map((i) => [i.friend.id, i.friend])) : new Map()
  const active = [...watching.values()]

  return (
    <MovieRow
      title="Friends Are Watching"
      icon="people"
      status={status !== 'ready' || !loaded ? 'loading' : loaded.error ? 'error' : undefined}
      error={loaded?.error}
      onRetry={() => setAttempt((n) => n + 1)}
      meta={
        active.length > 0 && (
          <span className="row-friends">
            <span className="row-avatars" aria-hidden="true">
              {active.slice(0, 3).map((f) => (
                <span className="row-avatar" key={f.id}>{f.username.charAt(0).toUpperCase()}</span>
              ))}
            </span>
            <span className="row-note">
              {active.length <= 3
                ? `${active.map((f) => f.username).join(', ')} ${active.length === 1 ? 'is' : 'are'} ranking`
                : `and ${active.length - 3} others are ranking`}
            </span>
          </span>
        )
      }
      empty={
        loaded && loaded.items.length === 0 ? (
          friends.length === 0 ? (
            <div className="row-unlock">
              <div>
                <strong>Add friends to see what they're watching</strong>
                <span>Find people by username and compare rankings once you're connected.</span>
              </div>
              <button type="button" className="btn btn--accent btn--sm" onClick={() => onNavigate('friends')}>Find friends</button>
            </div>
          ) : (
            "Your friends haven't ranked anything yet."
          )
        ) : null
      }
    >
      {loaded?.items.map(({ movie, friend }) => (
        <MovieCard key={movie.id} movie={movie} onOpen={onOpen} caption={`${friend.username} ranked it`} ranked={inList.has(movie.id)} />
      ))}
    </MovieRow>
  )
}
