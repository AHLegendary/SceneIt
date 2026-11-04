import { useCallback, useEffect, useState } from 'react'
import './App.css'
import MovieDetails from './components/MovieDetails.jsx'
import SearchDialog from './components/SearchDialog.jsx'
import CompareView from './features/ranking/CompareView.jsx'
import BlendDetailPage from './features/blends/BlendDetailPage.jsx'
import BlendsPage from './features/blends/BlendsPage.jsx'
import AccountBadge from './components/AccountBadge.jsx'
import Sidebar from './components/Sidebar.jsx'
import { PageStatus, SignInPrompt } from './components/SignInPrompt.jsx'
import { getMovie } from './lib/localStore.js'
import { PUBLIC_PAGES } from './lib/pages.js'
import { parseHash } from './lib/route.js'
import { loadMyList } from './lib/supabaseStore.js'
import { useAccount } from './lib/useMyList.js'
import ForYouPage from './pages/ForYouPage.jsx'
import FriendsPage from './pages/FriendsPage.jsx'
import LeaderboardPage from './pages/LeaderboardPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import MyListPage from './pages/MyListPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import UserListPage from './pages/UserListPage.jsx'
import UserProfilePage from './pages/UserProfilePage.jsx'

function App() {
  const account = useAccount()
  const signedIn = account.status === 'ready'
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  const page = route.page
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
    const onHash = () => setRoute(parseHash(window.location.hash))
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
      <Sidebar current={page === 'blend' ? 'blends' : page} onNavigate={navigate} signedIn={signedIn} username={account.username} />
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
        ) : page === 'profile' ? (
          <ProfilePage account={account} onOpen={openDetails} />
        ) : page === 'user' ? (
          <UserProfilePage username={route.username} account={account} onOpen={openDetails} />
        ) : page === 'user-list' ? (
          <UserListPage username={route.username} account={account} onOpen={openDetails} />
        ) : page === 'my-list' ? (
          <MyListPage onAdd={openSearch} onRerank={startRerank} onOpen={openDetails} highlightId={justRanked} />
        ) : page === 'for-you' ? (
          <ForYouPage onOpen={openDetails} onAdd={openSearch} />
        ) : page === 'friends' ? (
          <FriendsPage />
        ) : page === 'blends' ? (
          <BlendsPage />
        ) : page === 'blend' ? (
          <BlendDetailPage key={route.blendId} blendId={route.blendId} onOpen={openDetails} />
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
