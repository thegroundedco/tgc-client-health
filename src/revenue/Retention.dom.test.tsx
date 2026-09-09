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
    // East Bay has no rows AT ALL, so the month missing is the base one.
    given({
      clients: [...CLIENTS, { id: 3, name: 'East Bay', started_on: '2020-01-01', ended_on: null }],
    })

    const basis = screen.getByTestId('retention-basis').textContent ?? ''
    expect(basis).toMatch(/2 of 3/)
    expect(basis).toMatch(/1 had no entry for September 2025/)
    expect(basis).not.toContain('no entry for September 2026')
  })

  it('names the CURRENT month when the current month is the one missing', () => {
    // The disclosure named the base month for both kinds of absence. East Bay
    // here has September 2025 in full and is missing September 2026 -- the very
    // month the owner has yet to type -- and the old sentence told him his 2025
    // was the gap. The month named must be the month actually absent.
    given({
      clients: [...CLIENTS, { id: 3, name: 'East Bay', started_on: '2020-01-01', ended_on: null }],
      rows: [...ROWS, { client_id: 3, period: '2025-09-01', retainer_cents: 300000 }],
    })

    const basis = screen.getByTestId('retention-basis').textContent ?? ''
    expect(basis).toMatch(/2 of 3/)
    expect(basis).toMatch(/1 had no entry for September 2026/)
    expect(basis).not.toContain('no entry for September 2025')
  })

  it('lists the biggest mover first', () => {
    given()

    const names = screen
      .getAllByTestId('retention-contribution-name')
      .map((node) => node.textContent)
    // Acme +1000.00, Delta -1000.00 -- equal size, so name breaks the tie.
    expect(names).toEqual(['Acme', 'Delta'])
  })

  it('shows the delta on each row, signed so a rise and a fall differ at a glance', () => {
    // Spec section 5 point 4. Without it the row is a bare before/after pair and
    // the ordering -- by ABSOLUTE delta, which spec section 4 calls "the answer
    // to why did it move" -- has no visible basis, so eleven rows read as an
    // arbitrary sequence. Acme rose $1,000 and Delta fell $1,000: the same size
    // in opposite directions, so an unsigned delta would print identically on
    // both and tell the reader nothing.
    given()

    const rows = screen
      .getAllByTestId('retention-contribution-name')
      .map((node) => node.closest('li')?.textContent ?? '')

    expect(rows[0]).toContain('Acme')
    expect(rows[0]).toContain('+$1,000')
    expect(rows[0]).not.toContain('-$1,000')

    expect(rows[1]).toContain('Delta')
    expect(rows[1]).toContain('-$1,000')
    expect(rows[1]).not.toContain('+$1,000')
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

  it('guards against calling retention() with a null period from an empty table', () => {
    // This is day one: no revenue has been entered yet. latestPeriod() returns
    // null on an empty table, and retention() cannot be called with it. The
    // early return prevents a type error at best and a crash at worst.
    given({ rows: [] })

    expect(screen.queryByTestId('retention-nrr')).toBeNull()
    expect(screen.queryByTestId('retention-grr')).toBeNull()
    expect(document.body.textContent).toContain('No retention yet')
    expect(document.body.textContent).toContain('no revenue has been entered')
  })
})
