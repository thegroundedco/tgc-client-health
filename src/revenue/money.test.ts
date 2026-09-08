import { describe, expect, it } from 'vitest'
import { formatMoney, parseMoney, MAX_CENTS } from './money'

describe('formatMoney', () => {
  it('renders whole dollars without a decimal tail', () => {
    // The overwhelmingly common case at this agency: retainers are round
    // numbers. "$4,000.00" is noise on a screen where every figure ends .00.
    expect(formatMoney(400000)).toBe('$4,000')
  })

  it('renders cents when there are any', () => {
    expect(formatMoney(400010)).toBe('$4,000.10')
    expect(formatMoney(1)).toBe('$0.01')
  })

  it('renders zero as a dollar amount, not as a dash', () => {
    // An entered zero is a fact -- "billed nothing this month" -- and must look
    // like a number. A dash is what an ABSENT row renders as, and the whole
    // slice depends on those two never looking the same.
    expect(formatMoney(0)).toBe('$0')
  })

  it('groups thousands', () => {
    expect(formatMoney(123456789)).toBe('$1,234,567.89')
  })
})

describe('parseMoney', () => {
  it('reads a plain number of dollars', () => {
    expect(parseMoney('4000')).toBe(400000)
  })

  it('reads what a person actually types', () => {
    // Every one of these has been typed into a money field by somebody.
    expect(parseMoney('$4,000')).toBe(400000)
    expect(parseMoney(' 4000 ')).toBe(400000)
    expect(parseMoney('4,000.10')).toBe(400010)
    expect(parseMoney('4000.1')).toBe(400010)
  })

  it('reads an empty field as zero, not as a refusal', () => {
    // The grid pre-fills nothing. A blank project-work field means zero, and
    // making the person type 0 in ten rows to save a month is a worse tool.
    expect(parseMoney('')).toBe(0)
    expect(parseMoney('   ')).toBe(0)
  })

  it('refuses what is not a number', () => {
    expect(parseMoney('four thousand')).toBe(null)
    expect(parseMoney('4000abc')).toBe(null)
    expect(parseMoney('--4000')).toBe(null)
  })

  it('refuses a negative amount', () => {
    // The column has a check constraint. Refusing here means the person sees
    // why in the field rather than as a failed save of the whole month.
    expect(parseMoney('-4000')).toBe(null)
  })

  it('refuses more than the column can hold', () => {
    // integer cents tops out at 2147483647. A value past it would be accepted
    // by the browser, sent, and rejected by Postgres as a numeric overflow --
    // an error message about int4 range, on a screen about a retainer.
    expect(MAX_CENTS).toBe(2147483647)
    expect(parseMoney('21474836.47')).toBe(MAX_CENTS)
    expect(parseMoney('21474836.48')).toBe(null)
  })

  it('refuses a fraction of a cent rather than rounding it away', () => {
    // 0.005 dollars is half a cent. Rounding silently turns a typo into a
    // number the person never entered; refusing shows them the field.
    expect(parseMoney('4000.005')).toBe(null)
  })

  it('rounds a value that floating point multiplies inexactly', () => {
    // Math.round, not Math.trunc, and this is the test that proves it.
    // 19.99 * 100 is 1998.9999999999998, so truncation gives $19.98 -- a real
    // amount, silently one cent light, on a column that feeds a retention
    // figure. Every other fixture in this file multiplies exactly, so before
    // this test existed the whole suite passed with Math.trunc.
    expect(parseMoney('19.99')).toBe(1999)
    expect(parseMoney('0.29')).toBe(29)
    expect(parseMoney('2.03')).toBe(203)
  })
})
