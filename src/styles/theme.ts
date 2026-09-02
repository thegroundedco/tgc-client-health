// The theme preference: read it, write it, apply it. Pure, with storage and the
// root element injected, so every branch below is provable without a browser --
// the same shape as checkin/draftCache.ts, and for the same reasons.
//
// Two things this file is careful about.
//
// First, storage is optional. Safari in private browsing throws on the property
// ACCESS, not only on setItem's quota, and an embedded context can throw too.
// Every entry point treats that as a normal outcome, and writePreference
// returns whether the write actually happened.
//
// Second, and unlike draftCache, the stored value needs NO version segment. The
// draft's key carries v4 because reading a stale SHAPE would present an old
// rubric's answers as this month's -- a value meaning one thing read as though
// it meant another. A stale theme string cannot do that: it is one of three
// words, and anything unrecognised falls back to system. Validation covers the
// entire risk, and a version here would be cargo.

export type ThemePreference = 'system' | 'light' | 'dark'

// Ordered, and the order is the reading order of the control in the header:
// the default first, then the two overrides. ThemeControl renders from this
// array rather than repeating the three words.
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

export const DEFAULT_PREFERENCE: ThemePreference = 'system'

// Duplicated, by necessity, in the inline script in index.html -- that script
// must run before the bundle exists, so it cannot import this. It is not
// allowed to drift: tests/bootTheme.test.ts reads both files and compares them.
export const THEME_KEY = 'theme'
export const THEME_ATTRIBUTE = 'data-theme'

// Only the three methods used, so a test can supply a plain object rather than
// a whole Storage. Likewise RootLike: applyPreference needs two methods off an
// Element, not a document.
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type RootLike = Pick<Element, 'setAttribute' | 'removeAttribute'>

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
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
): ThemePreference {
  if (!store) return DEFAULT_PREFERENCE
  try {
    const raw = store.getItem(THEME_KEY)
    return isThemePreference(raw) ? raw : DEFAULT_PREFERENCE
  } catch {
    return DEFAULT_PREFERENCE
  }
}

export function writePreference(
  preference: ThemePreference,
  store: StorageLike | null = defaultStorage(),
): boolean {
  if (!store) return false
  try {
    // Absent and 'system' mean the same thing, so system CLEARS rather than
    // storing the word. One state, one representation -- and index.html's
    // script then needs only to recognise the two overrides.
    if (preference === DEFAULT_PREFERENCE) store.removeItem(THEME_KEY)
    else store.setItem(THEME_KEY, preference)
    return true
  } catch {
    return false
  }
}

export function applyPreference(root: RootLike, preference: ThemePreference): void {
  // Removing the attribute is the point of the three states: with no attribute,
  // tokens.css's media query resumes control and the app follows an OS that
  // changes at sunset without anybody pressing anything.
  if (preference === DEFAULT_PREFERENCE) root.removeAttribute(THEME_ATTRIBUTE)
  else root.setAttribute(THEME_ATTRIBUTE, preference)
}
