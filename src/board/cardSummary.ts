import { PILLARS, scoredCount } from '../lib/score'
import type { Pillar } from '../lib/score'
import { formatSavedAt } from '../lib/month'

// Only the columns the card actually reads. Narrower than the table row on
// purpose: useBoard selects exactly these, and a type that admitted the whole
// row would let a future edit read a column nothing fetched.
export type CardCheckin = {
  total_score: number | null
  submitted_at: string | null
  submitted_by: string | null
} & Partial<Record<Pillar, number | null>>

// The columns that produce a CardCheckin, spelled as one literal beside the
// type rather than in useBoard, for two reasons. supabase-js infers the row
// type from this string, so a literal is checked against the generated database
// types and a mistyped column fails `npm run build` -- a computed string
// degrades the row to untyped and the mistake surfaces at runtime as undefined.
// And it lives here, not in useBoard, because useBoard imports the Supabase
// client, which throws when VITE_ config is absent; CI runs vitest with no
// config, so a test importing useBoard would fail there. This file imports
// nothing but score and month, so the test beside it runs anywhere.
//
// The cost of a literal is that it can drift from PILLARS. cardSummary.test.ts
// pins it: typing from the literal, drift caught by the test.
//
// The five pillars are here because the card draws a bar per pillar, not
// because anything recomputes the total -- the total comes from the generated
// column, which `npm run verify:score` proves agrees with totalScore().
export const CHECKIN_COLUMNS =
  'client_id, total_score, submitted_at, submitted_by, relationship, delivery, financial, sentiment, growth'

// The footer IS the save confirmation -- §6. Better than a toast because it
// survives a reload, which is the check the owner ran on v1 and got no answer
// from. Every branch returns a non-empty sentence; the whole slice exists
// because a screen said nothing.
export function cardFooter(checkin: CardCheckin | null, viewerId: string): string {
  if (!checkin) return 'Not started'

  if (checkin.submitted_at !== null) {
    // "you" or the role, never a name: profiles_select_own makes another
    // person's profile unreadable, so a name here would have to be invented.
    // Recorded in spec §10 item 7.
    const who = checkin.submitted_by === viewerId ? 'you' : 'another account manager'
    return `Submitted ${formatSavedAt(checkin.submitted_at)} by ${who}`
  }

  const scored = scoredCount(checkin)
  // A row can exist with notes and no scores. "Draft, 0 of 5" would send the
  // reader looking for scores that were never entered.
  if (scored === 0) return 'Not started'
  return `Draft, ${scored} of ${PILLARS.length} scored`
}

export function progressLine(submitted: number, total: number): string {
  if (total === 0) return 'No active clients'
  if (submitted === total) return `All ${total} check-ins submitted this month`
  return `${submitted} of ${total} check-ins submitted this month`
}
