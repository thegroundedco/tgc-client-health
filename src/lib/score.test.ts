import { describe, expect, it } from 'vitest'
import { PILLARS, bandFor, totalScore } from './score'

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
