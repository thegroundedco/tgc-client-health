// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminProfile, Invitation, WriteState } from './userForm'

// The hook's own branches. This is the direct port of
// src/clients/useClients.dom.test.ts, and it exists for a stronger version of
// the same reason: useClients has a screen test beside it that at least renders
// the happy path, whereas UsersAdmin has no DOM test at all and Board.test.tsx
// mocks its way past the whole screen. So until this file, nothing anywhere ran
// useUsers -- not one line of it.
//
// FOUR of its outcomes could not be reached even by a screen test, because they
// never touch the screen's code: an UPDATE that matched no row, a DELETE that
// matched no row, a second invite inside one round trip, and a second profile
// edit inside one. useClients had two of that kind; this hook has four, plus a
// fifth control (revoke) sharing an in-flight guard with a sibling.
//
// Commit c6d9877 fixed the zero-row-delete class on this branch with no
// regression test. That is what this file closes.
//
// The Supabase client is faked rather than mocked per call, because the chain is
// part of what is being asserted: the profile update must end in .maybeSingle()
// and not .single(), and the revoke must end in .select() and not be a bare
// delete. `db` holds what each link resolves to and what each link was handed,
// and vi.hoisted is what lets the vi.mock factory below -- which runs during the
// import of useUsers, before this module's own body -- close over it.
type Result = { data: unknown; error: unknown }

const db = vi.hoisted(() => ({
  profileUpdates: 0,
  inserts: 0,
  deletes: 0,
  lastProfileUpdate: null as unknown,
  // What the profile update filtered on. Captured rather than discarded because
  // `.eq('id', id)` is the most dangerous single expression in this feature --
  // useClients.dom.test.ts says so about public.clients, and here the table is
  // public.profiles, on a project whose backups are not proven. An UPDATE that
  // loses its filter rewrites every row: every account's role, every account's
  // is_active. The guard trigger does not save you -- an admin holds
  // manage_users, so the statement is permitted; it just applies to everybody.
  lastProfileFilter: null as [string, unknown] | null,
  lastDeleteFilter: null as [string, unknown] | null,
  lastInsert: null as unknown,
  // Which terminal each chain actually called. The distinction between .single()
  // and .maybeSingle() is invisible in a result and load-bearing in the code.
  terminals: [] as string[],
  readProfiles: async (): Promise<Result> => ({ data: [], error: null }),
  readInvitations: async (): Promise<Result> => ({ data: [], error: null }),
  insertResult: async (): Promise<Result> => ({ data: null, error: null }),
  deleteResult: async (): Promise<Result> => ({ data: [], error: null }),
  // Both are provided, always. .single() is the wrong terminal and
  // .maybeSingle() is the right one, and a fake offering only one of them would
  // make the red phase of these tests a TypeError rather than the wrong sentence
  // on screen.
  single: async (): Promise<Result> => ({ data: null, error: null }),
  maybeSingle: async (): Promise<Result> => ({ data: null, error: null }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) =>
      table === 'profiles'
        ? {
            select: () => ({ order: () => db.readProfiles() }),
            update: (payload: unknown) => {
              db.profileUpdates += 1
              db.lastProfileUpdate = payload
              return {
                eq: (column: string, value: unknown) => {
                  db.lastProfileFilter = [column, value]
                  return {
                    select: () => ({
                      single: () => {
                        db.terminals.push('profiles.single')
                        return db.single()
                      },
                      maybeSingle: () => {
                        db.terminals.push('profiles.maybeSingle')
                        return db.maybeSingle()
                      },
                    }),
                  }
                },
              }
            },
          }
        : {
            select: () => ({ order: () => db.readInvitations() }),
            insert: (payload: unknown) => {
              db.inserts += 1
              db.lastInsert = payload
              return {
                select: () => ({
                  single: () => {
                    db.terminals.push('allowed_emails.single')
                    return db.insertResult()
                  },
                }),
              }
            },
            delete: () => {
              db.deletes += 1
              return {
                eq: (column: string, value: unknown) => {
                  db.lastDeleteFilter = [column, value]
                  // .select() IS the terminal on a delete -- there is no
                  // .single() after it. A bare `.eq()` with nothing following is
                  // the shape c6d9877 removed, and it is unrepresentable here:
                  // this fake only resolves through select().
                  return {
                    select: () => {
                      db.terminals.push('allowed_emails.delete.select')
                      return db.deleteResult()
                    },
                  }
                },
              }
            },
          },
  },
}))

import { useUsers } from './useUsers'
import { CONCURRENT_SAVE_TEXT } from '../clients/clientForm'
import { DELETE_MATCHED_NOTHING_TEXT, UPDATE_MATCHED_NOTHING_TEXT } from './userForm'

