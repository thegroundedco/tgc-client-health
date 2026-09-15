// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

import { supabase } from '../lib/supabase'
import { useClientRates } from './useClientRates'

const ROW = { client_id: 1, period: '2026-09-01', retainer_cents: 400_000, project_cents: 0 }

afterEach(() => vi.mocked(supabase.from).mockReset())

describe('useClientRates', () => {
  it('reports ready with the computed rates on a successful read', async () => {
    vi.mocked(supabase.from).mockImplementation(
      () =>
        ({
          select: () => Promise.resolve({ data: [ROW], error: null }),
        }) as never,
    )

    const { result } = renderHook(() => useClientRates(true))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.rates.get(1)).toEqual({ cents: 400_000, kind: 'retainer' })
  })

  // FINDING 1 from review: the brief's own snippet, transcribed from
  // useRevenue.ts's SHAPE, omitted the one thing that shape exists for --
  // useRevenue wraps its fetch in try/catch specifically so a REJECTED promise
  // (a genuine network failure) cannot escape the effect as an unhandled
  // rejection. Without it, this is exactly what produced the
  // `supabase.from is not a function` unhandled rejections found in
  // Shell.dom.test.tsx: a thrown rejection, not a resolved `{ data, error }`.
  it('reports error, and never an unhandled rejection, when the query itself rejects', async () => {
    vi.mocked(supabase.from).mockImplementation(
      () =>
        ({
          select: () => Promise.reject(new Error('network down')),
        }) as never,
    )

    const { result } = renderHook(() => useClientRates(true))

    // If the rejection escapes the effect uncaught, `status` never leaves
    // 'loading' and this times out instead of resolving to 'error' -- and
    // vitest additionally reports the escaped rejection against the whole run,
    // the same way it did for Shell.dom.test.tsx before that file's mock was
    // added. A clean run of this file is itself part of what this test proves.
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.rates.size).toBe(0)
  })
})
