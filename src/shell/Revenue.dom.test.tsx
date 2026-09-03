// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../revenue/useTenure', () => ({ useTenure: vi.fn() }))

import { Revenue } from './Revenue'
import { formatTenure, tenureDays, todayISO } from '../revenue/tenureMath'
import { useTenure } from '../revenue/useTenure'

afterEach(() => {
  document.body.innerHTML = ''
  vi.mocked(useTenure).mockReset()
})

// Started in 2020, deliberately, and far enough back that the tenure it
// produces is nowhere near any of formatTenure's boundaries -- so the asOf
// tripwire below is measuring the wiring, not sitting on the edge of a
// rounding rule that could flip between one run and the next.
const ACTIVE = {
  id: 1,
  name: 'Acme',
  status: 'active',
  started_on: '2020-01-01',
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

  // THE tripwire for `asOf`. Revenue.tsx computes `asOf` itself (`todayISO()`)
  // rather than taking it as a prop, and nothing else here checks a measurement
  // -- only client names -- so a broken `asOf` rendered every list correctly
  // while every number on it was nonsense, and no test noticed.
  //
  // The expected string is DERIVED from todayISO() rather than written out.
  // That is deliberate, and it is the whole point: a literal like /\d+ yr/
  // passes against any hardcoded date in the last few years -- freezing `asOf`
  // to '2023-06-15' left the entire suite green -- so it proved only that the
  // epoch was not grossly wrong, never that the page measures against TODAY.
  //
  // Deriving it does mean this test shares tenureMath's arithmetic with the
  // component and so cannot catch an arithmetic bug. It is not meant to:
  // tenureMath.test.ts owns the arithmetic, against hand-computed values. What
  // only this test can see is the WIRING -- that Revenue.tsx asks for the
  // current day instead of freezing or fabricating one -- and a derived
  // expectation is exactly what makes a frozen date fail here.
  it('measures tenure against today, not against a date frozen into the page', () => {
    const expected = formatTenure(tenureDays(ACTIVE.started_on, todayISO()))

    given()

    expect(screen.getByRole('list', { name: 'Tenure' }).textContent).toContain(expected)
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
    given({ status: 'loading', clients: [ACTIVE, GONE] })

    expect(screen.getByText(/loading/i)).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Tenure' })).toBe(null)
  })

  // Spec §6 forbids a percentage anywhere on this page, not just inside Churn.
  // Churn.dom.test.tsx already guards its own component, but that guard is
  // scoped there -- a percentage added to Tenure.tsx, or to Revenue.tsx's own
  // markup, would pass every existing test. Overview carries the same
  // page-level guard at src/shell/pages.dom.test.tsx for the same reason.
  it('renders no percentage anywhere on the page', () => {
    given()

    expect(document.body.textContent).not.toMatch(/\d\s*%/)
  })

  // A failed read must never fall through to a screen that looks merely empty.
  it('shows a failed read as an error, not as an empty roster', () => {
    given({ status: 'error', loadError: 'permission denied', clients: [ACTIVE, GONE] })

    expect(screen.getByRole('alert').textContent).toContain('permission denied')
    expect(screen.queryByRole('list', { name: 'Tenure' })).toBe(null)
  })
})