const ADAM: AdminProfile = {
  id: 'p-adam',
  email: 'adam@example.com',
  full_name: 'Adam',
  role: 'viewer',
  is_active: true,
  updated_at: '2026-08-25T15:42:00.000Z',
}

const BEA: AdminProfile = {
  ...ADAM,
  id: 'p-bea',
  email: 'bea@example.com',
  full_name: 'Bea',
  role: 'account_manager',
}

const WAITING: Invitation = {
  email: 'cara@example.com',
  role: 'viewer',
  created_at: '2026-08-25T09:00:00.000Z',
}

// PostgREST's own words for "you asked for one row and got none", and the shape
// .single() produces where .maybeSingle() produces { data: null, error: null }.
// Two layers, and they must not be run together: POSTGRES raises nothing,
// because profiles_update_manage_users' USING clause FILTERS the row out rather
// than refusing the statement -- zero rows updated, no 42501, no guard trigger
// involved at all. POSTGREST then invents this error, and only for .single().
// The fixture is kept so the tests below can feed it to .single() and prove the
// hook never shows that sentence to anybody.
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
  db.profileUpdates = 0
  db.inserts = 0
  db.deletes = 0
  db.lastProfileUpdate = null
  db.lastProfileFilter = null
  db.lastDeleteFilter = null
  db.lastInsert = null
  db.terminals = []
  db.readProfiles = async () => ({ data: [ADAM, BEA], error: null })
  db.readInvitations = async () => ({ data: [WAITING], error: null })
  db.insertResult = async () => ({ data: WAITING, error: null })
  db.deleteResult = async () => ({ data: [{ email: WAITING.email }], error: null })
  db.single = async () => ({ data: ADAM, error: null })
  db.maybeSingle = async () => ({ data: ADAM, error: null })
})

// Passed by reference rather than as `() => useUsers()`: an arrow holding a hook
// call trips react/rules-of-hooks, which this repo runs as an error.
async function ready() {
  const rendered = renderHook(useUsers)
  await waitFor(() => expect(rendered.result.current.status).toBe('ready'))
  return rendered
}

