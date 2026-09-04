// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

import { supabase } from '../lib/supabase'
import { useRevenue } from './useRevenue'

const CLIENT = { id: 1, name: 'Acme' }
const ROW = { client_id: 1, period: '2026-09-01', retainer_cents: 400000, project_cents: 0 }

// What each chained call was actually given, per table. The chain used to
// discard its arguments -- `or: () => chain` -- which left the two filters that
// decide WHICH clients and WHICH month this screen reads entirely unexercised.
// A review deferred that as a minor with no pattern to follow; the pattern is
// just to record them.
type Captured = {
  select: string[]
  or: string[]
  eq: [string, unknown][]
  order: string[]
}

// Two tables, two answers. The queue is keyed by table name rather than by call
// order, so a test does not silently pass because the hook happened to read
// them in the order the fixture listed. Returns what each table's chain was
// called with, for the tests that assert the query rather than the answer.
function given(answers: Record<string, { data: unknown; error: unknown }>) {
  const captured: Record<string, Captured> = {}
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const answer = answers[table] ?? { data: [], error: null }
    const calls = (captured[table] ??= { select: [], or: [], eq: [], order: [] })
    const chain = {
      select: (columns: string) => {
        calls.select.push(columns)
        return chain
      },
      eq: (column: string, value: unknown) => {
        calls.eq.push([column, value])
        return chain
      },
      or: (filter: string) => {
        calls.or.push(filter)
        return chain
      },
      order: (column: string) => {
        calls.order.push(column)
        return Promise.resolve(answer)
      },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer).then(resolve),
    }
    return chain as never
  })
  return captured
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

  it('goes back to loading while the new month is in flight', async () => {
    // The half the test above does not cover. That one proves a refetch was
    // ISSUED; this one proves the stale month is HIDDEN while it runs.
    //
    // Without setStatus('loading') at the top of load, `status` stays 'ready'
    // holding the previous month's rows for the whole fetch. RevenueAdmin then
    // renders September's amounts in the inputs and September's missing-count
    // in the caption, under an August heading, with Save still enabled -- and a
    // click in that window writes September's values into August. The screen
    // looks correct throughout, which is what makes it dangerous.
    given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { result, rerender } = renderHook(({ period }) => useRevenue(period), {
      initialProps: { period: '2026-09-01' },
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    // A read that never resolves, so the in-flight window stays open long
    // enough to assert on. Without it the fetch settles before any assertion
    // can run and the test passes whatever the hook does.
    vi.mocked(supabase.from).mockImplementation(() => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        or: () => chain,
        order: () => new Promise(() => {}),
      }
      return chain as never
    })

    rerender({ period: '2026-08-01' })

    await waitFor(() => expect(result.current.status).toBe('loading'))
  })

  // THE TWO FILTERS. Everything above asserts what the hook does with an
  // ANSWER; these assert the QUESTION, which is the half nothing could fail on
  // -- the chain discarded its arguments, so both filter strings could have
  // been anything at all and every test here still passed. They are the
  // contract this hook makes with PostgREST, and each has a failure that no
  // other test in this repository would notice.

  it('asks for the clients eligible for the month, both arms of the rule', async () => {
    const captured = given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { result } = renderHook(() => useRevenue('2026-09-01'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    const filter = captured.clients?.or[0] ?? ''

    // Arm one, and losing it is the catastrophic case: every ACTIVE client has
    // a null ended_on, so a filter reduced to the date comparison alone returns
    // an EMPTY roster -- the screen renders "no clients" and no month can be
    // entered at all.
    expect(filter).toContain('ended_on.is.null')

    // Arm two, INCLUSIVE of the period, spec section 6.1. Written `gt` instead
    // of `gte`, a client who left during a month drops out of that month's
    // roster -- so the revenue they really did bill before leaving can never be
    // recorded, and the month they departed permanently understates the firm's
    // income. Production has exactly such a client (ended 2026-08-25), which is
    // what makes this the live case and not a hypothetical.
    expect(filter).toContain('ended_on.gte.2026-09-01')
  })

  it('asks for one month of revenue, the month it was given', async () => {
    const captured = given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { result } = renderHook(() => useRevenue('2026-08-01'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    // Hand-derived from the argument above, not read back off the hook: a
    // filter pinned to the wrong month returns real rows for a month nobody
    // asked about, which RevenueAdmin then prefills into the inputs under the
    // requested month's heading -- the same shape of wrong answer as the
    // stale-month window, arriving by a different route.
    expect(captured.client_month_revenue?.eq).toEqual([['period', '2026-08-01']])
  })
})
