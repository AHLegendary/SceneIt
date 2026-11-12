import { useEffect, useRef, useState } from 'react'

// Infinite scrolling: calls onNear when the element you attach the returned
// ref to gets within about a screen of the viewport. Put the element (an empty
// div works) after the last item of a list.
//
//   const sentinel = useNearBottom(loadMore, hasMore && !loading, items.length)
//   ...
//   {hasMore && <div ref={sentinel} />}
//
// `enabled` switches it off while there is nothing more to load or a load is
// running. `watch` is anything that changes when more items arrive (the
// count): the observer is rebuilt, so if the new items still don't push the
// element out of view, it fires again instead of stalling.
//
// Without IntersectionObserver (very old browsers) it calls onNear straight
// away, which loads the rest one page after another.
export function useNearBottom(onNear, enabled, watch) {
  const [node, setNode] = useState(null)
  const latest = useRef(onNear)
  useEffect(() => {
    latest.current = onNear
  })

  useEffect(() => {
    if (!enabled || !node) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      latest.current()
      return undefined
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current()
      },
      { rootMargin: '600px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [node, enabled, watch])

  return setNode
}
