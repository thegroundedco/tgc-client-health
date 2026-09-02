import { can } from '../lib/capabilities'

// What a signed-in, ACTIVE person is looking at. Deliberately not the same
// question as src/appState.ts's AppState, which decides what the APP is showing
// -- loading, signed out, pending, a database error, or this. Merging them would
// put "cannot reach the database" and "the revenue page" in one union, and they
// are not alternatives to each other.
//
// A union rather than the booleans this replaces. Board.tsx held five useState
// values and rendered through a sequence of early returns, so the ORDER of
// those returns was what resolved a conflict: showingClients and showingUsers
// could both be true and one silently won. Three booleans represent eight
// states, most of them nonsense, and a fourth destination would have made it
// sixteen. Here each impossible combination is a compile error instead.

export type AdminSection = 'people' | 'clients'

export type Destination =
  | { kind: 'overview' }
  | { kind: 'clients' }
  | { kind: 'revenue' }
  | { kind: 'admin'; section: AdminSection }

export type DestinationKind = Destination['kind']

// Ordered, and the order is the menu bar's reading order. The bar renders from
// this array rather than repeating the four words, the same way ThemeControl
// renders from THEME_PREFERENCES.
export const DESTINATIONS: readonly { kind: DestinationKind; label: string }[] = [
  { kind: 'overview', label: 'Overview' },
  { kind: 'clients', label: 'Clients' },
  { kind: 'revenue', label: 'Revenue' },
  { kind: 'admin', label: 'Admin' },
]

// Spec §3.1. Overview is the homepage and will be this value -- but not while it
// is still empty: making an empty page the first thing every person sees on
// every sign-in is a worse tool than the one being replaced. One line to change,
// and destination.test.ts names it so it is changed deliberately.
export const LANDING: Destination = { kind: 'clients' }

// The sections a role can actually reach, in the bar's order. Admin holds all
// four capabilities; account_manager holds everything EXCEPT manage_users;
// viewer holds only view_scores. So an account manager gets one section here,
// which is the case everything below exists to handle.
export function adminSections(role: string): readonly AdminSection[] {
  const sections: AdminSection[] = []
  if (can(role, 'manage_users')) sections.push('people')
  if (can(role, 'manage_clients')) sections.push('clients')
  return sections
}

export function canSeeAdmin(role: string): boolean {
  return adminSections(role).length > 0
}

// Null means "this person cannot go there", which the caller must treat as the
// press doing nothing rather than as an error. Returning a Destination anyway
// and letting the screen render empty is the failure this exists to prevent.
export function openDestination(
  kind: DestinationKind,
  role: string,
): Destination | null {
  switch (kind) {
    case 'overview':
      return { kind: 'overview' }
    case 'clients':
      return { kind: 'clients' }
    case 'revenue':
      return { kind: 'revenue' }
    case 'admin': {
      // The FIRST section this person can see, never a hardcoded one.
      const [first] = adminSections(role)
      return first ? { kind: 'admin', section: first } : null
    }
  }
}
