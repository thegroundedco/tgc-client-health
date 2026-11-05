import { describe, expect, it } from 'vitest'
import { describeChange, formatChange, scoreChange } from './scoreChange'

describe('scoreChange', () => {
  it('is null when this month is null', () => {
    expect(scoreChange(null, 3)).toBeNull()
  })

  it('is null when last month is null', () => {
    expect(scoreChange(3, null)).toBeNull()
  })

  it('is null when both are null', () => {
    expect(scoreChange(null, null)).toBeNull()
  })

  it('treats a 1 as a score, not an absence', () => {
    expect(scoreChange(1, 1)).toEqual({ direction: 'same', delta: 0 })
  })

  it('is up, rounded to two places: 3.666 against 3.333 is +0.33', () => {
    expect(scoreChange(3.666, 3.333)).toEqual({ direction: 'up', delta: 0.33 })
  })

  it('is down, rounded to two places: 3.333 against 3.666 is -0.33', () => {
    expect(scoreChange(3.333, 3.666)).toEqual({ direction: 'down', delta: -0.33 })
  })

  it('is same when the difference rounds to zero (0.004)', () => {
    expect(scoreChange(3.004, 3)).toEqual({ direction: 'same', delta: 0 })
  })

  it('is same, with a positive zero, when a negative difference rounds to zero', () => {
    const change = scoreChange(3, 3.004)
    expect(change).toEqual({ direction: 'same', delta: 0 })
    expect(Object.is(change?.delta, -0)).toBe(false)
  })

  it('is up at the smallest visible step (0.01)', () => {
    expect(scoreChange(3.01, 3)).toEqual({ direction: 'up', delta: 0.01 })
  })

  it('carries a whole-number delta', () => {
    expect(scoreChange(5, 1)).toEqual({ direction: 'up', delta: 4 })
  })
})

describe('formatChange', () => {
  it('writes an increase with an up triangle and a plus sign', () => {
    expect(formatChange({ direction: 'up', delta: 0.33 })).toBe('▲ +0.33')
  })

  it('writes a decrease with a down triangle and a true minus sign, two places', () => {
    expect(formatChange({ direction: 'down', delta: -0.5 })).toBe('▼ −0.50')
    expect(formatChange({ direction: 'down', delta: -0.5 })).not.toContain('-')
  })

  it('writes no change in words', () => {
    expect(formatChange({ direction: 'same', delta: 0 })).toBe('no change')
  })

  it('pads to two places', () => {
    expect(formatChange({ direction: 'up', delta: 1 })).toBe('▲ +1.00')
  })

  it('round-trips scoreChange', () => {
    expect(formatChange(scoreChange(3.67, 3.34)!)).toBe('▲ +0.33')
    expect(formatChange(scoreChange(3.0, 3.5)!)).toBe('▼ −0.50')
  })
})

describe('describeChange', () => {
  it('names the bucket, the direction, the size and the month, for a label', () => {
    expect(describeChange('Communication', { direction: 'up', delta: 0.33 }, 'September')).toBe(
      'Communication up 0.33 from September',
    )
    expect(describeChange('Delivery', { direction: 'down', delta: -0.5 }, 'September')).toBe(
      'Delivery down 0.50 from September',
    )
    expect(describeChange('Overall', { direction: 'same', delta: 0 }, 'September')).toBe(
      'Overall unchanged from September',
    )
  })
})
