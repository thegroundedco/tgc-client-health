// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hoursFromBudgets } from './hoursFromBudgets'
import type { BudgetRow, HoursResult } from './hoursFromBudgets'
import { HoursBox } from './HoursBox'

// Results come from the real rule, not hand-written objects, so a note the
// box compares against cannot drift from the note the rule emits.
const OCT = '2026-10-01'
const AFTER = '2026-11-04'
function budget(over: Partial<BudgetRow> = {}): BudgetRow {
  return {
    productive_deal_id: 'd1',
    name: 'Budget A',
    starts_on: '2026-10-01',
    ends_on: '2026-10-31',
    budgeted_minutes: 1200,
    worked_minutes: 1200,
    ...over,
  }
}
function result(over: Partial<Parameters<typeof hoursFromBudgets>[0]> = {}): HoursResult {
  return hoursFromBudgets({ period: OCT, today: AFTER, linked: true, fetched: true, budgets: [budget()], ...over })
}
function setup(r: HoursResult) {
  const onRetry = vi.fn()
  const view = render(<HoursBox onRetry={onRetry} result={r} />)
  return { onRetry, view }
}

describe('HoursBox', () => {
  afterEach(cleanup)

  it('draws one row per budget with budgeted, worked and the signed difference', () => {
    setup(result({ budgets: [budget({ budgeted_minutes: 1200, worked_minutes: 1290 })] }))
    const rows = screen.getAllByTestId('hours-line')
    expect(rows).toHaveLength(1)
    const row = within(rows[0])
    expect(row.getByText('Budget A')).toBeTruthy()
    expect(row.getByText('20h budgeted')).toBeTruthy()
    expect(row.getByText('21.5h worked')).toBeTruthy()
    expect(row.getByText('+1.5h')).toBeTruthy()
  })

  it('writes an under-budget difference with a minus sign', () => {
    setup(result({ budgets: [budget({ budgeted_minutes: 1200, worked_minutes: 1170 })] }))
    expect(within(screen.getByTestId('hours-line')).getByText('−0.5h')).toBeTruthy()
  })

  it('renders Outside ±6h for a flagged line, and not for an unflagged one', () => {
    setup(
      result({
        budgets: [
          budget({ productive_deal_id: 'd1', name: 'Budget A', worked_minutes: 1200 + 361 }),
          budget({ productive_deal_id: 'd2', name: 'Budget B', worked_minutes: 1200 + 360 }),
        ],
      }),
    )
    const [a, b] = screen.getAllByTestId('hours-line')
    expect(within(a).getByText('Budget A')).toBeTruthy()
    expect(within(a).queryByText('Outside ±6h')).not.toBeNull()
    expect(within(b).getByText('Budget B')).toBeTruthy()
    expect(within(b).queryByText('Outside ±6h')).toBeNull()
    expect(screen.getAllByText('Outside ±6h')).toHaveLength(1)
  })

  it('renders the two-budget note', () => {
    setup(result({ budgets: [budget({ productive_deal_id: 'd1' }), budget({ productive_deal_id: 'd2', name: 'Budget B' })] }))
    expect(screen.getByText('2 monthly budgets – tidy up in Productive')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('renders No fixed monthly budget', () => {
    setup(result({ budgets: [] }))
    expect(screen.getByText('No fixed monthly budget')).toBeTruthy()
    expect(screen.queryAllByTestId('hours-line')).toHaveLength(0)
  })

  it('renders Not linked to Productive', () => {
    setup(result({ linked: false }))
    expect(screen.getByText('Not linked to Productive')).toBeTruthy()
  })

  it('renders nothing before the start month', () => {
    const { view } = setup(result({ period: '2026-09-01' }))
    expect(view.container.textContent).toBe('')
  })

  it('renders Try again only for the unreachable note, and it calls onRetry', () => {
    const { onRetry } = setup(result({ fetched: false, budgets: [] }))
    expect(screen.getByText("Couldn't reach Productive – answer by hand or try again")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('offers no Try again for the other notes or a scored month', () => {
    for (const r of [
      result(),
      result({ today: '2026-10-20' }),
      result({ budgets: [budget({ starts_on: '2026-10-13' })] }),
      result({ budgets: [] }),
    ]) {
      setup(r)
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
      cleanup()
    }
  })

  it('shows the month-not-finished note beside the running hours', () => {
    setup(result({ today: '2026-10-20' }))
    expect(screen.getByText('Month not finished – hours so far')).toBeTruthy()
    expect(screen.getAllByTestId('hours-line')).toHaveLength(1)
  })
})

// M3: the box writes the same signed difference as the reason line.
describe('HoursBox signed differences', () => {
  afterEach(cleanup)
  it.each([
    [3, '+0.1h'], [-3, '−0.1h'], [9, '+0.2h'], [-9, '−0.2h'], [2, '0h'], [-2, '0h'], [0, '0h'],
  ])('a %i minute difference reads %s', (minutes, text) => {
    setup(result({ budgets: [budget({ budgeted_minutes: 1200, worked_minutes: 1200 + minutes })] }))
    const row = screen.getByTestId('hours-line')
    expect(within(row).getByText(text)).toBeTruthy()
  })
})
