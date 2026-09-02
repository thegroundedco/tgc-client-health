import { describe, expect, it, vi } from 'vitest'
import {
  applyPreference,
  isThemePreference,
  readPreference,
  THEME_ATTRIBUTE,
  THEME_KEY,
  THEME_PREFERENCES,
  TRANSITION_CLASS,
  TRANSITION_MS,
  writePreference,
  type StorageLike,
} from './theme'

// A fake store rather than jsdom's localStorage: these are pure functions and
// they should be provable without an environment. draftCache.ts takes the same
// shape for the same reason.
function fakeStorage(initial: Record<string, string> = {}): StorageLike {
  const held = { ...initial }
  return {
    getItem: (key) => held[key] ?? null,
    setItem: (key, value) => {
      held[key] = value
    },
    removeItem: (key) => {
      delete held[key]
    },
  }
}

// Safari in private browsing throws on the property access, not only on quota.
// draftCache.ts already treats that as a normal outcome; so does this.
const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error('denied')
  },
  setItem: () => {
    throw new Error('denied')
  },
  removeItem: () => {
    throw new Error('denied')
  },
}

describe('the preference set', () => {
  // Two states, not three. The owner dropped 'system' as a SELECTABLE state on
  // 2026-09-02 when the control became a two-position pill: a switch has two
  // ends and there is nowhere on it for a third. Following the OS survives as
  // the STARTING condition -- see readPreference below -- not as a mode.
  it('is exactly light and dark', () => {
    expect(THEME_PREFERENCES).toEqual(['light', 'dark'])
  })

  // 'system' was a valid stored value in the previous build and must not be one
  // now. It has to fail validation rather than being quietly tolerated, or a
  // browser holding the old word would stamp data-theme="system" -- an
  // attribute no CSS block matches, leaving the page on whatever the media
  // query says while the toggle claims otherwise.
  it('rejects the retired third state', () => {
    expect(isThemePreference('system')).toBe(false)
  })

  it('accepts both live states and nothing else', () => {
    expect(isThemePreference('light')).toBe(true)
    expect(isThemePreference('dark')).toBe(true)
    for (const value of ['', 'Dark', 'auto', 'SYSTEM', null, undefined, 3, {}]) {
      expect(isThemePreference(value)).toBe(false)
    }
  })
})

describe('readPreference', () => {
  it('reads a stored choice, whatever the OS says', () => {
    expect(readPreference(fakeStorage({ [THEME_KEY]: 'dark' }), false)).toBe('dark')
    expect(readPreference(fakeStorage({ [THEME_KEY]: 'light' }), true)).toBe('light')
  })

  // The whole of what "follows the system" now means. A browser that has never
  // been toggled opens matching the machine; the first press pins it forever.
  it('falls back to the OS when nothing is stored', () => {
    expect(readPreference(fakeStorage(), true)).toBe('dark')
    expect(readPreference(fakeStorage(), false)).toBe('light')
  })

  // Including the retired 'system', which is the one unrecognised value a real
  // browser might actually be holding.
  it('falls back to the OS for an unrecognised stored value', () => {
    expect(readPreference(fakeStorage({ [THEME_KEY]: 'system' }), true)).toBe('dark')
    expect(readPreference(fakeStorage({ [THEME_KEY]: 'midnight' }), false)).toBe('light')
  })

  it('falls back to the OS when storage is absent or throws', () => {
    expect(readPreference(null, true)).toBe('dark')
    expect(readPreference(throwingStorage, true)).toBe('dark')
    expect(readPreference(throwingStorage, false)).toBe('light')
  })
})

describe('writePreference', () => {
  // Both states are now explicit. Nothing CLEARS the key any more -- that was
  // how the old 'system' was represented, and representing a live state by an
  // absence would now mean a stored choice that reads back as "never chose".
  it('stores both states rather than representing either as an absence', () => {
    const store = fakeStorage()
    expect(writePreference('dark', store)).toBe(true)
    expect(store.getItem(THEME_KEY)).toBe('dark')
    expect(writePreference('light', store)).toBe(true)
    expect(store.getItem(THEME_KEY)).toBe('light')
  })

  it('reports failure rather than throwing when storage refuses', () => {
    expect(writePreference('dark', throwingStorage)).toBe(false)
    expect(writePreference('dark', null)).toBe(false)
  })
})

describe('applyPreference', () => {
  // Always sets, never removes. Removing was how the old default handed control
  // back to the media query; with two explicit states there is nothing to hand
  // back to, and a removed attribute would silently re-follow the OS.
  it('stamps the attribute for both states', () => {
    const root = { setAttribute: vi.fn(), removeAttribute: vi.fn() }
    applyPreference(root, 'dark')
    expect(root.setAttribute).toHaveBeenCalledWith(THEME_ATTRIBUTE, 'dark')
    applyPreference(root, 'light')
    expect(root.setAttribute).toHaveBeenCalledWith(THEME_ATTRIBUTE, 'light')
    expect(root.removeAttribute).not.toHaveBeenCalled()
  })

  it('round trips both states through storage', () => {
    const store = fakeStorage()
    for (const preference of THEME_PREFERENCES) {
      writePreference(preference, store)
      expect(readPreference(store, false)).toBe(preference)
    }
  })
})

describe('the transition constants', () => {
  // The class is added for the length of a switch and taken off again, rather
  // than a transition living permanently on every element. TRANSITION_MS must
  // match the duration tokens.css actually animates for; tests/themeTransition
  // .test.ts is what stops those two drifting.
  it('name a class and a duration for the switch', () => {
    expect(TRANSITION_CLASS).toBe('theme-transition')
    expect(TRANSITION_MS).toBeGreaterThan(0)
  })
})
