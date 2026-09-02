// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Shell } from './Shell'
import type { Profile } from '../auth/useProfile'

// The board reaches Supabase, and this file is about navigation rather than
// about the board. Stubbed to a fixed, harmless screen so a failed fetch cannot
// masquerade as a navigation failure.
vi.mock('../board/Board', () => ({ Board: () => <p>the board</p> }))
vi.mock('../clients/ClientsAdmin', () => ({ ClientsAdmin: () => <p>client roster</p> }))
vi.mock('../users/UsersAdmin', () => ({ UsersAdmin: () => <p>people and access</p> }))

afterEach(() => {
  document.body.innerHTML = ''
})

function profile(role: string): Profile {
  return {
    id: 'p1',
    email: 'josh@thegroundedcompany.com',
    role,
    is_active: true,
  } as Profile
}

function renderShell(role = 'admin') {
  return render(
    <Shell
      onSignOut={vi.fn()}
      onThemeChange={vi.fn()}
      preference="light"
      profile={profile(role)}
    />,
  )
}

describe('the shell', () => {
  // Spec §3.1: Clients, not Overview, while Overview is empty.
  it('lands on Clients', () => {
    renderShell()
    expect(screen.getByText('the board')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clients' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('carries the identity, the theme control and sign out', () => {
    renderShell()
    expect(document.body.textContent).toContain('josh@thegroundedcompany.com')
    expect(screen.getByRole('switch', { name: 'Dark mode' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('moves between destinations', async () => {
    renderShell()
    await userEvent.click(screen.getByRole('button', { name: 'Revenue' }))
    expect(document.body.textContent).toContain('data model')
    await userEvent.click(screen.getByRole('button', { name: 'Overview' }))
    expect(document.body.textContent).toContain('snapshot')
    await userEvent.click(screen.getByRole('button', { name: 'Clients' }))
    expect(screen.getByText('the board')).toBeTruthy()
  })

  it('opens Admin on People for an admin, who can see both sections', async () => {
    renderShell('admin')
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    expect(screen.getByText('people and access')).toBeTruthy()
  })

  // The case the whole of openDestination exists for.
  it('opens Admin on the client roster for an account manager', async () => {
    renderShell('account_manager')
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    expect(screen.getByText('client roster')).toBeTruthy()
    expect(screen.queryByText('people and access')).toBe(null)
  })

  it('offers an admin both sections and lets them switch', async () => {
    renderShell('admin')
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    await userEvent.click(screen.getByRole('button', { name: 'Clients roster' }))
    expect(screen.getByText('client roster')).toBeTruthy()
  })

  // An account manager has one section, so a switcher would be a control with
  // nothing to control -- the same argument Board.tsx makes about not drawing
  // the view toggle on an empty roster.
  it('draws no section switcher when there is only one section', async () => {
    renderShell('account_manager')
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    expect(screen.queryByRole('button', { name: 'Clients roster' })).toBe(null)
  })

  it('never shows Admin to a viewer', () => {
    renderShell('viewer')
    expect(screen.queryByRole('button', { name: 'Admin' })).toBe(null)
  })

  // Carried over from Board.test.tsx's `reaching the clients admin`, which this
  // slice deletes (Step 6b). Those tests encoded a real requirement in their
  // names -- "which is when it is needed most", "so the screen is not a dead
  // end" -- and the requirement outlives the four copies of adminLink that used
  // to satisfy it. The bar is drawn by the shell, ABOVE whatever the destination
  // renders, so it survives a board that is empty or broken by construction
  // rather than by repetition. Asserted here so that stays true.
  it('draws the bar above the destination, whatever the destination does', () => {
    renderShell()
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Admin' })).toBeTruthy()
  })

  // Spec §4: new behaviour, and worth pinning. The check-in screen used to
  // return before the navigation was even defined, so Back was the only way out
  // of it. Board renders inside the shell's <main>, so its early return replaces
  // only its own output and the bar stays -- which is safe specifically because
  // draftCache.ts writes every keystroke to local storage as it happens.
  it('keeps the bar reachable while the board shows a sub-screen', () => {
    renderShell()
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy()
    expect(screen.getByText('the board')).toBeTruthy()
  })
})
