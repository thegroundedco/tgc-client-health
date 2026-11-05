import { formatPeriod } from '../lib/month'
import { formatMoney, parseMoney } from './money'

// The check-in screen's payments box, decided here so a component only draws.
// Its own module for the same reason as financeFromRevenue: the cases that go
// wrong (blank under a ghost, a typed 0, an untouched retainer) are invisible
// until somebody hits them, and a pure function is where they can be pinned.

export type MonthRow = {
  retainer_cents: number
  project_cents: number
  project_notes: string | null
  entered_by: string | null
  updated_at: string
}
export type BoxMode = 'confirm' | 'save' | 'readonly'

// Plain-number strings, NOT formatMoney output: no "$" and no commas, so
// parseMoney reads them back to the same cents. Whole dollars drop the tail,
// anything else keeps both digits so no cent is lost on the round trip.
const plain = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2))

export function initialFields(row: MonthRow | null): { retainer: string; project: string; notes: string } {
  if (!row) return { retainer: '', project: '', notes: '' }
  return { retainer: plain(row.retainer_cents), project: plain(row.project_cents), notes: row.project_notes ?? '' }
}

// What the notes field sends: trimmed, and null when nothing is left, so a
// whitespace-only note is no note. The database does the same (nullif/btrim);
// this keeps the wire value honest too.
export function notesForSave(typed: string): string | null {
  const trimmed = typed.trim()
  return trimmed === '' ? null : trimmed
}

// Blank under a ghost means the ghost: the person who types only a project
// amount for a retainer client is not saying the retainer is zero. Blank with
// nothing stored is 0. Null is an invalid entry, for the caller to show.
export function effectiveRetainer(typed: string, storedRetainer: number | null): number | null {
  if (typed.trim() === '') return storedRetainer ?? 0
  return parseMoney(typed)
}

// The ghost exists only where it is SHOWN: a month with no row. On a saved
// month the Retainer field holds real figures, so a cleared field is a typed
// zero-by-blank, never the Clients-admin amount (spec §9: a ghost is never stored).
export function ghostRetainer(row: MonthRow | null, storedRetainer: number | null): number | null {
  return row === null ? storedRetainer : null
}

// Only an EDITED retainer field can prompt. A month opened from Revenue entry
// shows saved figures as values, and changing only Project must ask nothing
// even when the saved retainer differs from the one in Clients admin.
export function shouldAskRetainer(args: {
  retainerEdited: boolean
  retainerCents: number
  storedRetainer: number | null
}): boolean {
  return args.retainerEdited && args.retainerCents !== (args.storedRetainer ?? 0)
}

export function boxMode(args: {
  canEdit: boolean
  row: MonthRow | null
  storedRetainer: number | null
  fields: { retainer: string; project: string }
}): BoxMode {
  if (!args.canEdit) return 'readonly'
  const blank = args.fields.retainer.trim() === '' && args.fields.project.trim() === ''
  // Confirm: nothing entered yet, a retainer to confirm, and nothing typed.
  if (args.row === null && args.storedRetainer !== null && blank) return 'confirm'
  return 'save'
}

// Month name only, from the shared helper: "October 2026" -> "October".
export const monthName = (period: string) => formatPeriod(period).split(' ')[0]

export function paymentCaption(period: string): string {
  return `Invoiced in ${monthName(period)}`
}

export function retainerQuestion(
  clientName: string,
  period: string,
  storedRetainer: number | null,
  newCents: number,
): { text: string; yes: string; no: string } {
  const text =
    storedRetainer === null
      ? `${clientName} has no retainer in Clients admin. Set a retainer of ${formatMoney(newCents)} a month from now on?`
      : `${clientName}'s retainer is ${formatMoney(storedRetainer)} a month in Clients admin. ` +
        (newCents === 0 ? 'Remove it from now on?' : `Change it to ${formatMoney(newCents)} from now on?`)
  return { text, yes: 'Yes, update the retainer', no: `No, just ${monthName(period)}` }
}
