import { useEffect, useState } from 'react'

function readViewportWidth(): number {
  try {
    return window.innerWidth
  } catch {
    return 1280
  }
}

/** Current viewport width in CSS pixels, updated on resize. */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(readViewportWidth)

  useEffect(() => {
    function handleResize() {
      setWidth(window.innerWidth)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return width
}
