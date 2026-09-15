// What a client is worth per month, now, for their card on the board.
//
// THIS MODULE DERIVES NOTHING FOR PROJECT CLIENTS, deliberately. A retainer
// client has a monthly rate: it is what they bill in a month. A project client
// does not, and inventing one means fee over duration -- which is exactly the
// formula the owner's boss described at a whiteboard for lifetime value, and
// which has its own slice waiting on a photograph of it. Guessing it here and
// correcting it there is work done twice, in the one place a wrong figure
// would be read as a fact about a client's worth.
//
// Pure, and separate from the read for the same reason every other pair in
// this codebase is: these rules are testable without a database or a DOM.

export type RateRow = {
  client_id: number
  period: string
  retainer_cents: number
  project_cents: number
}

export type ClientRate = { cents: number; kind: 'retainer' | 'project' }

/**
 * The latest month each client actually billed in, as a rate.
 *
 * PER CLIENT, not the roster's latest month. A client who stopped billing in
 * July still has a July rate, and reading everybody against September would
 * silently give them nothing -- which the card would then show as "no revenue
 * entered", a different and untrue statement.
 *
 * FIND THE LATEST MONTH FIRST, THEN DECIDE -- never filter zero rows out
 * before choosing "latest". A client who billed $4,000 in July and then $0 in
 * September has SEPTEMBER as their latest month, full stop; filtering the
 * zero row out first would let July win by default and show a stale figure as
 * a current one, which is the wrong-direction misstatement this card exists
 * to refuse. So the zero month, once found, must end in no rate rather than
 * in a fallback to whatever came before it.
 *
 * A latest month of zero yields NO RATE. An entered zero is a fact about a
 * month, not a rate: "they are a nothing-a-month client" is not what that row
 * says, and a card reading zero would claim the agency bills them nothing.
 */
export function currentRates(rows: readonly RateRow[]): Map<number, ClientRate> {
  const latest = new Map<number, RateRow>()
  for (const row of rows) {
    const held = latest.get(row.client_id)
    // Periods are YYYY-MM-01 strings and compare correctly as strings, which is
    // why nothing here parses a Date -- the trap tenureMath documents at length.
    // Every row competes for "latest" here, zero or not: a $0 September must be
    // able to beat a $4,000 July, or a stale rate would read as current.
    if (held === undefined || row.period > held.period) latest.set(row.client_id, row)
  }

  const rates = new Map<number, ClientRate>()
  for (const [clientId, row] of latest) {
    // Decided only now, on the month that actually won "latest". A zero here
    // ends in no rate rather than in a look back at an earlier, non-zero month.
    if (row.retainer_cents === 0 && row.project_cents === 0) continue
    // The retainer wins a month that holds both. A retainer client who also ran
    // a project is still a retainer client, and the retainer is the recurring
    // half -- which is what "rate" means.
    rates.set(
      clientId,
      row.retainer_cents > 0
        ? { cents: row.retainer_cents, kind: 'retainer' }
        : { cents: row.project_cents, kind: 'project' },
    )
  }
  return rates
}
