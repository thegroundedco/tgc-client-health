// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UPDATE_MATCHED_NOTHING_TEXT } from '../clients/clientForm'

type Result = { data: unknown; error: unknown }

// update(payload) -> eq -> eq -> select -> maybeSingle. Every eq is recorded,
// so a dropped client or period filter is visible, not just a changed last one.
const db = vi.hoisted(() => ({
  updates: 0,
  lastUpdate: null as Record<string, unknown> | null,
  filters: [] as [string, unknown][],
  write: async (): Promise<Result> => ({ data: null, error: null }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        db.updates += 1
        db.lastUpdate = payload
        const chain = {
          eq: (column: string, value: unknown) => {
            db.filters.push([column, value])
            return chain
          },
          select: () => ({ maybeSingle: () => db.write() }),
        }
        return chain
      },
    }),
  },
}))

import { useConfirmSuggestion } from './useConfirmSuggestion'

describe('useConfirmSuggestion', () => {
  beforeEach(() => {
    db.updates = 0
    db.lastUpdate = null
    db.filters = []
    db.write = async () => ({ data: { updated_at: '2026-10-29T16:00:00Z' }, error: null })
  })

  it('clears the flag on exactly this client and month, and nothing else', async () => {
    const { result } = renderHook(() => useConfirmSuggestion(7, '2026-10-01'))
    let ok = false
    await act(async () => { ok = await result.current.confirm() })
    expect(ok).toBe(true)
    expect(db.lastUpdate).toEqual({ suggested_at: null })
    expect([...db.filters].sort()).toEqual([['client_id', 7], ['period', '2026-10-01']])
    expect(result.current.state).toEqual({ kind: 'confirmed', at: '2026-10-29T16:00:00Z' })
  })

  it('treats a confirm that matched no row as a failure', async () => {
    db.write = async () => ({ data: null, error: null })
    const { result } = renderHook(() => useConfirmSuggestion(7, '2026-10-01'))
    let ok = true
    await act(async () => { ok = await result.current.confirm() })
    expect(ok).toBe(false)
    expect(result.current.state).toEqual({ kind: 'failed', message: UPDATE_MATCHED_NOTHING_TEXT })
  })

  it('reports a database error', async () => {
    db.write = async () => ({ data: null, error: { message: 'boom' } })
    const { result } = renderHook(() => useConfirmSuggestion(7, '2026-10-01'))
    let ok = true
    await act(async () => { ok = await result.current.confirm() })
    expect(ok).toBe(false)
    expect(result.current.state.kind).toBe('failed')
    expect((result.current.state as { message: string }).message).toContain('boom')
  })

  it('sends one update when pressed twice', async () => {
    const { result } = renderHook(() => useConfirmSuggestion(7, '2026-10-01'))
    await act(async () => { await Promise.all([result.current.confirm(), result.current.confirm()]) })
    expect(db.updates).toBe(1)
  })
})
