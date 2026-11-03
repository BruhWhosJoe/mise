import type { View } from '../types'

/**
 * Small consistent stroke icons for primary navigation. Decorative: every
 * usage sits beside a visible text label, which is the accessible name.
 */
function NavIcon({ view }: { view: View }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 18 18',
    'aria-hidden': true as const,
    focusable: 'false' as const,
    className: 'nav-icon',
  }
  if (view === 'discover') {
    return (
      <svg {...common}>
        <circle
          cx="8"
          cy="8"
          r="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <line
          x1="12"
          y1="12"
          x2="16"
          y2="16"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (view === 'catalog') {
    return (
      <svg {...common}>
        <rect
          x="2.5"
          y="2.5"
          width="13"
          height="4"
          rx="1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <rect
          x="2.5"
          y="7.5"
          width="13"
          height="4"
          rx="1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <rect
          x="2.5"
          y="12.5"
          width="8"
          height="3"
          rx="1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <circle cx="4" cy="4" r="2.2" fill="currentColor" />
      <circle cx="14" cy="4" r="2.2" fill="currentColor" />
      <circle cx="9" cy="14" r="2.2" fill="currentColor" />
      <line
        x1="5.5"
        y1="5.5"
        x2="7.8"
        y2="12"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <line
        x1="12.5"
        y1="5.5"
        x2="10.2"
        y2="12"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  )
}

export default NavIcon
