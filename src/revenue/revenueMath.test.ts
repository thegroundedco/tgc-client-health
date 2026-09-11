import { describe, expect, it } from 'vitest'
import {
  allocatePercentages,
  concentration,
  concentrationOverRange,
  MIN_RATE_PERIODS,
  NAMED_CLIENTS,
  rate,
  share,
  type EligibleClient,
  type RevenueRow,
} from './revenueMath'

const CLIENTS: EligibleClient[] = [
  { id: 1, name: 'Acme', status: 'active' },
  { id: 2, name: 'Delta', status: 'active' },
  { id: 3, name: 'East Bay', status: 'active' },
  { id: 4, name: 'Northgate', status: 'active' },
  { id: 5, name: 'Harbor Row', status: 'active' },
  { id: 6, name: 'Ivy Lane', status: 'active' },
]

// A paused client is ELIGIBLE -- the check constraint refuses them an end date,
// so useRevenue's `ended_on.is.null` arm returns them -- but nobody owes a
// figure for them. See the two tests near the bottom of the concentration
// block.
function paused(client: EligibleClient): EligibleClient {
  return { ...client, status: 'paused' }
}

function row(client_id: number, retainer_cents: number, project_cents = 0): RevenueRow {
  return { client_id, period: '2026-09-01', retainer_cents, project_cents }
}

describe('share', () => {
  it('returns a fraction, never a pre-multiplied percentage', () => {
    // 22, returned from a function called `share`, is one rename away from
    // being read as dollars. The caller multiplies; this does not.
    expect(share(2200, 10000)).toBe(0.22)
  })

  it('returns null when the whole is zero rather than dividing by it', () => {
    // A real state: a month where nothing was billed. Not an error, and not
    // NaN, which would render as the literal text "NaN%".
    expect(share(0, 0)).toBe(null)
  })
})

describe('allocatePercentages', () => {
  it('sums to exactly 100 on the named-clients example, where independent rounding gives 101', () => {
    // Concentration's own fixture: 450000, 250000, 600000, 400000, 200000,
    // 100000 of 2000000 -- exact percentages 22.5, 12.5, 30, 20, 10, 5. Two
    // rows sit on the .5 boundary and Math.round on each independently sends
    // both up, landing the column at 101.
    const amounts = [450000, 250000, 600000, 400000, 200000, 100000]
    const total = amounts.reduce((sum, value) => sum + value, 0)

    const allocated = allocatePercentages(amounts, total)

    expect(allocated?.reduce((sum, value) => sum + value, 0)).toBe(100)
  })

  it('sums to exactly 100 on an equal three-way split, where independent rounding gives 99', () => {
    // The opposite failure from the case above: 33.33 + 33.33 + 33.33 floors
    // to 33 + 33 + 33, three points short of 100, with no row anywhere near a
    // .5 boundary to round up on its own.
    const allocated = allocatePercentages([1, 1, 1], 3)

    expect(allocated?.reduce((sum, value) => sum + value, 0)).toBe(100)
  })

  it('never moves a row more than one point from its unrounded share', () => {
    const amounts = [450000, 250000, 600000, 400000, 200000, 100000]
    const total = amounts.reduce((sum, value) => sum + value, 0)

    const allocated = allocatePercentages(amounts, total)

    allocated?.forEach((points, index) => {
      const exact = (amounts[index] / total) * 100
      expect(Math.abs(points - exact)).toBeLessThanOrEqual(1)
    })
  })

  it('returns null for a month where nothing was billed, rather than a row of zeroes', () => {
    // share() returns null when the whole is zero for the same reason: a
    // column of "0%" reads as a fact about the month -- nobody billed
    // anything -- when the truth is that the total itself is zero and no
    // share is meaningful to show.
    expect(allocatePercentages([0, 0, 0], 0)).toBe(null)
  })

  it('refuses amounts that do not add up to the total, rather than throwing inside a render', () => {
    // OUT OF CONTRACT, and it used to be a blank screen. The allocation only
    // terminates correctly when `amounts` sums to `totalCents`: that is what
    // bounds the shortfall to one point per row. Hand it Concentration's
    // fixture with only the four NAMED rows and no rest row -- "I just need
    // percentages for the named clients", the obvious next call -- and the
    // four sum to 1700000 of 2000000. Floors are 22 + 12 + 30 + 20 = 84, so
    // the shortfall is 16 with only 4 rows to give it to, and the loop walked
    // off the end of `order` and read `.index` off undefined. A TypeError
    // thrown in a render is how a screen on this project goes blank.
    const namedOnly = [450000, 250000, 600000, 400000]

    expect(() => allocatePercentages(namedOnly, 2000000)).not.toThrow()
    expect(allocatePercentages(namedOnly, 2000000)).toBe(null)
  })

  it('refuses amounts that add up to more than the total, rather than printing a column over 100', () => {
    // The same broken precondition the other way, and the reason this is a
    // sum check rather than a clamp on the loop. Two 600000 rows against a
    // 1000000 total floor to 60 + 60: the shortfall is negative, so the loop
    // never runs, nothing walks off the end, and the function happily returns
    // a column reading 60% and 60%. Clamping the loop leaves that untouched.
    // Null is the honest answer -- Concentration already renders dollar
    // amounts with no percentage beside them for it, the same way it handles
    // a month where nothing was billed.
    expect(allocatePercentages([600000, 600000], 1000000)).toBe(null)
  })
})

