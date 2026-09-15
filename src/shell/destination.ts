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

export type AdminSection = 'people' | 'clients' | 'revenue'

export type Destination =
  | { kind: 'overview' }
  | { kind: 'clients' }
  | { kind: 'revenue' }
  // editClientId is OPTIONAL AND ONLY MEANINGFUL WHEN section is 'clients'.
  // That is precisely the looseness this union was written to avoid -- its
  // comment above asks for each impossible combination to be a compile error.
  // It is the price of opening a client's edit form from their check-in, and
  // the alternatives are recorded in the slice 6l spec section 5: a separate
  // destination kind means two routes to one screen and a menu bar that has to
  // know one of them is not a menu item.
  //
  // An id here is a REQUEST, NOT A PROMISE. ClientsAdmin opens that client if
  // it has them and renders its ordinary list if it does not.
  | { kind: 'admin'; section: AdminSection; editClientId?: number }

export type DestinationKind = Destination['kind']

// Ordered, and the order is the menu bar's reading order. The bar renders from
// this array rather than repeating the four words, the same way ThemeControl
// renders from THEME_PREFERENCES.
//
// `satisfies` rather than a type annotation, so each entry keeps its literal
// kind and the assertion below can see what is actually listed. An annotation
// would widen every `kind` to DestinationKind and the check would be vacuous.
export const DESTINATIONS = [
  { kind: 'overview', label: 'Overview' },
  { kind: 'clients', label: 'Clients' },
  { kind: 'revenue', label: 'Revenue' },
  { kind: 'admin', label: 'Admin' },
] as const satisfies readonly { kind: DestinationKind; label: string }[]

// The other half of the compile-time safety the union is here for. `satisfies`
// only proves every entry is a real destination; it says nothing about a
// destination with no entry, so a fifth variant could be added to Destination,
// handled in openDestination, and simply never appear in the bar -- reachable
// by nothing, with a clean build and a green suite. This resolves to `never` the
// moment a kind is missing, and `true` is not assignable to `never`.
// `void` because the assertion IS the binding's purpose -- nothing reads it at
// runtime, and the line exists only so the compiler has to check the type.
type UnlistedKind = Exclude<DestinationKind, (typeof DESTINATIONS)[number]['kind']>
const _everyKindIsInTheBar: UnlistedKind extends never ? true : never = true
void _everyKindIsInTheBar

// Spec §3.1. Overview is the homepage and will be this value -- but not while it
// is still empty: making an empty page the first thing every person sees on
// every sign-in is a worse tool than the one being replaced. One line to change,
// and destination.test.ts names it so it is changed deliberately.
export const LANDING: Destination = { kind: 'clients' }

// The sections a role can actually reach, in the bar's order. Revenue entry is
// gated on edit_revenue and not on view_revenue, deliberately: an account
// manager can read every figure on the Revenue destination and cannot enter
// one, so showing them the grid would be drawing a control the database will
// refuse.
export function adminSections(role: string): readonly AdminSection[] {
  const sections: AdminSection[] = []
  if (can(role, 'manage_users')) sections.push('people')
  if (can(role, 'manage_clients')) sections.push('clients')
  if (can(role, 'edit_revenue')) sections.push('revenue')
  return sections
}

export function canSeeAdmin(role: string): boolean {
  return adminSections(role).length > 0
}

// Whether a destination appears in the menu bar for this role. Admin was a
// special case in MenuBar's filter -- `entry.kind !== 'admin' || canSeeAdmin`
// -- and Revenue makes it two, at which point the rule belongs beside the
// destinations it is about rather than inside the component that draws them.
// The switch is exhaustive, so a fifth destination stops compiling here until
// somebody decides who can see it, rather than defaulting to everybody.
export function canSeeDestination(kind: DestinationKind, role: string): boolean {
  switch (kind) {
    case 'overview':
    case 'clients':
      return true
    case 'revenue':
      return can(role, 'view_revenue')
    case 'admin':
      return canSeeAdmin(role)
  }
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
      return canSeeDestination('revenue', role) ? { kind: 'revenue' } : null
    case 'admin': {
      // The FIRST section this person can see, never a hardcoded one.
      const [first] = adminSections(role)
      return first ? { kind: 'admin', section: first } : null
    }
  }
}
