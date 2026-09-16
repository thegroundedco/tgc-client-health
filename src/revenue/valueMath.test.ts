import { describe, expect, it } from 'vitest'
import type { RevenueRow } from './chartMath'
import type { RetentionClient } from './retentionMath'
import {
  TOP_N,
  clientValue,
  departedCount,
  departedToggleLabel,
  eligibleCount,
  isActive,
  lengthToggleLabel,
  visibleRows,
} from './valueMath'

// RetentionClient has SIX required fields, not five -- end_reason_code is
// required. Confirmed against src/revenue/retentionMath.ts.
function client(
  id: number,
  name: string,
  status = 'active',
): RetentionClient {
  return { id, name, status, started_on: '2025-01-01', ended_on: null, end_reason_code: null }
}

function row(
  client_id: number,
  period: string,
  retainer_cents: number,
  project_cents: number,
): RevenueRow {
  return { client_id, period, retainer_cents, project_cents }
}

describe('the monthly equivalent', () => {
  // The boss's own figure, reached without the step that inflated it: a $30,000
  // project delivered in three months is $10,000 a month.
  it('turns a project fee into a rate you can hold beside a retainer', () => {
    const rows = [
      row(1, '2026-01-01', 0, 1_000_000),
      row(1, '2026-02-01', 0, 1_000_000),
      row(1, '2026-03-01', 0, 1_000_000),
    ]

    const { rows: ranked } = clientValue([client(1, 'Babaloo')], rows)
    expect(ranked[0].monthlyEquivalentCents).toBe(1_000_000)
  })

  it("is a retainer client's actual rate", () => {
    const rows = [
      row(1, '2026-01-01', 400_000, 0),
      row(1, '2026-02-01', 400_000, 0),
    ]

    const { rows: ranked } = clientValue([client(1, 'Colorfil')], rows)
    expect(ranked[0].monthlyEquivalentCents).toBe(400_000)
  })

  it('is the one month itself for a client billed once', () => {
    const { rows: ranked } = clientValue(
      [client(1, 'Sno-Go')],
      [row(1, '2026-01-01', 750_000, 0)],
    )
    expect(ranked[0].monthlyEquivalentCents).toBe(750_000)
  })

  // The figure reads no dates at all, so an unknown start date costs nothing.
  // Most of this roster arrived from the invoice ledger with a start date that
  // is a floor rather than a beginning, which is exactly why lifetime value
  // was chosen over anything tenure-derived.
  it('does not care that a client has no start date', () => {
    const noStart = { ...client(1, 'Babaloo'), started_on: null }
    const { rows: ranked } = clientValue([noStart], [row(1, '2026-01-01', 500_000, 0)])
    expect(ranked[0].monthlyEquivalentCents).toBe(500_000)
  })
})

describe('the ranking', () => {
  it('puts the most valuable client first', () => {
    const clients = [client(1, 'Babaloo'), client(2, 'Colorfil'), client(3, 'Sno-Go')]
    const rows = [
      row(1, '2026-01-01', 100_000, 0),
      row(2, '2026-01-01', 900_000, 0),
      row(3, '2026-01-01', 500_000, 0),
    ]

    const { rows: ranked } = clientValue(clients, rows)
    expect(ranked.map((entry) => entry.name)).toEqual(['Colorfil', 'Sno-Go', 'Babaloo'])
  })

  // Deterministic, so the list does not reshuffle between renders on equal money.
  it('breaks a tie on name rather than leaving it to chance', () => {
    const clients = [client(1, 'Sno-Go'), client(2, 'Babaloo')]
    const rows = [row(1, '2026-01-01', 500_000, 0), row(2, '2026-01-01', 500_000, 0)]

    const { rows: ranked } = clientValue(clients, rows)
    expect(ranked.map((entry) => entry.name)).toEqual(['Babaloo', 'Sno-Go'])
  })

  // A client listed at $0 says the agency bills them nothing, rather than that
  // nobody has typed it. The whole codebase keeps this rule.
  it('leaves out a client with nothing entered', () => {
    const clients = [client(1, 'Babaloo'), client(2, 'Colorfil')]
    const { rows: ranked } = clientValue(clients, [row(1, '2026-01-01', 500_000, 0)])

    expect(ranked.map((entry) => entry.name)).toEqual(['Babaloo'])
  })
})

