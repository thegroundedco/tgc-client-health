import { describe, expect, it } from 'vitest'
import {
  CLIENT_STATUSES,
  END_REASON_CODES,
  EMPTY_DRAFT,
  draftFromRow,
  formProblems,
  insertPayload,
  isChurned,
  ownerLabel,
  reactivationWarning,
  reasonLabel,
  sortClients,
  statusLabel,
  updatePayload,
  writeFailureText,
  writeStatusLine,
} from './clientForm'
import type { AdminClient, ClientDraft } from './clientForm'

function row(overrides: Partial<AdminClient> = {}): AdminClient {
  return {
    id: 1,
    name: 'Acme',
    owner_id: null,
    status: 'active',
    ended_on: null,
    end_reason_code: null,
    end_reason_note: null,
    updated_at: '2026-08-24T15:42:00.000Z',
    ...overrides,
  }
}

function draft(overrides: Partial<ClientDraft> = {}): ClientDraft {
  return { ...EMPTY_DRAFT, name: 'Acme', ...overrides }
}

describe('the status vocabulary', () => {
  it('is the four the check constraint permits, active first', () => {
    expect(CLIENT_STATUSES).toEqual(['active', 'paused', 'cancelled', 'former'])
  })

  it('treats cancelled and former as churned, and nothing else', () => {
    expect(CLIENT_STATUSES.filter(isChurned)).toEqual(['cancelled', 'former'])
    expect(isChurned('sales')).toBe(false)
  })

  it('labels every status, and hands back an unknown one unchanged', () => {
    for (const status of CLIENT_STATUSES) {
      expect(statusLabel(status).length).toBeGreaterThan(0)
    }
    // Honest rather than reassuring: a status this screen does not know must
    // not be relabelled into one it does.
    expect(statusLabel('archived')).toBe('archived')
  })
})

describe('the reason vocabulary', () => {
  it('labels all seven codes, and says so when there is no code', () => {
    expect(END_REASON_CODES).toHaveLength(7)
    for (const code of END_REASON_CODES) {
      expect(reasonLabel(code)).not.toBe(code)
    }
    expect(reasonLabel(null)).toBe('No reason recorded')
    expect(reasonLabel('poached')).toBe('poached')
  })
})

describe('rule 1 -- a churned client needs a date and a coded reason', () => {
  it('asks for both when the status is cancelled or former', () => {
    for (const status of ['cancelled', 'former']) {
      const fields = formProblems(draft({ status })).map((p) => p.field)
      expect(fields).toContain('endedOn')
      expect(fields).toContain('endReasonCode')
    }
  })

  it('asks for neither when the status is active or paused', () => {
    for (const status of ['active', 'paused']) {
      expect(formProblems(draft({ status }))).toEqual([])
    }
  })

  it('is satisfied once both are supplied', () => {
    expect(
      formProblems(draft({ status: 'former', endedOn: '2026-08-01', endReasonCode: 'price' })),
    ).toEqual([])
  })

  it('never requires the note', () => {
    const problems = formProblems(
      draft({ status: 'former', endedOn: '2026-08-01', endReasonCode: 'price', endReasonNote: '' }),
    )
    expect(problems).toEqual([])
  })

  it('requires a name, and does not accept whitespace as one', () => {
    expect(formProblems(draft({ name: '   ' })).map((p) => p.field)).toEqual(['name'])
  })

  it('refuses a status it does not recognise, rather than saving it', () => {
    expect(formProblems(draft({ status: 'archived' })).map((p) => p.field)).toContain('status')
  })
})

