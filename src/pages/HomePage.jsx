import { useEffect, useMemo, useState } from 'react'
import MovieCard from '../components/MovieCard.jsx'
import MovieRow from '../components/MovieRow.jsx'
import { buildRecommendations, RECS_UNLOCK } from '../features/recommendations/recommend.js'
import { loadFriendsActivity, loadTrending } from '../lib/homeData.js'
import { fetchLeaderboard } from '../lib/leaderboard.js'
import Icon from '../components/Icon.jsx'
import { getCatalog } from '../lib/localStore.js'
import { useFriendGroups, useFriends } from '../lib/useFriends.js'
import { useMyTiers } from '../lib/useMyList.js'

// Homepage: a one-line welcome with the head-to-head button, then
// Netflix-style rows starting at Trending. Public rows (Trending, Top Ranked,
// Most Watched) show for everyone; personalized rows (recommendations,
// Friends Are Watching) only once the user is logged in and only from
// their real data.
export default function HomePage({ account, onOpen, onRank, onNavigate }) {
  const signedIn = account.status === 'ready'
  const tiers = useMyTiers()
  const inList = useMemo(() => new Set(tiers.flat().map((m) => m.id)), [tiers])

  return (
    <div className="home">
      <section className="welcome" aria-label="Welcome to SceneIt">
        <div>
          <h1 className="welcome__title">Welcome to <em>SceneIt</em></h1>
          <p className="welcome__text">Rank the movies you've seen head-to-head, and see what your friends think.</p>
        </div>
        <button type="button" className="btn btn--accent" onClick={onRank}>
          <Icon name="play" size={18} />
          Play Head-to-Head
        </button>
      </section>
      <div className="home__rows">
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
        {signedIn && <RecommendationRows tiers={tiers} onOpen={onOpen} onRank={onRank} />}
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
function RecommendationRows({ tiers, onOpen, onRank }) {
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
              <span>SceneIt learns from what you put at the top of your list and steers away from the bottom.</span>
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
