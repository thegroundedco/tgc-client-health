import { describe, expect, it } from 'vitest'
import {
  addMonths,
  currentPeriod,
  defaultPeriod,
  formatPeriod,
  formatSavedAt,
  periodFor,
  periodOptions,
  previousPeriod,
} from './month'

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

describe('previousPeriod', () => {
  it('steps back one month', () => {
    expect(previousPeriod('2026-08-01')).toBe('2026-07-01')
  })

  it('rolls the year over', () => {
    expect(previousPeriod('2026-01-01')).toBe('2025-12-01')
  })
})

describe('defaultPeriod', () => {
  it('defaults to last month, because a month is scored after it closes', () => {
    // The owner's actual workflow: August is scored during September. Defaulting
    // to the current month meant the board showed nothing but em dashes for the
    // first three weeks of every month, and the month he wanted became
    // unreachable the moment the calendar turned.
    expect(defaultPeriod()).toBe(previousPeriod(currentPeriod()))
  })
})

describe('periodOptions', () => {
  it('starts at the current month and never offers a later one', () => {
    // The list is the whole guard. There is no disabled state to get wrong
    // because a month you cannot score is simply not in it.
    const options = periodOptions()
    expect(options[0]).toBe(currentPeriod())
    for (const option of options) expect(option <= currentPeriod()).toBe(true)
  })

  it('runs newest first, one month apart, with no gaps or repeats', () => {
    const options = periodOptions(4)
    expect(options).toHaveLength(4)
    expect(options).toEqual([
      currentPeriod(),
      addMonths(currentPeriod(), -1),
      addMonths(currentPeriod(), -2),
      addMonths(currentPeriod(), -3),
    ])
  })

  it('includes the month the board opens on', () => {
    // If it did not, the board would mount with a value matching no option and
    // the select would silently show whatever came first instead -- the month
    // shown and the month read would disagree, which is the one failure this
    // control exists to prevent.
    expect(periodOptions()).toContain(defaultPeriod())
  })

  it('crosses the year boundary without a gap', () => {
    // Not date arithmetic done by hand: addMonths normalises the rollover, and
    // this is the case that catches a naive month - index.
    const options = periodOptions(14)
    const january = options.findIndex((option) => option.endsWith('-01-01'))
    expect(january).toBeGreaterThan(-1)
    expect(options[january + 1]?.endsWith('-12-01')).toBe(true)
  })
})

describe('previousPeriod without a floor', () => {
  it('goes back without limit', () => {
    // No floor: the query simply returns nothing for a month before the client
    // existed, and a floor would need a per-client answer the board does not have.
    expect(previousPeriod('2020-01-01')).toBe('2019-12-01')
  })
})

describe('formatSavedAt', () => {
  it('renders a real timestamp as a date and a time', () => {
    // Asserted on the year rather than the full string: the format is the
    // runner's local zone and locale data, and pinning the exact output would
    // make this test fail on a machine in a different timezone rather than
    // when the function breaks.
    const text = formatSavedAt('2026-08-21T15:42:00.000Z')
    expect(text).toContain('2026')
    expect(text).not.toContain('Invalid')
    expect(text.trim()).not.toBe('')
  })

  it('hands back anything it cannot parse, rather than the words "Invalid Date"', () => {
    // A malformed timestamp reaching the screen should read as odd data, not as
    // a broken app. `new Date('nonsense').toLocaleString()` is the string
    // "Invalid Date", which looks like a crash to the person reading it.
    expect(formatSavedAt('nonsense')).toBe('nonsense')
    expect(formatSavedAt('')).toBe('')
  })
})
