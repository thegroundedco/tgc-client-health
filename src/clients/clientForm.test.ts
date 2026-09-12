import { describe, expect, it } from 'vitest'
import {
  CLIENT_COLUMNS,
  CLIENT_STATUSES,
  CONCURRENT_SAVE_TEXT,
  CLIENT_TYPE_CODES,
  END_REASON_CODES,
  EMPTY_DRAFT,
  UPDATE_MATCHED_NOTHING_TEXT,
  draftFromRow,
  formProblems,
  insertPayload,
  isChurned,
  ownerLabel,
  reactivationWarning,
  reasonLabel,
  typeLabel,
  sortClients,
  statusLabel,
  statusRank,
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
    started_on: null,
    ended_on: null,
    end_reason_code: null,
    end_reason_note: null,
    note: null,
    type_code: null,
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

  // Nine since 2026-09-12: note and type_code joined. The count is in the name
  // so adding a column without thinking about this rule is impossible -- the
  // point is that EVERY column goes on EVERY save, so an update that moves a
  // client off `former` cannot leave one of the constrained three behind.
  it('sends all nine columns on every save, whatever the status', () => {
    for (const status of CLIENT_STATUSES) {
      expect(Object.keys(updatePayload(draft({ status }))).sort()).toEqual([
        'end_reason_code',
        'end_reason_note',
        'ended_on',
        'name',
        'note',
        'owner_id',
        'started_on',
        'status',
        'type_code',
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
    // to add". The absence of the two end-reason keys and the end date is the
    // assertion -- a payload that merely happened to send nulls would still let
    // a future edit set them. started_on is present regardless: it is not one
    // of the three the spec is talking about here.
    const payload = insertPayload(draft({ status: 'former', endedOn: '2026-08-01' }))
    expect(payload.status).toBe('active')
    expect(Object.keys(payload).sort()).toEqual(['name', 'owner_id', 'started_on', 'status'])
  })
})

describe('a row becoming a form', () => {
  it('carries every column across, with nulls as empty strings', () => {
    expect(draftFromRow(row({ status: 'former', ended_on: '2026-08-01', end_reason_code: 'price' })))
      .toEqual({
        name: 'Acme',
        ownerId: null,
        status: 'former',
        startedOn: '',
        endedOn: '2026-08-01',
        endReasonCode: 'price',
        endReasonNote: '',
        note: '',
        typeCode: '',
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
      note: 'a draw, not an engagement',
      type_code: 'ecommerce',
    })
    expect(updatePayload(draftFromRow(original))).toEqual({
      name: 'Polar Divide',
      owner_id: 'owner-1',
      status: 'cancelled',
      started_on: null,
      ended_on: '2026-07-15',
      end_reason_code: 'went_quiet',
      end_reason_note: 'stopped replying',
      note: 'a draw, not an engagement',
      type_code: 'ecommerce',
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

  it('ranks the four statuses in board-reading order', () => {
    expect(CLIENT_STATUSES.map(statusRank)).toEqual([0, 1, 2, 3])
  })

  it('ranks a status it does not know after all the ones it does', () => {
    // Not -1, which would sort an unknown status FIRST and put a row nobody
    // meant at the top of the board.
    expect(statusRank('archived')).toBe(CLIENT_STATUSES.length)
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

describe('the two refusals Postgres never raises', () => {
  // Neither reaches writeFailureText, because neither arrives as an error: a
  // second save inside one round trip is refused by this app before a request
  // is sent, and an UPDATE filtered away by clients_update_manage_clients
  // returns zero rows with no error at all.
  it('promises nothing was changed in both', () => {
    for (const text of [CONCURRENT_SAVE_TEXT, UPDATE_MATCHED_NOTHING_TEXT]) {
      expect(text).toContain('othing was changed')
    }
  })

  it('invites a retry only where retrying can work', () => {
    // The concurrent one clears by itself in a moment, so saying "try again" is
    // true. The zero-row one is a permission the account does not hold: every
    // retry will be refused identically, and inviting one sends somebody to
    // press a button that cannot ever succeed.
    expect(CONCURRENT_SAVE_TEXT).toContain('again')
    expect(UPDATE_MATCHED_NOTHING_TEXT).not.toContain('again')
    expect(UPDATE_MATCHED_NOTHING_TEXT).toContain('Ask an admin')
  })
})

describe('started_on', () => {
  it('is in the column literal, so the select fetches it', () => {
    expect(CLIENT_COLUMNS).toContain('started_on')
  })

  it('reaches the draft as a string, and a null row reaches it as empty', () => {
    expect(draftFromRow(row({ started_on: '2026-01-15' })).startedOn).toBe('2026-01-15')
    expect(draftFromRow(row({ started_on: null })).startedOn).toBe('')
  })

  // Null rather than an empty string, matching every other optional column on
  // this table. An empty string is not a date and the column would refuse it.
  it('is sent as null when the field is blank, and as the date when it is not', () => {
    expect(insertPayload(draft({ startedOn: '' })).started_on).toBeNull()
    expect(insertPayload(draft({ startedOn: '2026-01-15' })).started_on).toBe('2026-01-15')
    expect(updatePayload(draft({ startedOn: '' })).started_on).toBeNull()
    expect(updatePayload(draft({ startedOn: '2026-01-15' })).started_on).toBe('2026-01-15')
  })

  // The gate is the only thing that reads this column, and a shut gate is not a
  // refusal to save -- it is a bucket that is not scored yet. A client with no
  // start date is a normal, saveable row.
  it('is never required, whatever the status', () => {
    for (const status of CLIENT_STATUSES) {
      const attempt = draft({
        status,
        startedOn: '',
        endedOn: '2026-02-01',
        endReasonCode: 'price',
      })
      expect(formProblems(attempt).some((p) => p.field === 'startedOn')).toBe(false)
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

// Two fields asked for on the 2026-09-11 call. `note` records what a client IS;
// `type_code` records what KIND of business they are, so kinds can be counted.
describe('the client type vocabulary', () => {
  // DELIBERATELY SHORT. Exactly one category was named on the call --
  // e-commerce -- and this project has a history: six stat lines were once
  // invented for the Overview screen, the owner did not recognise them, and
  // they were retired as never-sourced. Inventing five plausible industries
  // here would be that mistake somewhere far more expensive, because rows get
  // entered against them.
  //
  // This test exists to make growing the list a deliberate act rather than an
  // accident, not to freeze it.
  it('holds only what was actually asked for, plus the honest fallback', () => {
    expect(CLIENT_TYPE_CODES).toEqual(['ecommerce', 'other'])
  })

  it('gives every code a label a person would recognise', () => {
    for (const code of CLIENT_TYPE_CODES) {
      expect(typeLabel(code)).not.toBe(code)
    }
  })

  // Null is not 'other'. Nobody has said yet, and a screen that shows those two
  // the same way loses the difference between an unanswered question and an
  // answered one.
  it('distinguishes a type nobody has set from one set to other', () => {
    expect(typeLabel(null)).toBe('Not recorded')
    expect(typeLabel('other')).toBe('Other')
  })

  it('hands an unrecognised code straight back', () => {
    // A value this screen does not know was written outside it, and
    // relabelling it into one of the known ones would hide that.
    expect(typeLabel('saas')).toBe('saas')
  })
})

describe('the client type on the payload', () => {
  it('rides along on an update, and empty becomes null', () => {
    expect(updatePayload(draft({ typeCode: 'ecommerce' })).type_code).toBe('ecommerce')
    expect(updatePayload(draft({ typeCode: '' })).type_code).toBeNull()
  })

  // Unlike the three lifecycle columns, neither of these is governed by the
  // status: a paused client still IS an e-commerce brand, and a departed one
  // still has whatever note explained it.
  it('survives a change of status, unlike the departure columns', () => {
    const payload = updatePayload(
      draft({ status: 'cancelled', endedOn: '2026-08-01', endReasonCode: 'price', typeCode: 'ecommerce', note: 'a draw' }),
    )

    expect(payload.type_code).toBe('ecommerce')
    expect(payload.note).toBe('a draw')
    expect(payload.end_reason_code).toBe('price')
  })
})

describe('the note field', () => {
  it('is carried on the payload, trimmed, and empty becomes null', () => {
    // An empty string and null both mean "nothing recorded", and storing both
    // means two ways to express one fact -- which every reader then has to
    // handle.
    expect(updatePayload(draft({ note: '  a draw, not an engagement  ' })).note).toBe(
      'a draw, not an engagement',
    )
    expect(updatePayload(draft({ note: '   ' })).note).toBeNull()
  })

  it('is kept apart from the departure note', () => {
    // end_reason_note is about why somebody LEFT. A live client's description
    // living in the same column would be read as a departure reason.
    const payload = updatePayload(draft({ note: 'a draw, not an engagement' }))

    expect(payload.note).toBe('a draw, not an engagement')
    expect(payload.end_reason_note).toBeNull()
  })
})
