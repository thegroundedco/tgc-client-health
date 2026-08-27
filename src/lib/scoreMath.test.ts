import { describe, expect, it } from 'vitest'
import { meanOrNull, meanTo2dp } from './scoreMath'

describe('meanTo2dp', () => {
  it('rounds to two decimals', () => {
    expect(meanTo2dp(13, 3)).toBe(4.33)
    expect(meanTo2dp(53, 22)).toBe(2.41)
  })

  it('is exact when the division is', () => {
    expect(meanTo2dp(12, 4)).toBe(3)
  })
})

describe('meanOrNull', () => {
  it('is the mean of the values', () => {
    expect(meanOrNull([5, 4, 3])).toBe(4)
  })

  it('is null when any value is missing', () => {
    expect(meanOrNull([5, 4, null])).toBeNull()
    expect(meanOrNull([5, 4, undefined])).toBeNull()
  })
})