describe('the users hook, writing a profile', () => {
  it('says so when the update matched no row, and does not invite a retry', async () => {
    // Reachable without anybody pressing a hidden button: a second admin demotes
    // this one while this screen is open. useProfile holds the profile from
    // mount, so the UI never notices, and profiles_update_manage_users then
    // filters every row out of every statement this screen sends.
    db.maybeSingle = async () => ({ data: null, error: null })
    db.single = async () => ({ data: null, error: PGRST116 })

    const { result } = await ready()
    await act(async () => {
      result.current.setRole(BEA.id, 'admin')
    })

    const message = failure(result.current.editState)
    expect(result.current.editStateFor).toBe(BEA.id)
    expect(message).toBe(UPDATE_MATCHED_NOTHING_TEXT)
    // The two things this message must NOT do. PostgREST's sentence is not one
    // to put in front of an account manager, and inviting a retry sends
    // somebody to press a button that cannot ever succeed.
    expect(message).not.toContain('JSON object requested')
    expect(message).not.toContain('try again')
  })

  it('ends the update in .maybeSingle(), never .single()', async () => {
    // The chain itself is the assertion. .single() turns "the policy filtered
    // the row out" into PGRST116, which no branch in userForm.ts translates, so
    // the screen would show raw PostgREST text where
    // UPDATE_MATCHED_NOTHING_TEXT belongs. Nothing else in the suite can see
    // which terminal was called: both resolve to a result object, and the two
    // results are indistinguishable on a successful write.
    const { result } = await ready()
    await act(async () => {
      result.current.setRole(BEA.id, 'admin')
    })

    expect(db.terminals).toEqual(['profiles.maybeSingle'])
    expect(db.terminals).not.toContain('profiles.single')
  })

  it('filters the update to the one row it was given, by id', async () => {
    // The guard against the worst thing this feature can do. An UPDATE with no
    // filter, or a filter on the wrong value, rewrites the role and is_active of
    // every account in public.profiles -- and because .select().maybeSingle()
    // would still hand back a plausible row, the screen would confirm it
    // cheerfully. The guard trigger is no help: the caller holds manage_users,
    // so the statement is permitted; it simply applies to everybody. Nothing
    // else in the suite can see this -- userForm.test.ts tests the decisions
    // with no knowledge of the query.
    const { result } = await ready()
    await act(async () => {
      result.current.setActive(BEA.id, false)
    })

    expect(db.lastProfileFilter).toEqual(['id', BEA.id])
    expect(db.lastProfileUpdate).toEqual({ is_active: false })
  })

  it('leaves the list alone when the update matched no row', async () => {
    // The row on screen must keep saying what the database holds. Writing the
    // requested role into the list here would show a promotion that did not
    // happen -- on the one screen whose entire subject is who holds what.
    db.maybeSingle = async () => ({ data: null, error: null })

    const { result } = await ready()
    await act(async () => {
      result.current.setRole(BEA.id, 'admin')
    })

    expect(result.current.profiles.map((row) => row.role)).toEqual(['viewer', 'account_manager'])
  })

  it('refuses a second profile edit inside one round trip out loud, not silently', async () => {
    // The in-flight ref must SAY something. A ref that just returns leaves a
    // press with no request, no message and a control that has done nothing at
    // all -- a defect in its own right, and what stops the first write's
    // confirmation from landing beside the second row.
    let release: (result: Result) => void = () => {}
    db.maybeSingle = () =>
      new Promise<Result>((resolve) => {
        release = resolve
      })

    const { result } = await ready()
    act(() => {
      result.current.setRole(ADAM.id, 'admin')
    })
    expect(result.current.editState.kind).toBe('saving')
    expect(result.current.editStateFor).toBe(ADAM.id)

    act(() => {
      result.current.setActive(BEA.id, false)
    })

    expect(result.current.editStateFor).toBe(BEA.id)
    expect(failure(result.current.editState)).toBe(CONCURRENT_SAVE_TEXT)
    // One press, one request: the refusal did not send anything.
    expect(db.profileUpdates).toBe(1)

    // And when the first write lands, the confirmation is attributed back to the
    // row it belongs to -- never left pointing at the row that was refused.
    await act(async () => {
      release({ data: { ...ADAM, role: 'admin', updated_at: '2026-08-25T16:00:00.000Z' }, error: null })
    })
    expect(result.current.editStateFor).toBe(ADAM.id)
    expect(result.current.editState).toMatchObject({ kind: 'saved', what: 'Role changed' })
  })

  it('confirms with the time the database returned, and updates the list', async () => {
    db.maybeSingle = async () => ({
      data: { ...BEA, role: 'admin', updated_at: '2026-08-25T16:00:00.000Z' },
      error: null,
    })

    const { result } = await ready()
    await act(async () => {
      result.current.setRole(BEA.id, 'admin')
    })

    expect(result.current.editState).toMatchObject({
      kind: 'saved',
      at: '2026-08-25T16:00:00.000Z',
    })
    expect(result.current.profiles.map((row) => row.role)).toEqual(['viewer', 'admin'])
  })

  it('translates the guard trigger refusal Postgres does raise', async () => {
    // The other failure shape on the same statement, and the reason the code
    // cannot simply treat "no row" as the only outcome: the trigger RAISES,
    // with a message userForm.ts matches on.
    db.maybeSingle = async () => ({
      data: null,
      error: { message: 'cannot change your own role or active status' },
    })

    const { result } = await ready()
    await act(async () => {
      result.current.setRole(ADAM.id, 'admin')
    })

    expect(result.current.editStateFor).toBe(ADAM.id)
    expect(failure(result.current.editState)).toContain('cannot change your own access')
  })
})

describe('the users hook, revoking an invitation', () => {
  it('says so when the delete matched no row, and names both causes', async () => {
    // The class c6d9877 fixed with no regression test. allowed_emails_delete_
    // manage_users is USING-only, so a caller who has lost manage_users has the
    // row filtered out: zero rows deleted, no error at all. A bare delete cannot
    // tell that apart from a real one and would report "revoked" while the
    // invited address stays live.
    db.deleteResult = async () => ({ data: [], error: null })

    const { result } = await ready()
    await act(async () => {
      result.current.revokeInvite(WAITING.email)
    })

    expect(failure(result.current.inviteState)).toBe(DELETE_MATCHED_NOTHING_TEXT)
  })

  it('leaves the invitation on screen when the delete matched no row', async () => {
    // The half that makes the message true. Removing the row from local state
    // here would show a withdrawal that did not happen -- and the address would
    // still be able to sign in and be activated, with nothing on screen saying
    // so.
    db.deleteResult = async () => ({ data: [], error: null })

    const { result } = await ready()
    await act(async () => {
      result.current.revokeInvite(WAITING.email)
    })

    expect(result.current.invitations.map((row) => row.email)).toEqual([WAITING.email])
  })

  it('asks the database to return what it deleted, filtered to one address', async () => {
    // Both halves of the c6d9877 fix in one assertion: the chain reaches
    // .select() rather than ending at .eq(), and it filters on the address it
    // was given. A delete that lost its filter empties the invitation list.
    const { result } = await ready()
    await act(async () => {
      result.current.revokeInvite(WAITING.email)
    })

    expect(db.lastDeleteFilter).toEqual(['email', WAITING.email])
    expect(db.terminals).toContain('allowed_emails.delete.select')
  })

  it('removes the invitation and confirms when a row really was deleted', async () => {
    const { result } = await ready()
    await act(async () => {
      result.current.revokeInvite(WAITING.email)
    })

    expect(result.current.invitations).toEqual([])
    expect(result.current.inviteState).toMatchObject({ kind: 'saved' })
  })
})

