import type { WriteState } from '../clients/clientForm.ts'
import { ROLES } from '../lib/capabilities.ts'

// Every decision the users admin screen makes, with no React and no Supabase
// client in sight -- the src/clients/clientForm.ts pattern, and for the same
// reason: the rules are not ternaries in JSX, and this file has to be importable
// by a test running with no VITE_ env. It must never import ../lib/supabase,
// which reads config at module scope and throws when it is absent.

export type { WriteState }

export type AdminProfile = {
  id: string
  email: string
  full_name: string | null
  // `string`, not Role, because that is what the column is: text with a check
  // constraint. Narrowing here would be a claim this code cannot verify.
  role: string
  is_active: boolean
  updated_at: string
}

export type Invitation = {
  email: string
  role: string
  created_at: string
}

export type InviteDraft = {
  email: string
  role: string
}

// The literal beside the type, so supabase-js infers the row shape from the
// string and a mistyped column fails `npm run build` rather than surfacing at
// runtime as undefined. Same pattern as CLIENT_COLUMNS.
export const PROFILE_COLUMNS = 'id, email, full_name, role, is_active, updated_at'
export const INVITATION_COLUMNS = 'email, role, created_at'

// All three, admin included -- Slice 3 design §7 and the decision recorded in
// §9. Derived from ROLES so a fourth role cannot be offered here without the
// permission model learning it first.
export const ASSIGNABLE_ROLES: readonly string[] = ROLES

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  account_manager: 'Account manager',
  viewer: 'Viewer',
}

export const ROLE_HINTS: Record<string, string> = {
  admin: 'Everything, including managing people and their access.',
  account_manager: 'Scores check-ins and manages the client roster.',
  viewer: 'Reads the board. Changes nothing.',
}

// Hands an unrecognised value straight back, for the same reason statusLabel
// does: a role this screen does not know is a row written outside it, and
// relabelling would hide that rather than surface it.
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

// The check constraint on allowed_emails.email is `email = lower(email)`, so an
// uppercase address is refused by the database. Normalising here means the
// refusal never happens rather than being explained after a round trip.
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export type InviteProblem = { field: 'email' | 'role'; text: string }

// Every problem returned here is one the database would refuse, or one it would
// silently accept and then never act on. The second kind matters most: inviting
// an address that already has a profile succeeds at the database and then sits
// inert forever, because no trigger will fire for it again.
export function inviteProblems(
  draft: InviteDraft,
  profiles: readonly AdminProfile[],
): InviteProblem[] {
  const problems: InviteProblem[] = []
  const email = normalizeEmail(draft.email)

  if (email === '') {
    problems.push({ field: 'email', text: 'An invitation needs an email address.' })
  } else if (profiles.some((profile) => normalizeEmail(profile.email) === email)) {
    problems.push({
      field: 'email',
      text: `${email} already has an account, so an invitation would never be used. Change their role in the people list instead.`,
    })
  }

  if (!ASSIGNABLE_ROLES.includes(draft.role)) {
    problems.push({
      field: 'role',
      text: `"${draft.role}" is not a role this tool knows, so it cannot be invited.`,
    })
  }

  return problems
}

export function invitePayload(draft: InviteDraft) {
  return { email: normalizeEmail(draft.email), role: draft.role }
}

// The guard trigger's two messages, verbatim from
// <generated>_profiles_admin_write_path.sql. Matched as substrings because
// Postgres prefixes nothing to a `raise exception ... using errcode` message,
// but supabase-js may wrap it.
const SELF_EDIT_MESSAGE = 'cannot change your own role or active status'
const NOT_ADMIN_MESSAGE = 'insufficient privilege to change role or is_active'

export const SELF_EDIT_TEXT =
  'You cannot change your own access. That is deliberate: it is what makes it impossible to lock every admin out of the tool. Another admin can change it for you.'

// An UPDATE that matched no row. profiles_update_manage_users is
// `using (...) with check (...)`, so a caller without manage_users has the row
// filtered out by USING rather than raising: zero rows, no error, and PostgREST
// answers PGRST116. Deliberately no invitation to retry -- every retry is
// refused identically.
export const UPDATE_MATCHED_NOTHING_TEXT =
  'That change was not applied, and nothing was changed. The database matched no account to update, which is what happens when the account signed in here is no longer allowed to manage users. Ask another admin.'

// A DELETE that matched no row. allowed_emails_delete_manage_users is
// USING-only, structurally identical to profiles_update_manage_users above: a
// caller without manage_users has the row filtered out rather than raising, so
// this is zero rows and no error, not PGRST116 and not an exception. Unlike the
// update case, though, there is a second, equally real explanation this code
// cannot distinguish from the first: another admin may have already revoked the
// same invitation between this screen's last load and this press. Both leave
// the row gone from the database and neither is a bug, so the text says both
// rather than guessing, and it does not claim a retry is pointless -- reloading
// the list, not "ask another admin", is the honest next step when the cause
// might just be a stale screen.
export const DELETE_MATCHED_NOTHING_TEXT =
  'That invitation was not revoked, and nothing was changed. The database matched no invitation to delete -- either this account is no longer allowed to manage users, or someone else already revoked this same invitation. The list on screen may be out of date; reload it to see which.'

export function writeFailureText(message: string, subject: string): string {
  const tail = ' Nothing was changed.'

  if (message.includes(SELF_EDIT_MESSAGE)) return `${SELF_EDIT_TEXT}${tail}`

  if (message.includes(NOT_ADMIN_MESSAGE)) {
    return `Your account is not allowed to change anyone's access. Ask an admin.${tail}`
  }

  if (message.includes('allowed_emails_pkey')) {
    return `${subject} has already been invited. The existing invitation still works.${tail}`
  }

  if (message.includes('allowed_emails_email_check')) {
    return `That address could not be stored. Addresses are held in lowercase.${tail}`
  }

  if (message.includes('allowed_emails_role_check')) {
    return `That is not a role this tool knows.${tail}`
  }

  if (message.includes('permission denied') || message.includes('row-level security')) {
    return `Your account is not allowed to do that. Ask an admin.${tail}`
  }

  return `${message}.${tail}`
}

// Inactive first: those are the accounts waiting on somebody, and this screen
// exists to unblock them. Then by label, so the order is stable.
export function sortProfiles(rows: readonly AdminProfile[]): AdminProfile[] {
  return [...rows].sort(
    (a, b) =>
      Number(a.is_active) - Number(b.is_active) ||
      a.email.localeCompare(b.email),
  )
}

// Oldest first: an invitation that has been sitting longest is the one most
// likely to have gone astray.
export function sortInvitations(rows: readonly Invitation[]): Invitation[] {
  return [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))
}
