/**
 * Original Mise brand mark: a small bowl holding three dots, drawn inline
 * so it needs no font or network fetch. Decorative; the adjacent "Mise"
 * text is the accessible name.
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
      <circle cx="10" cy="10" r="2.1" className="brand-mark-dot" />
      <circle cx="16" cy="8" r="2.1" className="brand-mark-dot" />
      <circle cx="22" cy="10" r="2.1" className="brand-mark-dot" />
      <path
        d="M6 16.5 v2.5 c0 5.5 4.4 8.5 10 8.5 s10 -3 10 -8.5 v-2.5"
        fill="none"
        className="brand-mark-bowl"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default BrandMark
