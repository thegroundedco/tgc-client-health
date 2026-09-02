// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useTheme } from './useTheme'
import { THEME_ATTRIBUTE, THEME_KEY } from './theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute(THEME_ATTRIBUTE)
})

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute(THEME_ATTRIBUTE)
})

describe('useTheme', () => {
  it('starts at system when nothing is stored', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('system')
    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false)
  })

  it('starts from the stored override and applies it', () => {
    localStorage.setItem(THEME_KEY, 'dark')
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('dark')
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark')
  })

  it('applies and persists a change', () => {
    const { result } = renderHook(() => useTheme())
    act(() => {
      result.current.setPreference('light')
    })
    expect(result.current.preference).toBe('light')
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('light')
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
  })

  // Going back to system must REMOVE the attribute, not set it to "system".
  // Leaving a stale data-theme="dark" behind would pin the app to dark forever
  // while the control claimed it was following the OS.
  it('removes the attribute and clears storage on the way back to system', () => {
    localStorage.setItem(THEME_KEY, 'dark')
    const { result } = renderHook(() => useTheme())
    act(() => {
      result.current.setPreference('system')
    })
    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false)
    expect(localStorage.getItem(THEME_KEY)).toBe(null)
  })

  // Mounting must never WRITE storage -- only setPreference does that. A write
  // in the effect (the exact regression the hook's comment warns against)
  // would fire on every mount of every screen, and readPreference's job of
  // normalising an unrecognised value to 'system' would come with a side
  // effect of silently erasing whatever was actually stored: a garbage string
  // here is not the hook's to correct, only to read past.
  it('does not touch storage on mount when the stored value is unrecognised', () => {
    localStorage.setItem(THEME_KEY, 'blah-garbage')
    renderHook(() => useTheme())
    expect(localStorage.getItem(THEME_KEY)).toBe('blah-garbage')
  })
})
