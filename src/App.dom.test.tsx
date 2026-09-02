// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_ATTRIBUTE, THEME_KEY } from './styles/theme'

// App reaches Supabase at module scope through useSession/useProfile, so both
// hooks are stubbed. What is under test here is one thing only: that the theme
// is applied on EVERY branch, and that the control appears on exactly one.
vi.mock('./auth/useSession', () => ({
  useSession: () => ({ session: null, status: 'ready', error: null }),
}))
vi.mock('./auth/useProfile', () => ({
  useProfile: () => ({ profile: null, status: 'ready', error: null }),
}))
vi.mock('./lib/supabase', () => ({ supabase: { auth: { signOut: vi.fn() } } }))

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute(THEME_ATTRIBUTE)
})

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute(THEME_ATTRIBUTE)
  document.body.innerHTML = ''
})

describe('the theme on the signed-out screen', () => {
  // Spec §7: the theme applies everywhere, the control appears only when
  // signed in. A light flash on the way to a dark app is exactly the defect
  // the inline script exists to prevent, and it would return here if App only
  // applied the theme on the `active` branch.
  it('is applied even though there is no control to change it', async () => {
    localStorage.setItem(THEME_KEY, 'dark')
    const { default: App } = await import('./App')
    render(<App />)
    await waitFor(() => {
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark')
    })
    expect(screen.queryByRole('group', { name: 'Theme' })).toBe(null)
  })
})
