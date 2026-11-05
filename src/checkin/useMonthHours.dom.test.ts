// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown[] | null; error: unknown }
type Call = { table: string; filters: [string, unknown][] }

// Every query and every invoke is recorded, so "nothing was issued" is an
// observable fact and not an absence of assertions.
const db = vi.hoisted(() => ({
  calls: [] as { table: string; filters: [string, unknown][] }[],
  invokes: [] as [string, unknown][],
  invoke: async (): Promise<{ data: unknown; error: unknown }> => ({ data: { fetched: true }, error: null }),
  links: async (): Promise<Result> => ({ data: [{ productive_project_id: 'p1' }], error: null }),
  budgets: async (): Promise<Result> => ({ data: [], error: null }),
  fetches: async (): Promise<Result> => ({ data: [], error: null }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (name: string, options: unknown) => {
        db.invokes.push([name, options])
        return db.invoke()
      },
    },
    from: (table: string) => {
      const call: Call = { table, filters: [] }
      db.calls.push(call)
      const source =
        table === 'client_productive_projects'
          ? db.links
          : table === 'client_month_budgets'
            ? db.budgets
            : table === 'client_month_hours_fetch'
              ? db.fetches
              : async (): Promise<Result> => {
                  throw new Error(`unexpected table: ${table}`)
                }
      const builder = {
        select: () => builder,
        eq: (col: string, v: unknown) => {
          call.filters.push([col, v])
          return builder
        },
        then: (res: (r: Result) => unknown, rej: (e: unknown) => unknown) => source().then(res, rej),
      }
      return builder
    },
  },
}))

import { supabase } from '../lib/supabase'
import { denverDay, useMonthHours } from './useMonthHours'

const OCT = '2026-10-01'
const BUDGET = {
  productive_deal_id: 'd1',
  name: 'Budget A',
  starts_on: '2026-10-01',
  ends_on: '2026-10-31',
  budgeted_minutes: 1200,
  worked_minutes: 1260,
}

