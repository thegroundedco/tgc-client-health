export const PILLARS = [
  'relationship',
  'delivery',
  'financial',
  'sentiment',
  'growth',
] as const

export type Pillar = (typeof PILLARS)[number]

export type Band = 'healthy' | 'watch' | 'at_risk' | 'incomplete'

// The per-pillar ceiling, and the total it implies. Derived rather than written
// as 25, so the denominator on screen cannot disagree with the rubric.
export const MAX_PILLAR_SCORE = 5

// The values a pillar control offers, in order. Built from MAX_PILLAR_SCORE so
// the control and the ceiling cannot drift apart.
export const SCORE_VALUES = Array.from(
  { length: MAX_PILLAR_SCORE },
  (_, index) => index + 1,
) as readonly number[]

export const MAX_TOTAL = PILLARS.length * MAX_PILLAR_SCORE

export function totalScore(
  pillars: Partial<Record<Pillar, number | null>>,
): number | null {
  let sum = 0
  for (const pillar of PILLARS) {
    const value = pillars[pillar]
    // An incomplete check-in has no score. Treating a missing pillar as
    // zero would report a healthy client as at risk.
    if (value === null || value === undefined) return null
    sum += value
  }
  return sum
}

// How many pillars hold a score. This is the number the button's label turns on
// -- fewer than five is a draft, five is a submission -- so it iterates PILLARS
// rather than the object's own keys: a draft restored from localStorage is
// arbitrary JSON, and a stray key must not be counted.
export function scoredCount(
  pillars: Partial<Record<Pillar, number | null>>,
): number {
  let count = 0
  for (const pillar of PILLARS) {
    const value = pillars[pillar]
    if (value !== null && value !== undefined) count += 1
  }
  return count
}

export function bandFor(total: number | null): Band {
  if (total === null) return 'incomplete'
  if (total >= 18) return 'healthy'
  if (total >= 11) return 'watch'
  return 'at_risk'
}

export const BAND_LABELS: Record<Band, string> = {
  healthy: 'Healthy',
  watch: 'Watch',
  at_risk: 'At risk',
  incomplete: 'Not scored',
}
