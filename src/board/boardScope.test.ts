import { describe, expect, it } from 'vitest'
import { CLIENT_STATUSES } from '../clients/clientForm'
import {
  activeCount,
  archivedCount,
  isOnBoard,
  isOpenable,
  notOpenableReason,
  toggleLabel,
  visibleClients,
} from './boardScope'
import type { ScopedClient } from './boardScope'

function client(overrides: Partial<ScopedClient> = {}): ScopedClient {
  return { id: 1, name: 'Acme', status: 'active', ...overrides }
}

const ROSTER: ScopedClient[] = [
  client({ id: 1, name: 'Zinc', status: 'active' }),
  client({ id: 2, name: 'Acme', status: 'active' }),
  client({ id: 3, name: 'Bellwether', status: 'paused' }),
  client({ id: 4, name: 'Cinder', status: 'cancelled' }),
  client({ id: 5, name: 'Test Client', status: 'former' }),
]

describe('what counts as on the board', () => {
  it('is active, and nothing else', () => {
    expect(CLIENT_STATUSES.filter(isOnBoard)).toEqual(['active'])
  })

  it('treats a status it does not recognise as off the board', () => {
    // Closed by default, for the same reason can() is: an unknown status is a
    // row written outside this app, and putting it on the working roster would
    // add a client nobody chose to the month's check-in count.
    expect(isOnBoard('archived')).toBe(false)
    expect(isOnBoard('')).toBe(false)
  })
})

describe('the two counts', () => {
  it('counts active and archived separately, and they total the roster', () => {
    expect(activeCount(ROSTER)).toBe(2)
    expect(archivedCount(ROSTER)).toBe(3)
    expect(activeCount(ROSTER) + archivedCount(ROSTER)).toBe(ROSTER.length)
  })

  it('counts nothing in an empty roster without throwing', () => {
    expect(activeCount([])).toBe(0)
    expect(archivedCount([])).toBe(0)
  })
})

describe('what the board shows', () => {
  it('shows only active clients while the toggle is off', () => {
    expect(visibleClients(ROSTER, false).map((c) => c.name)).toEqual(['Acme', 'Zinc'])
  })

  it('shows everything while the toggle is on, active roster first', () => {
    // Active before paused before cancelled before former, alphabetical inside
    // each. Name order alone would put Bellwether between Acme and Zinc and the
    // working roster would stop reading as a block.
    expect(visibleClients(ROSTER, true).map((c) => c.name)).toEqual([
      'Acme',
      'Zinc',
      'Bellwether',
      'Cinder',
      'Test Client',
    ])
  })

  it('does not mutate its input', () => {
    const input = [...ROSTER]
    visibleClients(input, true)
    expect(input.map((c) => c.id)).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps every field of the row it was given', () => {
    // Generic over the row type, so the board's real rows keep their check-in
    // columns rather than being narrowed to ScopedClient on the way through.
    const rows = [{ id: 1, name: 'Acme', status: 'active', extra: 'kept' }]
    expect(visibleClients(rows, false)[0].extra).toBe('kept')
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

describe('whether a card can be opened', () => {
  it('opens an active client and refuses every other status', () => {
    expect(CLIENT_STATUSES.filter(isOpenable)).toEqual(['active'])
    expect(isOpenable('archived')).toBe(false)
  })

  it('says why, in words, for every status it refuses', () => {
    // The reason is shown on the card. checkins_insert_edit_scores has no
    // status predicate, so the database would accept a check-in for a client
    // who left -- this sentence is the only thing that explains why the app
    // will not offer it.
    for (const status of CLIENT_STATUSES.filter((s) => !isOpenable(s))) {
      expect(notOpenableReason(status).length).toBeGreaterThan(0)
    }
  })

  it('distinguishes a paused client from one that has left', () => {
    // Different facts deserve different sentences: a paused client is coming
    // back, a former one is not.
    expect(notOpenableReason('paused')).not.toBe(notOpenableReason('former'))
    expect(notOpenableReason('paused')).toContain('paused')
  })
})
