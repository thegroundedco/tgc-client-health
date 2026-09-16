import { clientMix } from './mixMath'
import type { ClientEngagement, EngagementKind, MixReport } from './mixMath'
import type { RevenueRow } from './chartMath'
import type { RetentionClient } from './retentionMath'

// What each client is worth, and what that says about the two kinds of client.
//
// The owner's boss described a lifetime-value formula at a whiteboard on
// 2026-09-11. The version that reached us -- through a transcript, not the
// photograph -- multiplied a project client's monthly equivalent back out
// across the whole relationship, including months in which nothing was billed.
// That quadruples a $30,000 client who stays a year, and it manufactures
// evidence AGAINST the hypothesis its own author holds, which is how we know
// it is a transcription error rather than a finding.
//
// What survives is the monthly equivalent itself, which is a RATE and not a
// lifetime: fee over months billed, so a three-month project and a monthly
// retainer can be held side by side. Lifetime value is money actually billed
// and nothing else.
//
// Pure, and separate from the component, so every rule above is provable
// without a DOM -- the same split as every other maths module here.

/** How many clients the ranking draws before a reader asks for the rest. */
export const TOP_N = 10

export type ValueRow = ClientEngagement & {
  /**
   * Total billed over months billed. Null only when no month was billed, which
   * cannot happen for a listed client -- `clientMix` drops those -- so the null
   * is a type-level honesty rather than a state the page renders.
   */
  monthlyEquivalentCents: number | null
}

export type Verdict = {
  /** Null for a dead heat, and null when either kind has nobody in it. */
  winner: EngagementKind | null
  /** Null when no client of that kind has billed anything. */
  retainerMedianCents: number | null
  projectMedianCents: number | null
  /** Every client the verdict was drawn from -- active and departed alike. */
  clientCount: number
}

export function monthlyEquivalent(totalCents: number, monthsBilled: number): number | null {
  if (monthsBilled <= 0) return null
  // Rounded to whole cents. formatMoney renders cents, and a fractional cent
  // would print a third decimal place on a page where every other figure is
  // exact.
  return Math.round(totalCents / monthsBilled)
}

/**
 * Which kind of client is worth more, and by how much.
 *
 * THE ANSWER MAY CONTRADICT THE MAN WHO ASKED FOR IT, and nothing here may
 * round in his favour. `clientMix` already counts an exact revenue tie as a
 * PROJECT client for the same reason; a tie between the two medians is
 * reported as no winner rather than resolved toward the belief being tested.
 */
export function verdictFrom(report: MixReport): Verdict {
  const retainer = report.retainer.medianTotalCents
  const project = report.project.medianTotalCents

  const winner =
    retainer === null || project === null
      ? null
      : retainer === project
        ? null
        : retainer > project
          ? 'retainer'
          : 'project'

  return {
    winner,
    retainerMedianCents: retainer,
    projectMedianCents: project,
    clientCount: report.clients.length,
  }
}

/** The clients board's allowlist, not "has no end date": a paused client is not active. */
export function isActive(status: string): boolean {
  return status === 'active'
}

export function departedCount(rows: readonly ValueRow[]): number {
  return rows.filter((entry) => !isActive(entry.status)).length
}

export function eligibleCount(rows: readonly ValueRow[], showDeparted: boolean): number {
  return showDeparted ? rows.length : rows.filter((entry) => isActive(entry.status)).length
}

/**
 * The rows to draw, filtered then cut.
 *
 * Departed clients are ranked INTO the list rather than appended after it, so
 * revealing them can displace an active client from the top ten. That is the
 * number being honest: a client of four years who left outranks most of a
 * current book, and pinning the ranking would show an order true of no set of
 * clients.
 */
export function visibleRows(
  rows: readonly ValueRow[],
  showDeparted: boolean,
  showAll: boolean,
): ValueRow[] {
  const eligible = showDeparted ? [...rows] : rows.filter((entry) => isActive(entry.status))
  return showAll ? eligible : eligible.slice(0, TOP_N)
}

// Named in both directions, so each control says what pressing it will do
// rather than what state it is in -- the board's toggleLabel does the same,
// and for the same reason.
export function departedToggleLabel(departed: number, showDeparted: boolean): string {
  return `${showDeparted ? 'Hide' : 'Show'} ${departed} departed`
}

export function lengthToggleLabel(eligible: number, showAll: boolean): string {
  return showAll ? `Show top ${TOP_N}` : `Show all ${eligible}`
}

/**
 * Every client ranked by what they have actually billed, and the verdict drawn
 * from all of them.
 *
 * The verdict does NOT follow the list's filter, and the component says so in
 * the sentence: a completed relationship is the only complete lifetime value
 * there is, so a verdict drawn from active clients alone would rest on the
 * weaker half of the evidence and drift upward every month.
 */
export function clientValue(
  clients: readonly RetentionClient[],
  rows: readonly RevenueRow[],
): { rows: ValueRow[]; verdict: Verdict } {
  const report = clientMix(clients, rows)

  const ranked = report.clients
    .map((entry) => ({
      ...entry,
      monthlyEquivalentCents: monthlyEquivalent(entry.totalCents, entry.monthsBilled),
    }))
    // Copied by `map` above, so this sorts a new array rather than the report's.
    // Ties break on name: equal money must not reshuffle between renders.
    .sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name))

  return { rows: ranked, verdict: verdictFrom(report) }
}
