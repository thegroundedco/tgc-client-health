import type { Band } from '../lib/scoreMath'
import { overExposed } from '../revenue/revenueMath'

// What needs attention, gathered from two places that do not otherwise meet.
//
// The owner, 2026-09-11, describing this screen to his boss: "I imagine you'll
// want to see anything that's flagged like the clients that are taking up 20%
// at least 20% of revenue as far as concentration goes, and then clients who
// are flagged as at risk in the scores. I just don't want you to have to go
// through and sort all this if you aren't wanting to."
//
// Pure, so the rules below are provable without a DOM and without either of
// the two reads this page makes.

export type Flag =
  | { kind: 'exposure'; share: number }
  | { kind: 'at_risk'; score: number | null }

export type FlaggedClient = {
  clientId: number
  name: string
  flags: Flag[]
}

export type ScoreBand = { name: string; band: Band; score: number | null }

/**
 * Every client with something worth acting on, worst first.
 *
 * ONLY `at_risk`, never `watch`. Watch is the band that says keep an eye out;
 * this screen is for what needs acting on, and raising both would make the
 * list the whole roster on any month with a few soft scores.
 *
 * `incomplete` is never raised either. No score is not a bad score, and a
 * false "at risk" is as harmful as a false "healthy" -- the rule the board
 * already follows.
 */
export function flagged({
  bands,
  shares,
}: {
  bands: ReadonlyMap<number, ScoreBand>
  shares: readonly { clientId: number; name: string; share: number | null }[]
}): FlaggedClient[] {
  const byClient = new Map<number, FlaggedClient>()

  function entryFor(clientId: number, name: string): FlaggedClient {
    const found = byClient.get(clientId) ?? { clientId, name, flags: [] }
    byClient.set(clientId, found)
    return found
  }

  for (const entry of shares) {
    // A null share is not a small one: share() returns null when the whole is
    // zero, and an alarm there would be about no revenue at all.
    if (!overExposed(entry.share)) continue
    entryFor(entry.clientId, entry.name).flags.push({
      kind: 'exposure',
      share: entry.share as number,
    })
  }

  for (const [clientId, scored] of bands) {
    if (scored.band !== 'at_risk') continue
    entryFor(clientId, scored.name).flags.push({ kind: 'at_risk', score: scored.score })
  }

  // Worst first: a client who is both a large share AND scoring badly is the
  // one to look at, and burying it under an alphabetical sort would make the
  // reader do the sorting this screen exists to save them.
  return [...byClient.values()].sort((a, b) => {
    if (b.flags.length !== a.flags.length) return b.flags.length - a.flags.length
    const shareOf = (entry: FlaggedClient) =>
      entry.flags.find((flag) => flag.kind === 'exposure')?.share ?? 0
    return shareOf(b) - shareOf(a) || a.name.localeCompare(b.name)
  })
}
