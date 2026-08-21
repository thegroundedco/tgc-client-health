export const PILLARS = [
  'relationship',
  'delivery',
  'financial',
  'sentiment',
  'growth',
] as const

export type Pillar = (typeof PILLARS)[number]

export type Band = 'healthy' | 'watch' | 'at_risk' | 'incomplete'

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
