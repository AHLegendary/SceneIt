import ArrowScroller from './ArrowScroller.jsx'
import Icon from './Icon.jsx'

// A titled, horizontally scrolling row of cards with arrow controls.
// Pass `status` ('loading' | 'error') to show skeletons or an error with a
// retry button in place of the cards; otherwise render cards as children.
export default function MovieRow({ title, icon, meta, seeAll, onSeeAll, status, error, onRetry, empty, children, skeletons = 8 }) {
  return (
    <section className="row-section" aria-label={title}>
      <header className="row-head">
        <h2 className="row-title">
          {icon && <Icon name={icon} size={22} className="row-title__icon" />}
          <span>{title}</span>
        </h2>
        {meta && <div className="row-meta">{meta}</div>}
        {seeAll && onSeeAll && (
          <button type="button" className="row-more" onClick={onSeeAll}>
            {seeAll === true ? 'See All' : seeAll}
            <Icon name="arrow" size={16} />
          </button>
        )}
      </header>

      {status === 'error' ? (
        <div className="notice notice--error row-notice" role="alert">
          <span>{error}</span>
          {onRetry && (
            <button type="button" className="btn btn--sm" onClick={onRetry}>Try again</button>
          )}
        </div>
      ) : status === 'loading' ? (
        <div className="row-scroller" aria-busy="true">
          {Array.from({ length: skeletons }, (_, i) => (
            <span className="card card--skeleton" key={i} aria-hidden="true" />
          ))}
        </div>
      ) : empty ? (
        <div className="row-empty">{empty}</div>
      ) : (
        <ArrowScroller label={title}>{children}</ArrowScroller>
      )}
    </section>
  )
}
