import { describe, expect, it } from 'vitest'
import {
  basePeriodFor,
  latestPeriod,
  retention,
  type RetentionClient,
  type RetentionRow,
} from './retentionMath'

const CURRENT = '2026-09-01'
const BASE = '2025-09-01'

function client(
  id: number,
  name: string,
  over: Partial<RetentionClient> = {},
): RetentionClient {
  return { id, name, started_on: '2020-01-01', ended_on: null, ...over }
}

function row(client_id: number, period: string, retainer_cents: number): RetentionRow {
  return { client_id, period, retainer_cents }
}

describe('basePeriodFor', () => {
  it('is the same month a year earlier', () => {
    expect(basePeriodFor('2026-09-01')).toBe('2025-09-01')
  })

  it('handles January without rolling the month', () => {
    // The obvious off-by-one: month arithmetic that borrows. January 2026's
    // base is January 2025, not December 2024.
    expect(basePeriodFor('2026-01-01')).toBe('2025-01-01')
  })
})

describe('latestPeriod', () => {
  it('is the most recent period with a row, not the calendar month', () => {
    // Spec section 3.3. Anchoring to today would compute the figure from
    // whatever had been typed by the 2nd of the month.
    expect(latestPeriod([row(1, '2026-07-01', 100), row(1, '2026-09-01', 100)])).toBe(
      '2026-09-01',
    )
  })

  it('is null when nothing has been entered at all', () => {
    expect(latestPeriod([])).toBe(null)
  })
})

describe('retention — the classification rule, spec section 3', () => {
  it('compares a client present in both months', () => {
    const report = retention(
      [client(1, 'Acme')],
      [row(1, BASE, 400000), row(1, CURRENT, 500000)],
      CURRENT,
    )

    expect(report.included).toBe(1)
    expect(report.contributions[0]).toEqual({
      clientId: 1,
      name: 'Acme',
      baseCents: 400000,
      currentCents: 500000,
      deltaCents: 100000,
      kind: 'expanded',
    })
  })

  it('counts a CHURNED client as zero, not as excluded', () => {
    // THE test of this slice. A client with a base figure, no current row, and
    // an end date on or before the current month has left -- and losing them is
    // exactly what retention measures. Excluding them instead makes NRR report
    // on the survivors alone, which is the flattering, meaningless number this
    // project keeps refusing to render.
    const report = retention(
      [client(1, 'Acme'), client(2, 'Delta', { ended_on: '2026-08-25' })],
      [row(1, BASE, 400000), row(1, CURRENT, 400000), row(2, BASE, 100000)],
      CURRENT,
    )

    expect(report.included).toBe(2)
    expect(report.unentered).toBe(0)
    const delta = report.contributions.find((entry) => entry.clientId === 2)
    expect(delta?.kind).toBe('churned')
    expect(delta?.currentCents).toBe(0)
    expect(report.nrr).toBeCloseTo(400000 / 500000)
  })

  it('EXCLUDES an active client with no current row, and counts them', () => {
    // The same absence as above with the opposite handling, and ended_on is the
    // only thing that separates them. Treating this as a zero would make a cell
    // nobody has typed read as a lost client.
    const report = retention(
      [client(1, 'Acme'), client(2, 'Delta')],
      [row(1, BASE, 400000), row(1, CURRENT, 400000), row(2, BASE, 100000)],
      CURRENT,
    )

    expect(report.included).toBe(1)
    expect(report.unentered).toBe(1)
    expect(report.nrr).toBe(1)
    expect(report.contributions.some((entry) => entry.clientId === 2)).toBe(false)
  })

  it('EXCLUDES new business, which is what makes this retention', () => {
    const report = retention(
      [client(1, 'Acme'), client(2, 'Delta', { started_on: '2026-03-01' })],
      [row(1, BASE, 400000), row(1, CURRENT, 400000), row(2, CURRENT, 900000)],
      CURRENT,
    )

    expect(report.newBusiness).toBe(1)
    expect(report.included).toBe(1)
    // Their 900000 must not reach the numerator: including it measures growth,
    // which is slice 6d's question, not this one.
    expect(report.currentCents).toBe(400000)
    expect(report.nrr).toBe(1)
  })

  it('counts a client who existed then but has no base row as unentered', () => {
    // The fifth row of spec section 3's table, and the one an implementer is
    // likeliest to skip because it looks like the new-business case. Delta
    // started in 2020, so they are not new -- their base month simply was never
    // typed, and an untyped month is unknown rather than zero.
    const report = retention(
      [client(1, 'Acme'), client(2, 'Delta', { started_on: '2020-01-01' })],
      [row(1, BASE, 400000), row(1, CURRENT, 400000), row(2, CURRENT, 900000)],
      CURRENT,
    )

    expect(report.unentered).toBe(1)
    expect(report.newBusiness).toBe(0)
    expect(report.included).toBe(1)
  })

  it('counts a client with no start date as unentered, never as new business', () => {
    // Spec section 3.1a. With no base row and no start date there is no way to
    // tell new from unrecorded, and "we do not know" belongs in the disclosed
    // figure rather than silently in new business.
    const report = retention(
      [client(1, 'Acme'), client(2, 'Delta', { started_on: null })],
      [row(1, BASE, 400000), row(1, CURRENT, 400000), row(2, CURRENT, 900000)],
      CURRENT,
    )

    expect(report.unentered).toBe(1)
    expect(report.newBusiness).toBe(0)
  })
})

