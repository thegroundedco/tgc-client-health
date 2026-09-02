import type { ThemePreference } from './theme'
import styles from './ThemeControl.module.css'

// Decoration, both of them: the switch's accessible name and its checked state
// already say everything a screen reader needs, so an exposed image here would
// be announced as a stray graphic inside a control that has just described
// itself. Drawn in currentColor so they inherit the track's colour and need no
// literal of their own -- tokens.css is the only file allowed one.
function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      className={styles.icon}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 1.5v2.5M12 20v2.5M22.5 12H20M4 12H1.5M19.4 4.6l-1.8 1.8M6.4 17.6l-1.8 1.8M19.4 19.4l-1.8-1.8M6.4 6.4L4.6 4.6" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      className={styles.icon}
      fill="currentColor"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M20.8 14.2A8.6 8.6 0 0 1 9.8 3.2a8.8 8.8 0 1 0 11 11z" />
      <path d="M17.2 2l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" />
      <path d="M21.4 7.4l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4z" />
    </svg>
  )
}

// One switch, not the three buttons this replaced. The owner asked for a
// two-position pill on 2026-09-02, which retired 'system' as a selectable state
// -- a switch has two ends and nowhere to put a third. Following the OS
// survives as the starting condition, in theme.ts's readPreference.
//
// role="switch" rather than a pressed button, and that is the thing that makes
// a pill legitimate rather than a picture of a control: a switch carries its
// own on/off state, so this announces "Dark mode, switch, on" from a single
// element. It is a real <button>, so Enter and Space work with no handler.
//
// The knob sits at the moon end when dark and the sun end when light, matching
// the owner's reference: whichever icon is UNCOVERED is the theme you are in.
export function ThemeControl({
  preference,
  onChange,
}: {
  preference: ThemePreference
  onChange: (next: ThemePreference) => void
}) {
  const isDark = preference === 'dark'
  return (
    <button
      aria-checked={isDark}
      aria-label="Dark mode"
      className={styles.track}
      onClick={() => onChange(isDark ? 'light' : 'dark')}
      role="switch"
      type="button"
    >
      <SunIcon />
      <MoonIcon />
      <span
        aria-hidden="true"
        className={`${styles.knob} ${isDark ? '' : styles.knobLight}`}
      />
    </button>
  )
}
