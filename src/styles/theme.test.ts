import { describe, expect, it, vi } from 'vitest'
import {
  applyPreference,
  isThemePreference,
  readPreference,
  THEME_ATTRIBUTE,
  THEME_KEY,
  THEME_PREFERENCES,
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

describe('isThemePreference', () => {
  it('accepts exactly the three states', () => {
    expect(THEME_PREFERENCES).toEqual(['system', 'light', 'dark'])
    for (const preference of THEME_PREFERENCES) {
      expect(isThemePreference(preference)).toBe(true)
    }
  })

  it('rejects anything else', () => {
    for (const value of ['', 'Dark', 'auto', 'SYSTEM', null, undefined, 3, {}]) {
      expect(isThemePreference(value)).toBe(false)
    }
  })
})

describe('readPreference', () => {
  it('reads a stored override', () => {
    expect(readPreference(fakeStorage({ [THEME_KEY]: 'dark' }))).toBe('dark')
    expect(readPreference(fakeStorage({ [THEME_KEY]: 'light' }))).toBe('light')
  })

  // The whole reason this needs no key version, unlike draftCache. A stale
  // draft read as current shows an old rubric's answers as this month's. A
  // stale theme string is one of three words, and anything else is simply not
  // one of them.
  it('falls back to system for an unrecognised value', () => {
    expect(readPreference(fakeStorage({ [THEME_KEY]: 'midnight' }))).toBe('system')
  })

  it('falls back to system when the key is absent', () => {
    expect(readPreference(fakeStorage())).toBe('system')
  })

  it('falls back to system when there is no storage at all', () => {
    expect(readPreference(null)).toBe('system')
  })

  it('falls back to system when reading throws', () => {
    expect(readPreference(throwingStorage)).toBe('system')
  })
})

describe('writePreference', () => {
  it('stores an override and reports that it stuck', () => {
    const store = fakeStorage()
    expect(writePreference('dark', store)).toBe(true)
    expect(store.getItem(THEME_KEY)).toBe('dark')
    expect(readPreference(store)).toBe('dark')
  })

  // Absent and 'system' mean the same thing, and one state should have one
  // representation. It also keeps index.html's script to a single comparison.
  it('clears the key for system rather than storing the word', () => {
    const store = fakeStorage({ [THEME_KEY]: 'dark' })
    expect(writePreference('system', store)).toBe(true)
    expect(store.getItem(THEME_KEY)).toBe(null)
  })

  it('reports failure rather than throwing when storage refuses', () => {
    expect(writePreference('dark', throwingStorage)).toBe(false)
    expect(writePreference('dark', null)).toBe(false)
  })
})

describe('applyPreference', () => {
  it('sets the attribute for an override', () => {
    const root = { setAttribute: vi.fn(), removeAttribute: vi.fn() }
    applyPreference(root, 'dark')
    expect(root.setAttribute).toHaveBeenCalledWith(THEME_ATTRIBUTE, 'dark')
    expect(root.removeAttribute).not.toHaveBeenCalled()
  })

  // Removing, not setting data-theme="system". With no attribute the media
  // query resumes control, which is what lets the app follow an OS that
  // changes at sunset without anybody pressing anything.
  it('removes the attribute for system', () => {
    const root = { setAttribute: vi.fn(), removeAttribute: vi.fn() }
    applyPreference(root, 'system')
    expect(root.removeAttribute).toHaveBeenCalledWith(THEME_ATTRIBUTE)
    expect(root.setAttribute).not.toHaveBeenCalled()
  })

  it('round trips every state through storage', () => {
    const store = fakeStorage()
    for (const preference of THEME_PREFERENCES) {
      writePreference(preference, store)
      expect(readPreference(store)).toBe(preference)
    }
  })
})
