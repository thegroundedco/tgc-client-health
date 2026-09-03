// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

import { supabase } from '../lib/supabase'
import { useRevenue } from './useRevenue'

const CLIENT = { id: 1, name: 'Acme' }
const ROW = { client_id: 1, period: '2026-09-01', retainer_cents: 400000, project_cents: 0 }

// Two tables, two answers. The queue is keyed by table name rather than by call
// order, so a test does not silently pass because the hook happened to read
// them in the order the fixture listed.
function given(answers: Record<string, { data: unknown; error: unknown }>) {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const answer = answers[table] ?? { data: [], error: null }
    const chain = {
      select: () => chain,
      eq: () => chain,
      or: () => chain,
      order: () => Promise.resolve(answer),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer).then(resolve),
    }
    return chain as never
  })
}

afterEach(() => vi.mocked(supabase.from).mockReset())

describe('useRevenue', () => {
  it('reports both reads landing as ready', async () => {
    given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { result } = renderHook(() => useRevenue('2026-09-01'))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.clients).toEqual([CLIENT])
    expect(result.current.rows).toEqual([ROW])
    expect(result.current.loadError).toBe(null)
  })

  it('reports a failed roster read as an error, not as an empty month', async () => {
    // The defect this project keeps guarding against: a broken tool looking
    // like an empty one. An empty roster on this screen reads as "no clients".
    given({
      clients: { data: null, error: { message: 'permission denied' } },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { result } = renderHook(() => useRevenue('2026-09-01'))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.loadError).toContain('permission denied')
  })

  it('reports a failed revenue read as an error rather than as an unentered month', async () => {
    // Worse than the roster case and the reason it gets its own test: an empty
    // rows array is INDISTINGUISHABLE from a month nobody has entered, and
    // concentration would render "10 clients unaccounted for" as though that
    // were a fact about the data rather than about the network.
    given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: null, error: { message: 'permission denied' } },
    })

    const { result } = renderHook(() => useRevenue('2026-09-01'))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.rows).toEqual([])
  })

  it('leaves the previously-loaded month in place when a reload fails', async () => {
    // Distinguishes "left alone" from "wiped" by loading successfully FIRST.
    // Comparing against [] would also match the initial state and prove
    // nothing -- the exact hole a review found in useTenure.
    given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { result } = renderHook(() => useRevenue('2026-09-01'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: null, error: { message: 'gone' } },
    })
    act(() => result.current.reload())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.rows).toEqual([ROW])
  })

  it('re-reads when the period changes', async () => {
    given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { rerender } = renderHook(({ period }) => useRevenue(period), {
      initialProps: { period: '2026-09-01' },
    })
    await waitFor(() => expect(vi.mocked(supabase.from)).toHaveBeenCalled())
    const before = vi.mocked(supabase.from).mock.calls.length

    rerender({ period: '2026-08-01' })

    // Without `period` in the effect's dependencies the screen would show
    // September's figures under an August heading -- a wrong answer that looks
    // exactly like a right one.
    await waitFor(() =>
      expect(vi.mocked(supabase.from).mock.calls.length).toBeGreaterThan(before),
    )
  })
})
