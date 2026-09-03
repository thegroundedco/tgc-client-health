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
export type EligibleClient = { id: number; name: string }

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
