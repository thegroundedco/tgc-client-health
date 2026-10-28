import { CLIENT_STATUSES, statusLabel, statusRank } from '../clients/clientForm'
import type { ClientStatus } from '../clients/clientForm'
import { formatDay, formatPeriod, lastDayOf } from '../lib/month'

// Every decision the show-archived toggle implies, with no React and no
// Supabase client. Slice 2 step 5.
//
// The status vocabulary is IMPORTED rather than re-declared. There are already
// two copies of it -- the check constraint on public.clients and the array in
// clientForm.ts -- and tests/clientFormDrift.test.ts is what keeps those two
// in agreement. A third copy here would be outside that guard, so a fifth
// status arriving later would reach the board without anything failing.
//
// This module cannot import ../lib/supabase, and that is load-bearing rather
// than tidy: the client reads its config at module scope and THROWS when VITE_
// env is absent, and CI runs vitest with no VITE_ env at all.

// The columns every function here needs. ended_on joins started_on because the
// board is a MONTH's check-in grid, and which month a client belongs to is a
// question about their dates, not about their status today. Spec §2.
export type ScopedClient = {
  id: number
  name: string
  status: string
  started_on: string | null
  ended_on: string | null
}

function isKnownStatus(status: string): status is ClientStatus {
  return CLIENT_STATUSES.includes(status as ClientStatus)
}

// Spec §2. A client is on the board for a month when they have a check-in for
// it, or were a current client in it. Dates are compared as YYYY-MM-DD strings,
// which sort the same way the dates do.
//
// Rule 1 comes first and wins outright: a month's recorded work is never hidden
// by what happened after it -- a client paused in October still shows in the
// September they were scored in.
//
// A null start date counts as started. Sno-Go has none, and a missing date must
// not hide a client who is being scored. Closed by default on an unknown
// status, as before: a row written outside this app does not join the count of
// check-ins owed.
export function isOnBoardFor(client: ScopedClient, period: string, hasCheckin: boolean): boolean {
  if (hasCheckin) return true
  if (!isKnownStatus(client.status)) return false
  if (client.status === 'paused') return false
  if (client.started_on !== null && client.started_on > lastDayOf(period)) return false
  if (client.ended_on !== null && client.ended_on < period) return false
  return true
}

// The set every board consumer reads, computed once. The VALUE in `checkins` is
// never inspected: a saved draft is a check-in as much as a submitted one.
export function boardMembers(
  clients: readonly ScopedClient[],
  period: string,
  checkins: ReadonlyMap<number, unknown>,
): Set<number> {
  const members = new Set<number>()
  for (const client of clients) {
    if (isOnBoardFor(client, period, checkins.has(client.id))) members.add(client.id)
  }
  return members
}

export function archivedCount(clients: readonly ScopedClient[], members: ReadonlySet<number>): number {
  return clients.filter((client) => !members.has(client.id)).length
}

// Members first, then status rank, then name. A cancelled client still in their
// final month is a member and sorts with the month's work, after the active
// ones; everything behind the toggle follows.
export function visibleClients<T extends ScopedClient>(
  clients: readonly T[],
  members: ReadonlySet<number>,
  showArchived: boolean,
): T[] {
  const shown = showArchived ? clients : clients.filter((client) => members.has(client.id))
  const memberRank = (client: T) => (members.has(client.id) ? 0 : 1)
  // Copied before sorting: the array belongs to the hook's state.
  return [...shown].sort(
    (a, b) =>
      memberRank(a) - memberRank(b) ||
      statusRank(a.status) - statusRank(b.status) ||
      a.name.localeCompare(b.name),
  )
}

// Shown on a card that cannot be opened for this month. Only ever called for a
// non-member, so every branch is a reason the RULE gave, checked in the rule's
// own order.
export function notOpenableReason(client: ScopedClient, period: string): string {
  const month = formatPeriod(period)
  if (!isKnownStatus(client.status)) {
    return `This client's status is "${client.status}", which the board does not recognise, so it cannot be scored.`
  }
  if (client.status === 'paused') {
    return 'This client is paused, so no check-in is expected this month. Set them active on the client admin screen to score them again.'
  }
  if (client.started_on !== null && client.started_on > lastDayOf(period)) {
    return `This client starts on ${formatDay(client.started_on)}, after ${month}, so there is nothing to score yet.`
  }
  if (client.ended_on !== null && client.ended_on < period) {
    return `This client is ${statusLabel(client.status).toLowerCase()} and ended on ${formatDay(client.ended_on)}, before ${month}. Their past check-ins are unchanged.`
  }
  return `This client is not being scored for ${month}.`
}

// Names the count in both directions, so the control says what pressing it will
// do rather than what state it is in. "Show 3 archived" tells the reader there
// is something to see before they press it -- which is the whole reason the
// board hides them in the first place.
export function toggleLabel(archived: number, showArchived: boolean): string {
  return `${showArchived ? 'Hide' : 'Show'} ${archived} archived`
}
