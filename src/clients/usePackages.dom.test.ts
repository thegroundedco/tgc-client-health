// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

import { usePackages } from './usePackages'
import { supabase } from '../lib/supabase'

function resolving(result: unknown) {
  const order = vi.fn().mockResolvedValue(result)
  const select = vi.fn(() => ({ order }))
  vi.mocked(supabase.from).mockReturnValue({ select } as never)
  return { select, order }
}

function rejecting() {
  const order = vi.fn().mockRejectedValue(new Error('network down'))
  const select = vi.fn(() => ({ order }))
  vi.mocked(supabase.from).mockReturnValue({ select } as never)
  return { select, order }
}

const STINT = {
  id: 1,
  client_id: 7,
  package_code: 'foundation',
  started_on: '2025-01-01',
  note: null,
}

beforeEach(() => {
  vi.mocked(supabase.from).mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('usePackages', () => {
  it('groups the stints by client', async () => {
    resolving({ data: [STINT, { ...STINT, id: 2, package_code: 'grow' }], error: null })

    const { result } = renderHook(() => usePackages(true))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.byClient.get(7)?.length).toBe(2)
  })

  // GATED AT THE READ, NOT THE RENDER. Hiding a figure that was already
  // fetched is not a permission check.
  it('issues no query at all when it is not enabled', async () => {
    const { select } = resolving({ data: [STINT], error: null })

    const { result } = renderHook(() => usePackages(false))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(supabase.from).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    expect(result.current.byClient.size).toBe(0)
  })

  it('reports a refused read rather than rendering it as no packages', async () => {
    resolving({ data: null, error: { message: 'permission denied for table client_packages' } })

    const { result } = renderHook(() => usePackages(true))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.loadError).toBeTruthy()
    expect(result.current.byClient.size).toBe(0)
  })

  // A REJECTED promise, not a resolved { data, error }. Without the try/catch
  // this escapes the effect as an unhandled rejection and the hook hangs in
  // 'loading' -- the exact defect found in useClientRates on slice 6l.
  it('lands on error when the request rejects outright', async () => {
    rejecting()

    const { result } = renderHook(() => usePackages(true))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.loadError).toBeTruthy()
  })
})
