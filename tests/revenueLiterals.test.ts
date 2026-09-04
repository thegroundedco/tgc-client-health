// Spec section 9. The old rule here was "no percentage anywhere on this
// page", enforced by a regex over the rendered output. That was the right
// instinct and the wrong mechanism: a regex cannot tell a true "22% of
// September" from a meaningless "91.2% GRR", so it had to forbid both, and
// concentration needs the first one.
//
// The rule now lives where the number is COMPUTED -- revenueMath.rate()
// returns null below MIN_RATE_PERIODS, and revenueMath.test.ts fails if that
// threshold is relaxed. What remains here is the half a compute-site guard
// cannot cover: that no percentage is written into this page as a literal,
// bypassing the arithmetic entirely.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')

describe('the Revenue page', () => {
  it('writes no percentage into its own markup', () => {
    const source = readFileSync(join(ROOT, 'src', 'shell', 'Revenue.tsx'), 'utf8')
    expect(source.length).toBeGreaterThan(200)
    expect(source).not.toMatch(/\d\s*%/)
  })
})
