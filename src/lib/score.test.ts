import { describe, expect, it } from 'vitest'
import {
  MAX_PILLAR_SCORE,
  MAX_TOTAL,
  PILLARS,
  SCORE_VALUES,
  bandFor,
  scoredCount,
  totalScore,
  type Pillar,
} from './score'

describe('totalScore', () => {
  it('sums all five pillars', () => {
    expect(totalScore({ relationship: 5, delivery: 4, financial: 3, sentiment: 4, growth: 2 })).toBe(18)
  })

  it('returns null when a pillar is missing', () => {
    expect(totalScore({ relationship: 5, delivery: 4, financial: 3, sentiment: 4 })).toBeNull()
  })

  it('returns null when a pillar is explicitly null', () => {
    expect(totalScore({ relationship: 5, delivery: 4, financial: 3, sentiment: 4, growth: null })).toBeNull()
  })

  it('names exactly the five spec pillars in order', () => {
    expect(PILLARS).toEqual(['relationship', 'delivery', 'financial', 'sentiment', 'growth'])
  })
})

describe('bandFor', () => {
  it('bands 18 and above as healthy', () => {
    expect(bandFor(18)).toBe('healthy')
    expect(bandFor(25)).toBe('healthy')
  })

  it('bands 11 to 17 as watch', () => {
    expect(bandFor(11)).toBe('watch')
    expect(bandFor(17)).toBe('watch')
  })

  it('bands 10 and below as at risk', () => {
    expect(bandFor(10)).toBe('at_risk')
    expect(bandFor(5)).toBe('at_risk')
  })

  it('reports an unscored check-in as incomplete, never at risk', () => {
    expect(bandFor(null)).toBe('incomplete')
  })
})

describe('the scoring vocabulary', () => {
  it('puts the maximum at 25, which is the denominator every screen prints', () => {
    // Asserted as a literal on purpose. Board.tsx and CheckIn.tsx both print
    // "of 25" beside a total; if the pillar count or the per-pillar maximum
    // ever changes, this fails instead of the two screens quietly lying.
    expect(MAX_TOTAL).toBe(25)
    expect(MAX_PILLAR_SCORE).toBe(5)
    expect(SCORE_VALUES).toEqual([1, 2, 3, 4, 5])
  })

  it('counts only pillars that hold a score', () => {
    expect(scoredCount({})).toBe(0)
    expect(scoredCount({ relationship: 1 })).toBe(1)
    expect(scoredCount({ relationship: 1, delivery: null })).toBe(1)
    expect(scoredCount({ relationship: 1, delivery: undefined })).toBe(1)
    expect(
      scoredCount({
        relationship: 1,
        delivery: 2,
        financial: 3,
        sentiment: 4,
        growth: 5,
      }),
    ).toBe(5)
  })

  it('ignores keys that are not pillars', () => {
    // The form's state is built from PILLARS, but a draft restored from
    // localStorage is arbitrary JSON. A stray key must not inflate the count
    // and make an incomplete check-in look submittable.
    //
    // Cast through `unknown` deliberately: the point of the test is to hand
    // scoredCount a shape the type system would refuse, which is exactly what
    // JSON.parse produces at runtime. If a narrower cast compiles, use it --
    // but do not change the assertion to fit the type.
    const strayKey = { relationship: 1, nonsense: 5 } as unknown as Partial<
      Record<Pillar, number>
    >
    expect(scoredCount(strayKey)).toBe(1)
  })
})
