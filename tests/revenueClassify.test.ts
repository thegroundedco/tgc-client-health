import { describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain .mjs script with JSDoc types, not part of the app's
// TypeScript program. Same arrangement as revenue-import-plan.mjs: the decisions
// live in a module that can be tested, and the script around it only does I/O.
import { classifyRuns } from '../scripts/revenue-classify.mjs'

// The owner's rule, in his words: "a bare client name is a RETAINER only if it
// recurs in consecutive months -- three or more, or still running at the anchor
// -- otherwise project work", with his direct calls outranking the rule.
//
// It was applied BY HAND for the 2026 import and frozen into a map of names.
// That works for one year and fails for two, because a run of consecutive months
// does not stop at New Year. Synthetic names throughout: this repo is public.

const ANCHOR = '2026-09-01'

function line(name: string, period: string, cents = 500_000) {
  return { name, period, cents }
}

describe('classifyRuns — the recurrence rule', () => {
  it('calls three consecutive months a retainer', () => {
    const out = classifyRuns({
      lines: [line('Alpha', '2025-02-01'), line('Alpha', '2025-03-01'), line('Alpha', '2025-04-01')],
      anchor: ANCHOR,
    })
    expect(out.kinds.Alpha).toBe('retainer')
    expect(out.runs.Alpha).toEqual({ from: '2025-02-01', to: '2025-04-01', length: 3 })
  })

  it('calls two consecutive months project work', () => {
    const out = classifyRuns({
      lines: [line('Beta', '2025-02-01'), line('Beta', '2025-03-01')],
      anchor: ANCHOR,
    })
    expect(out.kinds.Beta).toBe('project')
  })

  it('joins a run across New Year, which is the whole reason this is computed', () => {
    const out = classifyRuns({
      lines: [
        line('Gamma', '2025-11-01'), line('Gamma', '2025-12-01'),
        line('Gamma', '2026-01-01'), line('Gamma', '2026-02-01'),
      ],
      anchor: ANCHOR,
    })
    expect(out.kinds.Gamma).toBe('retainer')
    expect(out.runs.Gamma).toEqual({ from: '2025-11-01', to: '2026-02-01', length: 4 })
  })

  it('does not add two separate short runs together', () => {
    const out = classifyRuns({
      lines: [
        line('Delta', '2025-01-01'), line('Delta', '2025-02-01'),
        line('Delta', '2025-09-01'), line('Delta', '2025-10-01'),
      ],
      anchor: ANCHOR,
    })
    expect(out.kinds.Delta).toBe('project')
    expect(out.runs.Delta.length).toBe(2)
  })

  it('calls a short run still open at the anchor a retainer', () => {
    const out = classifyRuns({
      lines: [line('Epsilon', '2026-08-01'), line('Epsilon', '2026-09-01')],
      anchor: ANCHOR,
    })
    expect(out.kinds.Epsilon).toBe('retainer')
    expect(out.decisions.find((d: { name: string }) => d.name === 'Epsilon')?.why).toBe('anchor')
  })

  it('breaks a run on an explicit zero, which is a month billed nothing', () => {
    const out = classifyRuns({
      lines: [
        line('Zeta', '2025-01-01'), line('Zeta', '2025-02-01', 0), line('Zeta', '2025-03-01'),
      ],
      anchor: ANCHOR,
    })
    expect(out.kinds.Zeta).toBe('project')
    expect(out.runs.Zeta.length).toBe(1)
  })

  it('breaks a run on a month absent from the ledger entirely', () => {
    const out = classifyRuns({
      lines: [line('Eta', '2025-01-01'), line('Eta', '2025-03-01'), line('Eta', '2025-04-01')],
      anchor: ANCHOR,
    })
    expect(out.kinds.Eta).toBe('project')
  })

  it("lets the owner's direct call outrank a computed retainer", () => {
    const out = classifyRuns({
      lines: [line('Theta', '2025-02-01'), line('Theta', '2025-03-01'), line('Theta', '2025-04-01')],
      anchor: ANCHOR,
      overrides: { Theta: 'project' },
    })
    expect(out.kinds.Theta).toBe('project')
    expect(out.decisions.find((d: { name: string }) => d.name === 'Theta')?.why).toBe('override')
  })

  it('keeps an exclusion whose name has dropped out of the ledger', () => {
    const out = classifyRuns({
      lines: [line('Iota', '2025-02-01')],
      anchor: ANCHOR,
      overrides: { Kappa: 'exclude' },
    })
    expect(out.kinds.Kappa).toBe('exclude')
  })

  it('crosses a December boundary without an off-by-one in the month arithmetic', () => {
    const out = classifyRuns({
      lines: [line('Lambda', '2025-12-01'), line('Lambda', '2026-01-01')],
      anchor: ANCHOR,
    })
    expect(out.runs.Lambda).toEqual({ from: '2025-12-01', to: '2026-01-01', length: 2 })
  })
})

// The threshold is a RULE, not a constant to be tuned. This asserts the tests
// above would notice if it moved: "two consecutive months is project work" fails
// the moment minRun becomes 2, which is the mutation this module is most likely
// to suffer at the hands of someone making a number look nicer.
describe('classifyRuns — the threshold is load-bearing', () => {
  it('a two-month run is project at the default threshold and retainer at two', () => {
    const lines = [line('Mu', '2025-02-01'), line('Mu', '2025-03-01')]
    expect(classifyRuns({ lines, anchor: ANCHOR }).kinds.Mu).toBe('project')
    expect(classifyRuns({ lines, anchor: ANCHOR, minRun: 2 }).kinds.Mu).toBe('retainer')
  })
})
