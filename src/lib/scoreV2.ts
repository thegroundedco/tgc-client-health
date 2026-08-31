import { BUCKETS, GATED_BUCKET, OVERALL_QUESTIONS, questionsFor, type Bucket } from './buckets'
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

// Re-exported for convenience -- both live in buckets.ts, the other leaf, and
// are handy alongside the functions here that consume them. Re-exporting adds
// no import to a leaf: scoreV2.ts already imports buckets.ts above, and the
// zero-imports rule binds scoreMath.ts and buckets.ts themselves, not this file.
export { OVERALL_QUESTIONS }

// A partial answer sheet. Every value is a number on the 1-5 scale; `null` and
// absence both mean unanswered. Partial because a draft is a check-in with
// questions still open, and because a draft restored from localStorage is
// arbitrary JSON -- every function here iterates the rubric rather than the
// object's own keys, so a stray key cannot be counted.
export type Answers = Partial<Record<string, number | null>>

// UNCHANGED by the 2026-08-28 amendment, and deliberately so. This is about
// COMPLETENESS -- how many answers a check-in needs before it may be submitted,
// and what every count on screen reads against. It is 21 when the gate is
// open, 17 when it is shut. What changed is the OVERALL's divisor, which is
// now always 17 and lives in OVERALL_QUESTIONS. These were one number until
// the amendment and are two now; collapsing them back would either make a
// gate-open check-in submittable four answers short, or make Advocacy count
// toward the headline number again.
export function requiredQuestions(advocacyApplies: boolean): readonly string[] {
  const buckets = advocacyApplies
    ? BUCKETS
    : BUCKETS.filter((bucket) => bucket !== GATED_BUCKET)
  return buckets.flatMap((bucket) => questionsFor(bucket).map((q) => q.key))
}

// One mean, for every bucket. There is no dispatch on kind any more and that
// absence is the API doing its job: a `choice` bucket and a `scale` bucket are
// the same arithmetic over the same column type, and the only thing that ever
// differed was which control wrote the number.
export function bucketScore(answers: Answers, bucket: Bucket): number | null {
  return meanOrNull(
    questionsFor(bucket).map((question) => answers[question.key] as number | null | undefined),
  )
}

// The mean of the seventeen non-Advocacy answers. Always -- there is no gate
// parameter, and that absence is the API doing its job: there is no way to ask
// for the retired 21-divisor behaviour by accident. Spec §3.2, amended
// 2026-08-28. Reversing it means changing this function and the view's
// expression, and nothing else.
export function overallScore(answers: Answers): number | null {
  return meanOrNull(
    OVERALL_QUESTIONS.map((key) => answers[key] as number | null | undefined),
  )
}

// A `1` is an ANSWER. Counting it as unanswered would leave a check-in
// permanently one short for any client with nothing yet to advocate, which is
// precisely the client most likely to answer No four times.
export function answeredCount(answers: Answers, advocacyApplies: boolean): number {
  let count = 0
  for (const key of requiredQuestions(advocacyApplies)) {
    const value = answers[key]
    if (value !== null && value !== undefined) count += 1
  }
  return count
}
