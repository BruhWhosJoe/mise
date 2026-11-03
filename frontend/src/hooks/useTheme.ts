import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'mf-theme'

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isTheme(stored) ? stored : null
  } catch {
    // Storage unavailable (private mode, blocked cookies): fall back to light.
    return null
  }
}

/**
 * Explicit theme choice. Defaults to light unless a valid choice was saved.
 * Applies the theme to the document root and persists only explicit choices.
 * Theme state is independent of question, results, selection, and view state.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(
    () => readStoredTheme() ?? 'light',
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage unavailable: the theme still applies for this visit.
    }
  }, [])

  return { theme, setTheme }
}
