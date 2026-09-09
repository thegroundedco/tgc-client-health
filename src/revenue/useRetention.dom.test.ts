// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

import { supabase } from '../lib/supabase'
import { useRetention } from './useRetention'

const CLIENT = { id: 1, name: 'Acme', started_on: '2020-01-01', ended_on: null }
const ROW = { client_id: 1, period: '2026-09-01', retainer_cents: 400000 }

// Records what each table's chain was asked for. The chain used to discard its
// arguments elsewhere in this codebase, which left the filters that decide what
// a screen reads completely unexercised -- see useRevenue.dom.test.ts.
type Captured = { select: string[]; order: string[] }

function given(answers: Record<string, { data: unknown; error: unknown }>) {
  const captured: Record<string, Captured> = {}
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const answer = answers[table] ?? { data: [], error: null }
    const calls = (captured[table] ??= { select: [], order: [] })
    const chain = {
      select: (columns: string) => {
        calls.select.push(columns)
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

describe('useRetention', () => {
  it('reports both reads landing as ready', async () => {
    given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { result } = renderHook(() => useRetention())

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.clients).toEqual([CLIENT])
    expect(result.current.rows).toEqual([ROW])
  })

  it('reports a failed roster read as an error, not as an empty book', async () => {
    // A broken tool must not look like an empty one. An empty roster here would
    // render retention as "no clients", which reads as a fact about the agency.
    given({
      clients: { data: null, error: { message: 'permission denied' } },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { result } = renderHook(() => useRetention())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.loadError).toContain('permission denied')
  })

  it('reports a failed revenue read as an error rather than a year of no revenue', async () => {
    given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: null, error: { message: 'permission denied' } },
    })

    const { result } = renderHook(() => useRetention())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.rows).toEqual([])
  })

  it('asks for the columns the classification rule needs', async () => {
    // THE CAST IS WHY THIS TEST EXISTS. The hook casts its response, so a
    // column missing from the select is invisible to tsc -- proven in slice 6c,
    // where dropping a column produced ZERO build errors while the feature
    // silently stopped working. Without ended_on a churned client reads as
    // unentered and churn vanishes from the churn measure; without started_on
    // new business is counted as unentered.
    const captured = given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { result } = renderHook(() => useRetention())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    const roster = captured.clients?.select[0] ?? ''
    expect(roster).toContain('id')
    expect(roster).toContain('name')
    expect(roster).toContain('started_on')
    expect(roster).toContain('ended_on')

    const revenue = captured.client_month_revenue?.select[0] ?? ''
    expect(revenue).toContain('client_id')
    expect(revenue).toContain('period')
    expect(revenue).toContain('retainer_cents')
  })

  it('reads project work too, because the billing chart needs it', async () => {
    // CHANGED IN SLICE 6D, and the guarantee moved rather than went away. This
    // used to assert project_cents was ABSENT, so retention could not pick it up
    // by accident. The billing chart needs it and reads the same whole table;
    // two hooks would fetch it twice and could anchor to different latest
    // months while both looked authoritative.
    //
    // Retention's "retainer only" rule now lives in the TYPE -- RetentionRow has
    // no project_cents field, so retention() cannot read one however the rows
    // arrive -- and retentionMath.test.ts proves it behaviourally by feeding it
    // rows WITH project work and asserting the rates do not move. That is a
    // stronger statement than a column missing from a string.
    const captured = given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { result } = renderHook(() => useRetention())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(captured.client_month_revenue?.select[0] ?? '').toContain('project_cents')
  })
})