describe('rate', () => {
  it('names the threshold as thirteen', () => {
    // A trailing-twelve figure needs a month AND the month twelve behind it.
    expect(MIN_RATE_PERIODS).toBe(13)
  })

  it('refuses to produce a number below the threshold', () => {
    // THE guard for spec section 9. A page-level regex cannot tell a true 22%
    // from a meaningless 91.2%; a function that will not produce the second
    // one can. Six months is exactly what the owner can backfill, so this is
    // the live case and not a hypothetical.
    expect(rate(Array(6).fill(400000))).toBe(null)
    expect(rate(Array(12).fill(400000))).toBe(null)
  })

  it('produces a figure at the threshold', () => {
    const flat = Array(MIN_RATE_PERIODS).fill(400000)
    expect(rate(flat)).toBe(1)
  })

  it('measures the last period against the first', () => {
    const periods = Array(MIN_RATE_PERIODS).fill(400000)
    periods[MIN_RATE_PERIODS - 1] = 200000
    expect(rate(periods)).toBe(0.5)
  })

  it('returns null when the earliest period is zero rather than dividing by it', () => {
    const periods = Array(MIN_RATE_PERIODS).fill(400000)
    periods[0] = 0
    expect(rate(periods)).toBe(null)
  })
})

describe('concentration', () => {
  it('names the cap as four', () => {
    expect(NAMED_CLIENTS).toBe(4)
  })

  it('ranks clients by total, largest first', () => {
    const result = concentration(CLIENTS.slice(0, 3), [
      row(1, 400000),
      row(2, 250000),
      row(3, 600000),
    ])

    expect(result.named.map((entry) => entry.name)).toEqual(['East Bay', 'Acme', 'Delta'])
    expect(result.totalCents).toBe(1250000)
  })

  it('counts project work toward the total', () => {
    const result = concentration(CLIENTS.slice(0, 1), [row(1, 400000, 220000)])

    expect(result.named[0].cents).toBe(620000)
    expect(result.totalCents).toBe(620000)
  })

  it('collapses everything past the fourth into one rest row', () => {
    const result = concentration(CLIENTS, [
      row(1, 600000),
      row(2, 500000),
      row(3, 400000),
      row(4, 300000),
      row(5, 200000),
      row(6, 100000),
    ])

    expect(result.named).toHaveLength(NAMED_CLIENTS)
    expect(result.rest).not.toBe(null)
    expect(result.rest!.count).toBe(2)
    expect(result.rest!.cents).toBe(300000)
  })

  it('has no rest row when everyone is named', () => {
    // Not a rest row reading "0 others", which is a sentence about nothing.
    const result = concentration(CLIENTS.slice(0, 3), [
      row(1, 400000),
      row(2, 250000),
      row(3, 600000),
    ])

    expect(result.rest).toBe(null)
  })

  it('EXCLUDES a client with no row, and says how many it excluded', () => {
    // Spec section 3.3, and the assertion this whole slice rests on. Three
    // clients are eligible for the month; one has not been entered. The total
    // must be the two that WERE entered, and `missing` must say so out loud --
    // a chart that silently omits an unentered client overstates every share
    // it draws.
    const result = concentration(CLIENTS.slice(0, 3), [row(1, 400000), row(2, 600000)])

    expect(result.totalCents).toBe(1000000)
    expect(result.entered).toBe(2)
    expect(result.missing).toBe(1)
    expect(result.named.map((entry) => entry.name)).toEqual(['Delta', 'Acme'])
    expect(result.named.some((entry) => entry.name === 'East Bay')).toBe(false)
  })

  it('keeps an entered zero, which is not the same as an absent row', () => {
    // The other half of the rule. Delta was entered and billed nothing: it
    // appears, at zero, and does NOT count toward `missing`.
    const result = concentration(CLIENTS.slice(0, 2), [row(1, 400000), row(2, 0)])

    expect(result.entered).toBe(2)
    expect(result.missing).toBe(0)
    expect(result.named.map((entry) => entry.name)).toEqual(['Acme', 'Delta'])
    expect(result.named[1].cents).toBe(0)
  })

  it('does not count a paused client with no row as missing', () => {
    // The board and this screen used to disagree about a paused client. The
    // board says "no check-in is expected this month" and gives that its own
    // sentence; this report counted them as somebody who still owed a figure,
    // so the missing count read one high EVERY month, forever, unless a person
    // typed a 0 for them each time. Production has one paused client, so this
    // was live rather than hypothetical.
    //
    // Two active clients entered, one paused client with no row: nobody is
    // missing. The paused client is in NEITHER count -- not entered, and not
    // owed -- so `entered + missing` is the number of clients a figure is
    // actually expected from, which is what both captions print.
    const clients = [CLIENTS[0], CLIENTS[1], paused(CLIENTS[2])]

    const result = concentration(clients, [row(1, 400000), row(2, 600000)])

    expect(result.missing).toBe(0)
    expect(result.entered).toBe(2)
  })

  it('still ranks a paused client that did bill', () => {
    // The half that stops the fix overshooting into "paused clients have no
    // revenue". A paused client may well still be on retainer, which is exactly
    // why they stay enterable -- so a row that EXISTS counts, is ranked, and
    // contributes to the total like any other.
    const clients = [CLIENTS[0], paused(CLIENTS[1])]

    const result = concentration(clients, [row(1, 400000), row(2, 600000)])

    expect(result.entered).toBe(2)
    expect(result.missing).toBe(0)
    expect(result.totalCents).toBe(1000000)
    expect(result.named.map((entry) => entry.name)).toEqual(['Delta', 'Acme'])
  })

  it('gives every share as a fraction of the entered total', () => {
    const result = concentration(CLIENTS.slice(0, 2), [row(1, 750000), row(2, 250000)])

    expect(result.named[0].share).toBe(0.75)
    expect(result.named[1].share).toBe(0.25)
  })

  it('reports a month nobody has entered as empty rather than as zeroes', () => {
    const result = concentration(CLIENTS.slice(0, 3), [])

    expect(result.named).toEqual([])
    expect(result.rest).toBe(null)
    expect(result.totalCents).toBe(0)
    expect(result.entered).toBe(0)
    expect(result.missing).toBe(3)
  })

  it('ignores a row for a client not eligible this month', () => {
    // A row can outlive eligibility: a client entered in August and departed
    // before September still has an August row. Concentration renders the
    // month's eligible roster, so a stray row must not conjure a nameless
    // entry -- which is what a row-driven implementation would do.
    const result = concentration(CLIENTS.slice(0, 1), [row(1, 400000), row(99, 900000)])

    expect(result.totalCents).toBe(400000)
    expect(result.named).toHaveLength(1)
  })

  it('breaks a tie by name, so equal amounts cannot swap between renders', () => {
    // Two clients billing exactly the same. Without the name tie-break the
    // comparator returns 0 for this pair and the order falls through to
    // whatever the roster happened to hand over -- so the same month renders
    // in a different order on a different read, for no reason the reader can
    // see. Asserted from BOTH input orderings, because a single ordering
    // passes on a comparator that merely preserves input order.
    const tied = [
      { id: 1, name: 'Zeta', status: 'active' },
      { id: 2, name: 'Alpha', status: 'active' },
    ]
    const rows = [row(1, 300000), row(2, 300000)]

    expect(concentration(tied, rows).named.map((entry) => entry.name)).toEqual(['Alpha', 'Zeta'])
    expect(concentration([...tied].reverse(), rows).named.map((entry) => entry.name)).toEqual([
      'Alpha',
      'Zeta',
    ])
  })
})

