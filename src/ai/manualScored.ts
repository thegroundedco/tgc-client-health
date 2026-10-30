import type { CardCheckin } from '../board/cardSummary'

// Members of the month whose check-in exists and was not AI-suggested, i.e.
// somebody scored them by hand. A run would overwrite exactly these.
export function manualScored(members: Set<number>, checkins: Map<number, CardCheckin>): Set<number> {
  const out = new Set<number>()
  for (const id of members) {
    const checkin = checkins.get(id)
    if (checkin && checkin.suggested_at === null) out.add(id)
  }
  return out
}
