import { RECS_UNLOCK } from './recommend.js'

// True when the user just went from below the unlock line to at or above it
// while the app was open (i.e. they ranked their 15th movie). `prev` is null
// before the list has loaded, so logging in with 15+ already ranked doesn't
// count as unlocking.
export function justUnlockedRecs(prev, next, unlockAt = RECS_UNLOCK) {
  return prev !== null && prev < unlockAt && next >= unlockAt
}
