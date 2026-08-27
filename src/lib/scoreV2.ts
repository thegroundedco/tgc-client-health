import { BUCKETS, GATED_BUCKET, questionsFor, type Bucket } from './buckets'
import { meanOrNull } from './scoreMath'

export {
  BAND_LABELS,
  HEALTHY_AT,
  MAX_SCORE,
  MIN_SCORE,
  SCORE_VALUES,
  WATCH_AT,
  bandFor,
  type Band,
} from './scoreMath'

// A partial answer sheet. Partial because a draft is a check-in with questions
// still unanswered, and because a draft restored from localStorage is arbitrary
// JSON -- every function here iterates the rubric rather than the object's own
// keys, so a stray key cannot be counted.
export type Answers = Partial<Record<string, number | null>>

export function requiredQuestions(advocacyApplies: boolean): readonly string[] {
  const buckets = advocacyApplies
    ? BUCKETS
    : BUCKETS.filter((bucket) => bucket !== GATED_BUCKET)
  return buckets.flatMap((bucket) => questionsFor(bucket).map((q) => q.key))
}

export function bucketScore(answers: Answers, bucket: Bucket): number | null {
  return meanOrNull(questionsFor(bucket).map((question) => answers[question.key]))
}

// The mean of every REQUIRED answer -- not the mean of the six bucket scores.
// Spec §3.2: every question weighs the same, so a four-question bucket moves
// this number by a third more than a three-question bucket does. Reversing that
// ruling means changing this function and the view's expression, and nothing
// else -- the bucket columns exist either way for the matrix and the bars.
export function overallScore(
  answers: Answers,
  advocacyApplies: boolean,
): number | null {
  return meanOrNull(requiredQuestions(advocacyApplies).map((key) => answers[key]))
}

export function answeredCount(
  answers: Answers,
  advocacyApplies: boolean,
): number {
  let count = 0
  for (const key of requiredQuestions(advocacyApplies)) {
    const value = answers[key]
    if (value !== null && value !== undefined) count += 1
  }
  return count
}
