import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { CAPABILITIES, ROLE_CAPABILITIES, ROLES, can } from '../src/lib/capabilities.ts'
import type { Role } from '../src/lib/capabilities.ts'

// The whole mitigation for the second copy. The presets live in the migration
// AND in capabilities.ts, because the browser cannot ask Postgres on every
// render; this file reads the arrays out of the migration and asserts the two
// copies are the same sets, in both directions.
//
// It does not -- cannot -- prove Postgres agrees with either copy. The migration
// text is the closest thing available without a database, and
// `npm run verify:privileges` is what checks the deployed function.
const MIGRATIONS = 'supabase/migrations'

function migration(suffix: string): string {
  const names = readdirSync(MIGRATIONS).filter((name) => name.endsWith(suffix))
  expect(names, `migrations ending in ${suffix}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

const SQL = migration('_has_capability.sql')

// The case arm for one role, as the migration writes it:
//   when 'admin' then array[
//     'view_scores', 'edit_scores', ...]
// Read out of the CASE rather than out of a hand-kept list, so this test has
// only one source for the SQL side.
function sqlPreset(role: string): string[] | null {
  const arm = SQL.match(new RegExp(`when '${role}' then array\\[([^\\]]*)\\]`, 's'))
  if (arm === null) return null
  return [...arm[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
}

function sqlRoles(): string[] {
  return [...SQL.matchAll(/when '([a-z_]+)' then array\[/g)].map((match) => match[1])
}

describe('the role presets', () => {
  it('offers exactly the four Phase 1 capabilities', () => {
    // Parent spec §7.1. The count as well as the membership: a fifth capability
    // added without thought would pass a membership-only check, and Slice 3's
    // permission overrides are meant to change the FUNCTION BODY, not this list.
    expect([...CAPABILITIES].toSorted()).toEqual([
      'edit_scores',
      'manage_clients',
      'manage_users',
      'view_scores',
    ])
  })

  it.each(['admin', 'account_manager', 'viewer'] as const)(
    '%s holds the same set here as in the migration',
    (role) => {
      const fromSql = sqlPreset(role)
      expect(fromSql, `the ${role} arm of the migration's CASE`).not.toBeNull()
      // Set equality AND length, so a duplicate on one side is not absorbed.
      expect(fromSql!.toSorted()).toEqual([...ROLE_CAPABILITIES[role]].toSorted())
      expect(fromSql!).toHaveLength(ROLE_CAPABILITIES[role].length)
    },
  )

  it('knows the same roles the migration does, in both directions', () => {
    // A fourth role added to either side alone fails here. One-directional would
    // let the SQL grow a role the UI never learns to draw for.
    expect(sqlRoles().toSorted()).toEqual([...ROLES].toSorted())
  })

  it('refuses a viewer edit_scores and allows a viewer view_scores', () => {
    // The specific pair the database got wrong until the has_capability
    // migration: every policy asked only whether the account was active, so a
    // viewer could write check-ins.
    expect(can('viewer', 'edit_scores')).toBe(false)
    expect(can('viewer', 'view_scores')).toBe(true)
  })

  it('gives every role view_scores and only admin manage_users', () => {
    for (const role of ROLES) {
      expect(can(role, 'view_scores'), `${role} view_scores`).toBe(true)
      expect(can(role, 'manage_users'), `${role} manage_users`).toBe(role === 'admin')
    }
  })

  it('answers false for a role it does not know', () => {
    // The UI reads `role` off a profiles row, which is a text column with a
    // check constraint -- so an unknown value is not reachable today, but a
    // lookup that returned undefined would make `can` throw and blank a screen.
    // Closed by default: the same posture as the migration's `else array[]`.
    expect(can('sales' as Role, 'view_scores')).toBe(false)
  })

  // The guard at src/lib/capabilities.ts:52 says an unexpected string must
  // answer "no" rather than throw. Until Slice 2 step 4 the parameter was typed
  // `Role`, so that sentence described behaviour no caller could reach and no
  // test could ask for. The screen passes `profile.role`, which is a text
  // column typed `string`, so the guard is now load-bearing.
  //
  // 'sales' is the same fourth role scripts/verify-capability.sql evaluates the
  // deployed CASE against, so both halves of the model are probed with the same
  // unknown value.
  it('answers no for a role it does not know, rather than throwing', () => {
    for (const capability of CAPABILITIES) {
      expect(can('sales', capability)).toBe(false)
      expect(can('', capability)).toBe(false)
    }
  })
})
