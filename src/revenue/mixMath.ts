import type { RevenueRow } from './chartMath'
import type { RetentionClient } from './retentionMath'
import { daysBetween } from './tenureMath'

// Do retainer clients last longer and pay more than project clients?
//
// Asked by the owner's boss on 2026-09-11: "my belief is the monthly retainer
// is a stronger play for us, we make more money that way, I have this belief
// that we probably keep the retainer clients longer... but I might be wrong,
// and if I'm wrong, that grossly changes what maybe our focus should be."
//
// THE WHOLE POINT IS THAT THE ANSWER MIGHT CONTRADICT HIM, so nothing here may
// round in favour of the hypothesis. A client whose revenue splits exactly
// evenly is counted as a PROJECT client, because a dead heat is not evidence
// for the belief being tested.
//
// Pure, and separate from the component, so the rules are provable without a
// DOM -- the same split as every other maths module here.

export type EngagementKind = 'retainer' | 'project'

export type ClientEngagement = {
  clientId: number
  name: string
  kind: EngagementKind
  retainerCents: number
  projectCents: number
  totalCents: number
  /** Null when the client has no start date on file. See the note on §unknownStart. */
  tenureDays: number | null
}

export type GroupSummary = {
  count: number
  totalCents: number
  /** Null for an empty group: zero is a measurement, "none of these" is not. */
  medianTotalCents: number | null
  medianTenureDays: number | null
  /** How many of `count` have a start date, and so contribute to the tenure median. */
  tenureKnown: number
}

export type MixReport = {
  clients: ClientEngagement[]
  retainer: GroupSummary
  project: GroupSummary
  /**
   * Clients with no start date on file, excluded from the tenure medians.
   *
   * This is the caveat the report cannot be read without. Most of the roster
   * arrived through the 2026 import with a start date set to the FIRST INVOICE
   * MONTH, which is a floor on the relationship rather than its beginning --
   * and any client with no date at all would otherwise be counted as
   * zero-length. Stated, not hidden: a tenure comparison the reader cannot
   * calibrate is worse than none.
   */
  unknownStart: number
}

/**
 * The middle value, not the average.
 *
 * On a book where one client can be a fifth of revenue, a mean describes that
 * client rather than the group. The median is what survives a Dixxon.
 */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function summarise(group: readonly ClientEngagement[]): GroupSummary {
  const tenures = group
    .map((entry) => entry.tenureDays)
    .filter((days): days is number => days !== null)

  return {
    count: group.length,
    totalCents: group.reduce((sum, entry) => sum + entry.totalCents, 0),
    medianTotalCents: medianOf(group.map((entry) => entry.totalCents)),
    medianTenureDays: medianOf(tenures),
    tenureKnown: tenures.length,
  }
}

/**
 * Each client sorted into the kind of engagement their money says they are,
 * and the two groups summarised.
 *
 * Classification is DERIVED from the revenue rather than entered by hand:
 * nobody has typed a client type, and asking for one would mean a judgement
 * per client before the question could be asked at all. The split is already
 * recorded per month, so the majority of a client's money is the honest
 * answer -- and the per-client figures are returned so a reader can see how
 * clear-cut any given call was.
 *
 * A client with NO revenue is left out entirely. No money is not a kind of
 * engagement, and counting them would drag both medians toward zero.
 */
export function clientMix(
  clients: readonly RetentionClient[],
  rows: readonly RevenueRow[],
  asOf: string,
): MixReport {
  const money = new Map<number, { retainerCents: number; projectCents: number }>()
  for (const row of rows) {
    const found = money.get(row.client_id) ?? { retainerCents: 0, projectCents: 0 }
    found.retainerCents += row.retainer_cents
    found.projectCents += row.project_cents
    money.set(row.client_id, found)
  }

  const entries: ClientEngagement[] = []
  let unknownStart = 0

  for (const client of clients) {
    const found = money.get(client.id)
    if (found === undefined) continue

    const totalCents = found.retainerCents + found.projectCents
    if (totalCents === 0 && found.retainerCents === 0 && found.projectCents === 0) {
      // An entered zero across every month is a client who billed nothing, not
      // a kind of engagement. They would otherwise land in `project` on the
      // tie rule and drag its median down.
      continue
    }

    // Tenure runs to the day they LEFT, not to today, or every departed client
    // would appear to be still accruing.
    const end = client.ended_on ?? asOf
    if (client.started_on === null) unknownStart += 1

    entries.push({
      clientId: client.id,
      name: client.name,
      kind: found.retainerCents > found.projectCents ? 'retainer' : 'project',
      retainerCents: found.retainerCents,
      projectCents: found.projectCents,
      totalCents,
      tenureDays: client.started_on === null ? null : daysBetween(client.started_on, end),
    })
  }

  return {
    clients: entries,
    retainer: summarise(entries.filter((entry) => entry.kind === 'retainer')),
    project: summarise(entries.filter((entry) => entry.kind === 'project')),
    unknownStart,
  }
}
