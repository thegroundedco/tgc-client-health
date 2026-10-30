import { describe, expect, it } from 'vitest'
import { ALL_QUESTIONS } from '../lib/buckets'
import { AI_ANSWER_KEYS, parseAiSuggestion, revertedAnswers, type AiSuggestion } from './aiSuggestion'

const FINANCE = ['fin_rack_rate', 'fin_rate_increased']

describe('AI_ANSWER_KEYS', () => {
  it('is the 19 non-finance keys', () => {
    expect(AI_ANSWER_KEYS).toHaveLength(19)
    for (const key of FINANCE) expect(AI_ANSWER_KEYS).not.toContain(key)
    expect([...AI_ANSWER_KEYS, ...FINANCE].sort()).toEqual([...ALL_QUESTIONS].sort())
  })
})

describe('parseAiSuggestion', () => {
  const good = {
    suggested_at: '2026-10-30T00:00:00.000Z',
    run_id: 7,
    notes: 'n',
    answers: { comm_timely: 4, adv_left_review: null },
  }

  it('returns the value for a well-formed suggestion', () => {
    expect(parseAiSuggestion(good)).toEqual(good)
    expect(parseAiSuggestion({ ...good, run_id: null })?.run_id).toBeNull()
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'x'],
    ['an empty object', {}],
    ['missing answers', { ...good, answers: undefined }],
    ['null answers', { ...good, answers: null }],
    ['non-string notes', { ...good, notes: 5 }],
    ['non-string suggested_at', { ...good, suggested_at: 5 }],
    ['non-numeric run_id', { ...good, run_id: 'a' }],
    ['non-numeric answer value', { ...good, answers: { comm_timely: 'x' } }],
  ])('returns null for %s', (_name, value) => {
    expect(parseAiSuggestion(value)).toBeNull()
  })
})

describe('revertedAnswers', () => {
  const ai: AiSuggestion = {
    suggested_at: '2026-10-30T00:00:00.000Z',
    run_id: null,
    notes: '',
    answers: { comm_timely: 2, adv_left_review: null },
  }

  it('keeps the current finance pair, takes the rest from the AI copy, absent becomes null', () => {
    const current = { fin_rack_rate: 5, fin_rate_increased: 1, comm_timely: 4, fin_pays_on_time: 3 }
    const out = revertedAnswers(current, ai)
    expect(out.fin_rack_rate).toBe(5)
    expect(out.fin_rate_increased).toBe(1)
    expect(out.comm_timely).toBe(2)
    expect(out.adv_left_review).toBeNull()
    expect(out.fin_pays_on_time).toBeNull()
    for (const key of AI_ANSWER_KEYS) expect(out).toHaveProperty(key)
  })

  it('maps a missing finance answer in current to null', () => {
    expect(revertedAnswers({}, ai).fin_rack_rate).toBeNull()
  })
})
