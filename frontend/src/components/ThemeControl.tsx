import type { Theme } from '../hooks/useTheme'

interface ThemeControlProps {
  theme: Theme
  onChange: (theme: Theme) => void
}

function ThemeControl({ theme, onChange }: ThemeControlProps) {
  return (
    <div className="theme-switch">
      <span className="theme-name" id="theme-label">
        Theme
      </span>
      <div
        className="theme-options"
        role="radiogroup"
        aria-labelledby="theme-label"
      >
        <label>
          <input
            type="radio"
            name="color-theme"
            value="light"
            checked={theme === 'light'}
            onChange={() => onChange('light')}
          />
          <span>Light</span>
        </label>
        <label>
          <input
            type="radio"
            name="color-theme"
            value="dark"
            checked={theme === 'dark'}
            onChange={() => onChange('dark')}
          />
          <span>Dark</span>
        </label>
      </div>
    </div>
  )
}

export default ThemeControl
