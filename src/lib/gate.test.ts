import { describe, expect, it } from 'vitest'
import { OVERALL_QUESTIONS } from './buckets'
import { advocacyApplies, advocacyGate, advocacyOpensAt } from './gate'

describe('advocacyApplies', () => {
  it('is shut when there is no start date', () => {
    expect(advocacyApplies(null, '2026-08-01')).toBe(false)
  })

  // The boundary, fixed at a period and varied by start date -- the same
  // arithmetic scripts/verify-scoring-view.sql §1 exercises, and the same
  // reason: because a period is always the first of a month, varying the
  // period cannot land on day 90 at all.
  //
  // 2026-04-01 minus 90 days is 2026-01-01. So:
  it('is shut at 89 days and open at exactly 90', () => {
    expect(advocacyApplies('2026-01-02', '2026-04-01')).toBe(false) // 89 days
    expect(advocacyApplies('2026-01-01', '2026-04-01')).toBe(true) //  90 days
    expect(advocacyApplies('2025-12-31', '2026-04-01')).toBe(true) //  91 days
  })

  it('crosses a year boundary correctly', () => {
    expect(advocacyApplies('2025-11-01', '2026-01-01')).toBe(false) // 61 days
    expect(advocacyApplies('2025-11-01', '2026-02-01')).toBe(true) //  92 days
  })

  // February 2028 has 29 days. Constructed so a naive 3-months-not-90-days
  // implementation would disagree.
  it('counts days, not months, across a leap February', () => {
    expect(advocacyApplies('2027-12-03', '2028-03-01')).toBe(false) // 89 days
    expect(advocacyApplies('2027-12-02', '2028-03-01')).toBe(true) //  90 days
  })
})

describe('advocacyOpensAt', () => {
  // The fact the owner most needs and the one most likely to be got wrong: the
  // gate does NOT open on day 90. A period is the first of a month, so it opens
  // on the first month beginning on or after day 90.
  it('rounds up to the first of the following month when day 90 is mid-month', () => {
    // 2026-01-15 + 90 days = 2026-04-15, so April is shut and May is the first
    // month that begins on or after it.
    expect(advocacyOpensAt('2026-01-15')).toBe('2026-05-01')
  })

  it('does not round up when day 90 is itself the first of a month', () => {
    // 2026-01-01 + 90 days = 2026-04-01 exactly.
    expect(advocacyOpensAt('2026-01-01')).toBe('2026-04-01')
  })

  it('agrees with advocacyApplies at the month it names', () => {
    for (const start of ['2026-01-15', '2026-01-01', '2025-12-31', '2026-02-28']) {
      const opens = advocacyOpensAt(start)
      expect(advocacyApplies(start, opens)).toBe(true)
      // ...and the month before it is shut.
      const [y, m] = opens.split('-').map(Number)
      const before = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}-01`
      expect(advocacyApplies(start, before)).toBe(false)
    }
  })
})

describe('advocacyGate', () => {
  it('is open with no reason once the gate applies', () => {
    expect(advocacyGate('2026-01-01', '2026-04-01')).toEqual({ open: true })
  })

  // Both shut reasons must be distinguishable, and neither may say "after 90
  // days" flatly -- the gate opens on a month, not on a day.
  it('names the missing start date as the reason', () => {
    const gate = advocacyGate(null, '2026-08-01')
    expect(gate.open).toBe(false)
    if (gate.open) return
    expect(gate.reason).toContain('start date')
    expect(gate.reason).not.toContain('90 days after')
  })

  it('names the month the gate opens when the client is inside their first 90 days', () => {
    const gate = advocacyGate('2026-01-15', '2026-03-01')
    expect(gate.open).toBe(false)
    if (gate.open) return
    expect(gate.reason).toContain('May 2026')
  })

  it('never returns an empty reason when shut', () => {
    for (const [start, period] of [
      [null, '2026-08-01'],
      ['2026-01-15', '2026-03-01'],
      ['2026-08-01', '2026-08-01'],
    ] as const) {
      const gate = advocacyGate(start, period)
      expect(gate.open).toBe(false)
      if (gate.open) continue
      expect(gate.reason.trim().length).toBeGreaterThan(0)
    }
  })

  // The copy states how many questions the check-in is scored out of. Deriving it
  // means the sentence cannot go stale the next time the rubric changes -- which
  // it just did, twice in four days.
  it('states the real non-Advocacy count, not a literal', () => {
    const shut = advocacyGate('2026-08-01', '2026-08-01')
    expect(shut.open).toBe(false)
    if (shut.open) return
    expect(shut.reason).toContain(`other ${OVERALL_QUESTIONS.length} questions`)
  })

  it('says the same for a client with no start date', () => {
    const none = advocacyGate(null, '2026-08-01')
    expect(none.open).toBe(false)
    if (none.open) return
    expect(none.reason).toContain(`other ${OVERALL_QUESTIONS.length} questions`)
  })
})
