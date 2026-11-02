// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: unknown }

const ROW = { retainer_cents: 500000, project_cents: 120000, entered_by: 'user-1', updated_at: '2026-10-28T10:00:00Z' }

// One fake per table, recording every filter, so a hook that drops an .eq or
// reads the wrong table fails.
const db = vi.hoisted(() => ({
  tables: [] as string[],
  selects: {} as Record<string, string>,
  filters: {} as Record<string, [string, unknown][]>,
  results: {} as Record<string, () => Promise<Result>>,
  rpcCalls: [] as [string, unknown][],
  rpc: async (): Promise<Result> => ({ data: null, error: null }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      db.tables.push(table)
      const f: [string, unknown][] = []
      db.filters[table] = f
      const chain = {
        select: (cols: string) => {
          db.selects[table] = cols
          return chain
        },
        eq: (column: string, value: unknown) => {
          f.push([column, value])
          return chain
        },
        maybeSingle: () => db.results[table](),
      }
      return chain
    },
    rpc: (name: string, args: unknown) => {
      db.rpcCalls.push([name, args])
      return db.rpc()
    },
  },
}))

import { useMonthPayment } from './useMonthPayment'

describe('useMonthPayment', () => {
  beforeEach(() => {
    db.tables = []
    db.selects = {}
    db.filters = {}
    db.rpcCalls = []
    db.results = {
      client_month_revenue: async () => ({ data: ROW, error: null }),
      client_retainers: async () => ({ data: { monthly_cents: 500000 }, error: null }),
      profiles: async () => ({ data: { full_name: 'Dana Delta', email: 'dana@example.com' }, error: null }),
    }
    db.rpc = async () => ({ data: null, error: null })
  })

  it('issues no query when the person may not read revenue', async () => {
    const { result } = renderHook(() => useMonthPayment(7, '2026-10-01', false))
    await act(async () => {})
    expect(result.current.status).toBe('off')
    expect(db.tables).toEqual([])
  })

  it('reads the month row and the stored retainer', async () => {
    const { result } = renderHook(() => useMonthPayment(7, '2026-10-01', true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.row).toEqual(ROW)
    expect(result.current.storedRetainer).toBe(500000)
    expect(result.current.enteredByName).toBe('Dana Delta')
    expect(db.selects['client_month_revenue']).toBe('retainer_cents, project_cents, entered_by, updated_at')
    expect(db.filters['client_month_revenue']).toEqual([['client_id', 7], ['period', '2026-10-01']])
    expect(db.filters['client_retainers']).toEqual([['client_id', 7]])
    expect(db.filters['profiles']).toEqual([['id', 'user-1']])
  })

  it('falls back to the email, and to null when the profile read fails', async () => {
    db.results.profiles = async () => ({ data: { full_name: null, email: 'dana@example.com' }, error: null })
    const a = renderHook(() => useMonthPayment(7, '2026-10-01', true))
    await waitFor(() => expect(a.result.current.status).toBe('ready'))
    expect(a.result.current.enteredByName).toBe('dana@example.com')

    db.results.profiles = async () => ({ data: null, error: { message: 'denied' } })
    const b = renderHook(() => useMonthPayment(7, '2026-10-01', true))
    await waitFor(() => expect(b.result.current.status).toBe('ready'))
    expect(b.result.current.enteredByName).toBeNull()
    expect(b.result.current.row).toEqual(ROW)
  })

  it('treats a missing retainer row as no retainer', async () => {
    db.results.client_retainers = async () => ({ data: null, error: null })
    db.results.client_month_revenue = async () => ({ data: null, error: null })
    const { result } = renderHook(() => useMonthPayment(7, '2026-10-01', true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.storedRetainer).toBeNull()
    expect(result.current.row).toBeNull()
    expect(result.current.enteredByName).toBeNull()
    expect(db.tables).not.toContain('profiles')
  })

  it('a failed read is an error, not an empty month', async () => {
    db.results.client_month_revenue = async () => ({ data: null, error: { message: 'permission denied' } })
    const a = renderHook(() => useMonthPayment(7, '2026-10-01', true))
    await waitFor(() => expect(a.result.current.status).toBe('error'))
    expect(a.result.current.loadError).toBe('permission denied')
    expect(a.result.current.row).toBeNull()

    db.results.client_month_revenue = async () => ({ data: ROW, error: null })
    db.results.client_retainers = async () => { throw new Error('boom') }
    const b = renderHook(() => useMonthPayment(7, '2026-10-01', true))
    await waitFor(() => expect(b.result.current.status).toBe('error'))
    expect(b.result.current.loadError).toBe('boom')

    // A resolved error on the retainer read is an error too, not "no retainer".
    db.results.client_retainers = async () => ({ data: null, error: { message: 'no retainers for you' } })
    const c = renderHook(() => useMonthPayment(7, '2026-10-01', true))
    await waitFor(() => expect(c.result.current.status).toBe('error'))
    expect(c.result.current.loadError).toBe('no retainers for you')
  })

  it('save sends the five arguments and reloads', async () => {
    const { result } = renderHook(() => useMonthPayment(7, '2026-10-01', true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const before = db.tables.filter((t) => t === 'client_month_revenue').length
    let out: unknown
    await act(async () => {
      out = await result.current.save({ retainerCents: 400000, projectCents: 25000, setRetainer: true })
    })
    expect(out).toEqual({ ok: true })
    expect(db.rpcCalls).toEqual([
      ['save_month_payment', {
        p_client_id: 7, p_period: '2026-10-01', p_retainer_cents: 400000, p_project_cents: 25000, p_set_retainer: true,
      }],
    ])
    await waitFor(() => expect(db.tables.filter((t) => t === 'client_month_revenue').length).toBe(before + 1))
  })

  it('a refresh after save keeps the data and stays ready until the new read lands, and save waits for it', async () => {
    const { result } = renderHook(() => useMonthPayment(7, '2026-10-01', true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const NEW = { ...ROW, project_cents: 999 }
    let release: () => void = () => {}
    db.results.client_month_revenue = () =>
      new Promise<Result>((resolve) => { release = () => resolve({ data: NEW, error: null }) })

    let settled = false
    let saving: Promise<unknown> = Promise.resolve()
    await act(async () => {
      saving = result.current.save({ retainerCents: 1, projectCents: 2, setRetainer: false }).then(() => { settled = true })
    })
    // The second read is still pending: nothing blanked, save not resolved.
    expect(result.current.status).toBe('ready')
    expect(result.current.row).toEqual(ROW)
    expect(result.current.storedRetainer).toBe(500000)
    expect(result.current.enteredByName).toBe('Dana Delta')
    expect(settled).toBe(false)

    await act(async () => { release(); await saving })
    expect(settled).toBe(true)
    expect(result.current.row).toEqual(NEW)
    expect(result.current.status).toBe('ready')
  })

  it('a changed month blanks the old one and shows loading', async () => {
    const { result, rerender } = renderHook(({ p }) => useMonthPayment(7, p, true), { initialProps: { p: '2026-10-01' } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    db.results.client_month_revenue = () => new Promise<Result>(() => {})
    rerender({ p: '2026-11-01' })
    expect(result.current.status).toBe('loading')
    expect(result.current.row).toBeNull()
  })

  it('a rejected rpc error object resolves to an error without reloading', async () => {
    db.rpc = async () => ({ data: null, error: { message: 'not allowed' } })
    const { result } = renderHook(() => useMonthPayment(7, '2026-10-01', true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const before = db.tables.length
    let out: unknown
    await act(async () => {
      out = await result.current.save({ retainerCents: 0, projectCents: 0, setRetainer: false })
    })
    expect(out).toEqual({ ok: false, error: 'not allowed' })
    expect(db.tables.length).toBe(before)
  })

  it('a thrown save resolves to an error', async () => {
    db.rpc = async () => { throw new Error('Failed to fetch') }
    const { result } = renderHook(() => useMonthPayment(7, '2026-10-01', true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let out: unknown
    await act(async () => {
      out = await result.current.save({ retainerCents: 1, projectCents: 2, setRetainer: false })
    })
    expect(out).toEqual({ ok: false, error: 'the connection failed' })
  })
})
