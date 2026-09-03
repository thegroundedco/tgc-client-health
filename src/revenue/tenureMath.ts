import { isChurned } from '../clients/clientForm'

// Named tenureMath rather than tenure, for a reason worth stating so nobody
// "corrects" it back: macOS's filesystem is case-INSENSITIVE, so `./tenure`
// and `./Tenure` are the same path. With a tenure.ts beside a Tenure.tsx, the
// resolver takes .ts first and BOTH imports land here -- Tenure.tsx imports
// itself, `Tenure` is undefined, and every DOM test for it fails with
// "Element type is invalid". src/board/matrixMath.ts carries the same name
// for the same reason: this collision already happened once, in Slice 5.
//
// The tenure report's arithmetic, sorting and summary. Pure: no React, no
// network, no clock of its own except the one you hand it. That is what makes
// the date handling below testable, and the date handling is the reason this is
// a module rather than a few subtractions in a component.
//
// Every date here is a YYYY-MM-DD string, which is what a Postgres `date`
// renders as. Two traps live in that:
//
// 1. `new Date().toISOString()` reports the UTC calendar day. At 18:00 in a
//    UTC-7 zone it is already tomorrow in UTC, so "today" would be a day ahead
//    for part of every evening -- and every test written at a UTC-safe hour
//    would pass. todayISO reads the LOCAL fields instead. Proven -- but only
//    because tenureMath.test.ts pins a non-UTC zone: under UTC itself the naive
//    `toISOString().slice(0, 10)` and the local-fields form name the same
//    calendar day, so this project's CI (ubuntu-latest, UTC by default) could
//    not have caught a regression here without that pin.
//
// 2. Mixing a UTC-parsed date with a local one puts a whole timezone offset
//    inside a subtraction, so daysBetween sends BOTH ends through Date.UTC as
//    a deliberate discipline -- the same one src/lib/gate.ts documents for the
//    90-day Advocacy gate. NOT proven by this file's tests: a bare zero-padded
//    YYYY-MM-DD string is already parsed as UTC midnight by JS itself, in
//    every engine and zone, so for this module's actual input domain the naive
//    `new Date(to).getTime() - new Date(from).getTime()` form agrees with the
//    careful one, and no test here can tell the two apart. The Date.UTC
//    parsing stays anyway, as defence for the day something other than a
//    zero-padded date string reaches it -- not as a guard the tests can show
//    is doing anything today.

export type LifecycleClient = {
  id: number
  name: string
  status: string
  started_on: string | null
  ended_on: string | null
  end_reason_code: string | null
  end_reason_note: string | null
}

export type CurrentRow = {
  client: LifecycleClient
  /** Null means unmeasurable, NEVER zero. See the module note above. */
  days: number | null
  paused: boolean
}

export type DepartedRow = { client: LifecycleClient; days: number | null }

export type TenureSummary = {
  /** Everybody, including those with no start date: they are still clients. */
  total: number
  /** How many of them could actually be measured. */
  measured: number
  medianDays: number | null
  longestDays: number | null
}

const DAY_MS = 86_400_000

export function todayISO(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toUTC(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return Date.UTC(year, month - 1, date)
}

export function daysBetween(from: string, to: string): number {
  // Both ends go through Date.UTC before subtracting -- real defence if this
  // ever receives something other than a zero-padded YYYY-MM-DD string, but
  // for that exact shape JS already parses it as UTC midnight on its own, so
  // this and the naive millisecond subtraction agree, and the tests below
  // cannot tell them apart. Because both ends are UTC, a local DST transition
  // is structurally unreachable here -- there is no local clock in this
  // subtraction for it to disturb -- so the tests below prove only the plain
  // arithmetic on ordinary calendar spans, nothing about DST and nothing about
  // parsing. The DST-dated cases are kept anyway because a two-day span is
  // still worth asserting; they just are not what makes this function safe.
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS)
}

export function tenureDays(startedOn: string | null, asOf: string): number | null {
  if (startedOn === null) return null
  return daysBetween(startedOn, asOf)
}

