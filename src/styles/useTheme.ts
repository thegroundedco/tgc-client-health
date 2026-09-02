import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyPreference,
  readPreference,
  TRANSITION_CLASS,
  TRANSITION_MS,
  writePreference,
  type ThemePreference,
} from './theme'

// The preference, held in React and mirrored to the document and to storage.
//
// The inline script in index.html has ALREADY stamped the attribute by the time
// this runs, and that is not redundant with the effect below: the script covers
// the first paint, which React is too late for, and the effect covers every
// change after it, which the script cannot see.
export function useTheme(): {
  preference: ThemePreference
  setPreference: (next: ThemePreference) => void
} {
  // Lazy initialiser, so storage is read once on mount rather than on every
  // render of every screen in the app.
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readPreference(),
  )

  // The handle for the window during which <html> carries the transition class.
  // Held in a ref rather than in state because changing it must never trigger a
  // render -- the whole point of the class is that it is invisible to React.
  const disarm = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    applyPreference(document.documentElement, preference)
  }, [preference])

  // Cleanup only, with no dependencies, so it runs at unmount and not on every
  // change. A timer left pending would fire against a torn-down tree.
  useEffect(() => {
    return () => {
      if (disarm.current !== null) clearTimeout(disarm.current)
      document.documentElement.classList.remove(TRANSITION_CLASS)
    }
  }, [])

  const setPreference = useCallback((next: ThemePreference) => {
    const root = document.documentElement

    // Armed HERE rather than in the effect above, and this is the reason the
    // animation is a class at all: the effect also runs on mount, so arming it
    // there would cross-fade the very first paint from the unstyled default
    // into the stamped theme -- the exact flash index.html's script exists to
    // prevent, reintroduced by the thing meant to make the switch pleasant.
    root.classList.add(TRANSITION_CLASS)

    // Restarted, not stacked. Two presses in quick succession would otherwise
    // leave the first press's timer free to strip the class part-way through
    // the second fade, cutting it dead.
    if (disarm.current !== null) clearTimeout(disarm.current)
    disarm.current = setTimeout(() => {
      root.classList.remove(TRANSITION_CLASS)
      disarm.current = null
    }, TRANSITION_MS)

    setPreferenceState(next)

    // writePreference's returned boolean -- whether the write actually stuck --
    // is deliberately unread here, not forgotten. React state has already
    // switched by the line above regardless of what storage does, so a person
    // in Safari private browsing sees the theme change correctly for the rest
    // of this visit; what silently fails is only the PERSISTENCE, and the next
    // load falls back to the OS with no error surfaced anywhere. Wiring the
    // return value up to anything -- a toast, a retry, a fallback surface -- is
    // a real option for whoever picks this up next; it just was not one this
    // pass made, so do not assume it was an oversight if you go looking.
    //
    // Storage is written here rather than in the effect for the same reason the
    // class is: the effect also runs on mount, and writing there would make
    // every mount of every screen a storage write -- including one that only
    // ever READ, when the stored value was something readPreference had to
    // normalise past.
    writePreference(next)
  }, [])

  return { preference, setPreference }
}