beforeEach(() => {
  db.calls.length = 0
  db.invokes.length = 0
  db.invoke = async () => ({ data: { fetched: true }, error: null })
  db.links = async () => ({ data: [{ productive_project_id: 'p1' }], error: null })
  db.budgets = async () => ({ data: [BUDGET], error: null })
  db.fetches = async () => ({ data: [{ fetched_at: '2026-11-04T10:00:00Z' }], error: null })
  // November 4th, local: October has closed, so a single full-month budget is scored.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 4, 9, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useMonthHours', () => {
  it('issues no invoke and no query without view_revenue', async () => {
    const invoke = vi.spyOn(supabase.functions, 'invoke')
    const from = vi.spyOn(supabase, 'from')
    const { result } = renderHook(() => useMonthHours(7, OCT, false))
    // Give any stray async work a chance to run before asserting nothing ran.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(invoke).toHaveBeenCalledTimes(0)
    expect(from).toHaveBeenCalledTimes(0)
    expect(result.current).toBeNull()
  })

  // E1: a month before hours were tracked asks nothing of Productive or the DB.
  it('issues no invoke and no query for a month before October 2026, and gives the before-start result', async () => {
    const invoke = vi.spyOn(supabase.functions, 'invoke')
    const from = vi.spyOn(supabase, 'from')
    const { result } = renderHook(() => useMonthHours(7, '2026-09-01', true))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(invoke).toHaveBeenCalledTimes(0)
    expect(from).toHaveBeenCalledTimes(0)
    expect(result.current).toEqual({ applies: false, reason: 'before_start', message: null, lines: [], answer: null })
  })

  it('still gives null for a month before October 2026 without view_revenue', async () => {
    const { result } = renderHook(() => useMonthHours(7, '2026-09-01', false))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(db.invokes).toEqual([])
    expect(result.current).toBeNull()
  })

  it('invokes the function for the client and period, then reads the three tables for them', async () => {
    const { result } = renderHook(() => useMonthHours(7, OCT, true))
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(db.invokes).toEqual([['fetch-productive-hours', { body: { clientId: 7, period: OCT } }]])
    const by = (t: string) => db.calls.find((c) => c.table === t)?.filters
    expect(by('client_productive_projects')).toEqual([['client_id', 7]])
    expect(by('client_month_budgets')).toEqual([['client_id', 7], ['period', OCT]])
    expect(by('client_month_hours_fetch')).toEqual([['client_id', 7], ['period', OCT]])
    expect(result.current).toMatchObject({ applies: true, answer: { value: 5 }, message: null })
  })

  it('treats a failed invoke with no fetch row as not fetched', async () => {
    db.invoke = async () => ({ data: null, error: new Error('502') })
    db.fetches = async () => ({ data: [], error: null })
    db.budgets = async () => ({ data: [], error: null })
    const { result } = renderHook(() => useMonthHours(7, OCT, true))
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toEqual({
      applies: false,
      reason: 'unreachable',
      lines: [],
      answer: null,
      message: "Couldn't reach Productive",
    })
  })

  it('treats a thrown invoke the same as a failed one', async () => {
    db.invoke = async () => {
      throw new Error('network')
    }
    db.fetches = async () => ({ data: [], error: null })
    const { result } = renderHook(() => useMonthHours(7, OCT, true))
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toMatchObject({ applies: false, reason: 'unreachable', answer: null })
  })

  it("keeps an older fetch when today's invoke fails", async () => {
    db.invoke = async () => ({ data: null, error: new Error('502') })
    const { result } = renderHook(() => useMonthHours(7, OCT, true))
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toMatchObject({
      applies: true,
      answer: { value: 5, reason: 'From Productive: 21h worked vs 20h budgeted (+1h).' },
      message: null,
    })
  })

  // Review fix round 1: a mid-month snapshot must not be scored as final just
  // because it is read after month end. Today is Nov 4; the stored fetch is
  // from Oct 20 and today's fetch failed.
  it('judges month-end by the stored fetch date, not the current date', async () => {
    db.invoke = async () => ({ data: null, error: new Error('502') })
    db.fetches = async () => ({ data: [{ fetched_at: new Date(2026, 9, 20, 15, 0, 0).toISOString() }], error: null })
    const { result } = renderHook(() => useMonthHours(7, OCT, true))
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toMatchObject({ applies: false, reason: 'not_finished', answer: null, message: 'Month not finished – hours so far' })
    expect((result.current as { lines: unknown[] }).lines).toHaveLength(1)
  })

  it('reads an unparseable fetch date as not finished', async () => {
    db.fetches = async () => ({ data: [{ fetched_at: 'not a date' }], error: null })
    const { result } = renderHook(() => useMonthHours(7, OCT, true))
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toMatchObject({ applies: false, reason: 'not_finished', answer: null, message: 'Month not finished – hours so far' })
  })

  it('is not applicable for a client with no links', async () => {
    db.links = async () => ({ data: [], error: null })
    const { result } = renderHook(() => useMonthHours(7, OCT, true))
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toEqual({ applies: false, reason: 'not_linked', message: 'Not linked to Productive', lines: [], answer: null })
  })

  // Brief 2026-11-05 §4: month-end is judged in America/Denver, the zone
  // private.hours_applies uses, so the screen and the score agree whatever
  // zone the viewer is in. 05:59:59Z on Nov 1 is still 23:59:59 on Oct 31 in
  // Denver (MDT, UTC-6, until 2am that morning); 06:00:00Z is midnight Nov 1.
  it('reads a fetch at 2026-11-01T05:59:59Z as Oct 31 in Denver: not finished', async () => {
    db.fetches = async () => ({ data: [{ fetched_at: '2026-11-01T05:59:59Z' }], error: null })
    const { result } = renderHook(() => useMonthHours(7, OCT, true))
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toMatchObject({ applies: false, reason: 'not_finished', answer: null, message: 'Month not finished – hours so far' })
  })

  it('reads a fetch at 2026-11-01T06:00:00Z as Nov 1 in Denver: finished', async () => {
    db.fetches = async () => ({ data: [{ fetched_at: '2026-11-01T06:00:00Z' }], error: null })
    const { result } = renderHook(() => useMonthHours(7, OCT, true))
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toMatchObject({
      applies: true,
      answer: { value: 5, reason: 'From Productive: 21h worked vs 20h budgeted (+1h).' },
      message: null,
    })
  })

  it('stays null on a failed read', async () => {
    db.budgets = async () => ({ data: null, error: new Error('denied') })
    const { result } = renderHook(() => useMonthHours(7, OCT, true))
    await waitFor(() => expect(db.calls.length).toBe(3))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(result.current).toBeNull()
  })

  // Every render is recorded: the effect's own setResult(null) lands inside the
  // same act() as the rerender, so the final value alone could not show what
  // the render the version changed in returned. That render is the one the
  // check-in's fill reads.
  it('gives null from the render the version changes in, then the new read', async () => {
    const seen: [number, unknown][] = []
    const { result, rerender } = renderHook(
      ({ v }) => {
        const hours = useMonthHours(7, OCT, true, v)
        seen.push([v, hours])
        return hours
      },
      { initialProps: { v: 0 } },
    )
    await waitFor(() => expect(result.current).not.toBeNull())
    let release: () => void = () => {}
    db.invoke = () =>
      new Promise((resolve) => {
        release = () => resolve({ data: { fetched: true }, error: null })
      })
    rerender({ v: 1 })
    const firstAtOne = seen.findIndex(([v]) => v === 1)
    expect(firstAtOne).toBeGreaterThan(-1)
    expect(seen[firstAtOne][1]).toBeNull()
    expect(result.current).toBeNull()
    release()
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(db.invokes).toHaveLength(2)
  })
})

describe('denverDay', () => {
  it('is the calendar date in America/Denver, YYYY-MM-DD', () => {
    expect(denverDay(new Date('2026-11-01T05:59:59Z'))).toBe('2026-10-31')
    expect(denverDay(new Date('2026-11-01T06:00:00Z'))).toBe('2026-11-01')
    expect(denverDay(new Date('2026-01-05T07:01:00Z'))).toBe('2026-01-05')
    // Winter: MST, UTC-7.
    expect(denverDay(new Date('2026-01-05T06:59:00Z'))).toBe('2026-01-04')
  })

  // The viewer's own zone must not move it. Node re-reads TZ when it is
  // assigned, and the module is re-imported under each zone, so a formatter
  // built at load in the viewer's zone would be caught here too. `process` is
  // cast through globalThis: src/ compiles without Node types (see
  // src/revenue/tenureMath.test.ts).
  it("does not depend on the viewer's zone", async () => {
    const process = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process
    const saved = process.env.TZ
    try {
      for (const zone of ['Pacific/Kiritimati', 'UTC', 'Pacific/Pago_Pago']) {
        process.env.TZ = zone
        vi.resetModules()
        const fresh = await import('./useMonthHours')
        expect(fresh.denverDay(new Date('2026-11-01T05:59:59Z')), zone).toBe('2026-10-31')
        expect(fresh.denverDay(new Date('2026-11-01T06:00:00Z')), zone).toBe('2026-11-01')
      }
    } finally {
      if (saved === undefined) delete process.env.TZ
      else process.env.TZ = saved
      vi.resetModules()
    }
  })
})
