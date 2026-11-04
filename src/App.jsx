import { useCallback, useEffect, useState } from 'react'
import './App.css'
import MovieDetails from './components/MovieDetails.jsx'
import SearchDialog from './components/SearchDialog.jsx'
import CompareView from './features/ranking/CompareView.jsx'
import BlendDetailPage from './features/blends/BlendDetailPage.jsx'
import BlendsPage from './features/blends/BlendsPage.jsx'
import TopNav from './components/TopNav.jsx'
import { PageStatus, SignInPrompt } from './components/SignInPrompt.jsx'
import { getMovie } from './lib/localStore.js'
import { PUBLIC_PAGES } from './lib/pages.js'
import { rememberReturn, takeReturn } from './lib/returnTo.js'
import { parseHash } from './lib/route.js'
import { loadMyList } from './lib/supabaseStore.js'
import { useAccount } from './lib/useMyList.js'
import ForYouPage from './pages/ForYouPage.jsx'
import FriendsPage from './pages/FriendsPage.jsx'
import HomePage from './pages/HomePage.jsx'
import LeaderboardPage from './pages/LeaderboardPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import MyListPage from './pages/MyListPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import UserListPage from './pages/UserListPage.jsx'
import UserProfilePage from './pages/UserProfilePage.jsx'

// Pages live in the URL hash (#/my-list, #/u/name) so refresh and
// back/forward work without a router or any server config on Vercel.
function navigate(id) {
  window.location.hash = `/${id}`
}

function App() {
  const account = useAccount()
  const signedIn = account.status === 'ready'
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  const page = route.page
  // null | { mode: 'rank', query }
  const [search, setSearch] = useState(null)
  const closeSearch = useCallback(() => setSearch(null), [])
  // Movie being placed head-to-head: { movie, rerank }
  const [ranking, setRanking] = useState(null)
  const [justRanked, setJustRanked] = useState(null)
  const [detailsId, setDetailsId] = useState(null)
  const openDetails = useCallback((id) => setDetailsId(id), [])
  const closeDetails = useCallback(() => setDetailsId(null), [])
  const detailsMovie = detailsId ? getMovie(detailsId) : null

  // Runs `go` now if logged in; otherwise remembers what the user wanted and
  // sends them to log in, so the login page can bring them back to it.
  function requireAccount(intent, go) {
    if (signedIn) return go()
    rememberReturn(intent)
    setSearch(null)
    setDetailsId(null)
    navigate('login')
    return undefined
  }

  const openRankSearch = () => requireAccount({ action: 'rank' }, () => setSearch({ mode: 'rank', query: '' }))

  // Picking a movie in search starts the head-to-head flow for it.
  function startRanking(movie) {
    requireAccount({ action: 'details', movieId: movie.id }, () => {
      setSearch(null)
      setDetailsId(null)
      setRanking({ movie, rerank: false })
    })
  }

  function startRerank(movie) {
    requireAccount({ action: 'details', movieId: movie.id }, () => {
      setDetailsId(null)
      setRanking({ movie, rerank: true })
    })
  }

  function finishRanking({ next }) {
    setJustRanked(ranking.movie.id)
    setRanking(null)
    if (next === 'search') setSearch({ mode: 'rank', query: '' })
    else navigate('my-list')
  }

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash(window.location.hash))
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Once logged in there's nothing to do on the login page: go back to what
  // the user was doing before, or home.
  useEffect(() => {
    if (!signedIn || (page !== 'login' && page !== 'signup')) return
    const intent = takeReturn() ?? {}
    navigate(intent.page ?? 'home')
    // Open the remembered dialog once the new page is showing.
    const timer = setTimeout(() => {
      if (intent.action === 'rank') setSearch({ mode: 'rank', query: '' })
      else if (intent.action === 'details' && intent.movieId && getMovie(intent.movieId)) setDetailsId(intent.movieId)
    }, 0)
    return () => clearTimeout(timer)
  }, [signedIn, page])

  const needsAccount = !PUBLIC_PAGES.has(page)
  const loginPage = page === 'login' || page === 'signup'

  return (
    <div className="app">
      <TopNav
        current={page === 'blend' ? 'blends' : page}
        account={account}
        onNavigate={navigate}
        onOpen={openDetails}
        onRank={openRankSearch}
        onLogin={() => navigate('login')}
        onSignUp={() => navigate('signup')}
      />
      <main className="main">
        {needsAccount && account.status === 'loading' ? (
          <PageStatus>Loading your account…</PageStatus>
        ) : needsAccount && account.status === 'signed-out' ? (
          <SignInPrompt onLogin={() => { rememberReturn({ page }); navigate('login') }} onSignUp={() => { rememberReturn({ page }); navigate('signup') }} />
        ) : needsAccount && account.status === 'error' ? (
          <PageStatus error onRetry={loadMyList}>{account.error}</PageStatus>
        ) : loginPage ? (
          <LoginPage key={page} initialMode={page === 'signup' ? 'signup' : 'login'} />
        ) : page === 'profile' ? (
          <ProfilePage account={account} onOpen={openDetails} onNavigate={navigate} />
        ) : page === 'user' ? (
          <UserProfilePage username={route.username} account={account} onOpen={openDetails} />
        ) : page === 'user-list' ? (
          <UserListPage username={route.username} account={account} onOpen={openDetails} />
        ) : page === 'my-list' ? (
          <MyListPage onAdd={openRankSearch} onRerank={startRerank} onOpen={openDetails} highlightId={justRanked} />
        ) : page === 'for-you' ? (
          <ForYouPage onOpen={openDetails} onAdd={openRankSearch} />
        ) : page === 'friends' ? (
          <FriendsPage />
        ) : page === 'blends' ? (
          <BlendsPage />
        ) : page === 'blend' ? (
          <BlendDetailPage key={route.blendId} blendId={route.blendId} onOpen={openDetails} />
        ) : page === 'leaderboard' ? (
          <LeaderboardPage onOpen={openDetails} />
        ) : (
          <HomePage account={account} onOpen={openDetails} onRank={openRankSearch} onNavigate={navigate} />
        )}
        <footer className="credit">
          Movie data from <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">TMDB</a>.
          This product uses the TMDB API but is not endorsed or certified by TMDB.
          IMDb and Rotten Tomatoes scores via <a href="https://www.omdbapi.com" target="_blank" rel="noreferrer">OMDb</a>.
        </footer>
      </main>
      {search && (
        <SearchDialog
          initialQuery={search.query}
          signedIn={signedIn}
          onClose={closeSearch}
          onPick={startRanking}
          onOpen={openDetails}
        />
      )}
      {detailsMovie && (
        <MovieDetails movie={detailsMovie} signedIn={signedIn} onClose={closeDetails} onRank={startRanking} onRerank={startRerank} />
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