describe('rule 2 -- reactivating destroys a recorded fact, and says so', () => {
  it('warns when leaving a churned status for a live one', () => {
    for (const from of ['cancelled', 'former']) {
      for (const to of ['active', 'paused']) {
        expect(reactivationWarning(from, to)).toContain('end date')
      }
    }
  })

  it('stays quiet in every other direction', () => {
    expect(reactivationWarning('active', 'former')).toBeNull()
    expect(reactivationWarning('active', 'paused')).toBeNull()
    expect(reactivationWarning('former', 'cancelled')).toBeNull()
    expect(reactivationWarning('former', 'former')).toBeNull()
  })

  it('clears all three columns in the one payload, for every live status', () => {
    // The constraint is bidirectional (spec §10 decision 2), so an update that
    // sets status without clearing these three is refused by Postgres. Sending
    // every column on every save is what makes that impossible to forget --
    // this is the assertion that stands in for the constraint.
    for (const status of ['active', 'paused']) {
      const payload = updatePayload(
        draft({ status, endedOn: '2026-08-01', endReasonCode: 'price', endReasonNote: 'left' }),
      )
      expect(payload.ended_on).toBeNull()
      expect(payload.end_reason_code).toBeNull()
      expect(payload.end_reason_note).toBeNull()
    }
  })

  it('sends all six columns on every save, whatever the status', () => {
    for (const status of CLIENT_STATUSES) {
      expect(Object.keys(updatePayload(draft({ status }))).sort()).toEqual([
        'end_reason_code',
        'end_reason_note',
        'ended_on',
        'name',
        'owner_id',
        'status',
      ])
    }
  })

  it('keeps the three columns on a churned save', () => {
    const payload = updatePayload(
      draft({ status: 'cancelled', endedOn: '2026-08-01', endReasonCode: 'price', endReasonNote: 'left' }),
    )
    expect(payload.ended_on).toBe('2026-08-01')
    expect(payload.end_reason_code).toBe('price')
    expect(payload.end_reason_note).toBe('left')
  })

  it('stores an empty note as null, not as an empty string', () => {
    const payload = updatePayload(
      draft({ status: 'cancelled', endedOn: '2026-08-01', endReasonCode: 'price', endReasonNote: '  ' }),
    )
    expect(payload.end_reason_note).toBeNull()
  })

  it('trims the name it sends', () => {
    expect(updatePayload(draft({ name: '  Acme  ' })).name).toBe('Acme')
    expect(insertPayload(draft({ name: '  Acme  ' })).name).toBe('Acme')
  })
})

describe('adding a client', () => {
  it('creates it active, and offers no way to create a churned one', () => {
    // Spec §7: "a client who has already left is not something anybody needs
    // to add". The absence of the three keys is the assertion -- a payload that
    // merely happened to send nulls would still let a future edit set them.
    const payload = insertPayload(draft({ status: 'former', endedOn: '2026-08-01' }))
    expect(payload.status).toBe('active')
    expect(Object.keys(payload).sort()).toEqual(['name', 'owner_id', 'status'])
  })
})

describe('a row becoming a form', () => {
  it('carries every column across, with nulls as empty strings', () => {
    expect(draftFromRow(row({ status: 'former', ended_on: '2026-08-01', end_reason_code: 'price' })))
      .toEqual({
        name: 'Acme',
        ownerId: null,
        status: 'former',
        endedOn: '2026-08-01',
        endReasonCode: 'price',
        endReasonNote: '',
      })
  })

  it('round-trips through updatePayload without inventing or losing a value', () => {
    const original = row({
      name: 'Polar Divide',
      owner_id: 'owner-1',
      status: 'cancelled',
      ended_on: '2026-07-15',
      end_reason_code: 'went_quiet',
      end_reason_note: 'stopped replying',
    })
    expect(updatePayload(draftFromRow(original))).toEqual({
      name: 'Polar Divide',
      owner_id: 'owner-1',
      status: 'cancelled',
      ended_on: '2026-07-15',
      end_reason_code: 'went_quiet',
      end_reason_note: 'stopped replying',
    })
  })
})

describe('the owner picker label', () => {
  it('prefers the name and falls back to the email', () => {
    expect(ownerLabel({ full_name: 'Amy Account', email: 'amy@example.com' })).toBe('Amy Account')
    expect(ownerLabel({ full_name: null, email: 'amy@example.com' })).toBe('amy@example.com')
    // A row whose full_name is whitespace is a row with no usable name.
    expect(ownerLabel({ full_name: '   ', email: 'amy@example.com' })).toBe('amy@example.com')
  })
})