// Whole units, because a client relationship is not a precise quantity and
// "0.53 months" would claim a precision nobody has. The month is 30 days and
// the year 365: an approximation, stated here so nobody later mistakes it for
// calendar arithmetic and "fixes" it into something that disagrees with itself
// across a leap year.
export function formatTenure(days: number | null): string {
  if (days === null) return 'unknown'
  if (days < 7) return 'under a week'
  if (days < 60) return `${Math.floor(days / 7)} wk`
  if (days < 365) return `${Math.floor(days / 30)} mo`
  const years = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)
  return months === 0 ? `${years} yr` : `${years} yr ${months} mo`
}

// A date, rendered as a date. NOT lib/month.ts's formatSavedAt, which takes an
// ISO timestamp: handed a date-only string it parses UTC midnight and renders it
// in LOCAL time, so `2026-08-25` prints as "Aug 24, 2026, 6:00 PM" west of
// Greenwich -- the wrong day, and a time for a date that has none.
//
// `timeZone: 'UTC'` is load-bearing, not decoration. Without it toLocaleDateString
// converts the UTC midnight back into local time and lands on the previous day
// again, which is the very bug this function exists to avoid. Proven -- but,
// like trap 1, only because tenureMath.test.ts pins a non-UTC zone: under UTC
// itself, dropping `timeZone: 'UTC'` renders the same day, so this project's
// CI (ubuntu-latest, UTC by default) could not have caught that regression
// without the pin.
export function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString('en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  })
}

// Everyone who has not left. Spec §4: `paused` counts, because the database's
// own check constraint refuses a paused client an end date -- by the schema's
// rules they have not ended.
export function currentRows(
  rows: readonly LifecycleClient[],
  asOf: string,
): CurrentRow[] {
  return rows
    .filter((client) => !isChurned(client.status))
    .map((client) => ({
      client,
      days: tenureDays(client.started_on, asOf),
      paused: client.status === 'paused',
    }))
    .sort((a, b) => {
      // Unknowns go last, not first. They are unmeasured, not new, and ranking
      // them where "two weeks" belongs would assert something the data does not
      // say. Spec §3.
      if (a.days === null && b.days === null) return a.client.name.localeCompare(b.client.name)
      if (a.days === null) return 1
      if (b.days === null) return -1
      return b.days - a.days
    })
}

export function departedRows(
  rows: readonly LifecycleClient[],
): DepartedRow[] {
  return rows
    .filter((client) => isChurned(client.status))
    .map((client) => ({
      client,
      // To the day they LEFT, not to today: their tenure stopped when the
      // relationship did, and measuring it to now would keep growing the
      // tenure of somebody who is gone.
      days:
        client.started_on === null || client.ended_on === null
          ? null
          : daysBetween(client.started_on, client.ended_on),
    }))
    .sort((a, b) => {
      const left = a.client.ended_on ?? ''
      const right = b.client.ended_on ?? ''
      // Most recent departure first. Two YYYY-MM-DD strings compare correctly
      // as strings, which is why nothing here parses one to order it.
      return right.localeCompare(left) || a.client.name.localeCompare(b.client.name)
    })
}

// Count everybody, measure only what is measured, and let the caller say when
// the two differ. Spec §3: treating an unknown as zero would drag the median
// down and report a shorter typical relationship than the firm actually has,
// while dropping those clients from the count would answer a different question
// from the one the line appears to answer.
export function summarise(rows: readonly CurrentRow[]): TenureSummary {
  const measured = rows
    .map((row) => row.days)
    .filter((days): days is number => days !== null)
    .sort((a, b) => a - b)

  if (measured.length === 0) {
    return { total: rows.length, measured: 0, medianDays: null, longestDays: null }
  }

  const middle = Math.floor(measured.length / 2)
  const medianDays =
    measured.length % 2 === 1
      ? measured[middle]
      : Math.round((measured[middle - 1] + measured[middle]) / 2)

  return {
    total: rows.length,
    measured: measured.length,
    medianDays,
    longestDays: measured[measured.length - 1],
  }
}
