import { describe, expect, it } from 'vitest'
import { clockHours, hoursFromBudgets, hoursScore, type BudgetRow } from './hoursFromBudgets'

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
  it('does not apply before October 2026, and says nothing', () =>
    expect(hoursFromBudgets({ ...base, period: '2026-09-01', budgets: [budget()] })).toEqual(
      { applies: false, reason: 'before_start', message: null, lines: [], answer: null }))
  it('does not apply when unlinked', () =>
    expect(hoursFromBudgets({ ...base, linked: false, budgets: [] })).toEqual(
      { applies: false, reason: 'not_linked', message: 'Not linked to Productive', lines: [], answer: null }))
  it('does not apply when Productive was not reached (no fetch row)', () =>
    expect(hoursFromBudgets({ ...base, fetched: false, budgets: [] })).toEqual(
      { applies: false, reason: 'unreachable', message: "Couldn't reach Productive", lines: [], answer: null }))
  it('does not apply when fetched with no fixed budget', () =>
    expect(hoursFromBudgets({ ...base, budgets: [] })).toEqual(
      { applies: false, reason: 'no_budget', message: 'No fixed monthly budget', lines: [], answer: null }))
  it('scores one finished full-month budget with its reason', () => {
    const r = hoursFromBudgets({ ...base, budgets: [budget()] })
    expect(r).toMatchObject({ applies: true, message: null, answer: {
      value: 1, reason: 'From Productive: 42.8h worked vs 25h budgeted (+17.8h).' } })
    expect(r.lines[0]).toMatchObject({
      budgetedHours: 25, workedHours: 42.8, diffHours: 17.8, flagged: true, budgetedMinutes: 1500, workedMinutes: 2568 })
  })
  it('shows a minus sign for under', () =>
    expect(hoursFromBudgets({ ...base, budgets: [budget({ worked_minutes: 720 })] }))
      .toMatchObject({ answer: { value: 1, reason: 'From Productive: 12h worked vs 25h budgeted (−13h).' } }))
  it('does not apply with two budgets, and still lists both', () => {
    const r = hoursFromBudgets({ ...base, budgets: [budget(), budget({ productive_deal_id: 'd2', name: 'Budget B' })] })
    expect(r).toMatchObject({ applies: false, reason: 'several_budgets', answer: null,
      message: '2 monthly budgets – tidy up in Productive' })
    expect(r.lines).toHaveLength(2)
  })
  it('does not apply to a first part-month, naming its start, and still lists it', () => {
    const r = hoursFromBudgets({ ...base, budgets: [budget({ starts_on: '2026-10-13' })] })
    expect(r).toMatchObject({ applies: false, reason: 'part_month', answer: null,
      message: 'First part-month (started Oct 13) – not scored' })
    expect(r.lines).toHaveLength(1)
  })
  // The database's rule is starts_on = period, not "starts on some 1st".
  it('treats a budget starting on another month\'s 1st as a part-month too', () =>
    expect(hoursFromBudgets({ ...base, budgets: [budget({ starts_on: '2026-09-01' })] }))
      .toMatchObject({ applies: false, reason: 'part_month', message: 'First part-month (started Sep 1) – not scored' }))
  it('names a part-month start without a leading zero', () =>
    expect(hoursFromBudgets({ ...base, budgets: [budget({ starts_on: '2026-10-02' })] }).message)
      .toBe('First part-month (started Oct 2) – not scored'))
  it('does not apply on the month\'s last day, with hours so far; applies on the 1st', () => {
    const before = hoursFromBudgets({ ...base, today: '2026-10-31', budgets: [budget()] })
    expect(before).toMatchObject({ applies: false, reason: 'not_finished', answer: null,
      message: 'Month not finished – hours so far' })
    expect(before.lines).toHaveLength(1)
    expect(hoursFromBudgets({ ...base, today: '2026-11-01', budgets: [budget()] }))
      .toMatchObject({ applies: true, answer: { value: 1 } })
  })
  // The brief's order: the first reason that matches wins.
  it('checks the reasons in order: linked, fetched, any budget, how many, part-month, finished', () => {
    const early = '2026-10-20'
    const why = (input: Parameters<typeof hoursFromBudgets>[0]) => {
      const r = hoursFromBudgets(input)
      return r.applies ? 'applies' : r.reason
    }
    expect(why({ ...base, linked: false, fetched: false, budgets: [] })).toBe('not_linked')
    expect(why({ ...base, fetched: false, today: early, budgets: [budget()] })).toBe('unreachable')
    expect(why({ ...base, today: early, budgets: [] })).toBe('no_budget')
    expect(why({ ...base, today: early,
      budgets: [budget({ starts_on: '2026-10-13' }), budget({ productive_deal_id: 'd2' })] })).toBe('several_budgets')
    expect(why({ ...base, today: early, budgets: [budget({ starts_on: '2026-10-13' })] })).toBe('part_month')
    expect(why({ ...base, today: early, budgets: [budget()] })).toBe('not_finished')
  })
  it('does not flag a line exactly 6h out', () =>
    expect(hoursFromBudgets({ ...base, budgets: [budget({ worked_minutes: 1860 })] }))
      .toMatchObject({ lines: [{ flagged: false }], answer: { value: 5 } }))
  it('sorts lines by name', () => {
    const r = hoursFromBudgets({ ...base, budgets: [budget({ name: 'Z' }), budget({ name: 'A', productive_deal_id: 'd2' })] })
    expect(r.lines.map((l) => l.name)).toEqual(['A', 'Z'])
  })
})

describe('clockHours', () => {
  it.each([
    [678, '11:18 h'], [300, '5:00 h'], [0, '0:00 h'], [5, '0:05 h'], [59, '0:59 h'], [60, '1:00 h'], [6000, '100:00 h'],
  ])('%i minutes is %s', (minutes, text) => expect(clockHours(minutes)).toBe(text))
})

// M3: the magnitude is rounded, then signed, so a difference and its mirror
// read the same; anything that rounds to nothing is a plain 0h, never −0h.
describe('signed differences round symmetrically', () => {
  const diffOf = (minutes: number) => {
    const r = hoursFromBudgets({ ...base, budgets: [budget({ budgeted_minutes: 1500, worked_minutes: 1500 + minutes })] })
    if (!r.applies) throw new Error('expected a scored month')
    return { line: r.lines[0], diffText: /\(([^)]*)\)\.$/.exec(r.answer.reason)?.[1] }
  }
  it.each([
    [3, 0.1, '+0.1h'], [-3, -0.1, '−0.1h'],
    [9, 0.2, '+0.2h'], [-9, -0.2, '−0.2h'],
    [2, 0, '0h'], [-2, 0, '0h'], [0, 0, '0h'],
  ])('%i minutes is %d hours, written %s', (minutes, hours, text) => {
    const { line, diffText } = diffOf(minutes)
    expect(Object.is(line.diffHours, hours)).toBe(true)
    expect(diffText).toBe(text)
  })
})
