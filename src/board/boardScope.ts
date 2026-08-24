import { CLIENT_STATUSES, statusLabel, statusRank } from '../clients/clientForm'

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

// The columns every function here needs, and nothing more. The board's real
// rows are wider; the generic on visibleClients below is what keeps them wide.
export type ScopedClient = { id: number; name: string; status: string }

// The board is the month's check-in grid, so what belongs on it is exactly the
// clients a check-in is expected for. Written as an allowlist of one rather
// than as "not churned": `paused` is neither active nor churned, and step 4's
// STATUS_HINTS already tells the reader a paused client is off the board.
//
// Closed by default. An unrecognised status -- a row written outside this app --
// is archived, not active, because adding an unknown client to the working
// roster would also add it to the count of check-ins owed.
export function isOnBoard(status: string): boolean {
  return status === 'active'
}

export function activeCount(clients: readonly ScopedClient[]): number {
  return clients.filter((client) => isOnBoard(client.status)).length
}

export function archivedCount(clients: readonly ScopedClient[]): number {
  return clients.filter((client) => !isOnBoard(client.status)).length
}

// Generic, so a caller's richer row type survives the filter. The board passes
// rows carrying more than these three fields and needs them back unchanged;
// a signature returning ScopedClient[] would silently narrow them.
export function visibleClients<T extends ScopedClient>(
  clients: readonly T[],
  showArchived: boolean,
): T[] {
  const shown = showArchived ? clients : clients.filter((client) => isOnBoard(client.status))
  // Copied before sorting: the array belongs to the hook's state, React
  // compares by identity, and sorting in place would mutate it.
  return [...shown].sort(
    (a, b) => statusRank(a.status) - statusRank(b.status) || a.name.localeCompare(b.name),
  )
}

// Names the count in both directions, so the control says what pressing it will
// do rather than what state it is in. "Show 3 archived" tells the reader there
// is something to see before they press it -- which is the whole reason the
// board hides them in the first place.
export function toggleLabel(archived: number, showArchived: boolean): string {
  return `${showArchived ? 'Hide' : 'Show'} ${archived} archived`
}

// A check-in can only be written for a client the board considers current.
// This is not belt-and-braces: checkins_insert_edit_scores gates on the
// edit_scores capability and carries NO status predicate, so Postgres would
// accept a check-in for a client who left. Until this step the board never drew
// such a client, so the path did not exist; revealing the cards creates it, and
// this is what closes it.
export function isOpenable(status: string): boolean {
  return isOnBoard(status)
}

// Shown on the card, because a name that is suddenly not a link needs to say
// why. One sentence per reason, and `paused` gets its own: a paused client is
// coming back and a former one is not, so telling the reader they are the same
// thing would be false.
export function notOpenableReason(status: string): string {
  if (status === 'paused') {
    return 'This client is paused, so no check-in is expected this month. Set them active on the client admin screen to score them again.'
  }
  if (CLIENT_STATUSES.includes(status as (typeof CLIENT_STATUSES)[number])) {
    return `This client is ${statusLabel(status).toLowerCase()} and cannot be scored. Their past check-ins are unchanged.`
  }
  // Unreachable through the app -- a check constraint makes an unknown status
  // impossible to write -- but honest rather than reassuring if one ever
  // appears: it says what it found instead of guessing which of the four it is.
  return `This client's status is "${status}", which the board does not recognise, so it cannot be scored.`
}