describe('the users hook, inviting', () => {
  it('refuses a second invite inside one round trip out loud, not silently', async () => {
    let release: (result: Result) => void = () => {}
    db.insertResult = () =>
      new Promise<Result>((resolve) => {
        release = resolve
      })

    const { result } = await ready()
    act(() => {
      result.current.invite({ email: 'dee@example.com', role: 'viewer' })
    })
    expect(result.current.inviteState.kind).toBe('saving')

    act(() => {
      result.current.invite({ email: 'eve@example.com', role: 'admin' })
    })

    expect(failure(result.current.inviteState)).toBe(CONCURRENT_SAVE_TEXT)
    // One press, one request. The second address was never sent, which is what
    // the message promises when it says nothing was changed.
    expect(db.inserts).toBe(1)
    expect(db.lastInsert).toEqual({ email: 'dee@example.com', role: 'viewer' })

    await act(async () => {
      release({ data: { email: 'dee@example.com', role: 'viewer', created_at: '2026-08-25T16:00:00.000Z' }, error: null })
    })
    expect(result.current.inviteState).toMatchObject({ kind: 'saved' })
  })

  it('refuses a revoke while an invite is in flight, since both share the guard', async () => {
    // inviteInFlight covers BOTH controls, which useClients has no analogue for:
    // one ref, two buttons in the same region, one inviteState between them. A
    // revoke admitted here would overwrite the pending invite's state and its
    // confirmation would land on whatever was left.
    let release: (result: Result) => void = () => {}
    db.insertResult = () =>
      new Promise<Result>((resolve) => {
        release = resolve
      })

    const { result } = await ready()
    act(() => {
      result.current.invite({ email: 'dee@example.com', role: 'viewer' })
    })

    act(() => {
      result.current.revokeInvite(WAITING.email)
    })

    expect(failure(result.current.inviteState)).toBe(CONCURRENT_SAVE_TEXT)
    expect(db.deletes).toBe(0)
    // And the invitation is still on screen: the refusal changed nothing.
    expect(result.current.invitations.map((row) => row.email)).toEqual([WAITING.email])

    await act(async () => {
      release({ data: { email: 'dee@example.com', role: 'viewer', created_at: '2026-08-25T16:00:00.000Z' }, error: null })
    })
  })

  it('normalises the address before sending it, and confirms with the stored time', async () => {
    // The check constraint on allowed_emails.email is `email = lower(email)`, so
    // an uppercase address is refused by the database. invitePayload is what
    // stops that round trip from ever happening, and this proves the hook sends
    // what it built.
    db.insertResult = async () => ({
      data: { email: 'dee@example.com', role: 'admin', created_at: '2026-08-25T16:00:00.000Z' },
      error: null,
    })

    const { result } = await ready()
    await act(async () => {
      result.current.invite({ email: '  Dee@Example.COM ', role: 'admin' })
    })

    expect(db.lastInsert).toEqual({ email: 'dee@example.com', role: 'admin' })
    expect(result.current.inviteState).toMatchObject({
      kind: 'saved',
      at: '2026-08-25T16:00:00.000Z',
    })
    expect(result.current.invitations.map((row) => row.email)).toEqual([
      WAITING.email,
      'dee@example.com',
    ])
  })

  it('translates a duplicate invitation rather than showing the constraint name', async () => {
    db.insertResult = async () => ({
      data: null,
      error: { message: 'duplicate key value violates unique constraint "allowed_emails_pkey"' },
    })

    const { result } = await ready()
    await act(async () => {
      result.current.invite({ email: WAITING.email, role: 'viewer' })
    })

    const message = failure(result.current.inviteState)
    expect(message).toContain('already been invited')
    expect(message).not.toContain('allowed_emails_pkey')
    // And the list is unchanged: nothing was added for a write that failed.
    expect(result.current.invitations.map((row) => row.email)).toEqual([WAITING.email])
  })
})

describe('the users hook, loading', () => {
  it('reports an unreadable invitation list as an error, not as an empty one', async () => {
    // v1's founding defect, on this screen: a failed read drawn as "nobody is
    // waiting". The profiles read succeeds here and the invitations read does
    // not, which is the asymmetric case -- half a screen of real data is exactly
    // what makes an empty region below it look like the truth.
    db.readInvitations = async () => ({ data: null, error: { message: 'connection refused' } })

    const rendered = renderHook(useUsers)
    await waitFor(() => expect(rendered.result.current.status).toBe('error'))
    expect(rendered.result.current.loadError).toContain('connection refused')
    expect(rendered.result.current.invitations).toEqual([])
  })
})
