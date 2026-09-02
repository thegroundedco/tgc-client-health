// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddClientPanel } from './AddClientPanel'

// useClients reaches Supabase on mount. Stubbed to the four things the form
// actually consumes, so this file tests the panel rather than the network.
vi.mock('./useClients', () => ({
  useClients: () => ({
    owners: [{ id: 'p1', label: 'Josh' }],
    addState: { kind: 'idle' },
    addClient: vi.fn(),
    resetAdd: vi.fn(),
  }),
}))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('AddClientPanel', () => {
  it('shows the same add form the admin screen uses', () => {
    render(<AddClientPanel onClose={vi.fn()} />)
    expect(screen.getByLabelText(/name/i)).toBeTruthy()
  })

  // The panel is mounted only while it is open, and that is the whole reason it
  // is a component rather than a branch inside Board: useClients fetches on
  // mount, and a hook cannot be called conditionally. Mounting on demand is what
  // keeps the Clients tab from paying for a form nobody opened.
  it('closes when asked', async () => {
    const onClose = vi.fn()
    render(<AddClientPanel onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
