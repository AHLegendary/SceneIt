import ReviewsFeed from '../components/ReviewsFeed.jsx'
import Segmented from '../components/Segmented.jsx'
import { communityHref } from '../lib/route.js'
import LeaderboardPage from './LeaderboardPage.jsx'
import './ProfilePage.css' // the review card and list styles live here

const TABS = [
  { id: 'reviews', label: 'Reviews' },
  { id: 'leaderboard', label: 'Leaderboard' },
]

// The Community page: what people are saying (Reviews, the default) and what
// they're ranking (Leaderboard, the original leaderboard page as it was). The
// tab is part of the address (#/community, #/community/leaderboard), so Back
// returns to the tab you were on and the old #/leaderboard link still works.
export default function CommunityPage({ tab, account, onOpen }) {
  return (
    <div className="community">
      <div className="community__tabs">
        <Segmented
          label="Community sections"
          options={TABS}
          value={tab}
          onChange={(id) => {
            window.location.hash = communityHref(id).slice(1)
          }}
        />
      </div>
      {tab === 'leaderboard' ? <LeaderboardPage onOpen={onOpen} /> : <ReviewsFeed account={account} onOpen={onOpen} />}
    </div>
  )
}
