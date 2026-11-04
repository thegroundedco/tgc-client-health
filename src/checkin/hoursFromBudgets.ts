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

const toHours = (minutes: number): number => Math.round(minutes / 6) / 10

// 25 not 25.0; Number() drops the trailing zero.
const fmt = (hours: number): string => String(hours)

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
  const sign = diff < 0 ? '−' : '+'
  return `From Productive: ${fmt(toHours(b.worked_minutes))}h worked vs ${fmt(toHours(b.budgeted_minutes))}h budgeted (${sign}${fmt(Math.abs(toHours(diff)))}h).`
}

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
