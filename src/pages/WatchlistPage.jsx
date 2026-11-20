import { useMemo } from 'react'
import Watchlist from '../components/Watchlist.jsx'
import { useMyTiers } from '../lib/useMyList.js'
import { retryMyWatchlist, useMyWatchlist } from '../lib/useWatchlist.js'
import { removeFromWatchlist } from '../lib/watchlist.js'
import './ProfilePage.css'

// Your whole watchlist, at #/watchlist. The profile shows the first few.
// `onRank` starts ranking a movie you've watched.
export default function WatchlistPage({ onOpen, onRank }) {
  const tiers = useMyTiers()
  const { status, movies } = useMyWatchlist()
  const rankedIds = useMemo(() => new Set(tiers.flat().map((m) => m.id)), [tiers])

  return (
    <section className="page">
      <header className="page__head">
        <div>
          <a className="profile__link uprofile__back" href="#/profile">← Back to your profile</a>
          <h1 className="page__title">Your watchlist</h1>
        </div>
      </header>
      <Watchlist status={status} movies={movies} rankedIds={rankedIds} onRetry={retryMyWatchlist} onOpen={onOpen} onRemove={removeFromWatchlist} onRank={onRank} heading={false} />
    </section>
  )
}
