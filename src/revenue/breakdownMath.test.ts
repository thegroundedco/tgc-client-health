import { describe, expect, it } from 'vitest'
import { monthBreakdown } from './breakdownMath'
import type { RetentionClient } from './retentionMath'
import type { RevenueRow } from './chartMath'

const PERIOD = '2026-08-01'

function client(id: number, name: string, over: Partial<RetentionClient> = {}): RetentionClient {
  return { id, name, started_on: '2020-01-01', ended_on: null, end_reason_code: null, ...over }
}

function row(client_id: number, period: string, retainer: number, project = 0): RevenueRow {
  return { client_id, period, retainer_cents: retainer, project_cents: project }
}

describe('monthBreakdown — who paid what', () => {
  it('names each client and splits their month in two', () => {
    const report = monthBreakdown(
      [client(1, 'Acme')],
      [row(1, PERIOD, 400000, 100000)],
      PERIOD,
    )

    expect(report.clients).toEqual([
      { clientId: 1, name: 'Acme', retainerCents: 400000, projectCents: 100000, totalCents: 500000 },
    ])
  })

  it('sorts by total descending, so the biggest payer leads', () => {
    const report = monthBreakdown(
      [client(1, 'Small'), client(2, 'Big'), client(3, 'Middle')],
      [row(1, PERIOD, 100000), row(2, PERIOD, 900000), row(3, PERIOD, 500000)],
      PERIOD,
    )

    expect(report.clients.map((entry) => entry.name)).toEqual(['Big', 'Middle', 'Small'])
  })

  it('breaks a tie by name rather than by whatever order the rows arrived', () => {
    // Two clients on the same retainer is ordinary here. Left to the row order
    // the list would reshuffle between renders for no reason a reader could
    // see, which reads as the data changing.
    const report = monthBreakdown(
      [client(1, 'Zeta'), client(2, 'Alpha')],
      [row(1, PERIOD, 100000), row(2, PERIOD, 100000)],
      PERIOD,
    )

    expect(report.clients.map((entry) => entry.name)).toEqual(['Alpha', 'Zeta'])
  })

  it('sums the month, both halves and the whole', () => {
    const report = monthBreakdown(
      [client(1, 'Acme'), client(2, 'Beta')],
      [row(1, PERIOD, 400000, 100000), row(2, PERIOD, 200000, 50000)],
      PERIOD,
    )

    expect(report.retainerCents).toBe(600000)
    expect(report.projectCents).toBe(150000)
    expect(report.totalCents).toBe(750000)
  })

  it('ignores every month but the one asked for', () => {
    const report = monthBreakdown(
      [client(1, 'Acme')],
      [row(1, '2026-07-01', 999999), row(1, PERIOD, 400000)],
      PERIOD,
    )

    expect(report.clients).toHaveLength(1)
    expect(report.clients[0].retainerCents).toBe(400000)
  })

  // Spec 6c §3.3 in this module. A client with no row is ABSENT and counted,
  // never listed at $0 -- $0 states the agency billed them nothing.
  it('leaves a client with no row OUT of the list and counts them instead', () => {
    const report = monthBreakdown(
      [client(1, 'Acme'), client(2, 'Silent')],
      [row(1, PERIOD, 400000)],
      PERIOD,
    )

    expect(report.clients.map((entry) => entry.name)).toEqual(['Acme'])
    expect(report.missing).toBe(1)
  })

  it('lists a client whose row says ZERO, because that is a fact about the month', () => {
    const report = monthBreakdown(
      [client(1, 'Acme'), client(2, 'Free')],
      [row(1, PERIOD, 400000), row(2, PERIOD, 0, 0)],
      PERIOD,
    )

    expect(report.clients.map((entry) => entry.name)).toEqual(['Acme', 'Free'])
    expect(report.clients[1].totalCents).toBe(0)
    expect(report.missing).toBe(0)
  })

  // Spec 6e §4.2. A client who left in 2024 is not a gap in a 2026 month.
  it('does not count a client who had already left as missing', () => {
    const report = monthBreakdown(
      [client(1, 'Acme'), client(2, 'Departed', { ended_on: '2024-03-15' })],
      [row(1, PERIOD, 400000)],
      PERIOD,
    )

    expect(report.missing).toBe(0)
  })

  it('does not count a client who had not started yet', () => {
    const report = monthBreakdown(
      [client(1, 'Acme'), client(2, 'Future', { started_on: '2026-12-01' })],
      [row(1, PERIOD, 400000)],
      PERIOD,
    )

    expect(report.missing).toBe(0)
  })

  it('counts a client who left DURING the month, who could still have been billed', () => {
    // Lifecycle boundaries are months, not days: a client who left on the 20th
    // billed most of that month.
    const report = monthBreakdown(
      [client(1, 'Acme'), client(2, 'Leaver', { ended_on: '2026-08-20' })],
      [row(1, PERIOD, 400000)],
      PERIOD,
    )

    expect(report.missing).toBe(1)
  })

  it('counts a client with NO start date on file, because we cannot say', () => {
    // The honest bucket, and the same ruling retention §3.1a makes: with
    // nothing on file we cannot claim they were not active, so we do not.
    const report = monthBreakdown(
      [client(1, 'Acme'), client(2, 'Unknown', { started_on: null })],
      [row(1, PERIOD, 400000)],
      PERIOD,
    )

    expect(report.missing).toBe(1)
  })

  it('reports an entirely unentered month as empty rather than as zeros', () => {
    const report = monthBreakdown([client(1, 'Acme')], [], PERIOD)

    expect(report.clients).toEqual([])
    expect(report.missing).toBe(1)
    expect(report.totalCents).toBe(0)
  })

  it('ignores a row whose client is not on the roster', () => {
    // A deleted client's rows outlive it. Listing an id with no name would put
    // a blank row in the panel.
    const report = monthBreakdown([client(1, 'Acme')], [row(99, PERIOD, 400000)], PERIOD)

    expect(report.clients).toEqual([])
  })
})
