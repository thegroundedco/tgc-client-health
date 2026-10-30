// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UPDATE_MATCHED_NOTHING_TEXT } from '../clients/clientForm'
import { ALL_QUESTIONS } from '../lib/buckets'
import { requiredQuestions } from '../lib/scoreV2'
import type { Answers } from '../lib/scoreV2'
import { AI_ANSWER_KEYS, type AiSuggestion } from './aiSuggestion'

type Result = { data: unknown; error: unknown }

const db = vi.hoisted(() => ({
  updates: 0,
  lastUpdate: null as Record<string, unknown> | null,
  filters: [] as [string, unknown][],
  selected: null as string | null,
  write: async (): Promise<Result> => ({ data: null, error: null }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        expect(table).toBe('checkins')
        db.updates += 1
        db.lastUpdate = payload
        const chain = {
          eq: (column: string, value: unknown) => {
            db.filters.push([column, value])
            return chain
          },
          select: (columns: string) => {
            db.selected = columns
            return { maybeSingle: () => db.write() }
          },
        }
        return chain
      },
    }),
  },
}))

import { useRevertSuggestion } from './useRevertSuggestion'

const FULL_AI: Answers = Object.fromEntries(AI_ANSWER_KEYS.map((k) => [k, 4]))
const ai = (answers: Answers): AiSuggestion => ({
  suggested_at: '2026-10-28T09:00:00Z',
  run_id: 3,
  notes: 'AI note',
  answers,
})
const CURRENT: Answers = { fin_rack_rate: 5, fin_rate_increased: 1, q_x: 1 }

describe('useRevertSuggestion', () => {
  beforeEach(() => {
    db.updates = 0
    db.lastUpdate = null
    db.filters = []
    db.selected = null
    db.write = async () => ({ data: { updated_at: 'x' }, error: null })
    vi.useRealTimers()
  })

  it('writes exactly the AI columns, notes, and review fields, filtered on client and month', async () => {
    const { result } = renderHook(() => useRevertSuggestion(7, '2026-10-01', 'prof-1'))
    await act(async () => {
      await result.current.revert({ current: CURRENT, ai: ai(FULL_AI), advocacyApplies: true })
    })
    const payload = db.lastUpdate!
    expect(Object.keys(payload).sort()).toEqual(
      [...AI_ANSWER_KEYS, 'notes', 'suggested_at', 'submitted_at', 'submitted_by'].sort(),
    )
    expect(AI_ANSWER_KEYS).toHaveLength(19)
    expect('ai_suggestion' in payload).toBe(false)
    expect('fin_rack_rate' in payload).toBe(false)
    expect('fin_rate_increased' in payload).toBe(false)
    expect(payload.notes).toBe('AI note')
    expect(payload.suggested_at).toEqual(expect.any(String))
    expect([...db.filters].sort()).toEqual([['client_id', 7], ['period', '2026-10-01']])
    expect(db.selected).toBe('updated_at')
    expect(result.current.state).toEqual({ kind: 'reverted' })
  })

  it('leaves submitted_at null when the merged answers are incomplete with the gate open', async () => {
    const partial = { ...FULL_AI, [AI_ANSWER_KEYS[0]]: null }
    const { result } = renderHook(() => useRevertSuggestion(7, '2026-10-01', 'prof-1'))
    await act(async () => {
      await result.current.revert({ current: CURRENT, ai: ai(partial), advocacyApplies: true })
    })
    expect(db.lastUpdate!.submitted_at).toBeNull()
    expect(db.lastUpdate!.submitted_by).toBeNull()
    expect(db.lastUpdate![AI_ANSWER_KEYS[0]]).toBeNull()
  })

  it('sets submitted_at and submitted_by when complete (finance kept, gate shut)', async () => {
    // Complete only because the person's own finance answers are merged in.
    const current: Answers = Object.fromEntries(ALL_QUESTIONS.map((k) => [k, 3]))
    const { result } = renderHook(() => useRevertSuggestion(7, '2026-10-01', 'prof-1'))
    await act(async () => {
      await result.current.revert({ current, ai: ai(FULL_AI), advocacyApplies: false })
    })
    expect(db.lastUpdate!.submitted_at).toBe(db.lastUpdate!.suggested_at)
    expect(db.lastUpdate!.submitted_by).toBe('prof-1')
  })

  it('judges completeness by the gate: no Advocacy answers is complete only with the gate shut', async () => {
    const advocacy = ALL_QUESTIONS.filter((k) => !requiredQuestions(false).includes(k))
    expect(advocacy.length).toBeGreaterThan(0)
    const noAdvocacy = { ...FULL_AI, ...Object.fromEntries(advocacy.map((k) => [k, null])) }
    const current: Answers = { fin_rack_rate: 3, fin_rate_increased: 3 }
    const { result } = renderHook(() => useRevertSuggestion(7, '2026-10-01', 'prof-1'))
    await act(async () => {
      await result.current.revert({ current, ai: ai(noAdvocacy), advocacyApplies: false })
    })
    expect(db.lastUpdate!.submitted_at).not.toBeNull()
    await act(async () => {
      await result.current.revert({ current, ai: ai(noAdvocacy), advocacyApplies: true })
    })
    expect(db.lastUpdate!.submitted_at).toBeNull()
  })

  it('is a failure when no row matched', async () => {
    db.write = async () => ({ data: null, error: null })
    const { result } = renderHook(() => useRevertSuggestion(7, '2026-10-01', 'prof-1'))
    await act(async () => {
      await result.current.revert({ current: CURRENT, ai: ai(FULL_AI), advocacyApplies: true })
    })
    expect(result.current.state).toEqual({ kind: 'failed', message: UPDATE_MATCHED_NOTHING_TEXT })
  })

  it('is a failure on a database error', async () => {
    db.write = async () => ({ data: null, error: { message: 'boom' } })
    const { result } = renderHook(() => useRevertSuggestion(7, '2026-10-01', 'prof-1'))
    await act(async () => {
      await result.current.revert({ current: CURRENT, ai: ai(FULL_AI), advocacyApplies: true })
    })
    expect(result.current.state.kind).toBe('failed')
  })
})
