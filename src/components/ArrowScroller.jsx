import { useCallback, useEffect, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import Icon from './Icon.jsx'

// A horizontal strip of cards with left/right arrows, on top of Embla
// (the carousel engine behind shadcn/ui's Carousel). Embla adds mouse drag
// and touch swipe with momentum and snapping; the arrows page by viewport.
// `children` is the strip's content; the strip gets `className` (default:
// the homepage row look). Arrows only show when there's somewhere to go.
export default function ArrowScroller({ label, className = 'row-scroller', children }) {
  const [viewportRef, embla] = useEmblaCarousel({
    align: 'start',
    containScroll: 'trimSnaps',
    dragFree: true,
    skipSnaps: true,
  })
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const update = useCallback(() => {
    if (!embla) return
    setCanLeft(embla.canScrollPrev())
    setCanRight(embla.canScrollNext())
  }, [embla])

  useEffect(() => {
    if (!embla) return undefined
    update()
    embla.on('select', update)
    embla.on('reInit', update)
    embla.on('scroll', update)
    return () => {
      embla.off('select', update)
      embla.off('reInit', update)
      embla.off('scroll', update)
    }
  }, [embla, update])

  // Re-measure when the children change (rows load their cards async).
  useEffect(() => {
    embla?.reInit()
  }, [embla, children])

  // Page by what's visible: the arrows move one screenful of cards.
  function page(dir) {
    if (!embla) return
    const inView = embla.slidesInView()
    if (!inView.length) return
    const first = inView[0]
    const last = inView[inView.length - 1]
    const count = Math.max(1, inView.length - 1)
    embla.scrollTo(dir > 0 ? last + 1 : Math.max(0, first - count))
  }

  // Tab into a card that's off to the side and Embla brings it into view
  // (the viewport hides overflow, so the browser can't scroll it itself).
  function onFocus(e) {
    if (!embla) return
    const slides = embla.slideNodes()
    const i = slides.findIndex((node) => node.contains(e.target))
    if (i !== -1) embla.scrollTo(i)
  }

  return (
    <div className="row-wrap">
      <div className="row-viewport" ref={viewportRef}>
        <div className={className} onFocus={onFocus}>
          {children}
        </div>
      </div>
      <button
        type="button"
        className={`row-arrow row-arrow--left${canLeft ? ' is-on' : ''}`}
        onClick={() => page(-1)}
        aria-label={`Scroll ${label} left`}
        tabIndex={canLeft ? 0 : -1}
      >
        <Icon name="chevron" size={20} strokeWidth={2.4} />
      </button>
      <button
        type="button"
        className={`row-arrow row-arrow--right${canRight ? ' is-on' : ''}`}
        onClick={() => page(1)}
        aria-label={`Scroll ${label} right`}
        tabIndex={canRight ? 0 : -1}
      >
        <Icon name="chevron" size={20} strokeWidth={2.4} />
      </button>
    </div>
  )
}
