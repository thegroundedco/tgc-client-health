import { describe, expect, it } from 'vitest'
import { currentRates } from './rateMath'
import type { RateRow } from './rateMath'

// Synthetic ids only; this repository is public.
function row(client_id: number, period: string, retainer_cents: number, project_cents = 0): RateRow {
  return { client_id, period, retainer_cents, project_cents }
}

describe('currentRates — what a client is worth per month, now', () => {
  it('reads a retainer client as their latest retainer figure', () => {
    const rates = currentRates([
      row(1, '2026-08-01', 400_000),
      row(1, '2026-09-01', 500_000),
    ])
    expect(rates.get(1)).toEqual({ cents: 500_000, kind: 'retainer' })
  })

  it('reads a project-only client as their latest project fee, NOT a monthly rate', () => {
    // This slice derives nothing for project clients. Fee over duration is the
    // owner's boss's lifetime-value formula and belongs to its own slice;
    // guessing it here and correcting it there is work done twice.
    const rates = currentRates([row(2, '2026-09-01', 0, 900_000)])
    expect(rates.get(2)).toEqual({ cents: 900_000, kind: 'project' })
  })

  it('gives a client with nothing entered NO rate, rather than zero', () => {
    // A missing row is not a zero anywhere in this codebase, and a health card
    // reading $0 says the agency bills them nothing rather than that nobody
    // has typed it.
    expect(currentRates([]).get(3)).toBeUndefined()
  })

  it('gives a client whose latest month is an explicit zero NO rate either', () => {
    // An entered zero is a fact about a month, not a rate. "They are a $0 a
    // month client" is not what that row says.
    const rates = currentRates([row(4, '2026-09-01', 0, 0)])
    expect(rates.get(4)).toBeUndefined()
  })

  it('takes the latest month per client, not the latest month overall', () => {
    // A client who stopped billing in July still has a July rate; reading the
    // roster's latest month would give them nothing.
    const rates = currentRates([
      row(5, '2026-07-01', 300_000),
      row(6, '2026-09-01', 800_000),
    ])
    expect(rates.get(5)).toEqual({ cents: 300_000, kind: 'retainer' })
  })

  it('prefers the retainer when a month holds both', () => {
    // A retainer client who also had a project that month is still a retainer
    // client, and the retainer is the recurring half -- which is what "rate"
    // means here.
    const rates = currentRates([row(7, '2026-09-01', 500_000, 200_000)])
    expect(rates.get(7)).toEqual({ cents: 500_000, kind: 'retainer' })
  })
})
