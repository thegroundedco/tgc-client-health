import { describe, expect, it } from 'vitest'
import { runLine, runState, type AiRun } from './runLine'

// Local-time constructors keep the formatted time independent of the machine zone.
const at = (h: number, m: number, s = 0) => new Date(2026, 9, 30, h, m, s)
const base = (o: Partial<AiRun>): AiRun => ({
  id: 1, period: '2026-10-01', client_ids: null, overwrite_client_ids: [], source: 'board',
  requested_by: 'u', requested_by_name: 'Josh', requested_at: at(14, 41).toISOString(),
  session_url: null, finished_at: null, status: 'requested', summary: null, ...o,
})

describe('runState', () => {
  it('is idle without a run', () => expect(runState(null, at(15, 0))).toBe('idle'))
  it('maps done and failed', () => {
    expect(runState(base({ status: 'done' }), at(23, 0))).toBe('done')
    expect(runState(base({ status: 'failed' }), at(14, 42))).toBe('failed')
  })
  it('requested is running until 30 minutes, then failed', () => {
    expect(runState(base({}), at(15, 10, 59))).toBe('running') // 29:59
    expect(runState(base({}), at(15, 11, 1))).toBe('failed') // 30:01
  })
})

describe('runLine', () => {
  it('running board run', () =>
    expect(runLine(base({}), at(14, 45))).toBe('AI scoring running — started by Josh at 2:41 PM.'))
  it('running schedule run', () =>
    expect(runLine(base({ source: 'schedule', requested_by_name: null }), at(14, 45))).toBe(
      'AI scoring running — started by the schedule at 2:41 PM.'))
  it('stale and failed runs', () => {
    expect(runLine(base({}), at(16, 0))).toBe("The last AI run didn't finish.")
    expect(runLine(base({ status: 'failed' }), at(14, 50))).toBe("The last AI run didn't finish.")
  })
  it('done run shows its summary', () =>
    expect(runLine(base({ status: 'done', summary: 'Scored 12 clients.' }), at(15, 0))).toBe('Scored 12 clients.'))
})
