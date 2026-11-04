import { HOURS_START_PERIOD } from '../lib/buckets'
import { addMonths } from '../lib/month'

export type BudgetRow = {
  productive_deal_id: string
  name: string
  starts_on: string
  ends_on: string
  budgeted_minutes: number
  worked_minutes: number
}

export type HoursLine = {
  dealId: string
  name: string
  budgetedHours: number
  workedHours: number
  diffHours: number // 1dp
  flagged: boolean // |diff| > 360 min
}

export type HoursAnswer = { value: 1 | 2 | 3 | 5; reason: string }

export type HoursResult =
  | { applies: false; reason: 'before_start' | 'not_linked' | 'no_budget'; message: string | null }
  | { applies: true; lines: HoursLine[]; answer: HoursAnswer | null; note: string | null }

// Bands are compared in whole minutes, never in float hours, so exactly
// +-360, -480, -600 and +480 land in the gentler band.
export function hoursScore(diffMinutes: number): 1 | 2 | 3 | 5 {
  if (diffMinutes >= -360 && diffMinutes <= 360) return 5
  if (diffMinutes >= -480 && diffMinutes < -360) return 3
  if ((diffMinutes >= -600 && diffMinutes < -480) || (diffMinutes > 360 && diffMinutes <= 480)) return 2
  return 1
}

// Minutes to hours at 1dp. The MAGNITUDE is rounded and the sign applied
// after, so -9 and +9 minutes are -0.2h and +0.2h (Math.round alone rounds
// halves up, which would make them -0.1h and +0.2h). Never -0.
export function toHours(minutes: number): number {
  const magnitude = Math.round(Math.abs(minutes) / 6) / 10
  if (magnitude === 0) return 0
  return minutes < 0 ? -magnitude : magnitude
}

// 25 not 25.0; Number() drops the trailing zero.
const fmt = (hours: number): string => String(hours)

// A signed difference in hours: a true minus, a plus, and plain 0h (no sign)
// when it rounds to nothing. Used by the reason line and by HoursBox, so the
// two always agree.
export function signedHours(hours: number): string {
  if (hours === 0) return '0h'
  return `${hours < 0 ? '−' : '+'}${fmt(Math.abs(hours))}h`
}

function line(b: BudgetRow): HoursLine {
  const diff = b.worked_minutes - b.budgeted_minutes
  return {
    dealId: b.productive_deal_id,
    name: b.name,
    budgetedHours: toHours(b.budgeted_minutes),
    workedHours: toHours(b.worked_minutes),
    diffHours: toHours(diff),
    flagged: Math.abs(diff) > 360,
  }
}

function reason(b: BudgetRow): string {
  const diff = b.worked_minutes - b.budgeted_minutes
  return `From Productive: ${fmt(toHours(b.worked_minutes))}h worked vs ${fmt(toHours(b.budgeted_minutes))}h budgeted (${signedHours(toHours(diff))}).`
}

// `today` is the date to judge month-end against: the date the budgets are as
// of (YYYY-MM-DD), which on the check-in is the local date of the fetch that
// stored them, not the viewer's clock. Data fetched before the month ended is
// "hours so far" and is never scored, whenever it is read.
export function hoursFromBudgets(input: {
  period: string
  today: string
  linked: boolean
  fetched: boolean
  budgets: readonly BudgetRow[]
}): HoursResult {
  const { period, today, linked, fetched, budgets } = input
  if (period < HOURS_START_PERIOD) return { applies: false, reason: 'before_start', message: null }
  if (!linked) return { applies: false, reason: 'not_linked', message: 'Not linked to Productive' }
  if (!fetched) {
    return {
      applies: true,
      lines: [],
      answer: null,
      note: "Couldn't reach Productive – answer by hand or try again",
    }
  }
  if (budgets.length === 0) return { applies: false, reason: 'no_budget', message: 'No fixed monthly budget' }

  const sorted = [...budgets].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const lines = sorted.map(line)
  const none = (note: string): HoursResult => ({ applies: true, lines, answer: null, note })

  if (sorted.length > 1) return none(`${sorted.length} monthly budgets – tidy up in Productive`)
  const only = sorted[0]
  if (!only.starts_on.endsWith('-01')) return none('First part-month – score by hand')
  if (today < addMonths(period, 1)) return none('Month not finished – hours so far')
  return {
    applies: true,
    lines,
    answer: { value: hoursScore(only.worked_minutes - only.budgeted_minutes), reason: reason(only) },
    note: null,
  }
}