describe('who is eligible, and how many are drawn', () => {
  const clients = [
    client(1, 'Babaloo'),
    client(2, 'Colorfil', 'churned'),
    client(3, 'Sno-Go', 'paused'),
  ]
  const rows = [
    row(1, '2026-01-01', 100_000, 0),
    row(2, '2026-01-01', 900_000, 0),
    row(3, '2026-01-01', 500_000, 0),
  ]

  // The clients board's allowlist, not "has no end date": a paused client is
  // not active.
  it('counts only an active status as active', () => {
    expect(isActive('active')).toBe(true)
    expect(isActive('paused')).toBe(false)
    expect(isActive('churned')).toBe(false)
  })

  it('shows only active clients by default', () => {
    const { rows: ranked } = clientValue(clients, rows)
    expect(visibleRows(ranked, false, true).map((entry) => entry.name)).toEqual(['Babaloo'])
  })

  // The consequence the spec accepts rather than engineers around: a departed
  // client can outrank every active one, and revealing them rearranges the top.
  it('ranks departed clients INTO the list, not after it', () => {
    const { rows: ranked } = clientValue(clients, rows)
    expect(visibleRows(ranked, true, true).map((entry) => entry.name)).toEqual([
      'Colorfil',
      'Sno-Go',
      'Babaloo',
    ])
  })

  it('draws only the top ten until asked for all', () => {
    const many = Array.from({ length: 14 }, (_, index) => client(index + 1, `Client ${index + 1}`))
    const manyRows = many.map((entry, index) =>
      row(entry.id, '2026-01-01', (index + 1) * 100_000, 0),
    )

    const { rows: ranked } = clientValue(many, manyRows)
    expect(visibleRows(ranked, false, false)).toHaveLength(TOP_N)
    expect(visibleRows(ranked, false, true)).toHaveLength(14)
  })

  it('counts the departed, so the control can say how many', () => {
    const { rows: ranked } = clientValue(clients, rows)
    expect(departedCount(ranked)).toBe(2)
  })

  it('counts who is eligible under the current filter', () => {
    const { rows: ranked } = clientValue(clients, rows)
    expect(eligibleCount(ranked, false)).toBe(1)
    expect(eligibleCount(ranked, true)).toBe(3)
  })

  // Both controls say what pressing them will DO, not what state they are in.
  it('labels both controls in both directions', () => {
    expect(departedToggleLabel(2, false)).toBe('Show 2 departed')
    expect(departedToggleLabel(2, true)).toBe('Hide 2 departed')
    expect(lengthToggleLabel(14, false)).toBe('Show all 14')
    expect(lengthToggleLabel(14, true)).toBe('Show top 10')
  })
})

describe('the verdict', () => {
  // THE TEST THIS SLICE IS MOST LIKELY TO GET WRONG. A verdict hard-coded to
  // "retainer" would pass every other test in this file. The boss's belief is
  // what is being TESTED, so the sentence must be able to contradict him.
  it('says retainer when retainer clients are worth more', () => {
    const clients = [client(1, 'Babaloo'), client(2, 'Colorfil')]
    const rows = [row(1, '2026-01-01', 900_000, 0), row(2, '2026-01-01', 0, 100_000)]

    expect(clientValue(clients, rows).verdict.winner).toBe('retainer')
  })

  it('says PROJECT when project clients are worth more', () => {
    const clients = [client(1, 'Babaloo'), client(2, 'Colorfil')]
    const rows = [row(1, '2026-01-01', 100_000, 0), row(2, '2026-01-01', 0, 900_000)]

    expect(clientValue(clients, rows).verdict.winner).toBe('project')
  })

  it('declares no winner when the two typical clients are worth the same', () => {
    const clients = [client(1, 'Babaloo'), client(2, 'Colorfil')]
    const rows = [row(1, '2026-01-01', 500_000, 0), row(2, '2026-01-01', 0, 500_000)]

    expect(clientValue(clients, rows).verdict.winner).toBeNull()
  })

  it('declares no winner when one kind has nobody in it', () => {
    const { verdict } = clientValue([client(1, 'Babaloo')], [row(1, '2026-01-01', 500_000, 0)])

    expect(verdict.winner).toBeNull()
    expect(verdict.projectMedianCents).toBeNull()
    expect(verdict.retainerMedianCents).toBe(500_000)
  })

  // The sentence names its own population because it does NOT follow the
  // list's filter -- a completed relationship is the only complete lifetime
  // value there is, and departed clients are most of this history.
  it('is drawn from every client ever billed, departed included', () => {
    const clients = [client(1, 'Babaloo'), client(2, 'Colorfil', 'churned')]
    const rows = [row(1, '2026-01-01', 100_000, 0), row(2, '2026-01-01', 0, 900_000)]

    expect(clientValue(clients, rows).verdict.clientCount).toBe(2)
  })
})
