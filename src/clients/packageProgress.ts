import { isChurned } from './clientForm'
import { PACKAGE_CODES, currentStint, journeyOf, sortStints } from './clientPackages'
import type { PackageStint } from './clientPackages'
import { medianOf } from '../revenue/mixMath'
import { departedRows } from '../revenue/tenureMath'

// Who is on which rung, who has moved, and whether the on-ramp works.
//
// The owner's boss, 2026-09-11: "I would love to see a brand join us and we're
// in foundation. And then I'd love to see them graduate from foundation into
// grow... almost being able to see which brands are moving up the ladder with
// us... Do they stay with us longer than a brand who skips foundation and jumps
// straight into grow?"
//
// In clients/ rather than shell/ deliberately: this is domain arithmetic about
// clients, not this application's chrome, and it is meant to survive the tool
// being folded into another. Pure for the same reason clientPackages.ts is --
// src/lib/supabase.ts throws at import when the VITE_ config is absent, and CI
// runs vitest with no VITE_ env at all.

/**
 * The lifecycle columns every rule here reads.
 *
 * Narrower than tenureMath's LifecycleClient on purpose: the roster Overview
 * already holds comes from useRetention, which does not select end_reason_note.
 * Task 2 makes departedRows accept this.
 */
export type ProgressClient = {
  id: number
  name: string
  status: string
  started_on: string | null
  ended_on: string | null
}

/**
 * The rung a client came in on.
 *
 * The EARLIEST stint by date, via sortStints -- not the first row returned.
 * Rows arrive in whatever order the database gives them, and somebody
 * correcting history enters an older stint after a newer one.
 *
 * An unrecognised code comes back as itself rather than as null, which is where
 * this parts company with journeyOf. That function must place a rung ON the
 * ladder to judge movement and cannot place one it does not know; this one is
 * only ever asked whether the rung IS foundation, and "some other rung" is a
 * true answer to that.
 */
export function entryRung(stints: readonly PackageStint[]): string | null {
  const sorted = sortStints(stints)
  return sorted.length === 0 ? null : sorted[0].package_code
}

export type LadderStanding = {
  rungs: { code: string; count: number }[]
  unrecorded: number
}

/**
 * Where the current roster sits, and how much of it is unrecorded.
 *
 * ACTIVE MEANS NOT CHURNED, which includes paused: clientForm describes paused
 * as "still a client, but not being scored right now", so they sit on a rung.
 * `status === 'active'` is the wrong test and the easy mistake here.
 *
 * `unrecorded` is returned beside the rungs and not as an afterthought. A ladder
 * showing three counts and hiding the fourth would undo clientPackages' decision
 * that null is "nobody has said" rather than foundation -- at the last step,
 * where it is least visible.
 *
 * A rung this vocabulary does not know is counted after the three it does,
 * rather than silently dropped or folded into unrecorded: somebody IS on it.
 */
export function ladderStanding(
  clients: readonly ProgressClient[],
  byClient: ReadonlyMap<number, PackageStint[]>,
  asOf: string,
): LadderStanding {
  const counts = new Map<string, number>(PACKAGE_CODES.map((code) => [code, 0]))
  let unrecorded = 0

  for (const client of clients) {
    if (isChurned(client.status)) continue

    // currentStint already ignores a stint dated in the future: a move recorded
    // ahead of time is a plan, not the current state.
    const stint = currentStint(byClient.get(client.id) ?? [], asOf)
    if (stint === null) {
      unrecorded += 1
      continue
    }
    counts.set(stint.package_code, (counts.get(stint.package_code) ?? 0) + 1)
  }

  return {
    rungs: [...counts].map(([code, count]) => ({ code, count })),
    unrecorded,
  }
}

export type Move = {
  clientId: number
  name: string
  /** The rung they entered on. */
  from: string
  /** The highest rung reached for a climb, the lowest for a descent. */
  to: string
  /** Where they are today, when that is not `to`. Null when it is. */
  now: string | null
}

export type Movements = { climbed: Move[]; descended: Move[] }

/**
 * Who has moved, in which direction, most recent move first.
 *
 * Membership is journeyOf and nothing else, so these lists cannot come to a
 * different view from the function that defines the words. That also means
 * `from` and `to` describe the ENTRY and the EXTREME rung rather than the
 * latest one, because that is how journeyOf decides -- foundation to scale and
 * back to grow is a client who climbed. `now` exists so that reading does not
 * imply scale is current.
 *
 * Departed clients are included. A completed relationship still climbed, and
 * dropping them would make these lists a story about the current roster.
 */
