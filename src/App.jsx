import { useCallback, useEffect, useState } from 'react'
import './App.css'
import MovieDetails from './components/MovieDetails.jsx'
import SearchDialog from './components/SearchDialog.jsx'
import CompareView from './features/ranking/CompareView.jsx'
import AccountBadge from './components/AccountBadge.jsx'
import LoginPage from './components/auth/LoginPage.jsx'
import Sidebar from './components/Sidebar.jsx'
import { PageStatus, SignInPrompt } from './components/SignInPrompt.jsx'
import { getMovie } from './lib/localStore.js'
import { PAGES, PUBLIC_PAGES } from './lib/pages.js'
import { loadMyList } from './lib/supabaseStore.js'
import { useAccount } from './lib/useMyList.js'
import ForYouPage from './pages/ForYouPage.jsx'
import LeaderboardPage from './pages/LeaderboardPage.jsx'
import MyListPage from './pages/MyListPage.jsx'

const DEFAULT_PAGE = 'leaderboard'

// Pages live in the URL hash (#/my-list) so refresh and back/forward work
// without a router or any server config on Vercel.
function pageFromHash() {
  const id = window.location.hash.replace(/^#\/?/, '')
  return PAGES.some((p) => p.id === id) ? id : DEFAULT_PAGE
}

function App() {
  const account = useAccount()
  const signedIn = account.status === 'ready'
  const [page, setPage] = useState(pageFromHash)
  const [searchOpen, setSearchOpen] = useState(false)
  const openSearch = useCallback(() => setSearchOpen(true), [])
  const closeSearch = useCallback(() => setSearchOpen(false), [])
  // Movie being placed head-to-head: { movie, rerank }
  const [ranking, setRanking] = useState(null)
  const [justRanked, setJustRanked] = useState(null)
  const [detailsId, setDetailsId] = useState(null)
  const openDetails = useCallback((id) => setDetailsId(id), [])
  const closeDetails = useCallback(() => setDetailsId(null), [])
  const detailsMovie = detailsId ? getMovie(detailsId) : null

  // Picking a movie in search starts the head-to-head flow for it.
  // Ranking needs an account, so logged-out users go to My List, which
  // shows the sign-in prompt.
  function startRanking(movie) {
    setSearchOpen(false)
    setDetailsId(null)
    if (!signedIn) return navigate('my-list')
    setRanking({ movie, rerank: false })
  }

  function startRerank(movie) {
    setDetailsId(null)
    if (!signedIn) return navigate('my-list')
    setRanking({ movie, rerank: true })
  }

  function finishRanking({ next }) {
    setJustRanked(ranking.movie.id)
    setRanking(null)
    if (next === 'search') setSearchOpen(true)
    else navigate('my-list')
  }

  useEffect(() => {
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Once logged in there's nothing to do on the login page.
  useEffect(() => {
    if (signedIn && page === 'login') navigate('my-list')
  }, [signedIn, page])

  function navigate(id) {
    window.location.hash = `/${id}`
  }

  return (
    <div className="app">
      <Sidebar current={page} onNavigate={navigate} signedIn={signedIn} />
      <main className="main">
        <div className="topbar">
          <AccountBadge account={account} />
        </div>
        {!PUBLIC_PAGES.has(page) && account.status === 'loading' ? (
          <PageStatus>Loading your list…</PageStatus>
        ) : !PUBLIC_PAGES.has(page) && account.status === 'signed-out' ? (
          <SignInPrompt />
        ) : !PUBLIC_PAGES.has(page) && account.status === 'error' ? (
          <PageStatus error onRetry={loadMyList}>{account.error}</PageStatus>
        ) : page === 'login' ? (
          <LoginPage onSuccess={() => navigate('my-list')} />
        ) : page === 'my-list' ? (
          <MyListPage onAdd={openSearch} onRerank={startRerank} onOpen={openDetails} highlightId={justRanked} />
        ) : page === 'for-you' ? (
          <ForYouPage onOpen={openDetails} onAdd={openSearch} />
        ) : (
          <LeaderboardPage onOpen={openDetails} />
        )}
        <footer className="credit">
          Movie data from <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">TMDB</a>.
          This product uses the TMDB API but is not endorsed or certified by TMDB.
          IMDb and Rotten Tomatoes scores via <a href="https://www.omdbapi.com" target="_blank" rel="noreferrer">OMDb</a>.
        </footer>
      </main>
      {searchOpen && <SearchDialog onClose={closeSearch} onPick={startRanking} onOpen={openDetails} />}
      {detailsMovie && (
        <MovieDetails movie={detailsMovie} onClose={closeDetails} onRank={startRanking} onRerank={startRerank} />
      )}
      {ranking && (
        <CompareView
          key={`${ranking.movie.id}-${ranking.rerank}`}
          movie={ranking.movie}
          rerank={ranking.rerank}
          onClose={() => setRanking(null)}
          onRankAnother={ranking.rerank ? undefined : () => finishRanking({ next: 'search' })}
          onSeeList={() => finishRanking({ next: 'list' })}
        />
      )}
    </div>
  )
}

export default App
