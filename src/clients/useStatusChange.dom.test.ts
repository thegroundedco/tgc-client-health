// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UPDATE_MATCHED_NOTHING_TEXT } from './clientForm'

type Result = { data: unknown; error: unknown }

const ROW = {
  id: 7, name: 'Acme', owner_id: null, status: 'active', started_on: '2026-01-01', ended_on: null,
  end_reason_code: null, end_reason_note: null, note: 'kept', type_code: null, updated_at: '2026-10-28T10:00:00Z',
}

// The read chain (select-first) and the write chain (update-first) are separate
// fakes, so a hook that skips the read, or drops .eq on either chain, fails.
const db = vi.hoisted(() => ({
  reads: 0,
  updates: 0,
  lastReadFilter: null as [string, unknown] | null,
  lastUpdate: null as Record<string, unknown> | null,
  lastFilter: null as [string, unknown] | null,
  read: async (): Promise<Result> => ({ data: null, error: null }),
  write: async (): Promise<Result> => ({ data: null, error: null }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (column: string, value: unknown) => {
          db.lastReadFilter = [column, value]
          return { maybeSingle: () => { db.reads += 1; return db.read() } }
        },
      }),
      update: (payload: Record<string, unknown>) => {
        db.updates += 1
        db.lastUpdate = payload
        return {
          eq: (column: string, value: unknown) => {
            db.lastFilter = [column, value]
            return { select: () => ({ maybeSingle: () => db.write() }) }
          },
        }
      },
    }),
  },
}))

import { useStatusChange } from './useStatusChange'

describe('useStatusChange', () => {
  beforeEach(() => {
    db.reads = 0
    db.updates = 0
    db.lastReadFilter = null
    db.lastUpdate = null
    db.lastFilter = null
    db.read = async () => ({ data: ROW, error: null })
    db.write = async () => ({ data: { ...ROW, ...db.lastUpdate, updated_at: '2026-10-28T11:00:00Z' }, error: null })
  })

  it('pauses by id, sending the whole row with only the status changed', async () => {
    const { result } = renderHook(() => useStatusChange(7))
    let ok = false
    await act(async () => { ok = await result.current.apply({ kind: 'pause' }) })
    expect(ok).toBe(true)
    expect(db.reads).toBe(1)
    expect(db.lastReadFilter).toEqual(['id', 7])
    expect(db.lastFilter).toEqual(['id', 7])
    expect(db.lastUpdate).toMatchObject({ status: 'paused', note: 'kept', name: 'Acme', ended_on: null })
    expect(result.current.state).toMatchObject({ kind: 'saved' })
  })

  // The panel hides Pause for a cancelled or former client, but the row it was
  // drawn from can be stale: somebody else may have cancelled them since. Pausing
  // then would clear their end date and reason, so the fresh read decides.
  it.each(['cancelled', 'former'])('refuses to pause a client the fresh read shows is %s', async (status) => {
    db.read = async () => ({ data: { ...ROW, status, ended_on: '2026-09-30', end_reason_code: 'price' }, error: null })
    const { result } = renderHook(() => useStatusChange(7))
    let ok = true
    await act(async () => { ok = await result.current.apply({ kind: 'pause' }) })
    expect(ok).toBe(false)
    expect(db.updates).toBe(0)
    expect(result.current.state).toEqual({
      kind: 'failed',
      message:
        'This client has already left, so it was not paused. Nothing was changed. Use Edit client to change a cancelled or former client.',
    })
  })

  it('cancels with the date and reason given', async () => {
    const { result } = renderHook(() => useStatusChange(7))
    await act(async () => {
      await result.current.apply({ kind: 'cancel', endedOn: '2026-09-30', endReasonCode: 'price', endReasonNote: '' })
    })
    expect(db.lastFilter).toEqual(['id', 7])
    expect(db.lastUpdate).toMatchObject({ status: 'cancelled', ended_on: '2026-09-30', end_reason_code: 'price', end_reason_note: null })
  })

  it('treats an update that matched nothing as a failure, not a success', async () => {
    db.write = async () => ({ data: null, error: null })
    const { result } = renderHook(() => useStatusChange(7))
    let ok = true
    await act(async () => { ok = await result.current.apply({ kind: 'pause' }) })
    expect(ok).toBe(false)
    expect(result.current.state).toEqual({ kind: 'failed', message: UPDATE_MATCHED_NOTHING_TEXT })
  })

  it('sends nothing when the row cannot be read', async () => {
    db.read = async () => ({ data: null, error: { message: 'boom' } })
    const { result } = renderHook(() => useStatusChange(7))
    await act(async () => { await result.current.apply({ kind: 'pause' }) })
    expect(db.updates).toBe(0)
    expect(result.current.state).toMatchObject({ kind: 'failed' })
  })

  it('refuses an incomplete cancellation before any write', async () => {
    const { result } = renderHook(() => useStatusChange(7))
    await act(async () => {
      await result.current.apply({ kind: 'cancel', endedOn: '2026-09-30', endReasonCode: '', endReasonNote: '' })
    })
    expect(db.updates).toBe(0)
    expect(result.current.state).toEqual({ kind: 'failed', message: 'A cancelled or former client needs a reason from the list.' })
  })

  it('sends one write when confirm is pressed twice', async () => {
    const { result } = renderHook(() => useStatusChange(7))
    await act(async () => {
      await Promise.all([result.current.apply({ kind: 'pause' }), result.current.apply({ kind: 'pause' })])
    })
    expect(db.updates).toBe(1)
  })

  it('shows a translated failure when the database refuses', async () => {
    db.write = async () => ({ data: null, error: { message: 'violates check constraint "clients_lifecycle_coherent"' } })
    const { result } = renderHook(() => useStatusChange(7))
    await act(async () => { await result.current.apply({ kind: 'pause' }) })
    expect(result.current.state).toMatchObject({ kind: 'failed', message: expect.stringContaining('needs an end date and a reason') })
  })
})
