import { formatPeriod } from './month.ts'

// The 90-day Advocacy gate, spec §4. This is the second copy of a rule that
// also lives in SQL, as the predicate on public.checkin_scores.advocacy_applies:
//
//   (c.started_on is not null and ch.period >= c.started_on + 90)
//
// Two copies exist because the view can only answer for a check-in that already
// has a row, and this screen has to answer for a month nobody has scored yet --
// which is every month, the first time somebody opens it. tests/gateParity.test.ts
// is the entire mitigation for the duplication: it reads the number out of the
// migration and asserts it is the number below.
export const GATE_DAYS = 90

// Both arguments are YYYY-MM-DD, which is what a Postgres `date` renders as and
// what checkins.period stores. Two such strings compare correctly with `>=` as
// strings, which is why nothing here parses a date to compare one -- a Date
// parsed from a bare YYYY-MM-DD is UTC midnight, and in any western zone its
// local calendar day is the day before, which would move the gate by a day for
// half the year and pass every test written in UTC.
function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  // Date.UTC normalises the month and year rollover, and toISOString reads the
  // same UTC fields back out, so the round trip has no zone in it.
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10)
}

export function advocacyApplies(startedOn: string | null, period: string): boolean {
  // §4.3: a null start date excludes Advocacy. Not "assume they are old enough"
  // -- an unknown tenure scoring a bucket about referrals and case studies would
  // put a number on the board that nobody has grounds for.
  if (startedOn === null) return false
  return period >= addDays(startedOn, GATE_DAYS)
}

// The first period at which the gate opens: day 90, rounded UP to the first of a
// month. §4.2 and the fact the owner most needs -- a client who started on the
// 15th is not gated in on day 90, because a check-in covers a whole month and
// the month containing day 90 began before it.
export function advocacyOpensAt(startedOn: string): string {
  const ninety = addDays(startedOn, GATE_DAYS)
  const [year, month, date] = ninety.split('-').map(Number)
  // Already the first of a month: that month is the answer. Otherwise the next
  // one. Date.UTC handles month 13 rolling into January.
  const first = new Date(Date.UTC(year, month - 1 + (date === 1 ? 0 : 1), 1))
  return first.toISOString().slice(0, 10)
}

export type AdvocacyGate = { open: true } | { open: false; reason: string }

// What the screen says, decided here rather than as a ternary in JSX, for the
// reason clientForm.ts states for its own sentences: what the screen SAYS is a
// decision, and decisions are testable without a browser.
//
// §7: the shut section is shown rather than hidden "so the scorer learns the
// bucket exists", which means the reason has to be worth reading. The two shut
// cases are genuinely different -- one is a missing fact somebody can go and
// enter, the other is a client who is simply new -- and telling them apart is
// the difference between a fixable omission and a wait.
export function advocacyGate(startedOn: string | null, period: string): AdvocacyGate {
  if (advocacyApplies(startedOn, period)) return { open: true }

  if (startedOn === null) {
    return {
      open: false,
      reason:
        'This client has no start date, so Advocacy is not scored and this ' +
        'check-in is scored out of the other 18 questions. Adding the date on ' +
        'the client admin screen opens this section.',
    }
  }

  return {
    open: false,
    reason:
      `This client is still inside their first ${GATE_DAYS} days, so Advocacy ` +
      `is not scored yet and this check-in is scored out of the other 18 ` +
      `questions. It opens with the ${formatPeriod(advocacyOpensAt(startedOn))} ` +
      `check-in — a check-in covers a whole month, so the gate opens with the ` +
      `first month that begins on or after day ${GATE_DAYS}, not on day ` +
      `${GATE_DAYS} itself.`,
  }
}
