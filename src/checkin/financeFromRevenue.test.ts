import { describe, expect, it } from 'vitest'
import { financeFromRevenue, stintFor } from './financeFromRevenue'
import type { RevenueRow, Stint } from './financeFromRevenue'

const OCT = '2026-10-01'
const row = (period: string, dollars: number, projectDollars = 0): RevenueRow => ({
  period, retainer_cents: Math.round(dollars * 100), project_cents: Math.round(projectDollars * 100),
})
const GROW: Stint = { package_code: 'grow', started_on: '2026-02-01' }

describe('rate vs last month', () => {
  it.each([
    [10000, 10490, 3], // +4.9%
    [10000, 10500, 3], // +5% inclusive
    [10000, 10510, 5], // +5.1%
    [10000, 9500, 3], // -5% inclusive
    [10000, 9490, 1], // -5.1%
    [0, 4000, 5],
    [0, 0, 3],
  ])('%d last month, %d this month → %d', (last, now, expected) => {
    const s = financeFromRevenue(OCT, null, [row('2026-09-01', last), row(OCT, now)])
    expect(s.fin_rate_increased?.value).toBe(expected)
  })

  it('counts project fees in the total', () => {
    const s = financeFromRevenue(OCT, null, [row('2026-09-01', 4000), row(OCT, 4000, 6000)])
    expect(s.fin_rate_increased?.value).toBe(5)
  })

  it('says what it compared', () => {
    const s = financeFromRevenue(OCT, null, [row('2026-09-01', 15500), row(OCT, 14860)])
    expect(s.fin_rate_increased).toEqual({ value: 3, reason: 'From revenue: $14,860 this month vs $15,500 last month.' })
  })

  it.each([
    ['no row this month', [row('2026-09-01', 4000)]],
    ['no row last month', [row(OCT, 4000)]],
  ])('gives nothing with %s', (_why, rows) => {
    expect(financeFromRevenue(OCT, null, rows).fin_rate_increased).toBeUndefined()
  })
})

describe('rack rate, Grow', () => {
  it('is Yes at the rate', () => {
    expect(financeFromRevenue(OCT, GROW, [row(OCT, 5000)]).fin_rack_rate).toEqual({
      value: 5, reason: 'From revenue: $5,000 billed vs $5,000 Grow rack rate.',
    })
  })
  it('is No a cent below it', () => {
    expect(financeFromRevenue(OCT, GROW, [row(OCT, 4999.99)]).fin_rack_rate?.value).toBe(1)
  })
  it('gives nothing without this month', () => {
    expect(financeFromRevenue(OCT, GROW, [row('2026-09-01', 9000)]).fin_rack_rate).toBeUndefined()
  })
})

describe('rack rate, Foundation', () => {
  const F: Stint = { package_code: 'foundation', started_on: '2026-08-17' }
  it('is Yes once the stint has billed the total, counting the start month', () => {
    const s = financeFromRevenue(OCT, F, [row('2026-08-01', 3500), row('2026-09-01', 3000), row(OCT, 3500)])
    expect(s.fin_rack_rate).toEqual({
      value: 5, reason: 'From revenue: $10,000 billed since Foundation began vs $10,000 Foundation rate.',
    })
  })
  it('is Unsure while still paying in', () => {
    const s = financeFromRevenue(OCT, F, [row('2026-08-01', 3500), row('2026-09-01', 3000), row(OCT, 3499.99)])
    expect(s.fin_rack_rate?.value).toBe(3)
  })
  it('ignores months before the stint and after this month', () => {
    const s = financeFromRevenue(OCT, F, [row('2026-07-01', 50000), row(OCT, 3500), row('2026-11-01', 50000)])
    expect(s.fin_rack_rate?.value).toBe(3)
  })
  it('gives nothing without this month', () => {
    expect(financeFromRevenue(OCT, F, [row('2026-09-01', 20000)]).fin_rack_rate).toBeUndefined()
  })
})

it('gives no rack rate without a package', () => {
  expect(financeFromRevenue(OCT, null, [row(OCT, 9000)]).fin_rack_rate).toBeUndefined()
})

describe('stintFor', () => {
  const stints: Stint[] = [
    { package_code: 'foundation', started_on: '2026-02-01' },
    { package_code: 'grow', started_on: '2026-09-15' },
    { package_code: 'grow', started_on: '2026-11-01' },
  ]
  it('is the latest stint started on or before the month end', () => {
    expect(stintFor(stints, '2026-09-01')?.started_on).toBe('2026-09-15')
    expect(stintFor(stints, '2026-08-01')?.started_on).toBe('2026-02-01')
  })
  it('is null before any stint', () => {
    expect(stintFor(stints, '2026-01-01')).toBeNull()
  })
})
