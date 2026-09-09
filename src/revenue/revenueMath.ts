// The arithmetic behind the Revenue page. Pure, and separate from the
// components, so the rules below are testable without a DOM -- the same split
// as matrixMath.ts and tenureMath.ts.
//
// Named revenueMath and not revenue: src/shell/Revenue.tsx exists, and on a
// case-insensitive filesystem `./revenue` and `./Revenue` are the same path.
// Both neighbouring modules carry their names for that bug.

export type RevenueRow = {
  client_id: number
  period: string
  retainer_cents: number
  project_cents: number
}

// Only what concentration needs. Its own shape rather than the admin screen's
// client type: a report should not silently start depending on a column because
// an editing screen added one. useTenure's comment makes the same argument.
//
// `status` is REQUIRED rather than optional, deliberately. It is here only to
// answer "is this client paused", and an optional field would let a caller that
// forgot to select the column typecheck cleanly while every client silently
// read as not-paused -- the exact silent-default failure this project keeps
// producing. Required means the compiler names every call site instead.
export type EligibleClient = { id: number; name: string; status: string }

export type ConcentrationEntry = {
  clientId: number
  name: string
  cents: number
  share: number | null
}

// Named ConcentrationReport, not Concentration: the component that will render
// it arrives in a later task as Concentration.tsx exporting `function
// Concentration`, and a module cannot import a type whose name its own export
// shadows.
export type ConcentrationReport = {
  named: ConcentrationEntry[]
  rest: { count: number; cents: number; share: number | null } | null
  totalCents: number
  // Eligible clients WITH a row this month, and eligible clients WITHOUT one.
  // `missing` is rendered, not merely counted: see the note on the rule below.
  entered: number
  missing: number
}

// Four named, the rest collapsed. Four because that is where this roster stops
// being interesting, and because ten bars rank clients without showing
// exposure -- the question concentration exists to answer.
export const NAMED_CLIENTS = 4

// A trailing-twelve figure needs a month and the month twelve behind it.
export const MIN_RATE_PERIODS = 13

// A share of one complete period, as a fraction in [0, 1]. Never
// pre-multiplied: a function called `share` that returns 22 is one rename away
// from being read as dollars, and the caller that formats it is the caller that
// knows whether it wants a percentage or a bar width.
//
// Null when the whole is zero -- a real state, a month where nothing was
// billed -- rather than NaN, which renders as the literal text "NaN%".
export function share(part: number, whole: number): number | null {
  if (whole === 0) return null
  return part / whole
}

// Largest-remainder allocation: turns a set of amounts that share one total
// into integer percentages that sum to EXACTLY 100, which independent
// rounding of each row does not guarantee. Concentration's own named-clients
// example proves it both ways: 30 + 22.5 + 20 + 12.5 + 15 sums to precisely
// 100, but Math.round on each row independently gives 30 + 23 + 20 + 13 + 15
// -- 101 -- because both .5s round up with nothing to reconcile the total.
// Three equal thirds show the opposite failure: 33 + 33 + 33 is 99.
//
// This is the one report in the app built specifically to be trustworthy
// about exact shares -- the whole argument of spec section 9's amendment is
// that a share of a complete month is honest in a way an inferred rate is
// not. A reader who adds up the column and gets 101 has every reason to stop
// believing the number, even though the underlying fraction was exact.
//
// Null when there is nothing to allocate. A month where nothing was billed
// has null shares (share() above, for the same reason) and no percentages to
// render -- this must not manufacture a column of zeroes for a state that has
// none, which is what an unconditional divide would do the moment totalCents
// is 0.
//
// PRECONDITION: `amounts` must sum to EXACTLY `totalCents` -- it is the whole
// roster of a total, not a selection from it. That is what bounds the
// shortfall below to one point per row, and it is the only input this returns
// a column for. Both ways of breaking it are silent otherwise: pass a SUBSET
// (the four named rows without the rest row, say) and the shortfall exceeds
// the number of rows, the distribution loop walks off the end of `order`, and
// a TypeError lands inside a render; pass amounts totalling MORE and the
// shortfall goes negative, the loop never runs, and the function returns a
// column reading 120. Null instead, for both -- Concentration already renders
// amounts with no percentage beside them, and a report built to be
// trustworthy about exact shares must print no share rather than a wrong one.
export function allocatePercentages(
  amounts: readonly number[],
  totalCents: number,
): number[] | null {
  if (totalCents === 0) return null
  if (amounts.length === 0) return []

  // Exact integer comparison: money is integer cents everywhere, so there is
  // no tolerance to allow for here and none should be invented.
  if (amounts.reduce((sum, value) => sum + value, 0) !== totalCents) return null

  const exact = amounts.map((cents) => (cents / totalCents) * 100)
  const floors = exact.map(Math.floor)
  const flooredTotal = floors.reduce((sum, value) => sum + value, 0)

  // The shortfall is always a whole number of points, 0..amounts.length - 1:
  // each row's floor is within one point of its exact share, so the floors
  // together undershoot 100 by less than one point per row.
  const shortfall = 100 - flooredTotal

  // Largest fractional remainder first, so the rows closest to rounding up
  // are the ones that do. Ties -- the three-way equal split is the case that
  // forces this -- broken by the larger amount, and anything still tied after
  // that keeps its original order: Array.prototype.sort is stable, so two
  // equal amounts resolve to whichever came first in `amounts`, the same way
  // on every run.
  const order = amounts
    .map((cents, index) => ({ index, cents, remainder: exact[index] - floors[index] }))
    .sort((left, right) => right.remainder - left.remainder || right.cents - left.cents)

  const allocated = [...floors]
  for (let i = 0; i < shortfall; i++) {
    allocated[order[i].index] += 1
  }
  return allocated
}

