import { ALL_QUESTIONS } from '../lib/buckets'
import type { Answers } from '../lib/scoreV2'

// The two finance answers an AI run never scores: they are facts about the
// contract, not judgments, so a revert leaves the person's values alone.
const FINANCE_KEYS: readonly string[] = ['fin_rack_rate', 'fin_rate_increased']

export const AI_ANSWER_KEYS: readonly string[] = ALL_QUESTIONS.filter(
  (key) => !FINANCE_KEYS.includes(key),
)

// Written only by an AI routine (a DB trigger rejects any app write).
export type AiSuggestion = {
  suggested_at: string
  run_id: number | null
  notes: string
  answers: Answers
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
  return { suggested_at, run_id, notes, answers: clean }
}

export function revertedAnswers(current: Answers, ai: AiSuggestion): Answers {
  const out: Answers = {}
  for (const key of AI_ANSWER_KEYS) out[key] = ai.answers[key] ?? null
  for (const key of FINANCE_KEYS) out[key] = current[key] ?? null
  return out
}
