// A period is always the first day of a month, formatted YYYY-MM-01, which is
// what the checkins.period date column stores.
export function periodFor(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}-01`
}

export function currentPeriod(): string {
  return periodFor(new Date())
}

export function addMonths(period: string, delta: number): string {
  const [year, month] = period.split('-').map(Number)
  // Constructing from parts lets Date normalise the year rollover for us.
  return periodFor(new Date(year, month - 1 + delta, 1))
}

export function formatPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

// Named rather than written as addMonths(period, -1) at each call site: the
// check-in screen's whole "compare with last month" read depends on this being
// the same month everywhere, and a stray +1 in one place would silently compare
// against the wrong period.
export function previousPeriod(period: string): string {
  return addMonths(period, -1)
}

// The confirmation's timestamp. Local zone deliberately: the person reading it
// wants to know whether that was them, five minutes ago.
export function formatSavedAt(iso: string): string {
  const parsed = new Date(iso)
  // Number.isNaN on the time value, not a try/catch: the Date constructor does
  // not throw on nonsense, it produces a Date whose toLocaleString is the
  // literal string "Invalid Date". Printing that on a confirmation line would
  // read as a crash. Handing back the raw value reads as odd data, which is
  // what it is.
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
