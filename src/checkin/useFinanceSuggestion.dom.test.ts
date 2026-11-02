// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown[] | null; error: unknown }
type Call = { table: string; filters: [string, string, unknown][] }

// Records every query: which table, and the filters applied, so "no query
// issued" is observable and the two tables cannot be confused.
const db = vi.hoisted(() => ({
  calls: [] as { table: string; filters: [string, string, unknown][] }[],
  revenue: async (): Promise<{ data: unknown[] | null; error: unknown }> => ({ data: [], error: null }),
  packages: async (): Promise<{ data: unknown[] | null; error: unknown }> => ({ data: [], error: null }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const call: Call = { table, filters: [] }
      db.calls.push(call)
      const builder = {
        select: () => builder,
        eq: (col: string, v: unknown) => {
          call.filters.push(['eq', col, v])
          return builder
        },
        lte: (col: string, v: unknown) => {
          call.filters.push(['lte', col, v])
          return builder
        },
        then: (res: (r: Result) => unknown, rej: (e: unknown) => unknown) =>
          (table === 'client_month_revenue' ? db.revenue() : db.packages()).then(res, rej),
      }
      return builder
    },
  },
}))

import { useFinanceSuggestion } from './useFinanceSuggestion'

const OCT = '2026-10-01'
const GROW_ROWS = [{ period: OCT, retainer_cents: 400000, project_cents: 0 }]

beforeEach(() => {
  db.calls.length = 0
  db.revenue = async () => ({ data: GROW_ROWS, error: null })
  db.packages = async () => ({ data: [{ package_code: 'grow', started_on: '2026-02-01' }], error: null })
})

const tables = () => db.calls.map((c) => c.table)

describe('useFinanceSuggestion', () => {
  it('reads both tables with the client and period filters and returns the result', async () => {
    const { result } = renderHook(() => useFinanceSuggestion(7, OCT, true, true))
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current?.fin_rack_rate?.value).toBe(1)
    const rev = db.calls.find((c) => c.table === 'client_month_revenue')
    const pkg = db.calls.find((c) => c.table === 'client_packages')
    expect(rev?.filters).toEqual([['eq', 'client_id', 7], ['lte', 'period', OCT]])
    expect(pkg?.filters).toEqual([['eq', 'client_id', 7]])
  })

  it('returns null and queries nothing without canReadRevenue', async () => {
    const { result } = renderHook(() => useFinanceSuggestion(7, OCT, false, true))
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current).toBeNull()
    expect(db.calls).toEqual([])
  })

  it('does not query client_packages without canReadPackages, and gives no rack rate', async () => {
    db.revenue = async () => ({
      data: [
        { period: '2026-09-01', retainer_cents: 400000, project_cents: 0 },
        { period: OCT, retainer_cents: 400000, project_cents: 0 },
      ],
      error: null,
    })
    const { result } = renderHook(() => useFinanceSuggestion(7, OCT, true, false))
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(tables()).toEqual(['client_month_revenue'])
    expect(result.current?.fin_rate_increased?.value).toBe(3)
    expect(result.current?.fin_rack_rate).toBeUndefined()
  })

  it('is null when the revenue read errors', async () => {
    db.revenue = async () => ({ data: null, error: { message: 'nope' } })
    const { result } = renderHook(() => useFinanceSuggestion(7, OCT, true, true))
    await waitFor(() => expect(tables()).toContain('client_month_revenue'))
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current).toBeNull()
  })

  it('keeps the rate when the packages read errors, and gives no rack rate', async () => {
    db.revenue = async () => ({
      data: [
        { period: '2026-09-01', retainer_cents: 400000, project_cents: 0 },
        { period: OCT, retainer_cents: 400000, project_cents: 0 },
      ],
      error: null,
    })
    db.packages = async () => ({ data: null, error: { message: 'nope' } })
    const { result } = renderHook(() => useFinanceSuggestion(7, OCT, true, true))
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current?.fin_rate_increased?.value).toBe(3)
    expect(result.current?.fin_rack_rate).toBeUndefined()
  })

  // Spec 2026-11-02 §5: a payment saved on the check-in bumps the version, and
  // the suggestion is worked out again from the revenue as it now stands.
  it('a new version re-reads revenue', async () => {
    const { result, rerender } = renderHook(
      ({ version }) => useFinanceSuggestion(7, OCT, true, false, version),
      { initialProps: { version: 0 } },
    )
    await waitFor(() => expect(result.current).not.toBeNull())
    // One row: no last month, so the rate change has no answer yet.
    expect(result.current?.fin_rate_increased).toBeUndefined()
    expect(tables()).toEqual(['client_month_revenue'])

    db.revenue = async () => ({
      data: [
        { period: '2026-09-01', retainer_cents: 400000, project_cents: 0 },
        { period: OCT, retainer_cents: 400000, project_cents: 0 },
      ],
      error: null,
    })
    rerender({ version: 1 })
    await waitFor(() => expect(result.current?.fin_rate_increased?.value).toBe(3))
    expect(tables()).toEqual(['client_month_revenue', 'client_month_revenue'])
  })

  // The check-in applies the first non-null answer after a payment save, so an
  // answer from before the save must never be handed back as if it were new --
  // not even for the one render before this hook's own effect clears it, which
  // is the render the check-in's effect runs in. So every rendered value is
  // recorded, not only the latest (act() would flush that render away).
  it('gives null, not the old answer, until the new version has been read', async () => {
    const seen: { version: number; value: unknown }[] = []
    const { result, rerender } = renderHook(
      ({ version }) => {
        const value = useFinanceSuggestion(7, OCT, true, false, version)
        seen.push({ version, value })
        return value
      },
      { initialProps: { version: 0 } },
    )
    await waitFor(() => expect(result.current).not.toBeNull())
    let land: null | ((r: { data: unknown[] | null; error: unknown }) => void) = null
    db.revenue = () => new Promise((resolve) => { land = resolve })
    rerender({ version: 1 })
    await waitFor(() => expect(land).not.toBeNull())
    const before = seen.filter((s) => s.version === 1)
    expect(before.length).toBeGreaterThan(0)
    expect(before.every((s) => s.value === null)).toBe(true)
    act(() => land?.({ data: GROW_ROWS, error: null }))
    await waitFor(() => expect(result.current).not.toBeNull())
  })
})
