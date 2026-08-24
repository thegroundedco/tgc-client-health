// The role presets, for deciding what to DRAW. Parent spec §7.1.
//
// THIS FILE IS NOT THE ENFORCEMENT, and the distinction is the whole point of
// §7.2: "UI hiding is convenience; the database refusing is the security".
// `can()` decides what a screen renders; the RLS policies decide what actually
// happens when the browser sends a write. A bug here shows a button that fails
// when pressed, which is a usability defect. A bug in the policies is a security
// defect. Never move a check out of the database and into this file.
//
// So why does a second copy exist at all? Because the browser cannot ask
// Postgres on every render, and a screen that shows an account manager the
// user-admin controls and then refuses them is worse than one that never drew
// them. The drift risk that creates is real, and capabilities.test.ts is the
// entire mitigation: it reads the preset arrays out of
// supabase/migrations/*_has_capability.sql and asserts the two copies are the
// same sets, in both directions.
//
// That guard lives in tests/capabilities.test.ts rather than beside this file:
// it needs node:fs to read the migration, and tsconfig.app.json has no node
// types, so a test under src/ that reads the filesystem fails `npm run build`
// while passing `npm test`. Same split, and same reason, as
// src/styles/tokenRules.ts and tests/tokens.test.ts.
//
// Slice 3 adds per-person permission overrides. When it does, it changes the SQL
// function's body and this file's shape -- a person's capabilities stop being a
// pure function of their role -- and the drift guard is what will force both
// halves to be edited together.

export type Capability = 'view_scores' | 'edit_scores' | 'manage_clients' | 'manage_users'

export type Role = 'admin' | 'account_manager' | 'viewer'

// Phase 1's four. Exported so the test can assert the count, not only the
// membership: a fifth capability is a change to the permission model and should
// have to be made in more than one place.
export const CAPABILITIES: readonly Capability[] = [
  'view_scores',
  'edit_scores',
  'manage_clients',
  'manage_users',
]

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  admin: ['view_scores', 'edit_scores', 'manage_clients', 'manage_users'],
  account_manager: ['view_scores', 'edit_scores', 'manage_clients'],
  viewer: ['view_scores'],
}

// Derived, so the roles cannot be listed twice and disagree.
export const ROLES = Object.keys(ROLE_CAPABILITIES) as readonly Role[]

// Closed by default. `role` arrives from a profiles row -- a text column whose
// check constraint makes an unknown value unreachable through the database
// today -- so the parameter is `string` rather than `Role`. That is deliberate,
// and it changed in Slice 2 step 4: `Profile['role']` is `string`
// (src/types/database.ts), so a `Role` parameter meant the only real caller,
// the clients admin screen, could not pass the value it actually holds without
// an assertion at the call site. An assertion there would have moved the lie
// closer to the screen instead of removing it. An unexpected string must answer
// "no" rather than throw on `undefined.includes`, because a throw inside a
// render is how this project's screens go blank.
export function can(role: string, capability: Capability): boolean {
  // Annotated `| undefined` on purpose: `Record<Role, …>` indexed by an
  // asserted key is typed as always-present, which would make the `?.` below
  // read as dead code the next person deletes. The lookup genuinely can miss.
  const preset: readonly Capability[] | undefined = ROLE_CAPABILITIES[role as Role]
  return preset?.includes(capability) ?? false
}
