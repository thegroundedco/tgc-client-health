// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Concentration } from './Concentration'

// No mock any more. Slice 6h moved this section onto the page's shared roster
// and revenue read, so it takes what it needs as props -- which means these
// tests exercise the real component against real data instead of a stubbed
// hook.
const CLIENTS = [
  { id: 1, name: 'Acme', status: 'active', started_on: '2020-01-01', ended_on: null },
  { id: 2, name: 'Delta', status: 'active', started_on: '2020-01-01', ended_on: null },
  { id: 3, name: 'East Bay', status: 'active', started_on: '2020-01-01', ended_on: null },
  { id: 4, name: 'Northgate', status: 'active', started_on: '2020-01-01', ended_on: null },
  { id: 5, name: 'Harbor Row', status: 'active', started_on: '2020-01-01', ended_on: null },
  { id: 6, name: 'Ivy Lane', status: 'active', started_on: '2020-01-01', ended_on: null },
]

function row(client_id: number, retainer_cents: number, period = '2026-09-01') {
  return { client_id, period, retainer_cents, project_cents: 0 }
}

const FULL = [
  row(1, 450000),
  row(2, 250000),
  row(3, 600000),
  row(4, 400000),
  row(5, 200000),
  row(6, 100000),
]

function given(
  over: {
    status?: 'loading' | 'ready' | 'error'
    loadError?: string
    clients?: typeof CLIENTS
    rows?: ReturnType<typeof row>[]
    from?: string
    to?: string
  } = {},
) {
  return render(
    <Concentration
      clients={over.clients ?? CLIENTS}
      from={over.from ?? '2026-09-01'}
      loadError={over.loadError ?? null}
      rows={over.rows ?? FULL}
      status={over.status ?? 'ready'}
      to={over.to ?? '2026-09-01'}
    />,
  )
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
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

  it('leaves a paused client out of the missing count', () => {
    // Two entered, one paused with no row: nobody is missing, so the missing
    // caption should not appear at all -- it renders only when somebody
    // actually owes a figure. The board says no check-in is expected from a
    // paused client; nobody owes a revenue figure for one either, and
    // production has one such client, so this count read one high every month.
    given({
      clients: [CLIENTS[0], CLIENTS[1], { ...CLIENTS[2], status: 'paused' }],
      rows: [row(1, 450000), row(2, 250000)],
    })

    expect(screen.queryByTestId('concentration-missing')).toBeNull()
  })

  it('still counts that same client as missing when they are active', () => {
    // The companion, so the test above cannot pass just because the caption
    // went away for some unrelated reason. Identical roster and identical rows,
    // with East Bay ACTIVE instead of paused: now somebody IS owed, and the
    // caption says so. The ONLY difference between the two tests is the status.
    given({
      clients: [CLIENTS[0], CLIENTS[1], CLIENTS[2]],
      rows: [row(1, 450000), row(2, 250000)],
    })

    expect(screen.getByTestId('concentration-missing').textContent).toContain('1 of 3')
  })

  it('does not call an all-paused roster an absence of clients', () => {
    // Introduced BY the paused fix and worth its own test. The empty-roster
    // sentence keys on the count of clients a figure is expected from, and
    // excluding paused clients from that count made "no clients were on the
    // books" reachable while clients existed -- they were merely all paused.
    // Remote (production is 10 active to 1 paused) and wrong, which is enough.
    given({ clients: [{ ...CLIENTS[0], status: 'paused' }], rows: [] })

    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/no clients/i)
    expect(text).toMatch(/has been entered/i)
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
