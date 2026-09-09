// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./useRetention', () => ({ useRetention: vi.fn() }))

import { Retention } from './Retention'
import { useRetention } from './useRetention'

const CLIENTS = [
  { id: 1, name: 'Acme', started_on: '2020-01-01', ended_on: null },
  { id: 2, name: 'Delta', started_on: '2020-01-01', ended_on: null },
]

const ROWS = [
  { client_id: 1, period: '2025-09-01', retainer_cents: 400000 },
  { client_id: 1, period: '2026-09-01', retainer_cents: 500000 },
  { client_id: 2, period: '2025-09-01', retainer_cents: 200000 },
  { client_id: 2, period: '2026-09-01', retainer_cents: 100000 },
]

function given(over: Partial<ReturnType<typeof useRetention>> = {}) {
  vi.mocked(useRetention).mockReturnValue({
    status: 'ready',
    loadError: null,
    clients: CLIENTS,
    rows: ROWS,
    reload: vi.fn(),
    ...over,
  })
  return render(<Retention />)
}

beforeEach(() => vi.mocked(useRetention).mockReset())
afterEach(() => {
  document.body.innerHTML = ''
})

describe('Retention', () => {
  it('names itself with the word a reader searches for', () => {
    given()

    expect(screen.getByRole('heading', { name: 'Retention' })).toBeTruthy()
  })

  it('leads with net and shows gross beside it', () => {
    // The owner's ruling: "Net is most important, but we still want visibility
    // into gross." Both present; NRR is the headline.
    given()

    // 600000 / 600000 = 100%; capped 400000 + 100000 = 500000 / 600000 = 83%
    expect(screen.getByTestId('retention-nrr').textContent).toContain('100%')
    expect(screen.getByTestId('retention-grr').textContent).toContain('83%')
  })

  it('names both months rather than implying them', () => {
    given()

    const text = document.body.textContent ?? ''
    expect(text).toContain('September 2026')
    expect(text).toContain('September 2025')
  })

  it('discloses how many clients the figure is based on', () => {
    // The disclosure travels WITH the number, not as a footnote. An unentered
    // client silently shrinking the denominator is the failure this prevents.
    given({
      clients: [...CLIENTS, { id: 3, name: 'East Bay', started_on: '2020-01-01', ended_on: null }],
    })

    expect(screen.getByTestId('retention-basis').textContent).toMatch(/2 of 3/)
    expect(screen.getByTestId('retention-basis').textContent).toMatch(/no entry/i)
  })

  it('lists the biggest mover first', () => {
    given()

    const names = screen
      .getAllByTestId('retention-contribution-name')
      .map((node) => node.textContent)
    // Acme +1000.00, Delta -1000.00 -- equal size, so name breaks the tie.
    expect(names).toEqual(['Acme', 'Delta'])
  })

  it('renders no rate at all when the base month is empty', () => {
    // Spec 4.1. No NaN%, no 0% -- a number nobody can stand behind is not shown.
    given({ rows: [{ client_id: 1, period: '2026-09-01', retainer_cents: 400000 }] })

    expect(screen.queryByTestId('retention-nrr')).toBeNull()
    expect(document.body.textContent).toMatch(/not enough history|no retention/i)
  })

  it('says it is loading rather than showing an empty report', () => {
    given({ status: 'loading' })

    expect(document.body.textContent).toMatch(/loading/i)
  })

  it('shows a failed read as an error, not as a year of no revenue', () => {
    given({ status: 'error', loadError: 'permission denied' })

    expect(screen.getByRole('alert').textContent).toContain('permission denied')
  })
})
