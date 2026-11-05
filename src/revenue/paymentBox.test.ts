import { describe, expect, it } from 'vitest'
import { parseMoney } from './money'
import {
  boxMode,
  checkItems,
  displayItems,
  effectiveRetainer,
  ghostRetainer,
  monthName,
  initialFields,
  paymentCaption,
  projectTotal,
  retainerQuestion,
  shouldAskRetainer,
  type MonthRow,
} from './paymentBox'

const row = (retainer_cents: number, project_cents: number): MonthRow => ({
  retainer_cents,
  project_cents,
  project_notes: null,
  entered_by: null,
  updated_at: '2026-10-28T12:00:00Z',
})
const EMPTY = { label: '', amount: '' }
const blank = { retainer: '', items: [EMPTY] }

describe('initialFields', () => {
  it('is an empty retainer and one empty line item with no row', () => {
    expect(initialFields(null, [])).toEqual({ retainer: '', items: [EMPTY] })
  })
  it('writes saved cents as plain numbers, one row per saved item, in order', () => {
    expect(
      initialFields(row(400000, 12345), [
        { label: 'Photo shoot', cents: 12000 },
        { label: 'Dev', cents: 345 },
      ]),
    ).toEqual({
      retainer: '4000',
      items: [
        { label: 'Photo shoot', amount: '120' },
        { label: 'Dev', amount: '3.45' },
      ],
    })
  })
  it('turns an older month with a project amount and no items into one Project row', () => {
    expect(initialFields(row(400000, 50000), []).items).toEqual([{ label: 'Project', amount: '500' }])
  })
  it('gives a saved month with no project work one empty row', () => {
    expect(initialFields(row(400000, 0), []).items).toEqual([EMPTY])
  })
  it('round-trips through parseMoney', () => {
    expect(parseMoney(initialFields(row(12345, 5), []).retainer)).toBe(12345)
    expect(parseMoney(initialFields(row(12345, 5), []).items[0].amount)).toBe(5)
  })
})

describe('displayItems', () => {
  it('is the saved items when there are any', () => {
    const items = [{ label: 'A', cents: 1 }]
    expect(displayItems(row(1, 999), items)).toBe(items)
  })
  it('is one Project item for an older month with only an amount', () => {
    expect(displayItems(row(1, 50000), [])).toEqual([{ label: 'Project', cents: 50000 }])
  })
  it('is nothing with no project amount, or no row', () => {
    expect(displayItems(row(1, 0), [])).toEqual([])
    expect(displayItems(null, [])).toEqual([])
  })
})

describe('checkItems', () => {
  it('ignores fully empty rows and trims labels', () => {
    expect(
      checkItems([EMPTY, { label: '  Photo shoot ', amount: '1,500' }, { label: ' ', amount: '  ' }, { label: 'Dev', amount: '$25.50' }]),
    ).toEqual({
      ok: true,
      items: [
        { label: 'Photo shoot', cents: 150000 },
        { label: 'Dev', cents: 2550 },
      ],
      totalCents: 152550,
    })
  })
  it('is an empty list, and zero, when every row is empty', () => {
    expect(checkItems([EMPTY, EMPTY])).toEqual({ ok: true, items: [], totalCents: 0 })
    expect(checkItems([])).toEqual({ ok: true, items: [], totalCents: 0 })
  })
  it('needs a label for an amount', () => {
    const result = checkItems([{ label: '  ', amount: '10' }, { label: 'Fine', amount: '1' }])
    expect(result).toEqual({ ok: false, errors: ['Add a label for this amount.', null], problem: null })
  })
  it('needs an amount above $0 for a label', () => {
    expect(checkItems([{ label: 'Shoot', amount: '' }])).toEqual({ ok: false, errors: ['Add an amount above $0.'], problem: null })
    expect(checkItems([{ label: 'Shoot', amount: '0' }])).toEqual({ ok: false, errors: ['Add an amount above $0.'], problem: null })
    expect(checkItems([{ label: 'Shoot', amount: '0.00' }])).toEqual({ ok: false, errors: ['Add an amount above $0.'], problem: null })
  })
  it('refuses an amount that is not money', () => {
    expect(checkItems([{ label: 'Shoot', amount: 'abc' }])).toEqual({
      ok: false,
      errors: ['Not a dollar amount up to $21,474,836.47.'],
      problem: null,
    })
  })
  it('refuses a label past 120 characters, counted after trimming', () => {
    expect(checkItems([{ label: ` ${'a'.repeat(120)} `, amount: '1' }]).ok).toBe(true)
    expect(checkItems([{ label: 'a'.repeat(121), amount: '1' }])).toEqual({
      ok: false,
      errors: ['Keep the label to 120 characters.'],
      problem: null,
    })
  })
  it('refuses a total past what the column holds', () => {
    expect(checkItems([{ label: 'A', amount: '21,474,836' }, { label: 'B', amount: '1' }])).toEqual({
      ok: false,
      errors: [null, null],
      problem: 'The project total is over $21,474,836.47. Nothing was saved.',
    })
  })
})

describe('projectTotal', () => {
  it('sums the amounts that read as money above zero', () => {
    expect(projectTotal([{ label: 'A', amount: '1,500' }, { label: '', amount: '2.50' }, { label: 'C', amount: 'abc' }, EMPTY])).toBe(150250)
    expect(projectTotal([])).toBe(0)
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
  it('confirms when nothing is entered, a retainer exists and every field is blank', () => {
    expect(boxMode({ canEdit: true, row: null, storedRetainer: 400000, fields: blank })).toBe('confirm')
    expect(boxMode({ canEdit: true, row: null, storedRetainer: 400000, fields: { retainer: ' ', items: [EMPTY, { label: ' ', amount: '' }] } })).toBe('confirm')
    expect(boxMode({ canEdit: true, row: null, storedRetainer: 400000, fields: { retainer: '', items: [] } })).toBe('confirm')
  })
  it('saves when a field has text', () => {
    expect(boxMode({ canEdit: true, row: null, storedRetainer: 400000, fields: { retainer: '', items: [{ label: '', amount: '5' }] } })).toBe('save')
    expect(boxMode({ canEdit: true, row: null, storedRetainer: 400000, fields: { retainer: '', items: [EMPTY, { label: 'x', amount: '' }] } })).toBe('save')
    expect(boxMode({ canEdit: true, row: null, storedRetainer: 400000, fields: { retainer: '1', items: [EMPTY] } })).toBe('save')
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

describe('ghostRetainer', () => {
  const row: MonthRow = { retainer_cents: 300000, project_cents: 0, project_notes: null, entered_by: null, updated_at: '2026-11-04T12:00:00Z' }
  it('is the stored retainer only when the month has no row', () => {
    expect(ghostRetainer(null, 400000)).toBe(400000)
    expect(ghostRetainer(null, null)).toBeNull()
    expect(ghostRetainer(row, 400000)).toBeNull()
  })
  it('makes a cleared Retainer on a saved month zero, not the stored amount', () => {
    expect(effectiveRetainer('', ghostRetainer(row, 400000))).toBe(0)
  })
})

describe('monthName', () => {
  it('is the month only', () => {
    expect(monthName('2026-10-01')).toBe('October')
  })
})
