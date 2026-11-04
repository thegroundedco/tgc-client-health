import { ALL_QUESTIONS, HOURS_QUESTION } from '../lib/buckets'
import type { Answers } from '../lib/scoreV2'
import { cleanBucketNotes, focusForSave } from './bucketNotes'
import type { BucketNotes } from './bucketNotes'

// The two finance answers an AI run never scores: they are facts about the
// contract, not judgments, so a revert leaves the person's values alone. The
// hours answer joins them: it is worked out from Productive, never by the AI,
// so a revert must not write it either.
const FINANCE_KEYS: readonly string[] = ['fin_rack_rate', 'fin_rate_increased', HOURS_QUESTION]

export const AI_ANSWER_KEYS: readonly string[] = ALL_QUESTIONS.filter(
  (key) => !FINANCE_KEYS.includes(key),
)

// Written only by an AI routine (a DB trigger rejects any app write).
export type AiSuggestion = {
  suggested_at: string
  run_id: number | null
  notes: string
  answers: Answers
  // Optional, and absent from every suggestion written before 2026-11-04.
  // Absent (undefined) means "this suggestion says nothing about them", and a
  // revert then leaves the person's own values alone. Present means the AI
  // had a view, even an empty one: {} and null are carried values, and a
  // revert writes them.
  bucket_notes?: BucketNotes
  focus?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Never throws; anything that is not the exact shape is null.
export function parseAiSuggestion(value: unknown): AiSuggestion | null {
  if (!isRecord(value)) return null
  const { suggested_at, run_id, notes, answers } = value
  if (typeof suggested_at !== 'string') return null
  if (run_id !== null && typeof run_id !== 'number') return null
  if (typeof notes !== 'string') return null
  if (!isRecord(answers)) return null
  const clean: Answers = {}
  for (const [key, answer] of Object.entries(answers)) {
    if (answer !== null && typeof answer !== 'number') return null
    clean[key] = answer
  }
  const parsed: AiSuggestion = { suggested_at, run_id, notes, answers: clean }
  // Tolerant, unlike the fields above: a malformed bucket_notes or focus
  // costs only that field, never the whole suggestion -- the answers are what
  // revert exists for. Malformed reads as not carried, so revert keeps the
  // person's own text rather than writing nothing over it.
  if (isRecord(value.bucket_notes)) parsed.bucket_notes = cleanBucketNotes(value.bucket_notes)
  if (value.focus === null) parsed.focus = null
  else if (typeof value.focus === 'string') parsed.focus = focusForSave(value.focus)
  return parsed
}

export function revertedAnswers(current: Answers, ai: AiSuggestion): Answers {
  const out: Answers = {}
  for (const key of AI_ANSWER_KEYS) out[key] = ai.answers[key] ?? null
  for (const key of FINANCE_KEYS) out[key] = current[key] ?? null
  return out
}
