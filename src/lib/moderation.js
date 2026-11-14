// Checks user-written text (reviews, review edits, comments) before it's saved.
//
// This is a stand-in, not real moderation: a tiny phrase list plus a spam
// check. It only exists to give people a message right away: the forms call it
// before sending. It is NOT the real check, since anyone can skip the browser.
// The database applies the same rules again (text_is_allowed in
// supabase/migrations/20261118000000_moderation_checks.sql) and rejects bad
// text with 'content_flagged', which reviews.js turns into FLAGGED_MESSAGE.
//
// TODO(moderation-v2): replace the phrase list with a real moderation service
// (for example a hosted moderation API called from api/ so the key stays on
// the server), and decide what happens to text that was saved before the
// check existed.

// CHANGE THESE TOGETHER with text_is_allowed in the migration above.
// tests/unit/moderationSql.test.js fails if the two copies drift apart.
//
// Phrases that are never okay. Matched as whole words/phrases, so ordinary
// words that merely contain letters of these don't get blocked.
export const BLOCKED_PHRASES = ['kill yourself', 'kys']

// One character repeated more than this many times in a row is spam, not a review.
export const MAX_REPEAT = 20

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