describe('retention — the arithmetic, spec section 4', () => {
  it('GRR ignores growth and NRR does not', () => {
    // The worked example from the design conversation. Acme grew, East Bay cut
    // back, Harbor left. NRR reads flat; GRR reads a fifth of the book gone.
    const clients = [
      client(1, 'Acme'),
      client(2, 'Delta'),
      client(3, 'East Bay'),
      client(4, 'Harbor', { ended_on: '2026-06-30' }),
    ]
    const rows = [
      row(1, BASE, 500000),
      row(1, CURRENT, 700000),
      row(2, BASE, 300000),
      row(2, CURRENT, 300000),
      row(3, BASE, 200000),
      row(3, CURRENT, 100000),
      row(4, BASE, 100000),
    ]

    const report = retention(clients, rows, CURRENT)

    expect(report.baseCents).toBe(1100000)
    expect(report.currentCents).toBe(1100000)
    expect(report.nrr).toBe(1)
    // min(current, base) per client: 500000 + 300000 + 100000 + 0
    expect(report.grr).toBeCloseTo(900000 / 1100000)
  })

  it('never lets GRR exceed 1 however much a client grows', () => {
    const report = retention(
      [client(1, 'Acme')],
      [row(1, BASE, 100000), row(1, CURRENT, 900000)],
      CURRENT,
    )

    expect(report.nrr).toBe(9)
    expect(report.grr).toBe(1)
  })

  it('splits the movement into expansion, contraction and churn', () => {
    const clients = [
      client(1, 'Up'),
      client(2, 'Down'),
      client(3, 'Gone', { ended_on: '2026-01-31' }),
    ]
    const rows = [
      row(1, BASE, 100000),
      row(1, CURRENT, 150000),
      row(2, BASE, 100000),
      row(2, CURRENT, 60000),
      row(3, BASE, 100000),
    ]

    const report = retention(clients, rows, CURRENT)

    expect(report.expansionCents).toBe(50000)
    expect(report.contractionCents).toBe(-40000)
    expect(report.churnedCents).toBe(-100000)
  })

  it('reconciles: base plus the three movements equals current', () => {
    // The invariant that catches a client counted in the wrong bucket. Any
    // misclassification that still totals correctly is caught by the tests
    // above; anything that does not is caught here.
    const clients = [
      client(1, 'Up'),
      client(2, 'Down'),
      client(3, 'Gone', { ended_on: '2026-01-31' }),
      client(4, 'Flat'),
    ]
    const rows = [
      row(1, BASE, 100000),
      row(1, CURRENT, 150000),
      row(2, BASE, 100000),
      row(2, CURRENT, 60000),
      row(3, BASE, 100000),
      row(4, BASE, 70000),
      row(4, CURRENT, 70000),
    ]

    const report = retention(clients, rows, CURRENT)

    expect(
      report.baseCents +
        report.expansionCents +
        report.contractionCents +
        report.churnedCents,
    ).toBe(report.currentCents)
  })

  it('orders contributions by the size of their effect, largest first', () => {
    // Spec section 4: this ordering IS the answer to "why did it move", so the
    // biggest mover has to be the first thing read -- in either direction.
    const clients = [client(1, 'Small'), client(2, 'Big'), client(3, 'Medium')]
    const rows = [
      row(1, BASE, 100000),
      row(1, CURRENT, 110000),
      row(2, BASE, 100000),
      row(2, CURRENT, 20000),
      row(3, BASE, 100000),
      row(3, CURRENT, 130000),
    ]

    const report = retention(clients, rows, CURRENT)

    expect(report.contributions.map((entry) => entry.name)).toEqual([
      'Big',
      'Medium',
      'Small',
    ])
  })

  it('refuses both rates when the base month holds nothing', () => {
    // Spec section 4.1, matching share() and rate(): a state with no meaningful
    // answer renders no number rather than NaN% or 0%.
    const report = retention([client(1, 'Acme')], [row(1, CURRENT, 400000)], CURRENT)

    expect(report.nrr).toBe(null)
    expect(report.grr).toBe(null)
  })

  it('refuses both rates when every base figure is zero', () => {
    const report = retention(
      [client(1, 'Acme')],
      [row(1, BASE, 0), row(1, CURRENT, 400000)],
      CURRENT,
    )

    expect(report.nrr).toBe(null)
    expect(report.grr).toBe(null)
  })

  it('never reads project work', () => {
    // Spec section 2. RetentionRow has no project_cents field at all, so this
    // is a type-level guarantee -- asserted here so that widening the type
    // later has to break a test that says why.
    const report = retention(
      [client(1, 'Acme')],
      [row(1, BASE, 100000), row(1, CURRENT, 100000)],
      CURRENT,
    )

    expect(report.nrr).toBe(1)
    expect(Object.keys(row(1, BASE, 1))).toEqual(['client_id', 'period', 'retainer_cents'])
  })
})
