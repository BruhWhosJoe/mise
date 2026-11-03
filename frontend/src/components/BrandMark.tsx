/**
 * Original MetaFabric brand mark: three knots joined by woven threads, drawn
 * inline so it needs no font or network fetch. Decorative; the adjacent
 * "MetaFabric" text is the accessible name.
 */
function BrandMark() {
  return (
    <svg
      className="brand-mark-svg"
      width="32"
      height="32"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="8"
        className="brand-mark-bg"
      />
      <path
        d="M7 21 L12 10 L16 21 L20 10 L25 21"
        fill="none"
        className="brand-mark-thread"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="21" r="2.4" className="brand-mark-knot" />
      <circle cx="16" cy="21" r="2.4" className="brand-mark-knot" />
      <circle cx="25" cy="21" r="2.4" className="brand-mark-knot" />
    </svg>
  )
}

export default BrandMark
