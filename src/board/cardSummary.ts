import { ALL_QUESTIONS, BUCKETS, type Bucket } from '../lib/buckets'
import { answeredCount, requiredQuestions } from '../lib/scoreV2'
import type { Answers } from '../lib/scoreV2'
import { formatSavedAt } from '../lib/month'

// The six generated bucket columns. Named here rather than derived from the
// bucket name, because the abbreviations are not derivable -- `finances` is
// `fin_score` and `communication` is `comm_score` -- and a derivation could not
// complain when it guessed wrong. cardSummary.test.ts pins all six.
export type BucketScoreKey =
  | 'comm_score' | 'growth_score' | 'fin_score'
  | 'rel_score' | 'del_score' | 'adv_score'

export const BUCKET_SCORE_KEY: Record<Bucket, BucketScoreKey> = {
  communication: 'comm_score',
  growth: 'growth_score',
  finances: 'fin_score',
  relationship: 'rel_score',
  delivery: 'del_score',
  advocacy: 'adv_score',
}

// Only what the card reads. Narrower than the table row on purpose: useBoard
// selects exactly these, and a type admitting the whole row would let a future
// edit read a column nothing fetched.
//
// The answers are typed `number | boolean | null` because the four Advocacy
// columns are boolean and the other eighteen are smallint. `false` is an
// ANSWER; only null and absence mean unanswered.
// AMENDED 2026-08-28 during the pre-flight scan. An earlier draft of this plan
// wrote this as an intersection with `Partial<Record<string, number | boolean |
// null>>`. That does not typecheck: the index signature covers `submitted_at`
// and `submitted_by` too, collapsing their types against number|boolean|null,
// and `answeredCount(checkin, ...)` could not be called at all. One index
// signature, admitting string, is the honest shape of a postgrest row.
export type CardCheckin = {
  client_id: number
  submitted_at: string | null
  submitted_by: string | null
  [key: string]: number | boolean | string | null | undefined
}

// One literal, checked against the generated database types by supabase-js, so
// a mistyped column fails `npm run build` rather than arriving at runtime as
// undefined. Built from the rubric so it cannot drift from it -- the previous
// version spelled five pillar names by hand and cardSummary.test.ts existed to
// catch exactly that drift. Now the drift is impossible and the test proves the
// construction instead.
export const CHECKIN_COLUMNS = [
  'client_id',
  'submitted_at',
  'submitted_by',
  ...ALL_QUESTIONS,
  ...BUCKETS.map((bucket) => BUCKET_SCORE_KEY[bucket]),
].join(', ')

// The footer IS the save confirmation -- §6. Better than a toast because it
// survives a reload, which is the check the owner ran on v1 and got no answer
// from. Every branch returns a non-empty sentence.
//
// `advocacyApplies` is a parameter rather than something read off the row: the
// gate lives on the client's start date, not on the check-in, and the view is
// what answers it. Without it this line would say "of 22" for a client whose
// Advocacy questions are not being asked, and the person would hunt for four
// questions that are not on the screen.
export function cardFooter(
  checkin: CardCheckin | null,
  viewerId: string,
  advocacyApplies: boolean,
): string {
  if (!checkin) return 'Not started'

  if (checkin.submitted_at !== null) {
    const who = checkin.submitted_by === viewerId ? 'you' : 'another account manager'
    return `Submitted ${formatSavedAt(checkin.submitted_at)} by ${who}`
  }

  // Iterate the rubric, not the row's own keys. The row also carries
  // client_id, the submitted fields, the six generated bucket scores and — once
  // the rename lands — six legacy_* columns, none of which are answers. This
  // mirrors useCheckin.ts's draftFromRow exactly, including the typeof filter:
  // a `false` is an ANSWER and must survive, which a truthiness check would
  // silently drop. Step 2.5's review proved that filter lethal by mutation.
  const answers: Answers = {}
  for (const key of ALL_QUESTIONS) {
    const value = checkin[key]
    if (typeof value === 'number' || typeof value === 'boolean') answers[key] = value
  }

  const scored = answeredCount(answers, advocacyApplies)
  // A row can exist with notes and no answers. "Draft, 0 of 22" would send the
  // reader looking for scores that were never entered.
  if (scored === 0) return 'Not started'
  return `Draft, ${scored} of ${requiredQuestions(advocacyApplies).length} scored`
}

export function progressLine(submitted: number, total: number): string {
  if (total === 0) return 'No active clients'
  if (submitted === total) return `All ${total} check-ins submitted this month`
  return `${submitted} of ${total} check-ins submitted this month`
}
