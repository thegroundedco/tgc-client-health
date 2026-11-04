import { describe, expect, it } from 'vitest'
import { hoursFromBudgets, hoursScore, type BudgetRow } from './hoursFromBudgets'

describe('hoursScore', () => {
  it.each([
    [0, 5], [360, 5], [-360, 5],
    [-361, 3], [-480, 3],
    [-481, 2], [-600, 2], [361, 2], [480, 2],
    [-601, 1], [481, 1], [-3600, 1],
  ])('diff %i min scores %i', (diff, score) => expect(hoursScore(diff)).toBe(score))
})

const budget = (o: Partial<BudgetRow> = {}): BudgetRow => ({
  productive_deal_id: 'd1', name: 'Budget A', starts_on: '2026-10-01', ends_on: '2026-10-31',
  budgeted_minutes: 1500, worked_minutes: 2568, ...o,
})
const base = { period: '2026-10-01', today: '2026-11-04', linked: true, fetched: true }

describe('hoursFromBudgets', () => {
  it('does not apply before October 2026', () =>
    expect(hoursFromBudgets({ ...base, period: '2026-09-01', budgets: [budget()] })).toEqual(
      { applies: false, reason: 'before_start', message: null }))
  it('does not apply when unlinked', () =>
    expect(hoursFromBudgets({ ...base, linked: false, budgets: [] })).toMatchObject(
      { applies: false, reason: 'not_linked', message: 'Not linked to Productive' }))
  it('does not apply when fetched with no fixed budget', () =>
    expect(hoursFromBudgets({ ...base, budgets: [] })).toMatchObject(
      { applies: false, reason: 'no_budget', message: 'No fixed monthly budget' }))
  it('applies with no answer when Productive was not reached', () =>
    expect(hoursFromBudgets({ ...base, fetched: false, budgets: [] })).toEqual({
      applies: true, lines: [], answer: null,
      note: "Couldn't reach Productive – answer by hand or try again" }))
  it('scores one finished full-month budget with its reason', () => {
    const r = hoursFromBudgets({ ...base, budgets: [budget()] })
    expect(r).toMatchObject({ applies: true, answer: {
      value: 1, reason: 'From Productive: 42.8h worked vs 25h budgeted (+17.8h).' }, note: null })
    expect(r.applies && r.lines[0]).toMatchObject({ budgetedHours: 25, workedHours: 42.8, diffHours: 17.8, flagged: true })
  })
  it('shows a minus sign for under', () =>
    expect(hoursFromBudgets({ ...base, budgets: [budget({ worked_minutes: 720 })] }))
      .toMatchObject({ answer: { value: 1, reason: 'From Productive: 12h worked vs 25h budgeted (−13h).' } }))
  it('leaves two budgets blank and lists both', () => {
    const r = hoursFromBudgets({ ...base, budgets: [budget(), budget({ productive_deal_id: 'd2', name: 'Budget B' })] })
    expect(r).toMatchObject({ applies: true, answer: null, note: '2 monthly budgets – tidy up in Productive' })
    expect(r.applies && r.lines).toHaveLength(2)
  })
  it('leaves a first part-month blank', () =>
    expect(hoursFromBudgets({ ...base, budgets: [budget({ starts_on: '2026-10-13' })] }))
      .toMatchObject({ applies: true, answer: null, note: 'First part-month – score by hand' }))
  it('leaves the month blank on its last day and fills it on the 1st', () => {
    expect(hoursFromBudgets({ ...base, today: '2026-10-31', budgets: [budget()] }))
      .toMatchObject({ answer: null, note: 'Month not finished – hours so far' })
    expect(hoursFromBudgets({ ...base, today: '2026-11-01', budgets: [budget()] }))
      .toMatchObject({ answer: { value: 1 } })
  })
  it('does not flag a line exactly 6h out', () =>
    expect(hoursFromBudgets({ ...base, budgets: [budget({ worked_minutes: 1860 })] }))
      .toMatchObject({ lines: [{ flagged: false }], answer: { value: 5 } }))
  it('sorts lines by name', () => {
    const r = hoursFromBudgets({ ...base, budgets: [budget({ name: 'Z' }), budget({ name: 'A', productive_deal_id: 'd2' })] })
    expect(r.applies && r.lines.map((l) => l.name)).toEqual(['A', 'Z'])
  })
})
