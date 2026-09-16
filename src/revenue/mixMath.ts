import type { RevenueRow } from './chartMath'
import type { RetentionClient } from './retentionMath'

// What are clients actually paying, and does that money say retainer or
// project?
//
// Asked by the owner's boss on 2026-09-11: "my belief is the monthly retainer
// is a stronger play for us, we make more money that way, I have this belief
// that we probably keep the retainer clients longer... but I might be wrong,
// and if I'm wrong, that grossly changes what maybe our focus should be."
//
// This module answers only the money half of that. Tenure moved out to
// `Tenure` and `Churn`, which carry it with the caveat it needs: most start
// dates on file are import floors -- the first invoice month a client was
// brought in under -- rather than when the relationship actually began, and a
// module that mixed the two questions could not state that caveat once for
// both.
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
  /** The client's lifecycle status, carried so the ranking can filter on it. */
  status: string
  kind: EngagementKind
  retainerCents: number
  projectCents: number
  totalCents: number
  /** Months in which this client billed anything. An entered zero is not one. */
  monthsBilled: number
}

export type GroupSummary = {
  count: number
  totalCents: number
  /** Null for an empty group: zero is a measurement, "none of these" is not. */
  medianTotalCents: number | null
}

export type MixReport = {
  clients: ClientEngagement[]
  retainer: GroupSummary
  project: GroupSummary
}

/**
 * The middle value, not the average.
 *
 * On a book where one client can be a fifth of revenue, a mean describes that
 * client rather than the group. The median is what survives a Dixxon.
 *
 * INTEGER CENTS OUT, ALWAYS. The middle pair of an even-sized group is
 * averaged, and two clients at $1,000.01 and $1,000.02 average to a HALF
 * cent -- which `formatMoney` prints as "$1,000.02", a figure no client
 * billed, on a page where every other number is exact. Every caller of this
 * function is now money (tenure left this module earlier in the slice), so the
 * rounding belongs here rather than at each reader.
 *
 * Rounding cannot manufacture evidence for the hypothesis being tested: the
 * two group medians round by the same rule, and the only verdict a half cent
 * can change is a near-tie into a DEAD HEAT, which is the reading that
 * declines to pick a winner.
 */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

function summarise(group: readonly ClientEngagement[]): GroupSummary {
  return {
    count: group.length,
    totalCents: group.reduce((sum, entry) => sum + entry.totalCents, 0),
    medianTotalCents: medianOf(group.map((entry) => entry.totalCents)),
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
): MixReport {
  const money = new Map<
    number,
    { retainerCents: number; projectCents: number; months: Set<string> }
  >()
  for (const row of rows) {
    const found = money.get(row.client_id) ?? {
      retainerCents: 0,
      projectCents: 0,
      months: new Set<string>(),
    }
    found.retainerCents += row.retainer_cents
    found.projectCents += row.project_cents
    // A month counts as BILLED only if money changed hands in it. An entered
    // zero is a month somebody confirmed was empty, and dividing by it would
    // report a lower monthly rate for the client whose zeroes were diligently
    // entered than for the one whose were never typed at all.
    if (row.retainer_cents + row.project_cents > 0) found.months.add(row.period)
    money.set(row.client_id, found)
  }

  const entries: ClientEngagement[] = []

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

    entries.push({
      clientId: client.id,
      name: client.name,
      status: client.status,
      kind: found.retainerCents > found.projectCents ? 'retainer' : 'project',
      retainerCents: found.retainerCents,
      projectCents: found.projectCents,
      totalCents,
      monthsBilled: found.months.size,
    })
  }

  return {
    clients: entries,
    retainer: summarise(entries.filter((entry) => entry.kind === 'retainer')),
    project: summarise(entries.filter((entry) => entry.kind === 'project')),
  }
}
