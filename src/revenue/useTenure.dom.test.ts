// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const order = vi.fn()
vi.mock('../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ order: order }) }) },
}))

import { useTenure } from './useTenure'

const ROW = {
  id: 1,
  name: 'Acme',
  status: 'active',
  started_on: '2026-01-01',
  ended_on: null,
  end_reason_code: null,
  end_reason_note: null,
}

beforeEach(() => {
  order.mockReset()
})

describe('useTenure', () => {
  it('starts out loading', () => {
    order.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useTenure())

    expect(result.current.status).toBe('loading')
    expect(result.current.clients).toEqual([])
  })

  it('reports the rows once they arrive', async () => {
    order.mockResolvedValue({ data: [ROW], error: null })
    const { result } = renderHook(() => useTenure())

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.clients).toEqual([ROW])
    expect(result.current.loadError).toBe(null)
  })

  // v1's signature defect, and the reason this hook reports a status at all
  // rather than just a list: a failed read that fell through to an empty array
  // would render as "no clients yet", making a broken tool look like an empty
  // one. useBoard carries the same shape for the same reason.
  it('reports a failed read as an error, never as an empty roster', async () => {
    order.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    const { result } = renderHook(() => useTenure())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.loadError).toContain('permission denied')
    expect(result.current.clients).toEqual([])
  })

  it('reports a thrown failure the same way', async () => {
    order.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useTenure())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.loadError).toContain('offline')
  })

  it('reads again on demand', async () => {
    order.mockResolvedValue({ data: [ROW], error: null })
    const { result } = renderHook(() => useTenure())

    await waitFor(() => expect(result.current.status).toBe('ready'))
    const before = order.mock.calls.length
    result.current.reload()
    await waitFor(() => expect(order.mock.calls.length).toBe(before + 1))
  })
})
