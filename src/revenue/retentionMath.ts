// Revenue retention: what happened to the money we already had. Pure, and
// separate from the components, so the rules below are testable without a DOM
// -- the same split as matrixMath.ts, tenureMath.ts and revenueMath.ts.
//
// Its own module rather than more of revenueMath.ts, which is already four
// unrelated exports: this is a distinct question with its own vocabulary, and
// a file that answers one question is one you can hold in your head.
//
// RETAINER ONLY. project_cents is not in RetentionRow and must not be added.
// Spec section 2: project work is real revenue that nobody expects to repeat,
// and a one-off project landing in a retention figure would report as
// retention something that is going to disappear next month by design.

export type RetentionClient = {
  id: number
  name: string
  started_on: string | null
  ended_on: string | null
}

export type RetentionRow = {
  client_id: number
  period: string
  retainer_cents: number
}

export type ContributionKind = 'retained' | 'expanded' | 'contracted' | 'churned'

export type Contribution = {
  clientId: number
  name: string
  baseCents: number
  currentCents: number
  deltaCents: number
  kind: ContributionKind
}

export type RetentionReport = {
  basePeriod: string
  currentPeriod: string
  // Clients the rates are computed FROM, and the two exclusions, kept apart
  // because they mean different things to a reader: one is a gap in the data
  // and the other is business won since.
  included: number
  unentered: number
  newBusiness: number
  baseCents: number
  currentCents: number
  nrr: number | null
  grr: number | null
  expansionCents: number
  contractionCents: number
  churnedCents: number
  contributions: Contribution[]
}

// The first of the month containing a date. Lifecycle boundaries are months,
// not days: a client who left on the 25th billed most of that month.
function monthOf(day: string): string {
  return `${day.slice(0, 7)}-01`
}

// Twelve months back, by string arithmetic on the year. Nothing here parses a
// Date: a bare YYYY-MM-DD parses as UTC midnight, whose local calendar day is
// the day before in any western zone -- the trap tenureMath.ts documents at
// length. Subtracting from the year leaves the month untouched, which is what
// makes January's base January and not December.
export function basePeriodFor(currentPeriod: string): string {
  const year = Number(currentPeriod.slice(0, 4))
  return `${year - 1}${currentPeriod.slice(4)}`
}

// The month the report is anchored to: the most recent one with any entry, not
// today. Spec section 3.3 -- on the 2nd of a month almost nothing is entered,
// and anchoring to the calendar would compute the figure from one or two
// clients every month for a week.
export function latestPeriod(rows: readonly RetentionRow[]): string | null {
  let latest: string | null = null
  for (const row of rows) {
    if (latest === null || row.period > latest) latest = row.period
  }
  return latest
}

export function retention(
  clients: readonly RetentionClient[],
  rows: readonly RetentionRow[],
  currentPeriod: string,
): RetentionReport {
  const basePeriod = basePeriodFor(currentPeriod)

  const baseByClient = new Map<number, number>()
  const currentByClient = new Map<number, number>()
  for (const row of rows) {
    if (row.period === basePeriod) baseByClient.set(row.client_id, row.retainer_cents)
    if (row.period === currentPeriod) currentByClient.set(row.client_id, row.retainer_cents)
  }

  const contributions: Contribution[] = []
  let unentered = 0
  let newBusiness = 0

  for (const client of clients) {
    const baseCents = baseByClient.get(client.id)

    if (baseCents === undefined) {
      // No base figure, so nothing to be retained against. Which exclusion it
      // is depends on whether we can say the client is NEW -- and with no start
      // date on file we cannot, so it goes to the honest bucket. Spec 3.1a.
      if (client.started_on !== null && monthOf(client.started_on) > basePeriod) {
        newBusiness += 1
      } else {
        unentered += 1
      }
      continue
    }

    const currentRow = currentByClient.get(client.id)
    let currentCents: number

    if (currentRow !== undefined) {
      currentCents = currentRow
    } else if (client.ended_on !== null && monthOf(client.ended_on) <= currentPeriod) {
      // CHURNED. The one place in this codebase where a missing row IS a zero,
      // and the exception is the whole point: a client who left bills nothing,
      // and losing them is what retention measures. Drop them instead and NRR
      // reports on the survivors alone.
      currentCents = 0
    } else {
      // Still active, nobody has typed this month. Unknown, not zero -- the
      // ordinary rule. Excluded from both sides so the rate stays a true
      // statement about the clients it does cover, and counted so the reader
      // knows how many it does not.
      unentered += 1
      continue
    }

    const deltaCents = currentCents - baseCents
    const kind: ContributionKind =
      currentRow === undefined
        ? 'churned'
        : deltaCents > 0
          ? 'expanded'
          : deltaCents < 0
            ? 'contracted'
            : 'retained'

    contributions.push({
      clientId: client.id,
      name: client.name,
      baseCents,
      currentCents,
      deltaCents,
      kind,
    })
  }

  // Largest effect first, in either direction: the question this ordering
  // answers is "why did it move", and the biggest mover is the answer.
  // Ties broken by name so the order is stable between renders.
  contributions.sort(
    (left, right) =>
      Math.abs(right.deltaCents) - Math.abs(left.deltaCents) ||
      left.name.localeCompare(right.name),
  )

  let baseCents = 0
  let currentCents = 0
  let capped = 0
  let expansionCents = 0
  let contractionCents = 0
  let churnedCents = 0

  for (const entry of contributions) {
    baseCents += entry.baseCents
    currentCents += entry.currentCents
    // The cap is the entire difference between the two rates: it makes growth
    // invisible, which is why GRR cannot exceed 1 and NRR can.
    capped += Math.min(entry.currentCents, entry.baseCents)

    if (entry.kind === 'churned') churnedCents += entry.deltaCents
    else if (entry.deltaCents > 0) expansionCents += entry.deltaCents
    else contractionCents += entry.deltaCents
  }

  // Null, not zero and not NaN: a base of nothing has no meaningful ratio, and
  // "0%" would read as a fact about the year. Same posture as share().
  const nrr = baseCents === 0 ? null : currentCents / baseCents
  const grr = baseCents === 0 ? null : capped / baseCents

  return {
    basePeriod,
    currentPeriod,
    included: contributions.length,
    unentered,
    newBusiness,
    baseCents,
    currentCents,
    nrr,
    grr,
    expansionCents,
    contractionCents,
    churnedCents,
    contributions,
  }
}
