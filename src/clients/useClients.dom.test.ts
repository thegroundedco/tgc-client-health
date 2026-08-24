// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminClient, ClientDraft, WriteState } from './clientForm'

// The hook's own branches, which no test could reach before: ClientsAdmin.dom.test.tsx
// mocks this module away, and Board.test.tsx mocks it away too. Two of the
// outcomes below never touch the screen's code at all -- a second save inside
// one round trip, and an UPDATE that matches no row -- so they can only be
// proved here.
//
// The Supabase client is faked rather than mocked per call: the real one is a
// chained builder, and the chain is part of what is being asserted (an update
// must end in .maybeSingle(), not .single()). `db` holds what each link
// resolves to, and vi.hoisted is what lets the vi.mock factory below -- which
// runs during the import of useClients, before this module's own body -- close
// over it.
type Result = { data: unknown; error: unknown }

const db = vi.hoisted(() => ({
  updates: 0,
  // What the last update actually sent, and what it filtered on. Captured
  // rather than discarded because `.eq('id', id)` is the most dangerous single
  // expression in this feature: an UPDATE that loses its filter rewrites every
  // row in public.clients, and this project has no backups. Nothing anywhere
  // asserted that filter until this was added -- the fake used to ignore both
  // arguments and hand back the same row whichever id was saved, so a dropped
  // filter passed every test.
  lastUpdate: null as unknown,
  lastFilter: null as [string, unknown] | null,
  read: async (): Promise<Result> => ({ data: [], error: null }),
  profiles: async (): Promise<Result> => ({ data: [], error: null }),
  // Both are provided, always. .single() is what the code called before the
  // zero-row finding and .maybeSingle() is what it calls now, and a fake that
  // offered only one of them would make the red phase of these tests a
  // TypeError rather than the wrong sentence on screen.
  single: async (): Promise<Result> => ({ data: null, error: null }),
  maybeSingle: async (): Promise<Result> => ({ data: null, error: null }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) =>
      table === 'profiles'
        ? { select: () => ({ eq: () => db.profiles() }) }
        : {
            select: () => ({ order: () => db.read() }),
            update: (payload: unknown) => {
              db.updates += 1
              db.lastUpdate = payload
              return {
                eq: (column: string, value: unknown) => {
                  db.lastFilter = [column, value]
                  return {
                    select: () => ({
                      single: () => db.single(),
                      maybeSingle: () => db.maybeSingle(),
                    }),
                  }
                },
              }
            },
          },
  },
}))

import { useClients } from './useClients'

const ACME: AdminClient = {
  id: 1,
  name: 'Acme',
  owner_id: null,
  status: 'active',
  ended_on: null,
  end_reason_code: null,
  end_reason_note: null,
  updated_at: '2026-08-24T15:42:00.000Z',
}

const GONE: AdminClient = { ...ACME, id: 2, name: 'Test Client' }

const DRAFT: ClientDraft = {
  name: 'Acme Holdings',
  ownerId: null,
  status: 'active',
  endedOn: '',
  endReasonCode: '',
  endReasonNote: '',
}

// PostgREST's own words for "you asked for one row and got none", and the shape
// the code used to see. Two layers, which the first draft of this comment ran
// together and contradicted itself doing: POSTGRES raises nothing, because
// clients_update_manage_clients' USING clause filters the row out rather than
// refusing the statement, so zero rows are updated and the 42501 the INSERT path
// relies on never happens. POSTGREST then turns that empty result into an error
// of its own, but only for .single(). The code now ends the chain in
// .maybeSingle(), which resolves { data: null, error: null } instead -- so this
// fixture is what the PRE-FIX call produced, kept because the tests below feed
// it to .single() to prove the old sentence is gone.
const PGRST116 = {
  code: 'PGRST116',
  message: 'JSON object requested, multiple (or no) rows returned',
}

// Asserts the outcome and hands back the sentence, so each test below reads as
// one claim about the words rather than three lines of narrowing.
function failure(state: WriteState): string {
  expect(state.kind, JSON.stringify(state)).toBe('failed')
  return state.kind === 'failed' ? state.message : ''
}

beforeEach(() => {
  db.updates = 0
  db.lastUpdate = null
  db.lastFilter = null
  db.read = async () => ({ data: [ACME, GONE], error: null })
  db.profiles = async () => ({ data: [], error: null })
  db.single = async () => ({ data: ACME, error: null })
  db.maybeSingle = async () => ({ data: ACME, error: null })
})

// Passed by reference rather than as `() => useClients()`: an arrow holding a
// hook call trips react/rules-of-hooks, which this repo runs as an error.
async function ready() {
  const rendered = renderHook(useClients)
  await waitFor(() => expect(rendered.result.current.status).toBe('ready'))
  return rendered
}

