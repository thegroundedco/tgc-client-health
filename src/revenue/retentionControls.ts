import type { RetentionClient } from './retentionMath'

// The three controls on the Retention section, as data and pure functions.
// Slice 6f-2, deferred from 6f-1 §1.3 until the owner had used real numbers.
//
// Separate from retentionMath because none of this is retention arithmetic:
// retention() already takes any base period (slice 6e added that for the month
// panel) and this module only decides which arguments to hand it. Keeping the
// decisions here means both 6f-1 traps are provable without rendering
// anything.

// The owner's four, longest last so the default sits where the eye ends up.
export const RETENTION_WINDOWS: readonly number[] = [1, 3, 6, 12]

/**
 * The month a window of `months` reaches back to from `anchor`.
 *
 * Arithmetic on the year and month numbers, never a parsed Date: a bare
 * YYYY-MM-DD parses as UTC midnight, whose local calendar day -- and in
 * January its local MONTH -- is the one before in any western zone. The same
 * trap tenureMath documents at length and chartMath avoids the same way.
 *
 * At twelve this must agree exactly with retentionMath.basePeriodFor, which is
 * what the whole app has reported since 6f-1. A disagreement would silently
 * change the number the owner reports upward, so a test pins the pair.
 */
export function baseForWindow(anchor: string, months: number): string {
  const year = Number(anchor.slice(0, 4))
  const month = Number(anchor.slice(5, 7))
  const total = year * 12 + (month - 1) - months
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

// 6f-1 §1.3 trap 1: a selectable window reopens what MIN_RATE_PERIODS closed.
// The answer is a caution rather than a refusal -- slice 6e's month panel
// already prints a ONE-month rate on the owner's approval, and a section that
// refused the figure the panel shows would be two rules for one number.
export const SHORT_WINDOW_MONTHS = 6

export function isShortWindow(months: number): boolean {
  return months < SHORT_WINDOW_MONTHS
}

/**
 * 6f-1 §1.3 trap 2, and the reason this function is NOT called
 * `excludeCancelled`.
 *
 * Excluding every departure removes churn from the churn measure: the only
 * clients left are the ones who stayed, so NRR sits at or above 100% forever
 * and the number becomes decorative. These two codes are the only departures
 * that were not retention failures -- we ended one ourselves, and the other
 * had no work left to retain.
 *
 * `in_housed` is deliberately NOT here. The owner was offered it and declined:
 * a client building an internal team is a competitive loss to most readers,
 * and excluding it reads as flattering to anyone checking the figure.
 *
 * A departure with NO reason recorded is kept. We cannot say it was not a
 * loss, and dropping it would let a data-entry gap improve the number.
 */
export const EXCLUDED_END_REASONS: readonly string[] = ['agency_initiated', 'project_completed']

export function excludeUncontested(
  clients: readonly RetentionClient[],
): readonly RetentionClient[] {
  return clients.filter((client) => {
    // ended_on is what makes somebody a departure. A stale reason code on a
    // live client must not remove them from their own retention figure.
    if (client.ended_on === null) return true
    if (client.end_reason_code === null || client.end_reason_code === undefined) return true
    return !EXCLUDED_END_REASONS.includes(client.end_reason_code)
  })
}
