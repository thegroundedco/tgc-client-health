// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MenuBar } from './MenuBar'

afterEach(() => {
  document.body.innerHTML = ''
})

const CLIENTS = { kind: 'clients' } as const

describe('MenuBar', () => {
  it('is a labelled navigation landmark', () => {
    render(<MenuBar current={CLIENTS} onNavigate={vi.fn()} role="admin" />)
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy()
  })

  it('shows all four destinations to an admin', () => {
    render(<MenuBar current={CLIENTS} onNavigate={vi.fn()} role="admin" />)
    for (const label of ['Overview', 'Clients', 'Revenue', 'Admin']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  // An account manager holds manage_clients but not manage_users, so Admin is
  // still theirs -- it just opens on the one section they have.
  it('still shows Admin to an account manager', () => {
    render(<MenuBar current={CLIENTS} onNavigate={vi.fn()} role="account_manager" />)
    expect(screen.getByRole('button', { name: 'Admin' })).toBeTruthy()
  })

  it('hides Admin from a viewer, who has neither capability', () => {
    render(<MenuBar current={CLIENTS} onNavigate={vi.fn()} role="viewer" />)
    expect(screen.queryByRole('button', { name: 'Admin' })).toBe(null)
    expect(screen.getByRole('button', { name: 'Clients' })).toBeTruthy()
  })

  // aria-current="page" rather than aria-pressed: these are navigation, not
  // toggles, and a screen reader announces the current one without a person
  // having to work it out from the label.
  it('marks the destination currently showing, and only that one', () => {
    render(<MenuBar current={CLIENTS} onNavigate={vi.fn()} role="admin" />)
    expect(screen.getByRole('button', { name: 'Clients' }).getAttribute('aria-current')).toBe(
      'page',
    )
    for (const label of ['Overview', 'Revenue', 'Admin']) {
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-current')).toBe(null)
    }
  })

  it('marks Admin as current whichever section is open', () => {
    render(
      <MenuBar
        current={{ kind: 'admin', section: 'clients' }}
        onNavigate={vi.fn()}
        role="admin"
      />,
    )
    expect(screen.getByRole('button', { name: 'Admin' }).getAttribute('aria-current')).toBe('page')
  })

  it('reports the destination that was pressed', async () => {
    const onNavigate = vi.fn()
    render(<MenuBar current={CLIENTS} onNavigate={onNavigate} role="admin" />)
    await userEvent.click(screen.getByRole('button', { name: 'Revenue' }))
    expect(onNavigate).toHaveBeenCalledWith('revenue')
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('never submits a form', () => {
    render(<MenuBar current={CLIENTS} onNavigate={vi.fn()} role="admin" />)
    for (const label of ['Overview', 'Clients', 'Revenue']) {
      expect(screen.getByRole('button', { name: label }).getAttribute('type')).toBe('button')
    }
  })
})
