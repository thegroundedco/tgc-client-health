import { describe, expect, it } from 'vitest'
import {
  archivedCount,
  boardMembers,
  isOnBoardFor,
  notOpenableReason,
  toggleLabel,
  visibleClients,
} from './boardScope'
import type { ScopedClient } from './boardScope'

const SEPT = '2026-09-01'

function client(overrides: Partial<ScopedClient> = {}): ScopedClient {
  return { id: 1, name: 'Acme', status: 'active', started_on: '2026-01-01', ended_on: null, ...overrides }
}

// One table, read by both the rule and the member set, so the two cannot
// disagree about a case. Each row names the edge it exists to catch.
const CASES: [string, Partial<ScopedClient>, boolean, boolean][] = [
  // [why, client, hasCheckin, expected]
  ['active, started long ago', {}, false, true],
  ['started mid-month', { started_on: '2026-09-15' }, false, true],
  ['started on the last day', { started_on: '2026-09-30' }, false, true],
  ['starts the day after the month', { started_on: '2026-10-01' }, false, false],
  ['starts next month', { started_on: '2026-10-07' }, false, false],
  ['no start date', { started_on: null }, false, true],
  ['cancelled mid-month', { status: 'cancelled', ended_on: '2026-09-15' }, false, true],
  ['ended on the first day', { status: 'former', ended_on: '2026-09-01' }, false, true],
  ['ended the day before the month', { status: 'former', ended_on: '2026-08-31' }, false, false],
  ['ended in a later month', { status: 'cancelled', ended_on: '2026-11-30' }, false, true],
  ['paused, nothing saved', { status: 'paused' }, false, false],
  ['paused, check-in saved', { status: 'paused' }, true, true],
  ['ended before the month, check-in saved', { status: 'former', ended_on: '2026-08-31' }, true, true],
  ['starts next month, check-in saved', { started_on: '2026-10-07' }, true, true],
  ['unknown status', { status: 'archived' }, false, false],
]

describe('isOnBoardFor', () => {
  it.each(CASES)('%s', (_why, overrides, hasCheckin, expected) => {
    expect(isOnBoardFor(client(overrides), SEPT, hasCheckin)).toBe(expected)
  })

  it('takes the month end from the period, not a fixed day', () => {
    // A 31-day month: the 31st is inside it. Hard-coding 30 fails here.
    expect(isOnBoardFor(client({ started_on: '2026-10-31' }), '2026-10-01', false)).toBe(true)
    // February: the 29th of a non-leap year does not exist, the 1st of March is outside.
    expect(isOnBoardFor(client({ started_on: '2026-03-01' }), '2026-02-01', false)).toBe(false)
    expect(isOnBoardFor(client({ started_on: '2026-02-28' }), '2026-02-01', false)).toBe(true)
  })
})

describe('boardMembers', () => {
  it('agrees with isOnBoardFor on every case', () => {
    const roster = CASES.map(([, overrides], index) => client({ id: index + 1, ...overrides }))
    const checkins = new Map(CASES.flatMap(([, , has], index) => (has ? [[index + 1, {}]] : [])))
    const members = boardMembers(roster, SEPT, checkins)
    CASES.forEach(([why, , , expected], index) => {
      expect([why, members.has(index + 1)]).toEqual([why, expected])
    })
  })

  it('counts a check-in only if it is in the map, whatever it holds', () => {
    const paused = client({ id: 9, status: 'paused' })
    expect(boardMembers([paused], SEPT, new Map()).has(9)).toBe(false)
    expect(boardMembers([paused], SEPT, new Map([[9, null]])).has(9)).toBe(true)
  })
})

describe('what the board shows', () => {
  const ROSTER = [
    client({ id: 1, name: 'Zinc' }),
    client({ id: 2, name: 'Acme' }),
    client({ id: 3, name: 'Bellwether', status: 'paused' }),
    client({ id: 4, name: 'Cinder', status: 'cancelled', ended_on: '2026-09-30' }),
    client({ id: 5, name: 'Dune', status: 'former', ended_on: '2026-06-30' }),
    client({ id: 6, name: 'Early', started_on: '2026-10-07' }),
  ]
  const members = boardMembers(ROSTER, SEPT, new Map())

  it('shows only members while the toggle is off, by status then name', () => {
    expect(visibleClients(ROSTER, members, false).map((c) => c.name)).toEqual(['Acme', 'Zinc', 'Cinder'])
  })

  it('shows members first, then the rest, while the toggle is on', () => {
    expect(visibleClients(ROSTER, members, true).map((c) => c.name)).toEqual([
      'Acme', 'Zinc', 'Cinder', 'Early', 'Bellwether', 'Dune',
    ])
  })

  it('counts everyone who is not a member as archived', () => {
    expect(archivedCount(ROSTER, members)).toBe(3)
    // 3 and 3 above, so an inverted count would also pass. This one differs.
    expect(archivedCount([client({ id: 7 })], new Set())).toBe(1)
  })

  it('does not sort the array it was given', () => {
    const before = ROSTER.map((c) => c.id)
    visibleClients(ROSTER, members, true)
    expect(ROSTER.map((c) => c.id)).toEqual(before)
  })
})

describe('notOpenableReason', () => {
  it('says a paused client is coming back', () => {
    expect(notOpenableReason(client({ status: 'paused' }), SEPT)).toMatch(/paused/)
  })
  it('names the start date of a client who had not started', () => {
    expect(notOpenableReason(client({ started_on: '2026-10-07' }), SEPT)).toBe(
      'This client starts on October 7, 2026, after September 2026, so there is nothing to score yet.',
    )
  })
  it('names the end date of a client who had already left', () => {
    expect(notOpenableReason(client({ status: 'former', ended_on: '2026-06-30' }), SEPT)).toBe(
      'This client is former and ended on June 30, 2026, before September 2026. Their past check-ins are unchanged.',
    )
  })
  it('says what it found for a status it does not know', () => {
    expect(notOpenableReason(client({ status: 'archived' }), SEPT)).toMatch(/"archived"/)
  })
})

describe('what the toggle says', () => {
  it('offers to show, and then to hide, naming the count both ways', () => {
    expect(toggleLabel(3, false)).toBe('Show 3 archived')
    expect(toggleLabel(3, true)).toBe('Hide 3 archived')
  })

  it('says one client rather than 1 clients', () => {
    expect(toggleLabel(1, false)).toBe('Show 1 archived')
  })

  it('never returns an empty label, at any count', () => {
    // The caller does not draw the control at zero, but a label function that
    // can return '' is one refactor away from an unlabelled button.
    for (const count of [0, 1, 2, 99]) {
      expect(toggleLabel(count, false).length).toBeGreaterThan(0)
      expect(toggleLabel(count, true).length).toBeGreaterThan(0)
    }
  })
})
