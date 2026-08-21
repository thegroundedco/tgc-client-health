import { describe, expect, it } from 'vitest'
import { addMonths, formatPeriod, periodFor } from './month'

describe('periodFor', () => {
  it('normalises any date to the first of its month', () => {
    expect(periodFor(new Date(2026, 7, 20))).toBe('2026-08-01')
  })

  it('pads single-digit months', () => {
    expect(periodFor(new Date(2026, 0, 5))).toBe('2026-01-01')
  })
})

describe('addMonths', () => {
  it('steps back across a year boundary', () => {
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01')
  })

  it('steps forward across a year boundary', () => {
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01')
  })

  it('steps back twelve months to the same month a year earlier', () => {
    expect(addMonths('2026-08-01', -12)).toBe('2025-08-01')
  })
})

describe('formatPeriod', () => {
  it('renders a human label', () => {
    expect(formatPeriod('2026-08-01')).toBe('August 2026')
  })
})
