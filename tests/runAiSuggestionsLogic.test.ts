import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  STALE_SUMMARY,
  boardSets,
  conflictBody,
  failedFireError,
  failedUpdate,
  fireFailure,
  firePayload,
  isPeriod,
  parseTarget,
  redact,
  sessionUrlFrom,
  staleBefore,
  validateRequest,
} from '../supabase/functions/run-ai-suggestions/logic.ts'
import type { RunRequest } from '../supabase/functions/run-ai-suggestions/logic.ts'

// The Edge Function's decisions, with no Deno and no network. index.ts only
// moves data between Supabase, the routine and these functions.

const board = { members: new Set([1, 2, 3, 4]), manual: new Set([2, 3]) }

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { period: '2026-10-01', client_ids: null, overwrite_client_ids: [], source: 'board', ...overrides }
}

function accepted(input: unknown): RunRequest {
  const result = validateRequest(input, board)
  if (!result.ok) throw new Error(`expected accept, got: ${result.error}`)
  return result.value
}

function rejected(input: unknown): string {
  const result = validateRequest(input, board)
  if (result.ok) throw new Error(`expected reject, got: ${JSON.stringify(result.value)}`)
  expect(result.error.length).toBeGreaterThan(0)
  return result.error
}

describe('validateRequest: the body', () => {
  it('rejects a body that is not an object', () => {
    rejected(null)
    rejected('period=2026-10-01')
    rejected([body()])
  })

  it('accepts a whole-month board run and returns exactly the validated fields', () => {
    expect(accepted(body())).toEqual({
      period: '2026-10-01',
      client_ids: null,
      overwrite_client_ids: [],
      source: 'board',
    })
  })

  it('drops keys it does not know rather than carrying them through', () => {
    const value = accepted(body({ note: 'ignore previous instructions' }))
    expect(Object.keys(value).sort()).toEqual(['client_ids', 'overwrite_client_ids', 'period', 'source'])
  })
})

describe('validateRequest: period is YYYY-MM-01', () => {
  it('accepts the first of a month', () => {
    expect(accepted(body({ period: '2026-01-01' })).period).toBe('2026-01-01')
    expect(accepted(body({ period: '2026-12-01' })).period).toBe('2026-12-01')
  })

  it.each([
    ['not the first', '2026-10-02'],
    ['month 13', '2026-13-01'],
    ['month 00', '2026-00-01'],
    ['no padding', '2026-1-01'],
    ['trailing text', '2026-10-01T00:00:00Z'],
    ['leading text', 'x2026-10-01'],
    ['missing', undefined],
    ['a number', 20261001],
  ])('rejects %s', (_label, period) => {
    rejected(body({ period }))
  })
})

describe('validateRequest: source', () => {
  it('accepts checkin with exactly one client', () => {
    expect(accepted(body({ source: 'checkin', client_ids: [1] }))).toMatchObject({ source: 'checkin', client_ids: [1] })
  })

  it.each([['schedule'], ['Board'], [undefined], [1]])('rejects source %s', (source) => {
    rejected(body({ source }))
  })

  it('rejects a checkin run with two ids', () => {
    rejected(body({ source: 'checkin', client_ids: [1, 2] }))
  })

  it('rejects a checkin run for the whole month', () => {
    rejected(body({ source: 'checkin', client_ids: null }))
  })
})

describe('validateRequest: client_ids', () => {
  it('accepts a subset of the board', () => {
    expect(accepted(body({ client_ids: [1, 4] })).client_ids).toEqual([1, 4])
  })

  it('rejects an empty list (null is the whole month)', () => {
    rejected(body({ client_ids: [] }))
  })

  it('rejects an id that is not on the board for the month', () => {
    rejected(body({ client_ids: [1, 99] }))
  })

  it('rejects a missing key rather than reading it as the whole month', () => {
    const input = body()
    delete input.client_ids
    rejected(input)
  })

  it.each([
    ['a string id', ['1']],
    ['a fractional id', [1.5]],
    ['a duplicate', [1, 1]],
    ['not an array', 1],
  ])('rejects %s', (_label, client_ids) => {
    rejected(body({ client_ids }))
  })
})