describe('the list order', () => {
  it('reads the active roster first, then alphabetically inside each status', () => {
    const sorted = sortClients([
      row({ id: 1, name: 'Zinc', status: 'active' }),
      row({ id: 2, name: 'Test Client', status: 'former', ended_on: '2026-08-01', end_reason_code: 'other' }),
      row({ id: 3, name: 'Acme', status: 'active' }),
      row({ id: 4, name: 'Bellwether', status: 'paused' }),
    ])
    expect(sorted.map((c) => c.name)).toEqual(['Acme', 'Zinc', 'Bellwether', 'Test Client'])
  })

  it('puts a status it does not know last rather than dropping the row', () => {
    const sorted = sortClients([row({ id: 1, name: 'B', status: 'archived' }), row({ id: 2, name: 'A' })])
    expect(sorted.map((c) => c.name)).toEqual(['A', 'B'])
    expect(sorted).toHaveLength(2)
  })

  it('does not mutate its input', () => {
    const input = [row({ id: 1, name: 'Zinc' }), row({ id: 2, name: 'Acme' })]
    sortClients(input)
    expect(input.map((c) => c.name)).toEqual(['Zinc', 'Acme'])
  })
})

describe('what a refused write says', () => {
  it('turns the unique index into a sentence about names', () => {
    const text = writeFailureText(
      'duplicate key value violates unique constraint "clients_name_unique"',
      'acme',
    )
    expect(text).toContain('acme')
    expect(text).toContain('already exists')
    expect(text).not.toContain('clients_name_unique')
  })

  it('turns the lifecycle constraint into the rule it enforces', () => {
    const text = writeFailureText(
      'new row for relation "clients" violates check constraint "clients_lifecycle_coherent"',
      'Acme',
    )
    expect(text).toContain('end date')
    expect(text).not.toContain('clients_lifecycle_coherent')
  })

  it('turns the reason-code constraint into a sentence about the list', () => {
    const text = writeFailureText(
      'violates check constraint "clients_end_reason_code_known"',
      'Acme',
    )
    expect(text).toContain('reason')
    expect(text).not.toContain('clients_end_reason_code_known')
  })

  it('names the permission problem when RLS refuses the write', () => {
    expect(writeFailureText('permission denied for table clients', 'Acme')).toContain('not allowed')
    expect(writeFailureText('new row violates row-level security policy for table "clients"', 'Acme'))
      .toContain('not allowed')
  })

  it('passes anything else through rather than guessing', () => {
    expect(writeFailureText('the connection failed', 'Acme')).toContain('the connection failed')
  })

  it('always says nothing was changed, whatever the failure', () => {
    // The screen keeps the form populated on a failure, so the person is
    // looking at values that are NOT in the database. Every branch has to say
    // so, or the screen is lying by omission -- Slice 1's finding, restated.
    const messages = [
      'duplicate key value violates unique constraint "clients_name_unique"',
      'violates check constraint "clients_lifecycle_coherent"',
      'violates check constraint "clients_end_reason_code_known"',
      'permission denied for table clients',
      'something nobody anticipated',
    ]
    for (const message of messages) {
      expect(writeFailureText(message, 'Acme')).toContain('Nothing was changed')
    }
  })
})

describe('the status line', () => {
  it('never returns an empty sentence, in any state', () => {
    const states: Parameters<typeof writeStatusLine>[0][] = [
      { kind: 'idle' },
      { kind: 'saving' },
      { kind: 'saved', at: '2026-08-24T15:42:00.000Z', what: 'Changes saved' },
      { kind: 'failed', message: 'Nothing was changed.' },
    ]
    for (const state of states) {
      for (const problems of [[], [{ field: 'name' as const, text: 'A client needs a name.' }]]) {
        expect(writeStatusLine(state, problems).text.length).toBeGreaterThan(0)
      }
    }
  })

  it('names the time on a confirmation', () => {
    const line = writeStatusLine({ kind: 'saved', at: '2026-08-24T15:42:00.000Z', what: 'Client added' }, [])
    expect(line.tone).toBe('confirm')
    expect(line.text).toContain('Client added')
    expect(line.text).toMatch(/2026/)
  })

  it('reports the problems while idle, and the failure while failed', () => {
    const problems = [{ field: 'name' as const, text: 'A client needs a name.' }]
    expect(writeStatusLine({ kind: 'idle' }, problems).text).toContain('A client needs a name.')
    expect(writeStatusLine({ kind: 'failed', message: 'Refused. Nothing was changed.' }, problems).tone)
      .toBe('error')
  })
})
