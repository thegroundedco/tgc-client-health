import { describe, expect, it } from 'vitest'
import { parseMoney } from './money'
import {
  boxMode,
  effectiveRetainer,
  initialFields,
  paymentCaption,
  retainerQuestion,
  shouldAskRetainer,
  type MonthRow,
} from './paymentBox'

const row = (retainer_cents: number, project_cents: number): MonthRow => ({
  retainer_cents,
  project_cents,
  entered_by: null,
  updated_at: '2026-10-28T12:00:00Z',
})
const blank = { retainer: '', project: '' }

describe('initialFields', () => {
  it('is two empty strings with no row', () => {
    expect(initialFields(null)).toEqual({ retainer: '', project: '' })
  })
  it('writes saved cents as plain numbers', () => {
    expect(initialFields(row(400000, 12345))).toEqual({ retainer: '4000', project: '123.45' })
  })
  it('round-trips through parseMoney', () => {
    expect(parseMoney(initialFields(row(12345, 5)).retainer)).toBe(12345)
    expect(parseMoney(initialFields(row(12345, 5)).project)).toBe(5)
  })
})

describe('effectiveRetainer', () => {
  it('reads blank under a ghost as the ghost', () => {
    expect(effectiveRetainer('', 400000)).toBe(400000)
  })
  it('reads blank with no stored retainer as 0', () => {
    expect(effectiveRetainer('', null)).toBe(0)
  })
  it('parses what was typed, null when invalid', () => {
    expect(effectiveRetainer('3,500', 400000)).toBe(350000)
    expect(effectiveRetainer('0', 400000)).toBe(0)
    expect(effectiveRetainer('abc', 400000)).toBeNull()
  })
})

describe('shouldAskRetainer', () => {
  it('asks only when edited and different from stored', () => {
    expect(shouldAskRetainer({ retainerEdited: true, retainerCents: 350000, storedRetainer: 400000 })).toBe(true)
    expect(shouldAskRetainer({ retainerEdited: true, retainerCents: 0, storedRetainer: 400000 })).toBe(true)
    expect(shouldAskRetainer({ retainerEdited: true, retainerCents: 400000, storedRetainer: 400000 })).toBe(false)
    expect(shouldAskRetainer({ retainerEdited: false, retainerCents: 350000, storedRetainer: 400000 })).toBe(false)
  })
  it('treats a null stored retainer as 0', () => {
    expect(shouldAskRetainer({ retainerEdited: true, retainerCents: 0, storedRetainer: null })).toBe(false)
    expect(shouldAskRetainer({ retainerEdited: true, retainerCents: 100, storedRetainer: null })).toBe(true)
  })
})

describe('boxMode', () => {
  it('is readonly without edit rights, whatever else is true', () => {
    expect(boxMode({ canEdit: false, row: null, storedRetainer: 400000, fields: blank })).toBe('readonly')
  })
  it('confirms when nothing is entered, a retainer exists and both fields are blank', () => {
    expect(boxMode({ canEdit: true, row: null, storedRetainer: 400000, fields: blank })).toBe('confirm')
  })
  it('saves when a field has text', () => {
    expect(boxMode({ canEdit: true, row: null, storedRetainer: 400000, fields: { retainer: '', project: '5' } })).toBe('save')
    expect(boxMode({ canEdit: true, row: null, storedRetainer: 400000, fields: { retainer: '1', project: '' } })).toBe('save')
  })
  it('saves when there is a row', () => {
    expect(boxMode({ canEdit: true, row: row(1, 1), storedRetainer: 400000, fields: blank })).toBe('save')
  })
  it('saves when there is no stored retainer', () => {
    expect(boxMode({ canEdit: true, row: null, storedRetainer: null, fields: blank })).toBe('save')
  })
})

describe('paymentCaption', () => {
  it('names the month the invoice is dated', () => {
    expect(paymentCaption('2026-10-01')).toBe('Invoiced in October')
  })
})

describe('retainerQuestion', () => {
  it('asks to change an existing retainer', () => {
    expect(retainerQuestion('Acme', '2026-10-01', 400000, 350000)).toEqual({
      text: "Acme's retainer is $4,000 a month in Clients admin. Change it to $3,500 from now on?",
      yes: 'Yes, update the retainer',
      no: 'No, just October',
    })
  })
  it('asks to set one when there is none', () => {
    expect(retainerQuestion('Acme', '2026-10-01', null, 350000).text).toBe(
      'Acme has no retainer in Clients admin. Set a retainer of $3,500 a month from now on?',
    )
  })
  it('asks to remove one when the new amount is 0', () => {
    expect(retainerQuestion('Acme', '2026-10-01', 400000, 0).text).toBe(
      "Acme's retainer is $4,000 a month in Clients admin. Remove it from now on?",
    )
  })
  it('names the month in the no button', () => {
    expect(retainerQuestion('Acme', '2026-03-01', 1, 2).no).toBe('No, just March')
  })
})
