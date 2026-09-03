// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../revenue/useTenure', () => ({ useTenure: vi.fn() }))

import { Revenue } from './Revenue'
import { useTenure } from '../revenue/useTenure'

afterEach(() => {
  document.body.innerHTML = ''
  vi.mocked(useTenure).mockReset()
})

const ACTIVE = {
  id: 1,
  name: 'Acme',
  status: 'active',
  started_on: '2026-01-01',
  ended_on: null,
  end_reason_code: null,
  end_reason_note: null,
}

const GONE = {
  id: 2,
  name: 'Delta',
  status: 'former',
  started_on: null,
  ended_on: '2026-08-25',
  end_reason_code: 'other',
  end_reason_note: null,
}

function given(over: Partial<ReturnType<typeof useTenure>> = {}) {
  vi.mocked(useTenure).mockReturnValue({
    status: 'ready',
    loadError: null,
    clients: [ACTIVE, GONE],
    reload: vi.fn(),
    ...over,
  })
  return render(<Revenue />)
}

describe('the Revenue destination', () => {
  it('names itself', () => {
    given()

    expect(screen.getByRole('heading', { name: 'Revenue' })).toBeTruthy()
  })

  it('shows both halves once the read lands', async () => {
    given()

    await waitFor(() => expect(screen.getByRole('list', { name: 'Tenure' })).toBeTruthy())
    expect(screen.getByRole('list', { name: 'Departures' })).toBeTruthy()
  })

  it('puts the current clients in tenure and the departed in the ledger', () => {
    given()

    expect(screen.getByRole('list', { name: 'Tenure' }).textContent).toContain('Acme')
    expect(screen.getByRole('list', { name: 'Tenure' }).textContent).not.toContain('Delta')
    expect(screen.getByRole('list', { name: 'Departures' }).textContent).toContain('Delta')
  })

  // The paragraph that was on this page before the report existed. It is still
  // true -- revenue retention needs a history of monthly amounts, which one
  // editable retainer field cannot produce -- and it is the reminder the owner
  // asked to keep in front of him. Spec §7.
  it('keeps saying what is still missing and why', () => {
    given()

    expect(document.body.textContent).toContain('data model')
  })

  it('says it is loading rather than showing an empty report', () => {
    given({ status: 'loading', clients: [] })

    expect(screen.getByText(/loading/i)).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Tenure' })).toBe(null)
  })

  // A failed read must never fall through to a screen that looks merely empty.
  it('shows a failed read as an error, not as an empty roster', () => {
    given({ status: 'error', loadError: 'permission denied', clients: [] })

    expect(screen.getByRole('alert').textContent).toContain('permission denied')
    expect(screen.queryByRole('list', { name: 'Tenure' })).toBe(null)
  })
})
