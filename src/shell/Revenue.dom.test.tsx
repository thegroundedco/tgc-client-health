// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../revenue/useTenure', () => ({ useTenure: vi.fn() }))
// Concentration now mounts on this page and owns its own useRevenue read.
// Left unmocked it would hit the real Supabase client during every test in
// this file -- including the ones that assert there is exactly one alert on
// screen -- so it gets the same seam as Concentration.dom.test.tsx, defaulted
// to a ready, empty read that renders nothing this file's assertions collide
// with.
vi.mock('../revenue/useRevenue', () => ({ useRevenue: vi.fn() }))
// Retention mounts on this page too, from this slice, and owns its own
// useRetention read exactly the way Concentration owns useRevenue -- same
// reason, same seam: left unmocked it would hit the real Supabase client on
// every test in this file.
vi.mock('../revenue/useRetention', () => ({ useRetention: vi.fn() }))

import { Revenue } from './Revenue'
import styles from './Revenue.module.css'
import { formatTenure, tenureDays, todayISO } from '../revenue/tenureMath'
import { useTenure } from '../revenue/useTenure'
import { useRevenue } from '../revenue/useRevenue'
import { useRetention } from '../revenue/useRetention'

beforeEach(() => {
  vi.mocked(useRevenue).mockReturnValue({
    status: 'ready',
    loadError: null,
    clients: [],
    rows: [],
    reload: vi.fn(),
  })
  vi.mocked(useRetention).mockReturnValue({
    status: 'ready',
    loadError: null,
    clients: [],
    rows: [],
    reload: vi.fn(),
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.mocked(useTenure).mockReset()
  vi.mocked(useRevenue).mockReset()
  vi.mocked(useRetention).mockReset()
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

  it('puts its five sections in the order the spec argues for', () => {
    // Slice 6d. The order is an argument, not an accident: what we are billing
    // and whether it is moving, then how much of last year we kept, then who we
    // are most exposed to, then how long clients stay and who left. Aggregate to
    // individual.
    //
    // Asserted as a SEQUENCE rather than as five presence checks, because the
    // reorder IS the deliverable -- Retention used to sit at the bottom, below
    // Churn, and it is the figure the owner reports upward. Five presence
    // assertions would pass with the old order intact.
    given()

    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((node) => node.textContent)
    expect(headings).toEqual(['Billing', 'Retention', 'Concentration', 'Tenure', 'Churn'])
  })

  it('names its four sections with the words a reader would search for', () => {
    // Discoverability, and it earned a test the hard way. The sections used to
    // be headed "Who we are most exposed to", "How long clients stay" and "Who
    // has left" -- accurate descriptions, and none of them the word anybody
    // actually holds in their head. The owner went looking for the
    // concentration report on the live site and concluded it had not shipped;
    // it was the first section on the page.
    //
    // Pinned here rather than in the four component tests because the thing
    // being guaranteed is a property of the PAGE: these four, together,
    // present. A per-component assertion would still pass with a section
    // dropped from Revenue.tsx entirely.
    given()

    expect(screen.getByRole('heading', { name: 'Concentration' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Tenure' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Churn' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Retention' })).toBeTruthy()
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

  it('no longer says retention is waiting for a data model', () => {
    // The page apologised for retention from slice 6b until this slice shipped
    // it. That paragraph named a date derived from the entry screen's six-month
    // reach, and it has been wrong since the backfill landed -- the third time
    // a sentence on this page went stale because the data moved underneath it.
    given()

    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/not here yet/i)
    expect(text).not.toMatch(/April 2027/i)
  })

  it('says it is loading rather than showing an empty report', () => {
    given({ status: 'loading', clients: [ACTIVE, GONE] })

    expect(screen.getByText(/loading/i)).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Tenure' })).toBe(null)
  })

  // The "no percentage anywhere on this page" guard that lived here moved to
  // tests/revenueLiterals.test.ts, source-level rather than rendered-output.
  // Spec section 9's amendment: an exact share of a complete period is now
  // allowed on this page (Concentration says one), so a DOM regex can no
  // longer forbid every digit-percent -- it would have to bless Concentration's
  // true "30% of September" and a fabricated "91.2% GRR" alike. See
  // tests/revenueLiterals.test.ts for the guard this replaced it with.

  // A failed read must never fall through to a screen that looks merely empty.
  it('shows a failed read as an error, not as an empty roster', () => {
    given({ status: 'error', loadError: 'permission denied', clients: [ACTIVE, GONE] })

    expect(screen.getByRole('alert').textContent).toContain('permission denied')
    expect(screen.queryByRole('list', { name: 'Tenure' })).toBe(null)
  })

  // The page is a two-column grid on a wide viewport (tests/revenueLayout.
  // test.ts asserts the stylesheet); these assert the wiring, which is the
  // half a stylesheet cannot check. Everything that is NOT one of the four
  // paired sections has to opt into spanning both columns, and the failure
  // mode of forgetting is silent: the element takes a single grid cell and
  // shunts a section into the other one, leaving the page looking shuffled
  // with nothing broken.
  it('spans the heading and the chart across both columns', () => {
    given()

    expect(screen.getByRole('heading', { name: 'Revenue' }).className).toContain(
      styles.wide,
    )
    // Billing's own <section> is not the grid item -- its wrapper is. Anchored
    // on the heading rather than the <svg>, because with no rows Billing
    // renders its "nothing to chart" branch and draws no svg at all; the
    // wrapper has to span either way.
    const billing = screen.getByRole('heading', { name: 'Billing' }).closest('section')
    expect(billing?.parentElement?.className ?? '').toContain(styles.wide)
  })

  it('spans a load state and an error across both columns too', () => {
    given({ status: 'loading', clients: [] })
    expect(screen.getByText(/loading/i).className).toContain(styles.wide)

    document.body.innerHTML = ''
    given({ status: 'error', loadError: 'permission denied', clients: [] })
    expect(screen.getByRole('alert').className).toContain(styles.wide)
  })

  // The other half of the same rule. A paired section carrying the span class
  // would take the full width and push its partner onto its own row -- the
  // pairing quietly not happening, which is the defect this whole slice fixes.
  it('leaves the four paired sections in single columns', () => {
    given()

    for (const name of ['Retention', 'Concentration', 'Tenure', 'Churn']) {
      const heading = screen.getByRole('heading', { name })
      const section = heading.closest('section')
      expect(section).not.toBeNull()
      expect(section?.className ?? '').not.toContain(styles.wide)
    }
  })
})
