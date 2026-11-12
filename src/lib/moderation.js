// Checks user-written text (reviews, review edits, comments) before it's saved.
//
// This is a stand-in, not real moderation: a tiny phrase list plus a spam
// check, so the rest of the app can call one function today and get a better
// implementation later without touching any caller. It runs in two places:
// the forms call it first so people get a message right away, and reviews.js
// calls it again before every write so nothing skips it.
//
// TODO: replace with a real moderation service (for example a hosted
// moderation API called from api/ so the key stays on the server), and decide
// what happens to text that was saved before the check existed.

// Phrases that are never okay. Matched as whole words/phrases, so ordinary
// words that merely contain letters of these don't get blocked.
const BLOCKED_PHRASES = ['kill yourself', 'kys']

// One character repeated this many times in a row is spam, not a review.
const MAX_REPEAT = 20

export const FLAGGED_MESSAGE =
  "That text can't be posted because it may break our community rules. Edit it and try again."

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const BLOCKED = new RegExp(`(^|[^\\p{L}\\p{N}])(${BLOCKED_PHRASES.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'iu')
const REPEATED = new RegExp(`(\\S)\\1{${MAX_REPEAT},}`, 'u')

// Returns { ok: true } if the text can be posted, or { ok: false, reason }
// with a message to show the user.
export function moderateText(text) {
  const value = String(text ?? '')
  if (BLOCKED.test(value) || REPEATED.test(value)) return { ok: false, reason: FLAGGED_MESSAGE }
  return { ok: true }
}