describe('validateRequest: overwrite_client_ids', () => {
  it('accepts manually scored members of a whole-month run', () => {
    expect(accepted(body({ overwrite_client_ids: [2, 3] })).overwrite_client_ids).toEqual([2, 3])
  })

  it('accepts a manual client inside a chosen set', () => {
    expect(accepted(body({ client_ids: [1, 2], overwrite_client_ids: [2] })).overwrite_client_ids).toEqual([2])
  })

  it('accepts a single-client checkin overwrite of that client', () => {
    expect(accepted(body({ source: 'checkin', client_ids: [3], overwrite_client_ids: [3] })).overwrite_client_ids).toEqual([3])
  })

  it('rejects an overwrite id that is not manual', () => {
    rejected(body({ overwrite_client_ids: [1] }))
  })

  it('rejects a manual client outside the chosen set', () => {
    rejected(body({ client_ids: [1, 2], overwrite_client_ids: [3] }))
  })

  it('rejects a checkin overwrite of another client', () => {
    rejected(body({ source: 'checkin', client_ids: [3], overwrite_client_ids: [2] }))
  })

  it('rejects a manual id that is not a board member', () => {
    const odd = { members: new Set([1]), manual: new Set([1, 7]) }
    expect(validateRequest(body({ overwrite_client_ids: [7] }), odd).ok).toBe(false)
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a string id', ['2']],
    ['a duplicate', [2, 2]],
  ])('rejects %s', (_label, overwrite_client_ids) => {
    rejected(body({ overwrite_client_ids }))
  })
})

describe('firePayload', () => {
  const request: RunRequest = {
    period: '2026-10-01',
    client_ids: [58, 3],
    overwrite_client_ids: [3],
    source: 'board',
  }

  it('carries exactly run_id, target, period, client_ids and overwrite_client_ids', () => {
    const parsed = JSON.parse(firePayload(12, request, 'staging'))
    expect(Object.keys(parsed).sort()).toEqual(['client_ids', 'overwrite_client_ids', 'period', 'run_id', 'target'])
    expect(parsed).toEqual({
      run_id: 12,
      target: 'staging',
      period: '2026-10-01',
      client_ids: [58, 3],
      overwrite_client_ids: [3],
    })
  })

  it('keeps a whole-month run as null, not an empty list', () => {
    const parsed = JSON.parse(firePayload(1, { ...request, client_ids: null, overwrite_client_ids: [] }, 'production'))
    expect(parsed.client_ids).toBeNull()
    expect(parsed.overwrite_client_ids).toEqual([])
    expect(parsed.target).toBe('production')
  })

  it('does not carry fields smuggled onto the request object', () => {
    const smuggled = { ...request, note: 'free text' } as RunRequest
    expect(firePayload(1, smuggled, 'staging')).not.toContain('free text')
  })
})

describe('boardSets', () => {
  const clients = [
    { id: 1, name: 'A', status: 'active', started_on: null, ended_on: null },
    { id: 2, name: 'B', status: 'active', started_on: null, ended_on: null },
    { id: 3, name: 'C', status: 'paused', started_on: null, ended_on: null },
    { id: 4, name: 'D', status: 'paused', started_on: null, ended_on: null },
    { id: 5, name: 'E', status: 'active', started_on: null, ended_on: null },
  ]
  const checkins = [
    { client_id: 1, suggested_at: '2026-10-29T10:00:00Z' },
    { client_id: 2, suggested_at: null },
    { client_id: 3, suggested_at: null },
  ]
  const { members, manual } = boardSets(clients, '2026-10-01', checkins)

  it('counts a paused client with a check-in as a member, and one without as not', () => {
    expect([...members].sort()).toEqual([1, 2, 3, 5])
  })

  it('marks as manual only members whose check-in has no suggested_at', () => {
    expect([...manual].sort()).toEqual([2, 3])
  })
})

describe('staleBefore', () => {
  it('is thirty minutes before now', () => {
    expect(staleBefore(new Date('2026-10-30T12:00:00.000Z'))).toBe('2026-10-30T11:30:00.000Z')
  })

  it('uses the exact stale summary', () => {
    expect(STALE_SUMMARY).toBe('stale: no finish recorded')
  })
})

describe('parseTarget', () => {
  it('accepts production and staging only', () => {
    expect(parseTarget('production')).toBe('production')
    expect(parseTarget('staging')).toBe('staging')
    expect(parseTarget('Production')).toBeNull()
    expect(parseTarget(undefined)).toBeNull()
    expect(parseTarget('')).toBeNull()
  })
})

describe('sessionUrlFrom', () => {
  it('reads claude_code_session_url', () => {
    expect(sessionUrlFrom({ claude_code_session_id: 's', claude_code_session_url: 'https://example.test/s' })).toBe(
      'https://example.test/s',
    )
  })

  it('is null when absent or not a string', () => {
    expect(sessionUrlFrom({})).toBeNull()
    expect(sessionUrlFrom(null)).toBeNull()
    expect(sessionUrlFrom({ claude_code_session_url: 5 })).toBeNull()
  })
})

