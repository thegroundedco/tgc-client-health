import { formatPeriod } from '../lib/month'
import { formatMoney, MAX_CENTS, parseMoney } from './money'

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

// A month's project fees (brief 2026-11-05 B3, the owner: "a spot for
// additional 'line items' in case we charge multiple project fees"). Saved, in
// cents; and as typed, two strings per row.
export type ProjectItem = { label: string; cents: number }
export type ItemField = { label: string; amount: string }
export type Fields = { retainer: string; items: ItemField[] }

// The table's own check: char_length(btrim(label)) between 1 and 120.
export const LABEL_MAX = 120

const EMPTY_ITEM: ItemField = { label: '', amount: '' }
const isEmptyItem = (item: ItemField) => item.label.trim() === '' && item.amount.trim() === ''

// Plain-number strings, NOT formatMoney output: no "$" and no commas, so
// parseMoney reads them back to the same cents. Whole dollars drop the tail,
// anything else keeps both digits so no cent is lost on the round trip.
const plain = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2))

// What a month shows as its line items, read-only. An older month saved before
// items existed has only an amount: it shows as one item labelled Project, so
// the figure is never hidden.
export function displayItems(row: MonthRow | null, items: ProjectItem[]): ProjectItem[] {
  if (items.length > 0) return items
  if (row && row.project_cents > 0) return [{ label: 'Project', cents: row.project_cents }]
  return []
}

// The fields a month opens with. The older month's amount becomes a Project
// row, so saving keeps it as an item. Always at least one row to type into.
export function initialFields(row: MonthRow | null, items: ProjectItem[]): Fields {
  const shown = displayItems(row, items).map((item) => ({ label: item.label, amount: plain(item.cents) }))
  return { retainer: row ? plain(row.retainer_cents) : '', items: shown.length > 0 ? shown : [EMPTY_ITEM] }
}

// The rows as the save will send them, or why not. One error per row (null for
// a row that is fine), plus a problem for the form as a whole. Fully empty rows
// are ignored; labels are trimmed.
export type ItemCheck =
  | { ok: true; items: ProjectItem[]; totalCents: number }
  | { ok: false; errors: (string | null)[]; problem: string | null }

export function checkItems(fields: ItemField[]): ItemCheck {
  const items: ProjectItem[] = []
  const errors = fields.map((field): string | null => {
    if (isEmptyItem(field)) return null
    const label = field.label.trim()
    const cents = parseMoney(field.amount)
    if (cents === null) return `Not a dollar amount up to ${formatMoney(MAX_CENTS)}.`
    if (label === '') return 'Add a label for this amount.'
    if (cents <= 0) return 'Add an amount above $0.'
    if (label.length > LABEL_MAX) return `Keep the label to ${LABEL_MAX} characters.`
    items.push({ label, cents })
    return null
  })
  if (errors.some((error) => error !== null)) return { ok: false, errors, problem: null }
  const totalCents = items.reduce((sum, item) => sum + item.cents, 0)
  if (totalCents > MAX_CENTS) {
    return { ok: false, errors, problem: `The project total is over ${formatMoney(MAX_CENTS)}. Nothing was saved.` }
  }
  return { ok: true, items, totalCents }
}

// "Project total: $X" as the person types: every amount that reads as money
// above zero, whatever its label says yet.
export function projectTotal(fields: ItemField[]): number {
  return fields.reduce((sum, field) => {
    const cents = parseMoney(field.amount)
    return cents !== null && cents > 0 ? sum + cents : sum
  }, 0)
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
  fields: Fields
}): BoxMode {
  if (!args.canEdit) return 'readonly'
  const blank = args.fields.retainer.trim() === '' && args.fields.items.every(isEmptyItem)
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
