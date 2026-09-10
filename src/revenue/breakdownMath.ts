import type { RevenueRow } from './chartMath'
import type { RetentionClient } from './retentionMath'

// One month, broken out by client. Slice 6e §4: the answer to "why is this bar
// this tall", which the chart itself cannot give because every bar is an
// aggregate over the whole roster and two identical bars can have completely
// different compositions behind them.
//
// Pure, and separate from the panel that draws it, so §4.1 and §4.2 -- the two
// rules this module exists for -- are provable without a DOM. The same split as
// chartMath, retentionMath, revenueMath and tenureMath.

export type ClientMonth = {
  clientId: number
  name: string
  retainerCents: number
  projectCents: number
  totalCents: number
}

export type MonthBreakdown = {
  period: string
  /** Clients WITH a row that month. Sorted by total descending, then by name. */
  clients: ClientMonth[]
  retainerCents: number
  projectCents: number
  totalCents: number
  /**
   * Clients who could have been billed that month and have no row on file.
   * A count rather than rows of $0 -- see the module note on §4.1.
   */
  missing: number
}

// The first of the month containing a date. Lifecycle boundaries are months,
// not days: a client who left on the 20th billed most of that month. The same
// rule and the same reason as retentionMath's own monthOf.
function monthOf(day: string): string {
  return `${day.slice(0, 7)}-01`
}

/**
 * Could this client have been billed in this month?
 *
 * A client who left in 2024 is not a gap in a 2026 month, and neither is one
 * who starts in 2027. Both would otherwise inflate the `missing` count into
 * meaninglessness on a roster that turns over.
 *
 * A client with NO START DATE on file counts as active. With nothing on file we
 * cannot say they were not, and the honest bucket is the one that says so --
 * the same ruling retentionMath makes at spec 3.1a for the same reason. It is
 * deliberately the conservative direction: it can overstate the gap, never
 * hide one.
 */
function couldBeBilled(client: RetentionClient, period: string): boolean {
  if (client.started_on !== null && monthOf(client.started_on) > period) return false
  if (client.ended_on !== null && monthOf(client.ended_on) < period) return false
  return true
}

/**
 * Who paid what, in one month.
 *
 * A client with no row is ABSENT from `clients` and counted in `missing`. This
 * is spec 6c §3.3 -- a missing row is not a zero -- at the point where it is
 * most tempting to break: a table with a gap in it looks unfinished, and
 * filling the gap with $0 would state that the agency billed that client
 * nothing. A client whose row SAYS zero is listed at $0, because that is a fact
 * somebody entered about the month.
 *
 * A row whose client_id is not on the roster is dropped. Rows outlive the
 * client they belong to, and an id with no name renders as a blank line.
 */
export function monthBreakdown(
  clients: readonly RetentionClient[],
  rows: readonly RevenueRow[],
  period: string,
): MonthBreakdown {
  const byClient = new Map<number, RevenueRow>()
  for (const row of rows) {
    if (row.period === period) byClient.set(row.client_id, row)
  }

  const entries: ClientMonth[] = []
  let missing = 0
  let retainerCents = 0
  let projectCents = 0

  for (const client of clients) {
    const row = byClient.get(client.id)

    if (row === undefined) {
      if (couldBeBilled(client, period)) missing += 1
      continue
    }

    retainerCents += row.retainer_cents
    projectCents += row.project_cents
    entries.push({
      clientId: client.id,
      name: client.name,
      retainerCents: row.retainer_cents,
      projectCents: row.project_cents,
      totalCents: row.retainer_cents + row.project_cents,
    })
  }

  // Biggest payer first, and ties broken by NAME rather than left to the order
  // the rows happened to arrive in. Two clients on the same retainer is
  // ordinary here, and a list that reshuffles between renders reads as the data
  // changing.
  entries.sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name))

  return {
    period,
    clients: entries,
    retainerCents,
    projectCents,
    totalCents: retainerCents + projectCents,
    missing,
  }
}
