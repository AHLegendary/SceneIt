import { useEffect, useMemo, useState } from 'react'
import Poster from '../components/Poster.jsx'
import {
  buildRecommendations,
  friendSignals,
  mergeTmdbRecs,
  pickSeeds,
  recLabel,
  RECS_UNLOCK,
} from '../features/recommendations/recommend.js'
import { getCatalog, movieFromDb, posterUrl } from '../lib/localStore.js'
import { getRecommendations } from '../lib/movies.js'
import { fetchTiersForUsers } from '../lib/rankingsQueries.js'
import { useFriends } from '../lib/useFriends.js'
import { useMyTiers } from '../lib/useMyList.js'

// Personalized recommendations, unlocked at 15 ranked movies. Cards open the
// movie details panel, where the user can rank them.
//
// Shows catalog-only picks right away, then folds in TMDb's recommendations
// for the user's top and bottom movies and friends' rankings once they
// load. If either fails, the page just goes without it.
export default function ForYouPage({ onOpen, onAdd }) {
  const tiers = useMyTiers()
  const count = tiers.reduce((n, tier) => n + tier.length, 0)
  const unlocked = count >= RECS_UNLOCK

  const seeds = useMemo(() => pickSeeds(tiers), [tiers])
  const seedKey = unlocked ? [...seeds.likes, ...seeds.dislikes].map((m) => m.tmdb_id).sort((a, b) => a - b).join(',') : ''
  const [fetched, setFetched] = useState({ key: '', results: null })

  useEffect(() => {
    if (!seedKey) return undefined
    let cancelled = false
    getRecommendations(seedKey.split(',').map(Number))
      .then((results) => !cancelled && setFetched({ key: seedKey, results }))
      .catch((error) => console.warn('TMDb recommendations unavailable:', error.message))
    return () => {
      cancelled = true
    }
  }, [seedKey])

  // Friends' ranked lists, refetched when the set of friends changes.
  const { list: friendList } = useFriends()
  const friends = useMemo(() => friendList.filter((f) => f.direction === 'friends'), [friendList])
  const friendKey = unlocked ? friends.map((f) => f.id).sort().join(',') : ''
  const [friendTiers, setFriendTiers] = useState({ key: '', byUser: null })

  useEffect(() => {
    if (!friendKey) return undefined
    let cancelled = false
    fetchTiersForUsers(friendKey.split(','))
      .then((byUser) => !cancelled && setFriendTiers({ key: friendKey, byUser }))
      .catch((error) => console.warn("Friends' rankings unavailable:", error.message))
    return () => {
      cancelled = true
    }
  }, [friendKey])

  const recs = useMemo(() => {
    const catalog = getCatalog()
    let candidates = catalog
    let links
    if (fetched.key === seedKey && fetched.results) {
      const seedsByTmdb = new Map([...seeds.likes, ...seeds.dislikes].map((m) => [m.tmdb_id, m]))
      const merged = mergeTmdbRecs(fetched.results, seedsByTmdb, movieFromDb)
      candidates = [...merged.candidates, ...catalog]
      links = merged.links
    }
    let signals
    if (friendKey && friendTiers.key === friendKey && friendTiers.byUser) {
      const withTiers = friends.map((f) => ({ ...f, tiers: friendTiers.byUser.get(f.id) ?? [] }))
      signals = friendSignals(tiers, withTiers)
    }
    return buildRecommendations(tiers, candidates, { links, friends: signals })
  }, [tiers, seeds, seedKey, fetched, friends, friendKey, friendTiers])

  return (
    <section className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">For You</h1>
          <p className="page__sub">Picked from how you've ranked movies so far.</p>
        </div>
      </header>

      {recs.locked ? (
        <div className="empty">
          <div className="empty__stack" aria-hidden="true">
            <span /><span /><span />
          </div>
          <h2 className="empty__title">
            Rank {recs.remaining} more {recs.remaining === 1 ? 'movie' : 'movies'} to unlock recommendations
          </h2>
          <p className="empty__text">
            Once you've ranked {RECS_UNLOCK}, SceneIt suggests movies based on what you put at the top
            of your list, steers away from what you put at the bottom, and mixes in what your friends love.
          </p>
          <div
            className="unlock__bar unlock__bar--wide"
            role="progressbar"
            aria-label="Movies ranked toward recommendations"
            aria-valuemin={0}
            aria-valuemax={RECS_UNLOCK}
            aria-valuenow={count}
          >
            <span style={{ width: `${(count / RECS_UNLOCK) * 100}%` }} />
          </div>
          <p className="empty__note">{count} of {RECS_UNLOCK} ranked</p>
          <button type="button" className="btn" onClick={onAdd}>
            Rank a movie
          </button>
        </div>
      ) : recs.rows.length === 0 ? (
        <div className="empty">
          <h2 className="empty__title">Nothing new to suggest</h2>
          <p className="empty__text">Rank a few more movies and check back for new picks.</p>
        </div>
      ) : (
        recs.rows.map((row) => (
          <section className="recs" key={row.id} aria-label={row.title}>
            <h2 className="recs__title">{row.title}</h2>
            <ul className="recs__grid">
              {row.items.map((item) => (
                <li key={item.movie.id}>
                  <button type="button" className="rec" onClick={() => onOpen(item.movie.id)}>
                    <Poster title={item.movie.title} src={posterUrl(item.movie, 'w342')} size="md" />
                    <span className="rec__title">{item.movie.title}</span>
                    <span className="rec__meta">{recLabel(item, row.id)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  )
}