// Slice 6h: Concentration follows the billing range, so it must collapse many
// months into one ranking. The single-month rules -- paused clients excluded
// from both counts, a client with no row counted missing rather than shown at
// zero -- are NOT reimplemented here: this sums the months and hands the
// result to concentration(), which already owns them.
describe('concentrationOverRange', () => {
  function client(id: number, over: Record<string, unknown> = {}) {
    return {
      id,
      name: `Client ${id}`,
      status: 'active',
      started_on: '2020-01-01',
      ended_on: null,
      ...over,
    }
  }
  function row(client_id: number, period: string, retainer: number, project = 0) {
    return { client_id, period, retainer_cents: retainer, project_cents: project }
  }

  it('sums each client across the months in view', () => {
    const report = concentrationOverRange(
      [client(1), client(2)],
      [
        row(1, '2026-01-01', 100000),
        row(1, '2026-02-01', 200000),
        row(2, '2026-02-01', 100000),
      ],
      '2026-01-01',
      '2026-02-01',
    )

    expect(report.named.find((entry) => entry.name === 'Client 1')?.cents).toBe(300000)
  })

  it('ignores months outside the range', () => {
    const report = concentrationOverRange(
      [client(1)],
      [row(1, '2026-01-01', 100000), row(1, '2026-05-01', 900000)],
      '2026-01-01',
      '2026-02-01',
    )

    expect(report.named[0].cents).toBe(100000)
  })

  it('counts both halves, because exposure is all the money', () => {
    const report = concentrationOverRange(
      [client(1)],
      [row(1, '2026-01-01', 100000, 50000)],
      '2026-01-01',
      '2026-01-01',
    )

    expect(report.named[0].cents).toBe(150000)
  })

  // A client who left before the range began was never exposure during it, and
  // one who starts after it ended was not either. Counting them as clients who
  // owe a figure inflates the missing count and makes the disclosure wrong.
  it('drops a client who had already left before the range', () => {
    const report = concentrationOverRange(
      [client(1), client(2, { ended_on: '2025-06-30' })],
      [row(1, '2026-01-01', 100000)],
      '2026-01-01',
      '2026-02-01',
    )

    expect(report.missing).toBe(0)
  })

  it('drops a client who had not started by the end of the range', () => {
    const report = concentrationOverRange(
      [client(1), client(2, { started_on: '2026-09-01' })],
      [row(1, '2026-01-01', 100000)],
      '2026-01-01',
      '2026-02-01',
    )

    expect(report.missing).toBe(0)
  })

  it('KEEPS a client who left partway through the range', () => {
    // They were exposure for part of it, and their revenue is real. The month
    // boundary is inclusive: a client who left on the 25th billed most of it.
    const report = concentrationOverRange(
      [client(1), client(2, { ended_on: '2026-01-20' })],
      [row(1, '2026-02-01', 100000), row(2, '2026-01-01', 400000)],
      '2026-01-01',
      '2026-02-01',
    )

    expect(report.named[0].name).toBe('Client 2')
    expect(report.named[0].cents).toBe(400000)
  })

  it('counts an eligible client with no row in the whole range as missing', () => {
    const report = concentrationOverRange(
      [client(1), client(2)],
      [row(1, '2026-01-01', 100000)],
      '2026-01-01',
      '2026-02-01',
    )

    expect(report.missing).toBe(1)
  })

  it('shares out of the RANGE total, not a month of it', () => {
    const report = concentrationOverRange(
      [client(1), client(2)],
      [
        row(1, '2026-01-01', 300000),
        row(2, '2026-01-01', 100000),
        row(2, '2026-02-01', 600000),
      ],
      '2026-01-01',
      '2026-02-01',
    )

    // Client 2 is 700,000 of 1,000,000. A fraction, not points -- the
    // component rounds once, through allocatePercentages, so that a column of
    // shares still sums to 100.
    expect(report.named[0].name).toBe('Client 2')
    expect(report.named[0].share).toBe(0.7)
    expect(report.totalCents).toBe(1000000)
  })
})
