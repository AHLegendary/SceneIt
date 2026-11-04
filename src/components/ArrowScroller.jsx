import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'

// A horizontally scrolling strip with the same left/right arrows as the
// homepage rows. `children` is the scrolling element's content; the scrolling
// element gets `className` (default: the homepage row look). Arrows show only
// when there's something to scroll to on that side.
export default function ArrowScroller({ label, className = 'row-scroller', children }) {
  const scroller = useRef(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const update = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    update()
    const el = scroller.current
    if (!el) return undefined
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [update, children])

  function scrollBy(dir) {
    const el = scroller.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: 'smooth' })
  }

  return (
    <div className="row-wrap">
      <div className={className} ref={scroller} onScroll={update}>
        {children}
      </div>
      <button
        type="button"
        className={`row-arrow row-arrow--left${canLeft ? ' is-on' : ''}`}
        onClick={() => scrollBy(-1)}
        aria-label={`Scroll ${label} left`}
        tabIndex={canLeft ? 0 : -1}
      >
        <Icon name="chevron" size={20} strokeWidth={2.4} />
      </button>
      <button
        type="button"
        className={`row-arrow row-arrow--right${canRight ? ' is-on' : ''}`}
        onClick={() => scrollBy(1)}
        aria-label={`Scroll ${label} right`}
        tabIndex={canRight ? 0 : -1}
      >
        <Icon name="chevron" size={20} strokeWidth={2.4} />
      </button>
    </div>
  )
}
