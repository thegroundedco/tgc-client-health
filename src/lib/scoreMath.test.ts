import { describe, expect, it } from 'vitest'
import { meanOrNull, meanTo2dp, yesNoScore } from './scoreMath'

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

describe('yesNoScore', () => {
  // 1 + the number of yeses. Exactly the migration's generated expression, and
  // verify:score is what proves the two agree.
  it('is 1 for all No and 5 for all Yes, stepping by one', () => {
    expect(yesNoScore([false, false, false, false])).toBe(1)
    expect(yesNoScore([true, false, false, false])).toBe(2)
    expect(yesNoScore([true, true, false, false])).toBe(3)
    expect(yesNoScore([true, true, true, false])).toBe(4)
    expect(yesNoScore([true, true, true, true])).toBe(5)
  })

  // The distinction the whole model rests on: four Nos is a real, low score;
  // one blank is no score at all.
  it('is null if any answer is missing, which is NOT the same as No', () => {
    expect(yesNoScore([true, true, true, null])).toBeNull()
    expect(yesNoScore([true, true, true, undefined])).toBeNull()
    expect(yesNoScore([false, false, false, false])).toBe(1)
  })
})