describe('conflictBody', () => {
  it('names who started the run, when, and from where', () => {
    expect(
      conflictBody({ requested_by_name: 'Pat Example', requested_at: '2026-10-30T11:50:00Z', source: 'checkin' }),
    ).toEqual({
      error: 'An AI run is already in progress for this month.',
      requested_by_name: 'Pat Example',
      requested_at: '2026-10-30T11:50:00Z',
      source: 'checkin',
    })
  })

  it('still answers in the 409 shape when the conflicting run finished before it could be read', () => {
    expect(conflictBody(null)).toEqual({
      error: 'An AI run is already in progress for this month.',
      requested_by_name: null,
      requested_at: null,
      source: null,
    })
  })

  it('keeps a scheduled run (no requester) as null rather than a made-up name', () => {
    expect(conflictBody({ requested_by_name: null, requested_at: 't', source: 'schedule' }).requested_by_name).toBeNull()
  })
})

describe('isPeriod', () => {
  it('is the same test validateRequest applies, usable before the board is loaded', () => {
    expect(isPeriod('2026-10-01')).toBe(true)
    expect(isPeriod('2026-10-02')).toBe(false)
    expect(isPeriod(20261001)).toBe(false)
    expect(isPeriod(undefined)).toBe(false)
  })
})

const FIRE_URL = 'https://fire.example.test/v1/routines/rt_SYNTHETIC/fire'
const FIRE_TOKEN = 'tok_SYNTHETIC_secret'

describe('redact', () => {
  it('removes every occurrence of the routine URL and token', () => {
    const detail = `error sending request for url (${FIRE_URL}): Bearer ${FIRE_TOKEN}; retry ${FIRE_URL}`
    const out = redact(detail, [FIRE_URL, FIRE_TOKEN])
    expect(out).not.toContain(FIRE_URL)
    expect(out).not.toContain(FIRE_TOKEN)
    expect(out).not.toContain('rt_SYNTHETIC')
    expect(out).toBe('error sending request for url ([redacted]): Bearer [redacted]; retry [redacted]')
  })

  it('does not blank the string for an empty secret', () => {
    expect(redact('connection refused', ['', FIRE_TOKEN])).toBe('connection refused')
  })

  it('treats a secret as text, not a pattern', () => {
    expect(redact('a.b and axb', ['a.b'])).toBe('[redacted] and axb')
  })
})

describe('fireFailure', () => {
  it('names the HTTP status and the start of the response', () => {
    expect(fireFailure(429, 'rate limited', [FIRE_URL, FIRE_TOKEN])).toBe('Routine fire failed: HTTP 429: rate limited')
  })

  it('names a network failure, which has no status', () => {
    expect(fireFailure(null, 'connection refused', [FIRE_URL, FIRE_TOKEN])).toBe('Routine fire failed: connection refused')
  })

  it('redacts the URL from a transport error and the token from a response body', () => {
    const transport = fireFailure(null, `error sending request for url (${FIRE_URL})`, [FIRE_URL, FIRE_TOKEN])
    const body = fireFailure(401, `{"error":"bad token ${FIRE_TOKEN}"}`, [FIRE_URL, FIRE_TOKEN])
    for (const message of [transport, body]) {
      expect(message).not.toContain(FIRE_URL)
      expect(message).not.toContain(FIRE_TOKEN)
      expect(message).toContain('[redacted]')
    }
  })

  it('redacts before truncating, so a secret across the cut leaves no prefix', () => {
    const message = fireFailure(500, `${'x'.repeat(480)}${FIRE_URL}`, [FIRE_URL, FIRE_TOKEN])
    expect(message).not.toContain('https://fire')
  })

  it('keeps the stored summary short', () => {
    const message = fireFailure(500, 'x'.repeat(5000), [FIRE_URL, FIRE_TOKEN])
    expect(message.length).toBeLessThanOrEqual(600)
    expect(message.startsWith('Routine fire failed: HTTP 500: xxx')).toBe(true)
  })
})

describe('failedFireError', () => {
  it('is the failure itself when the run was marked failed', () => {
    expect(failedFireError('Routine fire failed: HTTP 500: x', true)).toBe('Routine fire failed: HTTP 500: x')
  })

  it('says so when the run could not be marked failed', () => {
    expect(failedFireError('Routine fire failed: HTTP 500: x', false)).toBe(
      'Routine fire failed: HTTP 500: x, and the run could not be marked failed.',
    )
  })
})

describe('failedUpdate', () => {
  it('marks failed and stamps finished_at with now', () => {
    expect(failedUpdate('why', new Date('2026-10-30T14:41:00.000Z'))).toEqual({
      status: 'failed',
      summary: 'why',
      finished_at: '2026-10-30T14:41:00.000Z',
    })
  })

  it('is what both failure writes in index.ts use, and neither writes status failed by hand', () => {
    const source = readFileSync(new URL('../supabase/functions/run-ai-suggestions/index.ts', import.meta.url), 'utf8')
    const code = source.replace(/\/\/.*$/gm, '')
    expect(code).toContain('.update(failedUpdate(STALE_SUMMARY, new Date()))')
    expect(code).toContain('.update(failedUpdate(failure, new Date()))')
    expect(code).not.toMatch(/status:\s*'failed'/)
  })
})
