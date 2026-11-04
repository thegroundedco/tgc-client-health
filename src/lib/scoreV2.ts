import { BUCKETS, GATED_BUCKET, overallQuestions, questionsFor, type Bucket } from './buckets'
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
export { overallQuestions }

// A partial answer sheet. Every value is a number on the 1-5 scale; `null` and
// absence both mean unanswered. Partial because a draft is a check-in with
// questions still open, and because a draft restored from localStorage is
// arbitrary JSON -- every function here iterates the rubric rather than the
// object's own keys, so a stray key cannot be counted.
export type Answers = Partial<Record<string, number | null>>

// UNCHANGED by the 2026-08-28 amendment, and deliberately so. This is about
// COMPLETENESS -- how many answers a check-in needs before it may be submitted,
// and what every count on screen reads against. It is 21 when the gate is
// open, 17 when it is shut, and one more in each case when the hours question
// applies (22/18). What changed is the OVERALL's divisor, which is 17, or 18
// with hours, and lives in overallQuestions(). These were one number until
// the amendment and are two now; collapsing them back would either make a
// gate-open check-in submittable four answers short, or make Advocacy count
// toward the headline number again.
export function requiredQuestions(
  advocacyApplies: boolean,
  hoursApplies: boolean,
): readonly string[] {
  const buckets = advocacyApplies
    ? BUCKETS
    : BUCKETS.filter((bucket) => bucket !== GATED_BUCKET)
  return buckets.flatMap((bucket) => questionsFor(bucket, hoursApplies).map((q) => q.key))
}

// One mean, for every bucket. There is no dispatch on kind any more and that
// absence is the API doing its job: a `choice` bucket and a `scale` bucket are
// the same arithmetic over the same column type, and the only thing that ever
// differed was which control wrote the number.
export function bucketScore(
  answers: Answers,
  bucket: Bucket,
  hoursApplies: boolean,
): number | null {
  return meanOrNull(
    questionsFor(bucket, hoursApplies).map((question) => answers[question.key] as number | null | undefined),
  )
}

// The mean of the non-Advocacy answers: seventeen, or eighteen when the hours
// question applies. There is no gate parameter, and that absence is the API
// doing its job: there is no way to ask for the retired 21-divisor behaviour by
// accident. A stray hours answer is ignored when hours do not apply. Spec §3.2, amended
// 2026-08-28. Reversing it means changing this function and the view's
// expression, and nothing else.
export function overallScore(answers: Answers, hoursApplies: boolean): number | null {
  return meanOrNull(
    overallQuestions(hoursApplies).map((key) => answers[key] as number | null | undefined),
  )
}

// A `1` is an ANSWER. Counting it as unanswered would leave a check-in
// permanently one short for any client with nothing yet to advocate, which is
// precisely the client most likely to answer No four times.
export function answeredCount(
  answers: Answers,
  advocacyApplies: boolean,
  hoursApplies: boolean,
): number {
  let count = 0
  for (const key of requiredQuestions(advocacyApplies, hoursApplies)) {
    const value = answers[key]
    if (value !== null && value !== undefined) count += 1
  }
  return count
}

// THE completeness rule: every required question answered. One definition so
// submit and revert cannot disagree about what "complete" means.
export function isComplete(
  answers: Answers,
  advocacyApplies: boolean,
  hoursApplies: boolean,
): boolean {
  return (
    answeredCount(answers, advocacyApplies, hoursApplies) ===
    requiredQuestions(advocacyApplies, hoursApplies).length
  )
}
