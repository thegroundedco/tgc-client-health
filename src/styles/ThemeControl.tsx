import { THEME_PREFERENCES, type ThemePreference } from './theme'
import styles from './ThemeControl.module.css'

// Sentence case, matching every other button in the app.
const LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

// Three buttons rather than one that cycles, and rather than a <select>. The
// argument is Board.tsx's, made there about Cards | Matrix: a single button
// that says what it will BECOME gives no indication of what is currently
// showing, and aria-pressed on a set says which one is without a person having
// to work it out from the label. Rendered from THEME_PREFERENCES so the order
// and the membership live in one place.
export function ThemeControl({
  preference,
  onChange,
}: {
  preference: ThemePreference
  onChange: (next: ThemePreference) => void
}) {
  return (
    <div aria-label="Theme" className={styles.group} role="group">
      {THEME_PREFERENCES.map((option) => (
        <button
          aria-pressed={preference === option}
          className="button button--quiet"
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {LABELS[option]}
        </button>
      ))}
    </div>
  )
}
