// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data?: unknown; error: unknown }

const db = vi.hoisted(() => ({
  tables: [] as string[],
  filters: [] as [string, unknown][],
  upserts: [] as [unknown, unknown][],
  deletes: 0,
  read: async (): Promise<Result> => ({ data: { monthly_cents: 400000 }, error: null }),
  write: async (): Promise<Result> => ({ error: null }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => {
      db.tables.push(table)
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          db.filters.push([column, value])
          // A delete chain is awaited at .eq; a select chain continues.
          return Object.assign(Promise.resolve().then(() => db.write()), { maybeSingle: () => db.read() })
        },
        delete: () => {
          db.deletes += 1
          return chain
        },
        upsert: (row: unknown, opts: unknown) => {
          db.upserts.push([row, opts])
          return db.write()
        },
      }
      return chain
    },
  },
}))

import { useRetainer } from './useRetainer'

beforeEach(() => {
  db.tables = []
  db.filters = []
  db.upserts = []
  db.deletes = 0
  db.read = async () => ({ data: { monthly_cents: 400000 }, error: null })
  db.write = async () => ({ error: null })
})

describe('useRetainer', () => {
  it('issues no query without view_revenue', async () => {
    const { result } = renderHook(() => useRetainer(7, false))
    await act(async () => {})
    expect(result.current.status).toBe('off')
    expect(result.current.monthlyCents).toBeNull()
    expect(db.tables).toEqual([])
  })

  it('reads the retainer for the client', async () => {
    const { result } = renderHook(() => useRetainer(7, true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.monthlyCents).toBe(400000)
    expect(db.tables).toEqual(['client_retainers'])
    expect(db.filters).toEqual([['client_id', 7]])
  })

  it('reports a failed read rather than no retainer', async () => {
    db.read = async () => ({ data: null, error: { message: 'permission denied' } })
    const { result } = renderHook(() => useRetainer(7, true))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.loadError).toContain('permission denied')
    expect(result.current.monthlyCents).toBeNull()
  })

  it('save 0 deletes the row', async () => {
    const { result } = renderHook(() => useRetainer(7, true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    db.filters = []
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.save(0)
    })
    expect(outcome).toEqual({ ok: true })
    expect(db.deletes).toBe(1)
    expect(db.upserts).toEqual([])
    expect(db.filters).toEqual([['client_id', 7]])
    expect(result.current.monthlyCents).toBeNull()
  })

  it('save upserts the amount', async () => {
    const { result } = renderHook(() => useRetainer(7, true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.save(450000)
    })
    expect(outcome).toEqual({ ok: true })
    expect(db.deletes).toBe(0)
    expect(db.upserts).toEqual([
      [{ client_id: 7, monthly_cents: 450000, updated_by: 'user-1' }, { onConflict: 'client_id' }],
    ])
    expect(result.current.monthlyCents).toBe(450000)
  })

  it('a failed save reports the error and keeps the stored amount', async () => {
    const { result } = renderHook(() => useRetainer(7, true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    db.write = async () => ({ error: { message: 'new row violates row-level security policy' } })
    let outcome: { ok: boolean; error?: string } | undefined
    await act(async () => {
      outcome = await result.current.save(450000)
    })
    expect(outcome?.ok).toBe(false)
    expect(outcome?.error).toContain('row-level security')
    expect(result.current.monthlyCents).toBe(400000)
  })
})
