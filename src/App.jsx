import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import MovieDetails from './components/MovieDetails.jsx'
import RecsUnlockedDialog from './components/RecsUnlockedDialog.jsx'
import SearchDialog from './components/SearchDialog.jsx'
import CompareView from './features/ranking/CompareView.jsx'
import BlendDetailPage from './features/blends/BlendDetailPage.jsx'
import { BLEND_MAX_MEMBERS } from './features/blends/blends.js'
import BlendsPage from './features/blends/BlendsPage.jsx'
import { justUnlockedRecs } from './features/recommendations/unlockNotice.js'
import TopNav from './components/TopNav.jsx'
import { PageStatus, SignInPrompt } from './components/SignInPrompt.jsx'
import { getMovie } from './lib/localStore.js'
import { PUBLIC_PAGES } from './lib/pages.js'
import { onNavigate, startNavMemory } from './lib/navMemory.js'
import { rememberReturn, takeReturn } from './lib/returnTo.js'
import { parseHash } from './lib/route.js'
import { loadMyList } from './lib/supabaseStore.js'
import { useAccount } from './lib/useMyList.js'
import CommunityPage from './pages/CommunityPage.jsx'
import ForYouPage from './pages/ForYouPage.jsx'
import FriendsPage from './pages/FriendsPage.jsx'
import HomePage from './pages/HomePage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import MyListPage from './pages/MyListPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import ReviewPage from './pages/ReviewPage.jsx'
import UserListPage from './pages/UserListPage.jsx'
import UserProfilePage from './pages/UserProfilePage.jsx'

// Pages live in the URL hash (#/my-list, #/u/name) so refresh and
// back/forward work without a router or any server config on Vercel.
// Movie Blend stays in the nav when logged out as a teaser, so its sign-in
// screen says what a blend is instead of the generic ranking copy.
const BLEND_SIGN_IN = {
  title: 'Find a movie your whole group will like',
  text:
    `Blend your rankings with up to ${BLEND_MAX_MEMBERS - 1} friends and SceneIt picks movies ` +
    "the group loves that someone hasn't seen yet.",
}

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

  // Watch the ranked count and announce recommendations the moment it
  // reaches the unlock line. The count is forgotten when the user changes,
  // so loading someone's existing list never counts as "just unlocked".
  const rankedCount = account.tiers.reduce((n, tier) => n + tier.length, 0)
  const userId = account.status === 'ready' ? account.user?.id : null
  const lastCount = useRef({ userId: null, count: null })
  const [recsUnlocked, setRecsUnlocked] = useState(false)
  useEffect(() => {
    if (!userId) return
    const prev = lastCount.current.userId === userId ? lastCount.current.count : null
    lastCount.current = { userId, count: rankedCount }
    if (justUnlockedRecs(prev, rankedCount)) setRecsUnlocked(true)
  }, [userId, rankedCount])
  const closeRecsUnlocked = useCallback(() => setRecsUnlocked(false), [])

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

  // Back and forward restore the page as it was (scroll position, loaded
  // lists); a link click opens the new page at the top. See lib/navMemory.js.
  useEffect(() => startNavMemory(), [])
  useEffect(() => {
    const onHash = () => {
      onNavigate()
      setRoute(parseHash(window.location.hash))
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
    // Reopen the remembered dialog once the new page is showing. Don't clear
    // this timer in a cleanup: the navigate() above changes `page`, which
    // re-runs this effect and would cancel the timer before it fires.
    setTimeout(() => {
      if (intent.action === 'rank') setSearch({ mode: 'rank', query: '' })
      else if (intent.action === 'details' && intent.movieId && getMovie(intent.movieId)) setDetailsId(intent.movieId)
    }, 0)
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
          <SignInPrompt {...(page === 'blends' || page === 'blend' ? BLEND_SIGN_IN : {})} onLogin={() => { rememberReturn({ page }); navigate('login') }} onSignUp={() => { rememberReturn({ page }); navigate('signup') }} />
        ) : needsAccount && account.status === 'error' ? (
          <PageStatus error onRetry={loadMyList}>{account.error}</PageStatus>
        ) : loginPage ? (
          <LoginPage key={page} initialMode={page === 'signup' ? 'signup' : 'login'} />
        ) : page === 'profile' ? (
          <ProfilePage account={account} onOpen={openDetails} onNavigate={navigate} />
        ) : page === 'user' ? (
          <UserProfilePage username={route.username} account={account} onOpen={openDetails} />
        ) : page === 'review' ? (
          <ReviewPage key={route.reviewId} reviewId={route.reviewId} account={account} onOpen={openDetails} />
        ) : page === 'user-list' ? (
          <UserListPage username={route.username} account={account} onOpen={openDetails} />
        ) : page === 'my-list' ? (
          <MyListPage onAdd={openRankSearch} onRerank={startRerank} onOpen={openDetails} highlightId={justRanked} />
        ) : page === 'for-you' ? (
          <ForYouPage onOpen={openDetails} onAdd={openRankSearch} />
        ) : page === 'friends' ? (
          <FriendsPage />
        ) : page === 'blends' ? (
          <BlendsPage onRank={openRankSearch} />
        ) : page === 'blend' ? (
          <BlendDetailPage key={route.blendId} blendId={route.blendId} onOpen={openDetails} />
        ) : page === 'community' ? (
          <CommunityPage tab={route.tab} account={account} onOpen={openDetails} />
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
      {/* Waits for the ranking result screen to close so it doesn't cover it. */}
      {recsUnlocked && !ranking && (
        <RecsUnlockedDialog
          onClose={closeRecsUnlocked}
          onSeeRecs={() => {
            setRecsUnlocked(false)
            setSearch(null)
            setDetailsId(null)
            navigate('for-you')
          }}
        />
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
