// Where to send the user after they log in. When a guest tries something
// that needs an account (rank a movie, open My List...), we remember what
// they were doing, send them to the login page, and pick it up afterwards.
//
// Stored in sessionStorage so it survives the login page's own navigation
// but not a new tab. Shape: { page, action, movieId }, all optional.

const KEY = 'sceneit.returnTo'

export function rememberReturn(intent) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(intent ?? {}))
  } catch {
    // storage blocked: the user just lands on the default page after login
  }
}

// Reads and clears the remembered intent. Returns null if there is none.
export function takeReturn() {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    sessionStorage.removeItem(KEY)
    const intent = JSON.parse(raw)
    return intent && typeof intent === 'object' ? intent : null
  } catch {
    return null
  }
}
