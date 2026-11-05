import { HOURS_OPTIONS, HOURS_START_PERIOD } from '../lib/buckets'
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
  budgetedMinutes: number
  workedMinutes: number
  diffHours: number // 1dp
  flagged: boolean // |diff| > 360 min
}

export type HoursAnswer = { value: 1 | 2 | 3 | 5; reason: string }

// Why the hours question does not apply. Each but before_start has a message
// for the screen (brief 2026-11-05 A).
export type HoursReason =
  | 'before_start'
  | 'not_linked'
  | 'unreachable'
  | 'no_budget'
  | 'several_budgets'
  | 'part_month'
  | 'not_finished'

// One shape for both, so a consumer reads lines, answer and message without
// narrowing. Not applying keeps the lines it has, so the box can still show the
// hours so far (a part-month, two budgets, a month not finished).
export type HoursResult =
  | { applies: false; reason: HoursReason; message: string | null; lines: HoursLine[]; answer: null }
  | { applies: true; lines: HoursLine[]; answer: HoursAnswer; message: null }

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

// Minutes as Productive's widget writes them: "11:18 h", "5:00 h". Minutes
// zero-padded, hours not.
export function clockHours(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')} h`
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "2026-10-13" -> "Oct 13". Read from the string, never through Date, so no
// time zone can move the day.
function monthDay(date: string): string {
  const [, month, day] = date.split('-').map(Number)
  return `${SHORT_MONTHS[month - 1]} ${day}`
}

function line(b: BudgetRow): HoursLine {
  const diff = b.worked_minutes - b.budgeted_minutes
  return {
    dealId: b.productive_deal_id,
    name: b.name,
    budgetedHours: toHours(b.budgeted_minutes),
    workedHours: toHours(b.worked_minutes),
    budgetedMinutes: b.budgeted_minutes,
    workedMinutes: b.worked_minutes,
    diffHours: toHours(diff),
    flagged: Math.abs(diff) > 360,
  }
}

function reason(b: BudgetRow): string {
  const diff = b.worked_minutes - b.budgeted_minutes
  return `From Productive: ${fmt(toHours(b.worked_minutes))}h worked vs ${fmt(toHours(b.budgeted_minutes))}h budgeted (${signedHours(toHours(diff))}).`
}

// Brief 2026-11-05 A. Mirrors private.hours_applies and private.hours_score
// (supabase/migrations/20261105120000_hours_scored_by_db.sql) exactly: the
// database owns the stored score, and this is what the screen shows before and
// after a save, so the two must agree. It applies only when all hold: from
// HOURS_START_PERIOD, linked, fetched after the month ended, exactly one
// budget, and that budget starts on the 1st. Otherwise it does not apply, and
// the first reason that matches, in the order below, is the message.
//
// `today` is the date to judge month-end against: the date the budgets are as
// of (YYYY-MM-DD), which on the check-in is the local date of the fetch that
// stored them, not the viewer's clock -- the database judges the same fetched_at
// in America/Denver. Data fetched before the month ended is "hours so far" and
// is never scored, whenever it is read.
export function hoursFromBudgets(input: {
  period: string
  today: string
  linked: boolean
  fetched: boolean
  budgets: readonly BudgetRow[]
}): HoursResult {
  const { period, today, linked, fetched, budgets } = input
  const sorted = [...budgets].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const lines = sorted.map(line)
  const no = (why: HoursReason, message: string | null, shown: HoursLine[] = lines): HoursResult => ({
    applies: false,
    reason: why,
    message,
    lines: shown,
    answer: null,
  })

  if (period < HOURS_START_PERIOD) return no('before_start', null, [])
  if (!linked) return no('not_linked', 'Not linked to Productive', [])
  if (!fetched) return no('unreachable', "Couldn't reach Productive")
  if (sorted.length === 0) return no('no_budget', 'No fixed monthly budget')
  if (sorted.length > 1) return no('several_budgets', `${sorted.length} monthly budgets – tidy up in Productive`)
  const only = sorted[0]
  if (only.starts_on !== period) {
    return no('part_month', `First part-month (started ${monthDay(only.starts_on)}) – not scored`)
  }
  if (today < addMonths(period, 1)) return no('not_finished', 'Month not finished – hours so far')
  return {
    applies: true,
    lines,
    answer: { value: hoursScore(only.worked_minutes - only.budgeted_minutes), reason: reason(only) },
    message: null,
  }
}

// The share of the budget used, 0-100, capped at a full ring. A budget of 0
// cannot happen (the table checks budgeted_minutes > 0); read as full if it did.
export function ringPercent(workedMinutes: number, budgetedMinutes: number): number {
  if (budgetedMinutes <= 0) return 100
  return Math.min(100, Math.max(0, (workedMinutes / budgetedMinutes) * 100))
}

// "Within 6h" for 5, and so on: the band's own label from the option set the
// question was asked with, so the words cannot drift from the bands.
export function hoursBandLabel(value: number): string | null {
  return HOURS_OPTIONS.find((option) => option.value === value)?.label ?? null
}

// The score line, shown by HoursBox, and by the check-in screen's fallback for a viewer who
// cannot read the hours themselves.
export function hoursScoreText(value: number): string {
  const label = hoursBandLabel(value)
  return label === null ? `Hours within budget: ${value}` : `Hours within budget: ${value} – ${label}`
}
