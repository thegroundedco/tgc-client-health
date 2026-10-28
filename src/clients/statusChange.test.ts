import { describe, expect, it } from 'vitest'
import { EMPTY_DRAFT, updatePayload } from './clientForm'
import { cancelDateBounds, cancelProblems, draftWithChange } from './statusChange'
import type { CancelChange } from './statusChange'

const SEPT = '2026-09-01'
const cancel = (overrides: Partial<CancelChange> = {}): CancelChange => ({
  kind: 'cancel', endedOn: '2026-09-30', endReasonCode: 'price', endReasonNote: '', ...overrides,
})

describe('cancelDateBounds', () => {
  it('is the month, for a client who started before it', () => {
    expect(cancelDateBounds(SEPT, '2026-01-01')).toEqual({ min: '2026-09-01', max: '2026-09-30' })
  })
  it('is the month, for a client with no start date', () => {
    expect(cancelDateBounds(SEPT, null)).toEqual({ min: '2026-09-01', max: '2026-09-30' })
  })
  it('starts at the start date for a client who began mid-month', () => {
    expect(cancelDateBounds(SEPT, '2026-09-16')).toEqual({ min: '2026-09-16', max: '2026-09-30' })
  })
})

describe('draftWithChange', () => {
  const draft = { ...EMPTY_DRAFT, name: 'Acme', note: 'kept', typeCode: 'ecommerce' }
  it('pauses, clearing nothing that is not a lifecycle field', () => {
    const paused = draftWithChange(draft, { kind: 'pause' })
    expect(paused).toEqual({ ...draft, status: 'paused', endedOn: '', endReasonCode: '', endReasonNote: '' })
  })
  it('cancels, carrying the date, reason and note into the payload', () => {
    const payload = updatePayload(draftWithChange(draft, cancel({ endReasonNote: ' too dear ' })))
    expect(payload).toMatchObject({
      status: 'cancelled', ended_on: '2026-09-30', end_reason_code: 'price', end_reason_note: 'too dear',
      note: 'kept', type_code: 'ecommerce',
    })
  })
})

describe('cancelProblems', () => {
  const bounds = cancelDateBounds(SEPT, '2026-09-16')
  it('accepts a complete cancellation inside the bounds', () => {
    expect(cancelProblems(cancel(), bounds)).toEqual([])
  })
  it('refuses a missing reason, in the roster form’s own words', () => {
    expect(cancelProblems(cancel({ endReasonCode: '' }), bounds)).toEqual([
      'A cancelled or former client needs a reason from the list.',
    ])
  })
  it('refuses a missing date', () => {
    expect(cancelProblems(cancel({ endedOn: '' }), bounds)).toEqual([
      'A cancelled or former client needs the date they left.',
    ])
  })
  it.each(['2026-09-15', '2026-10-01'])('refuses %s, outside the bounds', (endedOn) => {
    expect(cancelProblems(cancel({ endedOn }), bounds)).toEqual([
      'The end date has to fall between September 16, 2026 and September 30, 2026.',
    ])
  })
  it('accepts both ends of the bounds', () => {
    expect(cancelProblems(cancel({ endedOn: '2026-09-16' }), bounds)).toEqual([])
    expect(cancelProblems(cancel({ endedOn: '2026-09-30' }), bounds)).toEqual([])
  })
})