export function movements(
  clients: readonly ProgressClient[],
  byClient: ReadonlyMap<number, PackageStint[]>,
  asOf: string,
): Movements {
  const climbed: { move: Move; on: string }[] = []
  const descended: { move: Move; on: string }[] = []

  for (const client of clients) {
    const stints = byClient.get(client.id) ?? []
    const journey = journeyOf(stints)
    if (journey === null || journey === 'stayed') continue

    const sorted = sortStints(stints)
    // journeyOf returned non-null, so every rung is on the ladder.
    const rungs = sorted.map((entry) => PACKAGE_CODES.indexOf(entry.package_code))
    const extreme = journey === 'climbed' ? Math.max(...rungs) : Math.min(...rungs)
    const reached = sorted[rungs.indexOf(extreme)]
    const current = currentStint(sorted, asOf)

    const move: Move = {
      clientId: client.id,
      name: client.name,
      from: sorted[0].package_code,
      to: reached.package_code,
      now:
        current === null || current.package_code === reached.package_code
          ? null
          : current.package_code,
    }
    ;(journey === 'climbed' ? climbed : descended).push({ move, on: reached.started_on })
  }

  // Most recent move first: this page is a snapshot, and who moved lately is
  // the more useful half of who moved. Two YYYY-MM-DD strings compare correctly
  // as strings, which is why nothing here parses one to order it.
  const order = (a: { move: Move; on: string }, b: { move: Move; on: string }) =>
    b.on.localeCompare(a.on) || a.move.name.localeCompare(b.move.name)

  return {
    climbed: climbed.sort(order).map((entry) => entry.move),
    descended: descended.sort(order).map((entry) => entry.move),
  }
}

/**
 * How many measured relationships each side needs before a median is printed.
 *
 * Three, set by the owner on 2026-09-24: low enough that the sentence can
 * appear within a few months of the history being recorded, high enough that
 * one unusual departure cannot set a median by itself. Exported so the rule and
 * the sentence describing it cannot drift apart.
 */
export const MIN_GROUP = 3

export type Group = {
  /** Everybody in the group, including those with no start date. */
  count: number
  /** How many of them could actually be measured. */
  measured: number
  medianDays: number
}

export type Comparison =
  | { kind: 'waiting'; foundation: number; above: number }
  | {
      kind: 'ready'
      foundation: Group
      above: Group
      longer: 'foundation' | 'above' | 'tie'
    }

/**
 * Whether clients who joined at Foundation stayed longer than clients who
 * joined above it.
 *
 * THIS IS NOT THE COMPARISON THAT WAS ASKED FOR, and spec section 1 is the
 * argument. The question as put pairs clients who signed at Foundation AND
 * graduated against everyone who joined above Foundation -- so the first group
 * holds only the on-ramp's successes while the second holds winners and losers
 * alike, and it would report Foundation as the stronger on-ramp whatever the
 * truth is. Both groups are therefore fixed at the moment the client signed:
 * nothing that happens afterwards can move anybody between them.
 *
 * NO asOf PARAMETER. Every relationship here has ended and is measured to the
 * day it ended, so no clock changes an answer. Slice C removed exactly such a
 * parameter from clientMix rather than leave it unused, so that a future caller
 * could not supply a date under the impression it changed something.
 *
 * departedRows is reused rather than refiltered: it already decides who has
 * left, already measures to the day they left rather than to today, and already
 * returns null days when a date is missing. Three chances for this section and
 * the Tenure report to disagree, removed.
 */
export function onRampComparison(
  clients: readonly ProgressClient[],
  byClient: ReadonlyMap<number, PackageStint[]>,
): Comparison {
  const days: { foundation: (number | null)[]; above: (number | null)[] } = {
    foundation: [],
    above: [],
  }

  for (const row of departedRows(clients)) {
    // A client with no recorded stint has no entry rung -- entryRung([]) is
    // null -- so they join NEITHER group. This is the population the spec
    // describes: joined at Foundation, or joined above it, with "joined"
    // meaning a package was actually recorded, not merely that the client
    // existed.
    const rung = entryRung(byClient.get(row.client.id) ?? [])
    if (rung === null) continue
    days[rung === 'foundation' ? 'foundation' : 'above'].push(row.days)
  }

  // Counted and measured are not the same number -- the distinction
  // tenureMath.summarise already documents. A departed client with no start
  // date is IN the group and OUT of the median: treating the unknown as a zero
  // would drag the median down, and dropping them from the count would answer a
  // different question from the one the sentence appears to answer.
  function group(all: readonly (number | null)[]) {
    const measured = all.filter((value): value is number => value !== null)
    return { count: all.length, measured: measured.length, medianDays: medianOf(measured) }
  }

  const foundation = group(days.foundation)
  const above = group(days.above)

  // MIN_GROUP gates on the MEASURED count, since that is what the median rests
  // on. The null checks are narrowing rather than defence: medianOf returns null
  // only for an empty list, which measured >= MIN_GROUP already excludes.
  if (
    foundation.measured < MIN_GROUP ||
    above.measured < MIN_GROUP ||
    foundation.medianDays === null ||
    above.medianDays === null
  ) {
    return { kind: 'waiting', foundation: foundation.measured, above: above.measured }
  }

  return {
    kind: 'ready',
    foundation: { ...foundation, medianDays: foundation.medianDays },
    above: { ...above, medianDays: above.medianDays },
    longer:
      foundation.medianDays === above.medianDays
        ? 'tie'
        : foundation.medianDays > above.medianDays
          ? 'foundation'
          : 'above',
  }
}
