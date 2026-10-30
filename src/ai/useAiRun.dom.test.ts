// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiRun } from './runLine'

const db = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  selects: 0,
  failLoads: false,
  gate: null as null | Promise<void>,
  periods: [] as unknown[],
  order: null as unknown,
  limit: null as unknown,
  invoke: async (): Promise<{ data: unknown; error: unknown }> => ({ data: { run_id: 1 }, error: null }),
  invoked: null as unknown,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => {
      let period = ''
      const chain = {
        select: () => chain,
        eq: (_c: string, v: string) => { period = v; db.periods.push(v); return chain },
        order: (...a: unknown[]) => { db.order = a; return chain },
        limit: async (n: number) => {
          db.limit = n; db.selects += 1
          const gate = db.gate
          db.gate = null
          if (gate) await gate
          if (db.failLoads) return { data: null, error: { message: 'down' } }
          return { data: db.rows[period] ?? [], error: null }
        },
      }
      return chain
    },
    functions: { invoke: (name: string, opts: unknown) => { db.invoked = [name, opts]; return db.invoke() } },
  },
}))

import { useAiRun } from './useAiRun'

const run = (o: Partial<AiRun> = {}): AiRun => ({
  id: 1, period: '2026-10-01', client_ids: null, overwrite_client_ids: [], source: 'board',
  requested_by: 'u', requested_by_name: 'Josh', requested_at: new Date().toISOString(),
  session_url: null, finished_at: null, status: 'requested', summary: null, ...o,
})
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const body = { period: '2026-10-01', client_ids: null, overwrite_client_ids: [], source: 'board' as const }

