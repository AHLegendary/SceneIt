// Runs before every integration test file (see vite.config.js).
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// Searches are debounced and some flows chain a few requests: allow for it.
configure({ asyncUtilTimeout: 3000 })

// The app and the api/ handlers both import createClient from here; hand them
// the fake. harness.js puts the current FakeBackend on globalThis.
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args) => globalThis.__sceneit.backend.createClient(...args),
}))

// Newer Node versions (25+) define their own localStorage global, which has no methods
// unless Node is started with --localstorage-file, and it hides jsdom's working one.
// Give the tests a plain in-memory Storage whenever the one in place doesn't work, so the
// suite behaves the same on every Node version.
class MemoryStorage {
  #items = new Map()
  get length() {
    return this.#items.size
  }
  key(index) {
    return [...this.#items.keys()][index] ?? null
  }
  getItem(key) {
    return this.#items.has(String(key)) ? this.#items.get(String(key)) : null
  }
  setItem(key, value) {
    this.#items.set(String(key), String(value))
  }
  removeItem(key) {
    this.#items.delete(String(key))
  }
  clear() {
    this.#items.clear()
  }
}

for (const name of ['localStorage', 'sessionStorage']) {
  let works = false
  try {
    works = typeof globalThis[name]?.clear === 'function' && typeof globalThis[name]?.getItem === 'function'
  } catch {
    // Accessing it can throw too (opaque origins); treat that as broken.
  }
  if (!works) Object.defineProperty(globalThis, name, { value: new MemoryStorage(), configurable: true, writable: true })
}

// jsdom doesn't implement these, and the app uses them.
function polyfill() {
  // Reduced motion: the head-to-head flow skips its 900 ms animation, and the
  // homepage hero doesn't rotate on a timer.
  window.matchMedia = (query) => ({
    matches: /prefers-reduced-motion/.test(query),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })
  window.scrollTo = () => {}
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.scrollBy = () => {}
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // Nothing scrolls in jsdom, so infinite lists never see their last element
  // come into view on their own. This records the observers; a test calls
  // scrollToEnd() (harness.js) to say "the user scrolled to the bottom".
  const observers = new Set()
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback
      this.targets = new Set()
      observers.add(this)
    }
    observe(target) { this.targets.add(target) }
    unobserve(target) { this.targets.delete(target) }
    disconnect() {
      this.targets.clear()
      observers.delete(this)
    }
  }
  globalThis.__intersection = {
    // Tells every observer that its elements are on screen.
    fire() {
      for (const observer of [...observers]) {
        const entries = [...observer.targets].map((target) => ({ target, isIntersecting: true }))
        if (entries.length) observer.callback(entries, observer)
      }
    },
  }
}

beforeEach(() => {
  // Integration tests never touch the real network. launch() and the API tests
  // replace this with the fake backend's fetch; anything else fails loudly.
  vi.stubGlobal('fetch', (input) => {
    throw new Error(`Real network request in an integration test: ${String(input?.url ?? input)}`)
  })
  polyfill()
  window.location.hash = ''
  // History entries are tagged for back-button restoration (lib/navMemory.js);
  // the jsdom window lives for the whole file, so start each test untagged.
  window.history.replaceState(null, '')
  sessionStorage.clear()
  localStorage.clear()
})

afterEach(() => {
  // The fake backend stops answering, so a request still in flight when the
  // test ends can't touch the next test. The env and fetch stubs stay in
  // place for the same reason (a late handler must not see a real fetch or a
  // missing token); every launch() sets them up again.
  globalThis.__sceneit?.backend.close()
  cleanup()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})
