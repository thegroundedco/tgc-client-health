// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

import { supabase } from '../lib/supabase'
import { useClientRates } from './useClientRates'

const ROW = { client_id: 1, period: '2026-09-01', retainer_cents: 400_000, project_cents: 0 }

// The chain the hook actually builds: .from(...).select(...).order(...). `order`
// is the awaited link, not `select`, because the ORDER is part of the query the
// hook must issue -- see the test below that asserts its arguments.
const order = vi.fn()

function respondWith(result: () => Promise<unknown>) {
  order.mockImplementation(result)
  vi.mocked(supabase.from).mockImplementation(() => ({ select: () => ({ order }) }) as never)
}

afterEach(() => {
  vi.mocked(supabase.from).mockReset()
  order.mockReset()
})

describe('useClientRates', () => {
  it('reports ready with the computed rates on a successful read', async () => {
    respondWith(() => Promise.resolve({ data: [ROW], error: null }))

    const { result } = renderHook(() => useClientRates(true))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.rates.get(1)).toEqual({ cents: 400_000, kind: 'retainer' })
  })

  // FINAL-REVIEW FINDING 4: the query was unbounded AND unordered. PostgREST
  // caps a response (1000 rows by default) and, with no ORDER BY, drops rows in
  // UNSPECIFIED order past that cap -- so a client's September row could vanish
  // while their July row survived, and July would then win "latest" and be
  // shown as the current rate. Newest-first means truncation can only cost the
  // OLDEST months, which makes a rate absent rather than wrong. The direction is
  // the whole point, so it is asserted rather than left to a comment: flipping
  // ascending to true reintroduces the bug and must fail here.
  it('asks for the newest months first, so truncation can only drop the oldest', async () => {
    respondWith(() => Promise.resolve({ data: [ROW], error: null }))

    const { result } = renderHook(() => useClientRates(true))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(order).toHaveBeenCalledWith('period', { ascending: false })
  })

  // EARLIER REVIEW, finding 1: the brief's own snippet, transcribed from
  // useRevenue.ts's SHAPE, omitted the one thing that shape exists for --
  // useRevenue wraps its fetch in try/catch specifically so a REJECTED promise
  // (a genuine network failure) cannot escape the effect as an unhandled
  // rejection. Without it, this is exactly what produced the
  // `supabase.from is not a function` unhandled rejections found in
  // Shell.dom.test.tsx: a thrown rejection, not a resolved `{ data, error }`.
  it('reports error, and never an unhandled rejection, when the query itself rejects', async () => {
    respondWith(() => Promise.reject(new Error('network down')))

    const { result } = renderHook(() => useClientRates(true))

    // If the rejection escapes the effect uncaught, `status` never leaves
    // 'loading' and this times out instead of resolving to 'error' -- and
    // vitest additionally reports the escaped rejection against the whole run,
    // the same way it did for Shell.dom.test.tsx before that file's mock was
    // added. A clean run of this file is itself part of what this test proves.
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.rates.size).toBe(0)
  })

  // FINAL-REVIEW FINDING 1, and spec section 3.2's own words: "the read is gated
  // too, not just the display -- a non-admin must not issue a query whose rows
  // they should not have."
  //
  // Nothing tested that. Board.test.tsx asserts the ARGUMENT `false` against a
  // mocked hook, which proves what the board passes and nothing at all about
  // what the hook then does with it; both tests above pass `true`. Deleting
  // `if (!enabled) return` from the loader left all 1674 tests green while every
  // viewer's browser issued the revenue query.
  //
  // So this asserts on `supabase.from` itself -- the only observation that can
  // tell a gated read from a fetched-then-hidden one. An empty rate map is not
  // evidence: a hook that queried, got rows, and dropped them would look
  // identical.
  it('issues NO query at all when it is not enabled', async () => {
    respondWith(() => Promise.resolve({ data: [ROW], error: null }))

    const { result } = renderHook(() => useClientRates(false))

    // Awaited, not asserted synchronously: the read lives in an effect, and a
    // synchronous check would pass against a hook that queries one tick later.
    // 'ready' is the disabled hook's resting state -- it is not loading, because
    // there is nothing to load.
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(supabase.from).not.toHaveBeenCalled()
    expect(result.current.rates.size).toBe(0)
  })
})
