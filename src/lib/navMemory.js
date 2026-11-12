// Remembers where you were on each page, so Back (the browser's, or an
// in-app back button) returns to the same scroll position, search text and
// loaded list, and opening a page by clicking a link still starts at the top.
//
// The router is the URL hash, so every page you visit is a browser history
// entry. Each entry gets a key stored in history.state (and a depth number,
// to know if there is anywhere in the app to go back to). Per key we keep:
//   * the scroll position, recorded as you scroll
//   * "slots": state a page asks us to hold for it (see useNavMemory)
//
// On a new entry (a link click) the page starts at the top and nothing is
// recalled. On an entry we've seen before (back or forward) the scroll
// position is restored once the page is tall enough to scroll that far, which
// matters because lists load asynchronously.
//
// All of it lives in memory for this page load. A full reload forgets it and
// opens at the top, which is the same as what the browser does without us.

import { useState } from 'react'

const KEY = 'sceneitKey'
const DEPTH = 'sceneitDepth'
// Stop waiting for a page to grow tall enough after this long.
const RESTORE_TIMEOUT_MS = 3000

let current = { key: null, depth: 0 }
const scrolls = new Map() // entry key -> scrollY
const slots = new Map() // `${entry key}|${slot}` -> value
// While a restore is running the page is still short and the browser clamps
// the scroll position, which must not overwrite the one we're restoring.
let restoring = false
let stopRestoring = null

function newKey() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// Works out which history entry we're on. Returns 'new' for an entry we
// haven't tagged yet (a link click, or the first page of the visit) and
// 'seen' for one we have (back, forward, or a reload).
function syncEntry() {
  const state = window.history.state
  if (state && typeof state[KEY] === 'string') {
    current = { key: state[KEY], depth: Number.isInteger(state[DEPTH]) ? state[DEPTH] : 0 }
    return 'seen'
  }
  const depth = current.key === null ? 0 : current.depth + 1
  const key = newKey()
  try {
    window.history.replaceState({ ...(state && typeof state === 'object' ? state : {}), [KEY]: key, [DEPTH]: depth }, '')
  } catch {
    // replaceState can be blocked (sandboxed frames): then nothing is restored.
  }
  current = { key, depth }
  return 'new'
}

function cancelRestore() {
  stopRestoring?.()
}

// Scrolls to y as soon as the page is tall enough, or as far as it gets after
// a few seconds. If you start scrolling yourself in the meantime, it gives up.
function restoreScroll(y) {
  cancelRestore()
  if (y <= 0) {
    window.scrollTo({ top: 0 })
    return
  }
  const stopEvents = ['wheel', 'touchstart', 'keydown', 'mousedown']
  const started = performance.now()
  let timer = null
  let cancelled = false

  function finish() {
    cancelled = true
    restoring = false
    stopRestoring = null
    clearTimeout(timer)
    stopEvents.forEach((name) => window.removeEventListener(name, finish))
  }
  stopRestoring = finish
  restoring = true
  stopEvents.forEach((name) => window.addEventListener(name, finish, { passive: true }))

  function step() {
    if (cancelled) return
    const reachable = document.documentElement.scrollHeight - window.innerHeight
    if (reachable >= y || performance.now() - started > RESTORE_TIMEOUT_MS) {
      window.scrollTo({ top: Math.min(y, Math.max(0, reachable)) })
      finish()
      return
    }
    timer = setTimeout(step, 50)
  }
  step()
}

// Call once when the app starts. Takes over scroll restoration from the
// browser (which restores before our lists have loaded), tags the first
// history entry and records scroll positions. Returns a cleanup function.
export function startNavMemory() {
  try {
    window.history.scrollRestoration = 'manual'
  } catch {
    // not supported: the browser keeps restoring on its own, which is okay
  }
  syncEntry()
  const onScroll = () => {
    if (!restoring && current.key) scrolls.set(current.key, window.scrollY)
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  return () => {
    window.removeEventListener('scroll', onScroll)
    cancelRestore()
  }
}

// Call from the hashchange handler, before rendering the new page. A new page
// starts at the top; going back or forward restores where you were.
export function onNavigate() {
  const kind = syncEntry()
  if (kind === 'new') {
    cancelRestore()
    window.scrollTo({ top: 0 })
  } else {
    restoreScroll(scrolls.get(current.key) ?? 0)
  }
}

// Is there an earlier page of this app to go back to? False when the app was
// opened straight on this page (a shared link, a new tab).
export function canGoBack() {
  return current.depth > 0
}

// The in-app back button: the previous page exactly as you left it, or, if
// there isn't one, `fallbackHash` (for example the author's profile).
export function goBack(fallbackHash) {
  if (canGoBack()) window.history.back()
  else window.location.hash = fallbackHash
}

// ------------------------------------------------------------------ slots

// The key of the history entry we're on now. A page that shows on the very
// first render (before App has started this module) asks too, so the first
// entry is tagged on demand rather than answering null, which would make the
// page forget everything.
export function currentEntryKey() {
  if (current.key === null) syncEntry()
  return current.key
}

// Holds `value` for a page, under the entry it was opened on. Pass the key
// you captured when the page opened: by the time a late update arrives, the
// current entry may already be a different page.
export function remember(entryKey, slot, value) {
  if (entryKey) slots.set(`${entryKey}|${slot}`, value)
}

export function recall(entryKey, slot) {
  return entryKey ? slots.get(`${entryKey}|${slot}`) : undefined
}

// For a component that wants its state back after Back:
//
//   const { recalled, save } = useNavMemory('recent:' + userId)
//   const [limit, setLimit] = useState(recalled?.limit ?? 20)
//   useEffect(() => save({ limit }), [save, limit])
//
// `recalled` is whatever the same slot saved on this history entry the last
// time (undefined on a fresh visit, so a link click starts clean). It's read
// once, when the component first renders.
export function useNavMemory(slot) {
  const [memory] = useState(() => {
    const key = currentEntryKey()
    return { key, recalled: recall(key, slot), save: (value) => remember(key, slot, value) }
  })
  return { recalled: memory.recalled, save: memory.save }
}
