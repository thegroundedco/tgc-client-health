import { useCallback, useEffect, useState } from 'react'
import {
  applyPreference,
  readPreference,
  writePreference,
  type ThemePreference,
} from './theme'

// The preference, held in React and mirrored to the document and to storage.
//
// The inline script in index.html has ALREADY stamped the attribute for a
// stored override by the time this runs, and that is not redundant with the
// effect below: the script covers the first paint, which React is too late for,
// and the effect covers every change after it, which the script cannot see.
export function useTheme(): {
  preference: ThemePreference
  setPreference: (next: ThemePreference) => void
} {
  // Lazy initialiser, so storage is read once on mount rather than on every
  // render of every screen in the app.
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readPreference(),
  )

  useEffect(() => {
    applyPreference(document.documentElement, preference)
  }, [preference])

  // Storage is written here rather than in the effect, deliberately. The effect
  // also runs on mount, and writing there would make every mount of every
  // screen a storage write -- including one that only ever READ, when the
  // stored value was something readPreference had to normalise (garbage, or
  // an old shape). That normalisation would then come with a side effect of
  // silently clearing the very value it was reading past.
  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    writePreference(next)
  }, [])

  return { preference, setPreference }
}
