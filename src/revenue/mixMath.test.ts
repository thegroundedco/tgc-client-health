import { describe, expect, it } from 'vitest'
import { clientMix, medianOf } from './mixMath'
import type { RevenueRow } from './chartMath'
import type { RetentionClient } from './retentionMath'

// Nick Stagge, 2026-09-11: "my belief is the monthly retainer is a stronger
// play for us, we make more money that way... but I might be wrong, and if I'm
// wrong, that grossly changes what maybe our focus should be."
//
// The whole point is that the answer might contradict him, so nothing here may
// round in favour of the hypothesis.

function client(id: number, name = `Client ${id}`, status = 'active'): RetentionClient {
  return {
    id,
    name,
    status,
    started_on: '2026-01-01',
    ended_on: null,
    end_reason_code: null,
  }
}

function row(client_id: number, period: string, retainer: number, project = 0): RevenueRow {
  return { client_id, period, retainer_cents: retainer, project_cents: project }
}

describe('medianOf', () => {
  // Median, not mean: on a book where one client is a fifth of revenue, a mean
  // describes that client rather than the group.
  // SKEWED on purpose. [3,1,2] has a median of 2 and a mean of 2, so it
  // cannot tell the two apart -- swapping the implementation for a mean passed
  // these until the data was skewed, which is the exact property median was
  // chosen for.
  it('is the middle value, not the average, of a skewed list', () => {
    expect(medianOf([1, 2, 30])).toBe(2)
    expect(medianOf([1, 1, 1, 97])).toBe(1)
  })

  it('averages the middle pair of an even-length list', () => {
    expect(medianOf([1, 2, 10, 200])).toBe(6)
  })

  it('does not care what order it is given', () => {
    expect(medianOf([30, 1, 2])).toBe(2)
  })

  it('is null for nothing', () => {
    expect(medianOf([])).toBeNull()
  })
})

describe('clientMix — which kind of client is this', () => {
  it('calls a client whose money is mostly retainer a retainer client', () => {
    const mix = clientMix([client(1)], [row(1, '2026-01-01', 100000, 20000)])

    expect(mix.clients[0].kind).toBe('retainer')
  })

  it('calls a client whose money is mostly project a project client', () => {
    const mix = clientMix([client(1)], [row(1, '2026-01-01', 20000, 100000)])

    expect(mix.clients[0].kind).toBe('project')
  })

  // Never round toward the hypothesis. A dead heat is not evidence that
  // retainers are the stronger play, and this report exists to test that claim
  // rather than to confirm it.
  it('calls an exact tie a project client, not a retainer one', () => {
    const mix = clientMix([client(1)], [row(1, '2026-01-01', 50000, 50000)])

    expect(mix.clients[0].kind).toBe('project')
  })

  it('leaves out a client with no revenue at all', () => {
    // No money is not a kind of engagement. Counting them would drag both
    // medians toward zero.
    const mix = clientMix([client(1), client(2)], [row(1, '2026-01-01', 100000)])

    expect(mix.clients).toHaveLength(1)
  })
})

describe('clientMix — how many months a client billed', () => {
  it('counts the months a client actually billed in', () => {
    const clients = [client(1, 'Babaloo')]
    const rows = [
      row(1, '2026-01-01', 400_000, 0),
      row(1, '2026-02-01', 400_000, 0),
      row(1, '2026-03-01', 400_000, 0),
    ]

    expect(clientMix(clients, rows).clients[0].monthsBilled).toBe(3)
  })

  // An entered zero is a month somebody CONFIRMED was empty. Counting it would
  // report a lower rate for the client whose account manager was diligent about
  // entering zeroes, which is the opposite of what the figure is for.
  it('does not count a month entered as zero', () => {
    const clients = [client(1, 'Babaloo')]
    const rows = [
      row(1, '2026-01-01', 400_000, 0),
      row(1, '2026-02-01', 0, 0),
      row(1, '2026-03-01', 400_000, 0),
    ]

    expect(clientMix(clients, rows).clients[0].monthsBilled).toBe(2)
  })

  // Two rows for one client in one month must not count that month twice --
  // otherwise the monthly equivalent halves for no reason a reader could see.
  it('counts a month once however many rows it arrives in', () => {
    const clients = [client(1, 'Babaloo')]
    const rows = [
      row(1, '2026-01-01', 400_000, 0),
      row(1, '2026-01-01', 0, 100_000),
    ]

    expect(clientMix(clients, rows).clients[0].monthsBilled).toBe(1)
  })

  // valueMath filters the ranking by status and cannot reach the roster itself.
  it('carries each client status through, for the ranking to filter on', () => {
    const clients = [client(1, 'Babaloo', 'churned')]
    const rows = [row(1, '2026-01-01', 400_000, 0)]

    expect(clientMix(clients, rows).clients[0].status).toBe('churned')
  })
})

describe('clientMix — what each group is worth', () => {
  const CLIENTS = [client(1), client(2), client(3)]
  const ROWS = [
    row(1, '2026-01-01', 100000),
    row(1, '2026-02-01', 100000),
    row(2, '2026-06-01', 0, 500000),
    row(3, '2026-01-01', 300000),
  ]

  it('totals each group', () => {
    const mix = clientMix(CLIENTS, ROWS)

    expect(mix.retainer.totalCents).toBe(500000)
    expect(mix.project.totalCents).toBe(500000)
  })

  it('counts the clients in each group', () => {
    const mix = clientMix(CLIENTS, ROWS)

    expect(mix.retainer.count).toBe(2)
    expect(mix.project.count).toBe(1)
  })

  it('reports the MEDIAN client, not the average one', () => {
    const mix = clientMix(CLIENTS, ROWS)

    // Retainer clients are worth 200,000 and 300,000: median 250,000.
    expect(mix.retainer.medianTotalCents).toBe(250000)
  })
})

describe('clientMix — what it refuses to claim', () => {
  it('gives a group with no clients no medians rather than zero', () => {
    // Zero is a measurement. "No clients of this kind" is not.
    const mix = clientMix([client(1)], [row(1, '2026-01-01', 100000)])

    expect(mix.project.count).toBe(0)
    expect(mix.project.medianTotalCents).toBeNull()
  })
})
