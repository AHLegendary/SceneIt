function formatDate(iso) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'recently' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// "just now", "5 min ago", "3 hr ago", "2 days ago", then a date.
export function timeAgo(iso, now = Date.now()) {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'recently'
  const min = Math.floor((now - then) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const days = Math.floor(hr / 24)
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  return `on ${formatDate(iso)}`
}