// A rate across periods, oldest first. Null -- not a number -- until there are
// enough periods for it to mean anything.
//
// THIS IS THE ENFORCEMENT for spec section 9's amendment. Slice 6b forbade any
// percentage on the Revenue page with a regex over the rendered output, which
// was the right instinct and the wrong mechanism: a regex cannot tell a true
// "22% of September" from a meaningless "91.2% GRR". A function that refuses to
// produce the second one can. Nothing calls this yet -- no rate ships in slice
// 6c -- and it exists anyway, because removing the old guard without putting
// this one in place in the same change would leave a window with neither.
//
// GROWTH, not retention -- last period over first, across whatever window is
// passed in. That is slice 6d's question ("is revenue larger than it was"),
// and a different one from retention's ("did we keep the money we already
// had"): a roster that churned its smallest clients and backfilled with
// larger new ones can show growth here while NRR and GRR, in
// retentionMath.ts, report the churn plainly. Nothing calls `rate()` as of
// slice 6f-1 either, and it stays -- deliberately unused rather than dead --
// for the same reason it was written unused in 6c: 6d's growth question is
// real and this is its arithmetic, waiting on its own slice rather than on
// retention borrowing it for a question it does not answer.
export function rate(periods: readonly number[]): number | null {
  if (periods.length < MIN_RATE_PERIODS) return null
  const first = periods[0]
  if (first === 0) return null
  return periods[periods.length - 1] / first
}

export function concentration(
  clients: readonly EligibleClient[],
  rows: readonly RevenueRow[],
): ConcentrationReport {
  const byClient = new Map(rows.map((entry) => [entry.client_id, entry]))

  // Driven by the ELIGIBLE ROSTER, not by the rows. Two consequences, both
  // deliberate:
  //
  // 1. A client with no row is absent from the chart and counted in `missing`.
  //    A row with 0 means "entered; billed nothing" and appears at zero; no row
  //    means "nobody has said yet". If those collapse, an unfilled month reads
  //    as a client billing nothing, which on this page reads as churn. Spec
  //    section 3.3, and the same rule as checkins.legacy_total_score being null
  //    whenever a pillar is null.
  //
  // 2. A row whose client is not eligible this month is ignored rather than
  //    rendered nameless. Rows outlive eligibility -- a client who departed in
  //    August still has an August row -- and a row-driven loop would invent an
  //    entry for one.
  const entered: ConcentrationEntry[] = []
  let missing = 0

  for (const client of clients) {
    const found = byClient.get(client.id)
    if (found === undefined) {
      // A PAUSED client with no row is not owed. The board already says "no
      // check-in is expected this month" of a paused client and gives that its
      // own sentence; this report counted them as somebody who still owed a
      // figure, so the missing count read one high every month forever unless a
      // person typed a 0 for them each time. Production has one such client.
      //
      // They fall out of BOTH counts rather than into `entered`: they have no
      // row, so calling them entered would be a lie, and `entered + missing` is
      // then exactly the number of clients a figure is expected from -- which is
      // the denominator both captions print.
      //
      // Only the absent case is skipped. A paused client who DID bill has a row,
      // never reaches here, and is ranked like anyone else: paused means the
      // check-ins stop, not that the retainer does.
      if (client.status === 'paused') continue
      missing += 1
      continue
    }
    entered.push({
      clientId: client.id,
      name: client.name,
      cents: found.retainer_cents + found.project_cents,
      share: null,
    })
  }

  // Descending by amount, then by name so the order is stable when two clients
  // bill the same -- without it, two equal rows swap places between renders for
  // no reason the reader can see.
  entered.sort((left, right) => right.cents - left.cents || left.name.localeCompare(right.name))

  const totalCents = entered.reduce((sum, item) => sum + item.cents, 0)
  const withShares = entered.map((item) => ({ ...item, share: share(item.cents, totalCents) }))

  const named = withShares.slice(0, NAMED_CLIENTS)
  const remainder = withShares.slice(NAMED_CLIENTS)

  // Null rather than a zero-count rest row: "and 0 others" is a sentence about
  // nothing, and drawing it makes a complete list look truncated.
  const rest =
    remainder.length === 0
      ? null
      : {
          count: remainder.length,
          cents: remainder.reduce((sum, item) => sum + item.cents, 0),
          share: share(
            remainder.reduce((sum, item) => sum + item.cents, 0),
            totalCents,
          ),
        }

  return { named, rest, totalCents, entered: withShares.length, missing }
}
