import { useEffect, useId } from 'react'
import Icon from './Icon.jsx'
import Sparkles from './Sparkles.jsx'
import { RECS_UNLOCK } from '../features/recommendations/recommend.js'

// Shown once, right after the user ranks their 15th movie. In usability
// testing people didn't know recommendations existed or how to unlock them
// (issue #38), so this tells them and takes them straight there.
export default function RecsUnlockedDialog({ onSeeRecs, onClose }) {
  const titleId = useId()

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay overlay--top overlay--center" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog unlocked" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <Sparkles count={18} seed={15} />
        <span className="unlocked__icon" aria-hidden="true">
          <Icon name="sparkle" size={34} />
        </span>
        <h2 id={titleId} className="unlocked__title">Recommendations unlocked!</h2>
        <p className="unlocked__text">
          You've ranked {RECS_UNLOCK} movies, so SceneIt now knows enough about your taste to suggest
          what to watch next. Find them any time under <strong>For You</strong> in the top bar.
        </p>
        <div className="unlocked__actions">
          <button type="button" className="btn btn--light" onClick={onClose}>Later</button>
          <button type="button" className="btn btn--accent" onClick={onSeeRecs} autoFocus>
            <Icon name="sparkle" size={18} />
            See my picks
          </button>
        </div>
      </div>
    </div>
  )
}
