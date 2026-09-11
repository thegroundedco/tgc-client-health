// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./useRetention', () => ({ useRetention: vi.fn() }))

import { Retention } from './Retention'
import { useRetention } from './useRetention'

const CLIENTS = [
  { id: 1, name: 'Acme', status: 'active', started_on: '2020-01-01', ended_on: null, end_reason_code: null },
  { id: 2, name: 'Delta', status: 'active', started_on: '2020-01-01', ended_on: null, end_reason_code: null },
]

const ROWS = [
  { client_id: 1, period: '2025-09-01', retainer_cents: 400000, project_cents: 0 },
  { client_id: 1, period: '2026-09-01', retainer_cents: 500000, project_cents: 0 },
  { client_id: 2, period: '2025-09-01', retainer_cents: 200000, project_cents: 0 },
  { client_id: 2, period: '2026-09-01', retainer_cents: 100000, project_cents: 0 },
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
  return render(<Retention read={vi.mocked(useRetention)()} />)
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
      clients: [...CLIENTS, { id: 3, name: 'East Bay', status: 'active', started_on: '2020-01-01', ended_on: null, end_reason_code: null }],
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
      clients: [...CLIENTS, { id: 3, name: 'East Bay', status: 'active', started_on: '2020-01-01', ended_on: null, end_reason_code: null }],
      rows: [...ROWS, { client_id: 3, period: '2025-09-01', retainer_cents: 300000, project_cents: 0 }],
    })

    const basis = screen.getByTestId('retention-basis').textContent ?? ''
    expect(basis).toMatch(/2 of 3/)
    expect(basis).toMatch(/1 had no entry for September 2026/)
    expect(basis).not.toContain('no entry for September 2025')
  })

  // The contributions fold as of slice 6f-2, so these two open the disclosure
  // before asserting. The assertions themselves are unchanged -- the list's
  // ordering and its signed deltas are still pinned exactly as before.
  it('lists the biggest mover first', () => {
    given()

    fireEvent.click(screen.getByRole('button', { name: /show what moved/i }))

    const names = screen
      .getAllByTestId('retention-contribution-name')
      .map((node) => node.textContent)
    // Acme +1000.00, Delta -1000.00 -- equal size, so name breaks the tie.
    expect(names).toEqual(['Acme', 'Delta'])
  })

  it('splits the movement into expansion, contraction and churn, each labelled', () => {
    // Spec section 5 point 2, and it was rendered with nothing pinning it: no
    // test in the suite named retention-movement, expansion, contraction or
    // churnedCents, so transposing two of the words -- or deleting the
    // paragraph outright -- left all 1141 tests green while the screen lied or
    // lost an element. The three amounts here are deliberately different from
    // one another ($2,000 / $3,000 / $4,000) so that a swapped pair cannot
    // still match.
    given({
      clients: [
        { id: 1, name: 'Up', status: 'active', started_on: '2020-01-01', ended_on: null, end_reason_code: null },
        { id: 2, name: 'Down', status: 'active', started_on: '2020-01-01', ended_on: null, end_reason_code: null },
        { id: 3, name: 'Gone', status: 'active', started_on: '2020-01-01', ended_on: '2026-01-31', end_reason_code: null },
      ],
      rows: [
        { client_id: 1, period: '2025-09-01', retainer_cents: 100000, project_cents: 0 },
        { client_id: 1, period: '2026-09-01', retainer_cents: 300000, project_cents: 0 },
        { client_id: 2, period: '2025-09-01', retainer_cents: 500000, project_cents: 0 },
        { client_id: 2, period: '2026-09-01', retainer_cents: 200000, project_cents: 0 },
        { client_id: 3, period: '2025-09-01', retainer_cents: 400000, project_cents: 0 },
      ],
    })

    const movement = screen.getByTestId('retention-movement').textContent ?? ''

    expect(movement).toContain('$2,000 expansion')
    expect(movement).toContain('$3,000 contraction')
    expect(movement).toContain('$4,000 churn')
    // In that order, which is the order spec section 5 point 2 states.
    expect(movement).toMatch(/expansion.*contraction.*churn/)
    // Contraction and churn are held signed in the arithmetic (spec section 4)
    // and shown as magnitudes beside their own word. A minus reaching the
    // screen would read as a double negative.
    expect(movement).not.toContain('-$')
  })

  it('shows the delta on each row, signed so a rise and a fall differ at a glance', () => {
    // Spec section 5 point 4. Without it the row is a bare before/after pair and
    // the ordering -- by ABSOLUTE delta, which spec section 4 calls "the answer
    // to why did it move" -- has no visible basis, so eleven rows read as an
    // arbitrary sequence. Acme rose $1,000 and Delta fell $1,000: the same size
    // in opposite directions, so an unsigned delta would print identically on
    // both and tell the reader nothing.
    given()

    fireEvent.click(screen.getByRole('button', { name: /show what moved/i }))

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
    given({ rows: [{ client_id: 1, period: '2026-09-01', retainer_cents: 400000, project_cents: 0 }] })

    expect(screen.queryByTestId('retention-nrr')).toBeNull()
    expect(document.body.textContent).toMatch(/not enough history|no retention/i)
  })

  it('says the roster is empty rather than blaming the base month', () => {
    // Concentration.tsx solved this identical trap first and its comment says
    // the sentence "must not be borrowed". An empty roster with revenue on file
    // leaves baseCents at 0, so without its own branch the page reads
    // "September 2025 has no entered revenue" -- which sends the reader off to
    // enter a month for clients who do not exist, when what they are actually
    // looking at is an empty roster (a broken eligibility filter, most likely).
    given({ clients: [], rows: ROWS })

    expect(screen.queryByTestId('retention-nrr')).toBeNull()
    expect(document.body.textContent).toContain('No clients were on the books')
    expect(document.body.textContent).not.toContain('has no entered revenue')
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

// A full thirteen months for both clients, so every window has a base month
// to measure against. The file's other fixture holds only the two anchor
// months, which is right for testing the classification rule and useless for
// testing a window control.
const MONTHLY = (() => {
  const rows = []
  for (let i = 0; i < 13; i++) {
    const total = 2025 * 12 + 8 + i
    const period = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
    rows.push({ client_id: 1, period, retainer_cents: 400000 + i * 10000, project_cents: 0 })
    rows.push({ client_id: 2, period, retainer_cents: 200000, project_cents: 0 })
  }
  return rows
})()

function givenMonthly() {
  vi.mocked(useRetention).mockReturnValue({
    status: 'ready',
    loadError: null,
    clients: CLIENTS,
    rows: MONTHLY,
    reload: vi.fn(),
  })
  return render(<Retention read={vi.mocked(useRetention)()} />)
}

describe('Retention — the controls, slice 6f-2', () => {
  it('offers the four windows the owner chose, with twelve months selected', () => {
    givenMonthly()

    const group = screen.getByRole('group', { name: /window/i })
    expect(
      [...group.querySelectorAll('button')].map((node) => node.textContent),
    ).toEqual(['1 mo', '3 mo', '6 mo', '12 mo'])
    expect(screen.getByRole('button', { name: '12 mo' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('measures against the chosen window rather than always a year', async () => {
    const user = userEvent.setup()
    givenMonthly()

    expect(screen.getByTestId('retention-window').textContent).toContain('September 2025')

    await user.click(screen.getByRole('button', { name: '1 mo' }))

    expect(screen.getByTestId('retention-window').textContent).toContain('August 2026')
  })

  // 6f-1 trap 1. Cautioned, never refused -- the month panel already prints a
  // one-month rate, so refusing it here would be two rules for one number.
  it('cautions a short window instead of refusing it', async () => {
    const user = userEvent.setup()
    givenMonthly()

    expect(screen.queryByTestId('retention-caution')).toBeNull()

    await user.click(screen.getByRole('button', { name: '3 mo' }))

    expect(screen.getByTestId('retention-caution')).toBeTruthy()
    // And it still shows a figure. Cautioned is not refused.
    expect(screen.getByTestId('retention-nrr')).toBeTruthy()
  })

  it('does not caution six months or twelve', async () => {
    const user = userEvent.setup()
    givenMonthly()

    await user.click(screen.getByRole('button', { name: '6 mo' }))

    expect(screen.queryByTestId('retention-caution')).toBeNull()
  })

  it('swaps which rate is the headline, and hides NEITHER', async () => {
    // The owner's boss: "Net is most important, but we still want visibility
    // into gross." A control that lets the section be screenshotted with no
    // net figure anywhere defeats that.
    const user = userEvent.setup()
    givenMonthly()

    expect(screen.getByTestId('retention-nrr').textContent).toContain('net')

    await user.click(screen.getByRole('button', { name: /^gross$/i }))

    expect(screen.getByTestId('retention-headline').textContent).toContain('gross')
    expect(screen.getByTestId('retention-secondary').textContent).toContain('net')
  })

  it('shows the movement as a bar as well as in words', () => {
    givenMonthly()

    expect(screen.getByTestId('retention-movement-bar')).toBeTruthy()
    expect(screen.getByTestId('retention-movement').textContent).toContain('expansion')
  })

  it('keeps the basis sentence visible rather than folding it away', () => {
    // Spec 6f-2 §6.1. Slice 6e §3.1 established the sentence must travel WITH
    // the rate; folding it one slice later would contradict that.
    givenMonthly()

    expect(screen.getByTestId('retention-basis')).toBeTruthy()
  })

  // 6f-1 trap 2. Excluding every departure parks NRR above 100% forever.
  it('excludes only departures that were not losses, and says it did', async () => {
    const user = userEvent.setup()
    vi.mocked(useRetention).mockReturnValue({
      status: 'ready',
      loadError: null,
      clients: [
        ...CLIENTS,
        {
          id: 3,
          name: 'We Ended It',
          status: 'cancelled',
          started_on: '2020-01-01',
          ended_on: '2026-05-01',
          end_reason_code: 'agency_initiated',
        },
      ],
      rows: [...MONTHLY, { client_id: 3, period: '2025-09-01', retainer_cents: 300000, project_cents: 0 }],
      reload: vi.fn(),
    })
    render(<Retention read={vi.mocked(useRetention)()} />)
    await user.click(screen.getByRole('button', { name: /show what moved/i }))

    expect(screen.getByText('We Ended It')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /ignore ended by us/i }))

    expect(screen.queryByText('We Ended It')).toBeNull()
    // And it must not present itself as plain retention afterwards.
    expect(screen.getByTestId('retention-excluding').textContent).toMatch(/1 departure/i)
  })

  it('keeps a departure that WAS a loss when the toggle is on', async () => {
    const user = userEvent.setup()
    vi.mocked(useRetention).mockReturnValue({
      status: 'ready',
      loadError: null,
      clients: [
        ...CLIENTS,
        {
          id: 3,
          name: 'Left On Price',
          status: 'cancelled',
          started_on: '2020-01-01',
          ended_on: '2026-05-01',
          end_reason_code: 'price',
        },
      ],
      rows: [...MONTHLY, { client_id: 3, period: '2025-09-01', retainer_cents: 300000, project_cents: 0 }],
      reload: vi.fn(),
    })
    render(<Retention read={vi.mocked(useRetention)()} />)

    await user.click(screen.getByRole('button', { name: /ignore ended by us/i }))
    await user.click(screen.getByRole('button', { name: /show what moved/i }))

    expect(screen.getByText('Left On Price')).toBeTruthy()
  })
})
