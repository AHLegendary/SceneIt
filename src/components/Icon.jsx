// Small inline icon set (stroke icons, 24-unit grid). Decorative by default.
const PATHS = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10.5V20h13v-9.5M10 20v-5h4v5',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-3.3 3.6-5.5 8-5.5s8 2.2 8 5.5',
  friends: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 19c0-3 2.9-5 6.5-5s6.5 2 6.5 5M16 4.3a3.5 3.5 0 0 1 0 6.7M17.5 14.2c2.4.5 4 2.1 4 4.8',
  bookmark: 'M6 3h12v18l-6-4.5L6 21z',
  swords: 'M3 3l8 8M3 3h4M3 3v4M21 3l-8 8M21 3h-4M21 3v4M6 18l3-3M18 18l-3-3M4 20l2-2M20 20l-2-2M9 15l2-2M15 15l-2-2',
  card: 'M3 6h18v12H3zM7 10h4v4H7zM13 10h5M13 14h5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  trophy: 'M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 20h8',
  film: 'M4 4h16v16H4zM4 9h16M4 15h16M9 4v16M15 4v16',
  clapper: 'M3 9h18v11H3zM3 9l2-5h14l2 5M8 4l2 5M13 4l2 5',
  people: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 19c0-2.8 2.7-4.5 6-4.5s6 1.7 6 4.5M14 14.7c.6-.1 1.3-.2 2-.2 3.3 0 6 1.7 6 4.5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  play: 'M7 5v14l11-7z',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5',
  check: 'M5 12l5 5L20 7',
  close: 'M6 6l12 12M18 6L6 18',
  logout: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
  sparkle: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM19 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
  star: 'M12 3l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.4l-5.7 3.1 1.2-6.4L2.8 9.7l6.4-.8z',
  plus: 'M12 5v14M5 12h14',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  equal: 'M5 9h14M5 15h14',
}

export default function Icon({ name, size = 18, strokeWidth = 2, className = '', label }) {
  const d = PATHS[name]
  if (!d) return null
  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === 'play' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : 'true'}
    >
      {label && <title>{label}</title>}
      <path d={d} />
    </svg>
  )
}
