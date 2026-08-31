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
// The answers are typed `number | null` because every one of the 21 questions
// is a nullable smallint 1-5, Advocacy's four included (spec §5.2, amended
// 2026-08-31). A 1 is an ANSWER; only null and absence mean unanswered.
// AMENDED 2026-08-28 during the pre-flight scan. An earlier draft of this plan
// wrote this as an intersection with `Partial<Record<string, number | null>>`.
// That does not typecheck: the index signature covers `submitted_at` and
// `submitted_by` too, collapsing their types against number|null, and
// `answeredCount(checkin, ...)` could not be called at all. One index
// signature, admitting string, is the honest shape of a postgrest row.
//
// AMENDED again, task 4 fix round 1: the six bucket score columns are named
// here explicitly, alongside the index signature, rather than left to it.
// TypeScript allows a named property beside an index signature whenever the
// property's type is assignable to the signature's, and `number | null` is --
// so ClientCard.tsx can read `checkin?.[BUCKET_SCORE_KEY[bucket]]` and get
// `number | null` back on its own, with no cast asserting what this type
// already promises.
export type CardCheckin = {
  client_id: number
  submitted_at: string | null
  submitted_by: string | null
  comm_score?: number | null
  growth_score?: number | null
  fin_score?: number | null
  rel_score?: number | null
  del_score?: number | null
  adv_score?: number | null
  [key: string]: number | string | null | undefined
}

// Built from the rubric with .join(', '), so column drift against it is not
// just caught but IMPOSSIBLE -- the previous version spelled five pillar names
// by hand and cardSummary.test.ts existed to catch exactly that drift; now the
// test instead proves the construction. The trade is the compile-time column
// check the hand-spelled literal used to give for free: postgrest-js can only
// parse a select() string into a row type when that string is a literal type,
// and .join(', ') widens this one to plain `string`. cardSummary.test.ts is
// therefore the only thing left pinning these column names -- a mistyped
// column here fails a test, not `npm run build`. The read site in useBoard.ts
// asserts the row type accordingly, with a comment pointing back here.
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
// what answers it. Without it this line would say "of 21" for a client whose
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
  // client_id, the submitted fields, the six generated bucket scores and six
  // legacy_* columns, none of which are answers. This mirrors useCheckin.ts's
  // draftFromRow exactly, including the typeof filter: a 1 is an ANSWER and
  // must survive, which a truthiness check would silently drop. Step 2.5's
  // review proved that filter lethal by mutation.
  const answers: Answers = {}
  for (const key of ALL_QUESTIONS) {
    const value = checkin[key]
    if (typeof value === 'number') answers[key] = value
  }

  const scored = answeredCount(answers, advocacyApplies)
  // A row can exist with notes and no answers. "Draft, 0 of 21" would send the
  // reader looking for scores that were never entered.
  if (scored === 0) return 'Not started'
  return `Draft, ${scored} of ${requiredQuestions(advocacyApplies).length} scored`
}

export function progressLine(submitted: number, total: number): string {
  if (total === 0) return 'No active clients'
  if (submitted === total) return `All ${total} check-ins submitted this month`
  return `${submitted} of ${total} check-ins submitted this month`
}
