import { lastDayOf, previousPeriod } from '../lib/month'
import { formatMoney } from '../revenue/money'
import { FOUNDATION_RATE_CENTS, GROW_RATE_CENTS, RATE_TOLERANCE } from './financeRates'

export type RevenueRow = { period: string; retainer_cents: number; project_cents: number }
export type Stint = { package_code: string; started_on: string }
export type FinanceAnswer = { value: 1 | 3 | 5; reason: string }
export type FinanceSuggestion = { fin_rack_rate?: FinanceAnswer; fin_rate_increased?: FinanceAnswer }

const total = (row: RevenueRow) => row.retainer_cents + row.project_cents
// A stint started mid-month counts that whole month: revenue is stored per month.
const monthOf = (date: string) => `${date.slice(0, 7)}-01`

export function stintFor(stints: readonly Stint[], period: string): Stint | null {
  const end = lastDayOf(period)
  const started = stints.filter((stint) => stint.started_on <= end)
  if (started.length === 0) return null
  return started.reduce((latest, stint) => (stint.started_on > latest.started_on ? stint : latest))
}

function rateChange(period: string, rows: readonly RevenueRow[]): FinanceAnswer | undefined {
  const now = rows.find((row) => row.period === period)
  const last = rows.find((row) => row.period === previousPeriod(period))
  if (!now || !last) return undefined
  const a = total(last)
  const b = total(now)
  let value: 1 | 3 | 5
  if (a === 0) value = b > 0 ? 5 : 3
  else {
    const change = (b - a) / a
    value = Math.abs(change) <= RATE_TOLERANCE ? 3 : change > 0 ? 5 : 1
  }
  return { value, reason: `From revenue: ${formatMoney(b)} this month vs ${formatMoney(a)} last month.` }
}

function rackRate(period: string, stint: Stint | null, rows: readonly RevenueRow[]): FinanceAnswer | undefined {
  if (!stint) return undefined
  const now = rows.find((row) => row.period === period)
  if (!now) return undefined
  if (stint.package_code === 'grow') {
    const billed = total(now)
    return {
      value: billed >= GROW_RATE_CENTS ? 5 : 1,
      reason: `From revenue: ${formatMoney(billed)} billed vs ${formatMoney(GROW_RATE_CENTS)} Grow rack rate.`,
    }
  }
  if (stint.package_code === 'foundation') {
    const from = monthOf(stint.started_on)
    const billed = rows
      .filter((row) => row.period >= from && row.period <= period)
      .reduce((sum, row) => sum + total(row), 0)
    return {
      value: billed >= FOUNDATION_RATE_CENTS ? 5 : 3,
      reason: `From revenue: ${formatMoney(billed)} billed since Foundation began vs ${formatMoney(FOUNDATION_RATE_CENTS)} Foundation rate.`,
    }
  }
  return undefined
}

// Spec 2026-10-29. Two of the three Finances questions, worked out from data the
// tool already holds; "Pays on time" stays a judgement. Nothing is returned for a
// question the data cannot answer -- missing revenue, no package -- so the
// screen leaves it for the person rather than guessing.
export function financeFromRevenue(
  period: string,
  stint: Stint | null,
  rows: readonly RevenueRow[],
): FinanceSuggestion {
  const suggestion: FinanceSuggestion = {}
  const rate = rateChange(period, rows)
  if (rate) suggestion.fin_rate_increased = rate
  const rack = rackRate(period, stint, rows)
  if (rack) suggestion.fin_rack_rate = rack
  return suggestion
}
