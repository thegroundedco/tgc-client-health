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

// Last month, not this one. A month is judged after it closes: the owner scores
// August during September. Defaulting to the current month meant the board read
// as em dashes for the first three weeks of every month and the month he
// actually wanted was unreachable. Spec §7, and §10 decision 8 records that he
// chose this over "most recent unsubmitted" and what it costs.
export function defaultPeriod(): string {
  return previousPeriod(currentPeriod())
}

// The months the board offers, OLDEST first, ending at the current month.
// Oldest first by the owner's ruling 2026-09-01: he reads the list as a
// timeline, and a timeline runs forward.
//
// The current month is in the list even though it has not closed -- somebody
// who wants to look at a month in progress should be able to, and the check-in
// screen has never refused one -- but it is the LAST entry, and nothing follows
// it. In September the list ends at September; October is not offered at all.
//
// A future month is absent rather than present and disabled, which is what this
// replaces. The arrows had to offer "next" always and then refuse it at the
// boundary; a list offers only what it will honour.
//
// Twelve, not "back to the earliest client". Sizing the list from data would
// mean plumbing every client's started_on into the board just to decide how
// many options to draw, and the tool holds one month of history. Raise the
// count when there is more than a year to look at.
export function periodOptions(count = 12): string[] {
  const now = currentPeriod()
  // index - (count - 1), so the last element is addMonths(now, 0) -- the
  // current month -- and the offsets before it are negative. Written this way
  // rather than as a reversed descending list so there is one expression to
  // read and no second array to keep in step with the first.
  return Array.from({ length: count }, (_, index) => addMonths(now, index - (count - 1)))
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