describe('useAiRun', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    db.rows = {}; db.selects = 0; db.failLoads = false; db.gate = null; db.periods = []
    db.invoke = async () => ({ data: { run_id: 1 }, error: null })
  })
  afterEach(() => vi.useRealTimers())

  it('loads the latest run for the period, newest first, limit 1', async () => {
    db.rows['2026-10-01'] = [run()]
    const { result } = renderHook(() => useAiRun('2026-10-01', () => {}))
    await flush()
    expect(result.current.state).toBe('running')
    expect(db.order).toEqual(['requested_at', { ascending: false }])
    expect(db.limit).toBe(1)
    expect(db.periods).toEqual(['2026-10-01'])
  })

  it('polls every 30s only while running', async () => {
    db.rows['2026-10-01'] = [run({ status: 'done', summary: 's' })]
    renderHook(() => useAiRun('2026-10-01', () => {}))
    await flush()
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(db.selects).toBe(1)

    db.selects = 0
    db.rows['2026-10-01'] = [run()]
    renderHook(() => useAiRun('2026-10-01', () => {}))
    await flush()
    expect(db.selects).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(db.selects).toBe(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(db.selects).toBe(3)
  })

  it('calls onFinished exactly once on running -> done, then stops polling', async () => {
    db.rows['2026-10-01'] = [run()]
    const onFinished = vi.fn()
    const { result } = renderHook(() => useAiRun('2026-10-01', onFinished))
    await flush()
    expect(onFinished).not.toHaveBeenCalled()
    db.rows['2026-10-01'] = [run({ status: 'done', summary: 'ok' })]
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(result.current.state).toBe('done')
    expect(onFinished).toHaveBeenCalledTimes(1)
    const n = db.selects
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(db.selects).toBe(n)
    expect(onFinished).toHaveBeenCalledTimes(1)
  })

  it('does not call onFinished when a finished run is simply loaded', async () => {
    db.rows['2026-10-01'] = [run({ status: 'failed' })]
    const onFinished = vi.fn()
    renderHook(() => useAiRun('2026-10-01', onFinished))
    await flush()
    expect(onFinished).not.toHaveBeenCalled()
  })

  it('changing period drops the old month run and never fires onFinished', async () => {
    db.rows['2026-10-01'] = [run()]
    const onFinished = vi.fn()
    const { result, rerender } = renderHook(({ p }) => useAiRun(p, onFinished), { initialProps: { p: '2026-10-01' } })
    await flush()
    expect(result.current.run).not.toBeNull()
    db.rows['2026-09-01'] = [run({ id: 2, period: '2026-09-01', status: 'done', summary: 'old' })]
    rerender({ p: '2026-09-01' })
    expect(result.current.run).toBeNull()
    await flush()
    expect(result.current.run?.id).toBe(2)
    expect(onFinished).not.toHaveBeenCalled()
  })

  it('start posts the body, reloads the run, and returns ok', async () => {
    const { result } = renderHook(() => useAiRun('2026-10-01', () => {}))
    await flush()
    db.rows['2026-10-01'] = [run()]
    let r: unknown
    await act(async () => { r = await result.current.start(body) })
    expect(r).toEqual({ ok: true })
    expect(db.invoked).toEqual(['run-ai-suggestions', { body }])
    expect(result.current.state).toBe('running')
    expect(result.current.starting).toBe(false)
  })

  it('a 409 resolves the exact conflict message', async () => {
    const at = new Date(2026, 9, 30, 14, 41).toISOString()
    db.invoke = async () => ({
      data: null,
      error: { context: new Response(JSON.stringify({ error: 'x', requested_by_name: 'Josh', requested_at: at, source: 'board' }), { status: 409 }) },
    })
    const { result } = renderHook(() => useAiRun('2026-10-01', () => {}))
    let r: unknown
    await act(async () => { r = await result.current.start(body) })
    expect(r).toEqual({ ok: false, message: 'AI scoring is already running for this month — started by Josh at 2:41 PM.' })
  })

  it('a 409 with null fields falls back to someone and omits the time', async () => {
    db.invoke = async () => ({
      data: null,
      error: { context: new Response(JSON.stringify({ error: 'x', requested_by_name: null, requested_at: null, source: null }), { status: 409 }) },
    })
    const { result } = renderHook(() => useAiRun('2026-10-01', () => {}))
    let r: unknown
    await act(async () => { r = await result.current.start(body) })
    expect(r).toEqual({ ok: false, message: 'AI scoring is already running for this month — started by someone.' })
  })

  it('other failures surface the body error, else a generic message', async () => {
    db.invoke = async () => ({
      data: null,
      error: { context: new Response(JSON.stringify({ error: 'You need permission to edit scores.' }), { status: 403 }) },
    })
    const { result } = renderHook(() => useAiRun('2026-10-01', () => {}))
    let r: unknown
    await act(async () => { r = await result.current.start(body) })
    expect(r).toEqual({ ok: false, message: 'You need permission to edit scores.' })
    db.invoke = async () => ({ data: null, error: new Error('network') })
    await act(async () => { r = await result.current.start(body) })
    expect(r).toMatchObject({ ok: false })
    expect((r as { message: string }).message).toMatch(/try again/i)
  })

  it('a failed reload after a successful start still shows running and polls', async () => {
    const { result } = renderHook(() => useAiRun('2026-10-01', () => {}))
    await flush()
    db.failLoads = true
    let r: unknown
    await act(async () => { r = await result.current.start(body) })
    expect(r).toEqual({ ok: true })
    expect(result.current.state).toBe('running')
    db.failLoads = false
    db.rows['2026-10-01'] = [run({ id: 9, status: 'done', summary: 'ok' })]
    const onSelects = db.selects
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(db.selects).toBeGreaterThan(onSelects)
    expect(result.current.run?.id).toBe(9)
    expect(result.current.state).toBe('done')
  })

  it.each([false, true])('a run crossing 30 minutes goes failed with unchanged rows (polls failing: %s)', async (fail) => {
    db.rows['2026-10-01'] = [run({ requested_at: new Date(Date.now() - 29 * 60_000).toISOString() })]
    const onFinished = vi.fn()
    const { result } = renderHook(() => useAiRun('2026-10-01', onFinished))
    await flush()
    expect(result.current.state).toBe('running')
    db.failLoads = fail
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000) })
    expect(result.current.state).toBe('failed')
    expect(onFinished).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(onFinished).toHaveBeenCalledTimes(1)
  })

  it('a slow response for the old period does not overwrite the new one', async () => {
    db.rows['2026-10-01'] = [run({ id: 1 })]
    db.rows['2026-09-01'] = [run({ id: 2, period: '2026-09-01', status: 'done', summary: 'b' })]
    let release!: () => void
    db.gate = new Promise<void>((r) => { release = r })
    const { result, rerender } = renderHook(({ p }) => useAiRun(p, () => {}), { initialProps: { p: '2026-10-01' } })
    rerender({ p: '2026-09-01' })
    await flush()
    expect(result.current.run?.id).toBe(2)
    release()
    await flush()
    expect(result.current.run?.id).toBe(2)
    expect(result.current.run?.period).toBe('2026-09-01')
  })
})
