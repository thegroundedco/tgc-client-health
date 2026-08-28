// The arithmetic, with no knowledge of the rubric.
//
// This module imports NOTHING, deliberately. scripts/score-parity.mjs runs under
// plain Node, which cannot resolve this codebase's extensionless relative
// imports -- measured 2026-08-27: a value import of './dep' fails
// ERR_MODULE_NOT_FOUND while './dep.ts' resolves. Node strips TypeScript types
// on import, so a .ts file loads, but only if it has nothing of its own to
// resolve. Keeping the arithmetic here and the rubric in buckets.ts -- both
// leaves -- is what lets the verifier reuse the real implementation rather than
// keep a second copy of it that can drift.
//
// If you add an import to this file, `npm run verify:score` stops working, and
// it will look like a Node bug rather than what it is.

export type Band = 'healthy' | 'watch' | 'at_risk' | 'incomplete'

export const MIN_SCORE = 1
export const MAX_SCORE = 5

export const SCORE_VALUES = Array.from(
  { length: MAX_SCORE - MIN_SCORE + 1 },
  (_, index) => index + MIN_SCORE,
) as readonly number[]

// Restated on the 1-5 scale from Slice 1's 18 and 11 out of 25. Deliberately
// the exact arithmetic equivalents rather than round numbers: the bucket
// definitions changed this cycle, and moving the thresholds at the same time
// would make it impossible to tell whether a client's band moved because the
// client changed or because we did. Spec §10 decision 1.
export const HEALTHY_AT = 3.6
export const WATCH_AT = 2.2

export const BAND_LABELS: Record<Band, string> = {
  healthy: 'Healthy',
  watch: 'Watch',
  at_risk: 'At risk',
  incomplete: 'Not scored',
}

// Two decimals, matching what Postgres stores in numeric(3,2) and what the
// view's round(x, 2) produces. Computed from the integer sum and divisor rather
// than by rounding a float, so the two implementations cannot drift.
//
// No half-way case is reachable for the divisors this model uses (3, 4, 18 and
// 22): reaching one requires `sum * 100 / divisor` to be an odd half-integer,
// which for each of those divisors requires `sum` to be a multiple of the
// divisor -- and every such multiple yields an even numerator. So the rounding
// direction on a tie is never exercised, and the two implementations cannot
// disagree here regardless of which tie-breaking rule Postgres uses.
export function meanTo2dp(sum: number, divisor: number): number {
  return Math.round((sum * 100) / divisor) / 100
}

// The mean of the given values, or null if ANY of them is missing. The null is
// the whole point: an incomplete set must never read as a low score, because a
// false "at risk" is as harmful as a false "healthy".
export function meanOrNull(
  values: readonly (number | null | undefined)[],
): number | null {
  let sum = 0
  for (const value of values) {
    if (value === null || value === undefined) return null
    sum += value
  }
  return meanTo2dp(sum, values.length)
}

export function bandFor(overall: number | null): Band {
  if (overall === null) return 'incomplete'
  if (overall >= HEALTHY_AT) return 'healthy'
  if (overall >= WATCH_AT) return 'watch'
  return 'at_risk'
}

// 1 + the number of yeses. Mirrors the generated column's expression in
// 20260828*_advocacy_yes_no.sql exactly, and `npm run verify:score` is what
// proves they have not drifted.
//
// The offset of 1 is not decoration: it puts four Nos at 1.00 and four Yeses at
// 5.00, which is the same range the other five buckets produce from a mean of
// 1-5 answers. So a yes/no bucket needs no rescaling anywhere downstream -- the
// board's bar, the matrix's cell and bandFor() all work on it unchanged.
//
// Null if ANY answer is missing, exactly as meanOrNull. Note what this makes
// distinct: four Nos scores 1.00, and one blank scores nothing at all.
export function yesNoScore(
  values: readonly (boolean | null | undefined)[],
): number | null {
  let yeses = 0
  for (const value of values) {
    if (value === null || value === undefined) return null
    if (value) yeses += 1
  }
  return 1 + yeses
}
