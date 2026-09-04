// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./useRevenue', () => ({ useRevenue: vi.fn() }))

import { Concentration } from './Concentration'
import { useRevenue } from './useRevenue'

const CLIENTS = [
  { id: 1, name: 'Acme' },
  { id: 2, name: 'Delta' },
  { id: 3, name: 'East Bay' },
  { id: 4, name: 'Northgate' },
  { id: 5, name: 'Harbor Row' },
  { id: 6, name: 'Ivy Lane' },
]

function row(client_id: number, retainer_cents: number) {
  return { client_id, period: '2026-09-01', retainer_cents, project_cents: 0 }
}

const FULL = [
  row(1, 450000),
  row(2, 250000),
  row(3, 600000),
  row(4, 400000),
  row(5, 200000),
  row(6, 100000),
]

function given(over: Partial<ReturnType<typeof useRevenue>> = {}) {
  vi.mocked(useRevenue).mockReturnValue({
    status: 'ready',
    loadError: null,
    clients: CLIENTS,
    rows: FULL,
    reload: vi.fn(),
    ...over,
  })
  return render(<Concentration month="2026-09-01" />)
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.mocked(useRevenue).mockReset()
})

describe('concentration', () => {
  it('names the month it is describing', () => {
    // Without it the figures are undated, and this component is mounted beside
    // two others that describe a different span entirely.
    given()

    expect(document.body.textContent).toContain('September 2026')
  })

  it('ranks the named clients largest first, with amounts', () => {
    given()

    const names = screen
      .getAllByTestId('concentration-name')
      .map((node) => node.textContent)
    expect(names).toEqual(['East Bay', 'Acme', 'Northgate', 'Delta'])
    expect(document.body.textContent).toContain('$6,000')
  })

  it('shows a share as an exact percentage of the month', () => {
    // Allowed by the section 9 amendment: a share of a COMPLETE month,
    // computed from complete data and inferred from nothing. East Bay is
    // 600000 of 2000000, which is exactly 30%.
    given()

    expect(document.body.textContent).toMatch(/30%/)
  })

  it('shows percentages that sum to exactly 100, not 101 or 99', () => {
    // The bug this guards: rounding each row's share independently
    // (Math.round(share * 100) per row) sends the FULL fixture's column to
    // 101 -- Acme's 22.5 and Delta's 12.5 both round up on the .5 boundary
    // with nothing to reconcile the total against. Reading every percentage
    // off the actual rendered page, rather than re-deriving the figure by
    // hand, is what would have caught it: a hand-computed expectation shares
    // the same rounding mistake as the code under test.
    given()

    const points = [...document.body.textContent!.matchAll(/(\d+)%/g)].map((match) =>
      Number(match[1]),
    )

    expect(points.length).toBeGreaterThan(0)
    expect(points.reduce((sum, value) => sum + value, 0)).toBe(100)
  })

  it('collapses the tail into one row naming how many', () => {
    given()

    // Six eligible, four named, so two collapse -- and the row says two rather
    // than listing them, which is the difference between showing exposure and
    // ranking a roster.
    expect(document.body.textContent).toContain('2 others')
  })

  it('says how many clients the month is missing rather than omitting them silently', () => {
    // Spec section 7. A chart that quietly drops three unentered clients
    // overstates every share it draws, and looks exactly like a complete one.
    given({ rows: [row(1, 450000), row(3, 600000)] })

    expect(document.body.textContent).toContain('4 of 6')
  })

  it('excludes an unentered client from the ranking entirely', () => {
    // The other half: not merely counted as missing, but absent from the bars,
    // because a bar at zero reads as a client who billed nothing.
    given({ rows: [row(1, 450000), row(3, 600000)] })

    const names = screen
      .getAllByTestId('concentration-name')
      .map((node) => node.textContent)
    expect(names).toEqual(['East Bay', 'Acme'])
  })

  it('says a month nobody has entered is unentered, not that everyone billed zero', () => {
    // The empty state. Rendered as zeroes this reads as total collapse of the
    // business, which is the single most alarming way this page could lie.
    given({ rows: [] })

    expect(document.body.textContent).toMatch(/not been entered|nothing entered|no revenue entered/i)
    expect(document.body.textContent).not.toMatch(/\d+%/)
  })

  it('distinguishes having no clients from having no entries', () => {
    // Both states satisfy `entered === 0`, and until now both rendered the
    // same sentence. They are different facts and they point at different
    // actions: "nobody has entered September yet" sends a person to the entry
    // screen, which is right when there ARE clients waiting. With an EMPTY
    // roster that sentence is a wrong instruction -- there is nothing to enter
    // and the entry grid would be blank too.
    //
    // It also matters because of HOW an empty roster arises. The eligibility
    // filter in useRevenue returns nothing at all if its `ended_on.is.null`
    // arm is ever lost, which is a live mutation covered in that hook's own
    // tests -- and this page saying "no revenue has been entered" would send
    // the reader hunting for missing data entry instead of a bug.
    given({ clients: [], rows: [] })

    const text = document.body.textContent ?? ''
    expect(text).toMatch(/no clients/i)
    expect(text).not.toMatch(/has been entered/i)
  })

  it('shows a failed read as an error rather than an empty chart', () => {
    given({ status: 'error', loadError: 'permission denied', clients: [], rows: [] })

    expect(screen.getByRole('alert').textContent).toContain('permission denied')
  })

  it('says it is loading rather than drawing an empty chart', () => {
    given({ status: 'loading', clients: [], rows: [] })

    expect(screen.getByText(/loading/i)).toBeTruthy()
  })
})
