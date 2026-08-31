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

// Named rather than written as addMonths(period, 1) at each call site, for the
// same reason previousPeriod is.
export function nextPeriod(period: string): string {
  return addMonths(period, 1)
}

// Last month, not this one. A month is judged after it closes: the owner scores
// August during September. Defaulting to the current month meant the board read
// as em dashes for the first three weeks of every month and the month he
// actually wanted was unreachable. Spec §7, and §10 decision 8 records that he
// chose this over "most recent unsubmitted" and what it costs.
export function defaultPeriod(): string {
  return previousPeriod(currentPeriod())
}

// Forward stops at the current month; back has no floor. Comparing the strings
// is sound because a period is always YYYY-MM-01 and those sort as dates do.
export function canAdvance(period: string): boolean {
  return period < currentPeriod()
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
