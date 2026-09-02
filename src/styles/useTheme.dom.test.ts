// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTheme } from './useTheme'
import { THEME_ATTRIBUTE, THEME_KEY, TRANSITION_CLASS, TRANSITION_MS } from './theme'

const root = () => document.documentElement

beforeEach(() => {
  localStorage.clear()
  root().removeAttribute(THEME_ATTRIBUTE)
  root().classList.remove(TRANSITION_CLASS)
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  root().removeAttribute(THEME_ATTRIBUTE)
  root().classList.remove(TRANSITION_CLASS)
})

describe('useTheme', () => {
  it('starts from the stored choice and applies it', () => {
    localStorage.setItem(THEME_KEY, 'dark')
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('dark')
    expect(root().getAttribute(THEME_ATTRIBUTE)).toBe('dark')
  })

  // jsdom implements no matchMedia, so theme.ts's guarded lookup yields false
  // and an untoggled browser reads as light. That IS the fallback under test:
  // a machine we cannot ask is treated as preferring light.
  it('starts from the OS when nothing is stored', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('light')
    expect(root().getAttribute(THEME_ATTRIBUTE)).toBe('light')
  })

  it('applies and persists a change', () => {
    const { result } = renderHook(() => useTheme())
    act(() => {
      result.current.setPreference('dark')
    })
    expect(result.current.preference).toBe('dark')
    expect(root().getAttribute(THEME_ATTRIBUTE)).toBe('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
  })

  // The reason the animation is a class rather than a standing rule. If the
  // class were on the root at mount, the very first paint would cross-fade
  // from the unstyled default into the stamped theme -- the exact flash
  // index.html's inline script exists to prevent, reintroduced by the thing
  // meant to make the switch pleasant.
  it('does not arm the transition on mount', () => {
    localStorage.setItem(THEME_KEY, 'dark')
    renderHook(() => useTheme())
    expect(root().classList.contains(TRANSITION_CLASS)).toBe(false)
  })

  it('arms the transition for a change and disarms it afterwards', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useTheme())
    act(() => {
      result.current.setPreference('dark')
    })
    expect(root().classList.contains(TRANSITION_CLASS)).toBe(true)

    act(() => {
      vi.advanceTimersByTime(TRANSITION_MS - 1)
    })
    expect(root().classList.contains(TRANSITION_CLASS)).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(root().classList.contains(TRANSITION_CLASS)).toBe(false)
  })

  // Two presses in quick succession must not leave the first press's timer
  // free to strip the class while the second fade is still running.
  it('restarts the window rather than letting an earlier press end it', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useTheme())
    act(() => {
      result.current.setPreference('dark')
    })
    act(() => {
      vi.advanceTimersByTime(TRANSITION_MS - 10)
      result.current.setPreference('light')
    })
    act(() => {
      vi.advanceTimersByTime(20)
    })
    expect(root().classList.contains(TRANSITION_CLASS)).toBe(true)
    act(() => {
      vi.advanceTimersByTime(TRANSITION_MS)
    })
    expect(root().classList.contains(TRANSITION_CLASS)).toBe(false)
  })

  // A pending disarm must not outlive the tree that armed it. Asserted
  // behaviourally rather than by counting timers: a press schedules two, one
  // here and one in React's own scheduler, so a count of zero would be an
  // assertion about React's internals rather than about this hook.
  it('disarms at unmount and stays disarmed', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useTheme())
    act(() => {
      result.current.setPreference('dark')
    })
    unmount()
    expect(root().classList.contains(TRANSITION_CLASS)).toBe(false)

    // Past the window the press opened. Nothing of this hook's may run now.
    expect(() => {
      vi.advanceTimersByTime(TRANSITION_MS * 2)
    }).not.toThrow()
    expect(root().classList.contains(TRANSITION_CLASS)).toBe(false)
  })

  // Carried forward from the previous build: mounting must READ storage, never
  // write it. Moving the write into the effect passes every other test here
  // while silently erasing a value the hook only ever normalised past.
  it('does not touch storage on mount when the stored value is unrecognised', () => {
    localStorage.setItem(THEME_KEY, 'blah-garbage')
    renderHook(() => useTheme())
    expect(localStorage.getItem(THEME_KEY)).toBe('blah-garbage')
  })
})