describe('the clients hook, updating', () => {
  it('says so when the update matched no row, and does not invite a retry', async () => {
    // Reachable without anybody pressing a hidden button: an admin deactivates
    // or demotes an account while its holder has this screen open. useProfile
    // holds the profile from mount, so the UI never notices.
    db.maybeSingle = async () => ({ data: null, error: null })
    db.single = async () => ({ data: null, error: PGRST116 })

    const { result } = await ready()
    await act(async () => {
      result.current.saveClient(1, DRAFT)
    })

    const message = failure(result.current.editState)
    expect(result.current.editStateFor).toBe(1)
    expect(message).toContain('was not applied')
    expect(message).toContain('Ask an admin')
    // The two things this message must NOT do. PostgREST's sentence is not one
    // to put in front of an account manager, and inviting a retry sends
    // somebody to press a button that cannot ever succeed.
    expect(message).not.toContain('JSON object requested')
    expect(message).not.toContain('pressing save again')
  })

  it('filters the update to the one row it was given, by id', async () => {
    // The guard against the worst thing this feature can do. An UPDATE with no
    // filter, or a filter on the wrong value, rewrites the whole table -- and
    // because .select().maybeSingle() would still hand back a plausible row,
    // the screen would confirm it cheerfully. Nothing else in the suite can see
    // this: clientForm.test.ts tests the payload with no knowledge of the
    // query, and ClientsAdmin.dom.test.tsx mocks this hook away entirely.
    const { result } = await ready()
    await act(async () => {
      result.current.saveClient(GONE.id, DRAFT)
    })

    expect(db.lastFilter).toEqual(['id', GONE.id])
  })

  it('sends all six columns on the update, whatever the draft holds', async () => {
    // The hook-level half of the bidirectional-constraint guarantee.
    // clients_lifecycle_coherent refuses a partial update, so a payload that
    // omitted a lifecycle column would be rejected by Postgres -- and
    // updatePayload building all six is only load-bearing if the hook actually
    // sends what it built. clientForm.test.ts proves the builder; this proves
    // the wire.
    const { result } = await ready()
    await act(async () => {
      result.current.saveClient(ACME.id, DRAFT)
    })

    expect(Object.keys(db.lastUpdate as object).sort()).toEqual([
      'end_reason_code',
      'end_reason_note',
      'ended_on',
      'name',
      'owner_id',
      'status',
    ])
  })

  it('leaves the list alone when the update matched no row', async () => {
    // The row on screen must keep saying what the database holds. Writing the
    // draft into the list here would show a rename that did not happen.
    db.maybeSingle = async () => ({ data: null, error: null })

    const { result } = await ready()
    await act(async () => {
      result.current.saveClient(1, DRAFT)
    })

    expect(result.current.clients.map((client) => client.name)).toEqual(['Acme', 'Test Client'])
  })

  it('refuses a second save inside one round trip out loud, not silently', async () => {
    // The in-flight ref used to `return` with no state set at all: no request,
    // no message, and the button had already been re-enabled by the other row's
    // reset. A control that does nothing at all is its own defect, and this is
    // what stops the first write's confirmation from landing on the second row.
    let release: (result: Result) => void = () => {}
    db.maybeSingle = () =>
      new Promise<Result>((resolve) => {
        release = resolve
      })

    const { result } = await ready()
    act(() => {
      result.current.saveClient(1, DRAFT)
    })
    expect(result.current.editState.kind).toBe('saving')
    expect(result.current.editStateFor).toBe(1)

    act(() => {
      result.current.saveClient(2, DRAFT)
    })

    const message = failure(result.current.editState)
    expect(result.current.editStateFor).toBe(2)
    expect(message).toContain('still finishing')
    expect(message).toContain('Nothing was changed')
    // One press, one request: the refusal did not send anything.
    expect(db.updates).toBe(1)

    // And when the first write lands, the confirmation is attributed back to
    // the row it belongs to -- never left pointing at the row that was refused.
    await act(async () => {
      release({ data: { ...ACME, name: 'Acme Holdings' }, error: null })
    })
    expect(result.current.editStateFor).toBe(1)
    expect(result.current.editState).toMatchObject({ kind: 'saved', what: 'Changes saved' })
  })

  it('confirms a save with the time the database returned, and updates the list', async () => {
    db.maybeSingle = async () => ({
      data: { ...ACME, name: 'Acme Holdings', updated_at: '2026-08-24T16:00:00.000Z' },
      error: null,
    })

    const { result } = await ready()
    await act(async () => {
      result.current.saveClient(1, DRAFT)
    })

    expect(result.current.editState).toMatchObject({
      kind: 'saved',
      at: '2026-08-24T16:00:00.000Z',
    })
    expect(result.current.editStateFor).toBe(1)
    expect(result.current.clients.map((client) => client.name)).toEqual([
      'Acme Holdings',
      'Test Client',
    ])
  })

  it('translates a refusal Postgres does raise, and attributes it to the row', async () => {
    db.maybeSingle = async () => ({
      data: null,
      error: { message: 'new row violates row-level security policy for table "clients"' },
    })

    const { result } = await ready()
    await act(async () => {
      result.current.saveClient(2, DRAFT)
    })

    expect(result.current.editStateFor).toBe(2)
    expect(failure(result.current.editState)).toContain('not allowed to change clients')
  })
})
