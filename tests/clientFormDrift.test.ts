import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CLIENT_STATUSES,
  END_REASON_CODES,
  END_REASON_LABELS,
} from '../src/clients/clientForm.ts'

// The screen's vocabularies against the deployed constraints. Two copies of the
// same list exist because a <select> cannot ask Postgres what it permits, and
// this file is the entire mitigation for that -- the same bargain, and the same
// remedy, as src/lib/capabilities.ts and tests/capabilities.test.ts.
//
// What this does NOT prove: that Postgres enforces either list. That is
// `npm run verify:lifecycle`, which reads the live constraint out of
// pg_constraint and evaluates it over all 32 combinations of its inputs.
const MIGRATIONS = 'supabase/migrations'

function migration(suffix: string): string {
  const names = readdirSync(MIGRATIONS).filter((name) => name.endsWith(suffix))
  // Exactly one, or the assertions below could be reading a file nobody meant.
  expect(names, `migrations ending in ${suffix}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

// Pulls the quoted literals out of a check constraint's IN list. Anchored on the
// column name so it cannot pick up a different constraint in the same file.
function inListAfter(sql: string, column: string): string[] {
  const match = sql.match(new RegExp(`${column}\\s+in\\s*\\(([^)]*)\\)`, 'i'))
  expect(match, `an IN list for ${column}`).not.toBeNull()
  return [...(match?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

describe('the screen agrees with the database about statuses', () => {
  const sql = migration('_create_clients_and_checkins.sql')

  it('offers exactly the statuses the check constraint permits', () => {
    const permitted = inListAfter(sql, 'status')
    // A positive count first, so a regex that matched nothing cannot read as
    // agreement. This project has shipped one check that reported success by
    // finding no data.
    expect(permitted.length).toBe(4)
    expect([...CLIENT_STATUSES].sort()).toEqual([...permitted].sort())
  })
})

describe('the screen agrees with the database about end reasons', () => {
  const sql = migration('_add_client_lifecycle.sql')

  it('offers exactly the codes the check constraint permits', () => {
    const permitted = inListAfter(sql, 'end_reason_code')
    expect(permitted.length).toBe(7)
    expect([...END_REASON_CODES].sort()).toEqual([...permitted].sort())
  })

  it('has a label for every code and no label for a code that does not exist', () => {
    expect(Object.keys(END_REASON_LABELS).sort()).toEqual([...END_REASON_CODES].sort())
  })
})
