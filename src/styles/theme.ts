// The theme preference: read it, write it, apply it. Pure, with storage, the OS
// preference and the root element injected, so every branch below is provable
// without a browser -- the same shape as checkin/draftCache.ts, and for the
// same reasons.
//
// Three things this file is careful about.
//
// First, storage is optional. Safari in private browsing throws on the property
// ACCESS, not only on setItem's quota, and an embedded context can throw too.
// Every entry point treats that as a normal outcome, and writePreference
// returns whether the write actually happened.
//
// Second, the stored value needs NO version segment, unlike draftCache. The
// draft's key carries v4 because reading a stale SHAPE would present an old
// rubric's answers as this month's -- a value meaning one thing read as though
// it meant another. A stale theme string cannot do that: it is one of two
// words, and anything unrecognised falls through to the OS. Validation covers
// the entire risk.
//
// Third -- and this is the 2026-09-02 change -- there are TWO states now, not
// three. The control became a two-position pill, and a switch has two ends with
// nowhere on it for a third. "Follow the system" survives as the STARTING
// CONDITION rather than as a mode: a browser that has never been toggled opens
// matching the machine, and the first press pins it. The cost the owner
// accepted is that sunset stops doing anything once you have pressed it.
//
// The retired word 'system' was never written to storage even by the previous
// build -- it represented that state by CLEARING the key -- but isThemePreference
// must still reject it, because a value that fails validation falls through to
// the OS while one that passes would stamp data-theme="system", an attribute no
// CSS block matches.

export type ThemePreference = 'light' | 'dark'

// Ordered, and the order is the reading order of the pill: light at the sun
// end, dark at the moon end. ThemeControl and both drift tests read this array
// rather than repeating the two words.
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark']

// Duplicated, by necessity, in the inline script in index.html -- that script
// must run before the bundle exists, so it cannot import this. It is not
// allowed to drift: tests/bootTheme.test.ts reads both files and compares them.
export const THEME_KEY = 'theme'
export const THEME_ATTRIBUTE = 'data-theme'

// The switch is animated by adding this class to <html> for the length of one
// change and taking it off again, rather than by a transition that lives
// permanently on every element in the app. Two reasons, and both are the point:
// a permanent rule would fade the whole page in on the FIRST paint, and it
// would tax every unrelated repaint for an action taken twice a year.
//
// TRANSITION_MS must equal the duration tokens.css actually animates for. Too
// short and the class comes off mid-fade, cutting it dead; too long and it
// lingers over the next interaction. tests/themeTransition.test.ts fails if the
// number here and the token there stop agreeing.
export const TRANSITION_CLASS = 'theme-transition'
export const TRANSITION_MS = 300

// Only the three methods used, so a test can supply a plain object rather than
// a whole Storage. Likewise RootLike: applyPreference needs one method off an
// Element, not a document.
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type RootLike = Pick<Element, 'setAttribute'>

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

// Injected everywhere it is used, and defaulted here rather than read inline,
// for the same reason storage is: matchMedia does not exist in every context
// this module is imported into, and a throw here would take out the first
// paint. A machine we cannot ask is treated as preferring light.
function defaultPrefersDark(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  } catch {
    return false
  }
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === 'string' &&
    (THEME_PREFERENCES as readonly string[]).includes(value)
  )
}

export function readPreference(
  store: StorageLike | null = defaultStorage(),
  prefersDark: boolean = defaultPrefersDark(),
): ThemePreference {
  const fromOS: ThemePreference = prefersDark ? 'dark' : 'light'
  if (!store) return fromOS
  try {
    const raw = store.getItem(THEME_KEY)
    return isThemePreference(raw) ? raw : fromOS
  } catch {
    return fromOS
  }
}

export function writePreference(
  preference: ThemePreference,
  store: StorageLike | null = defaultStorage(),
): boolean {
  if (!store) return false
  try {
    // Both states are explicit now. Nothing clears the key: that was how the
    // retired 'system' was represented, and an absence now means only "never
    // chose", which is a different thing from either live state.
    store.setItem(THEME_KEY, preference)
    return true
  } catch {
    return false
  }
}

export function applyPreference(root: RootLike, preference: ThemePreference): void {
  // Always sets, never removes. Removing was how the old default handed control
  // back to tokens.css's media query; with two explicit states there is nothing
  // to hand back to, and a removed attribute would silently re-follow the OS
  // against a choice the person has actually made.
  root.setAttribute(THEME_ATTRIBUTE, preference)
}
