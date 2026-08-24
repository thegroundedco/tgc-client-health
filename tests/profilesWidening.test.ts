import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// What this test does and does not do. It pins the text of the second SELECT
// policy on public.profiles and, above all, that this migration is PURELY
// ADDITIVE. It proves nothing about what Postgres returns -- nothing without a
// database can. That is `npm run verify:privileges`, whose sections 10b and 10g
// are what actually read rows as a signed-in subject.
//
// The assertion that matters most is "nothing is dropped". The plausible wrong
// edit here is not a typo in the predicate; it is somebody deciding that a
// widening should REPLACE profiles_select_own rather than sit beside it. That
// would remove an inactive user's ability to read their own row, which
// profiles_update_own needs in order to update it at all.
const MIGRATIONS = 'supabase/migrations'

function migration(suffix: string): string {
  const names = readdirSync(MIGRATIONS).filter((name) => name.endsWith(suffix))
  // Exactly one, or the assertions below could be reading a file nobody meant.
  expect(names, `migrations ending in ${suffix}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

// Assertions about presence, absence and mention run against statements rather
// than prose. This migration's comments discuss profiles_select_own,
// profiles_update_own and dropping at length -- explaining what is deliberately
// NOT being done -- so an assert-absence run against the raw text would trip on
// the explanation. This project has hit that defect three times now.
function withoutComments(sql: string): string {
  return sql.replaceAll(/--[^\n]*/g, '')
}

describe('the profiles widening migration', () => {
  const sql = migration('_widen_profiles_select.sql')
  const statements = withoutComments(sql)

  it('creates the second select policy, scoped to authenticated', () => {
    expect(statements).toContain('create policy profiles_select_active_users')
    expect(statements).toContain('on public.profiles')
    expect(statements).toContain('for select')
    expect(statements).toContain('to authenticated')
  })

  it('gates on view_scores and on nothing else', () => {
    // The capability by name. Regating this on manage_users would make the owner
    // picker empty for everyone but an admin; regating it on a capability that
    // does not exist would make it empty for everyone.
    expect(statements).toContain(
      "using ((select private.has_capability('view_scores')))",
    )

    // Every capability this file names is that one, so a predicate that reached
    // for a second capability cannot pass on the first.
    const named = statements.match(/has_capability\('([a-z_]+)'\)/g) ?? []
    expect(named).toEqual(["has_capability('view_scores')"])
  })

  it('wraps the call in a subselect', () => {
    // So Postgres evaluates it once per statement rather than once per row.
    // Asserted separately from the predicate text because unwrapping it is a
    // silent performance regression, not an error.
    expect(statements).toMatch(/using \(\(select private\.has_capability/)
  })

  it('is purely additive -- nothing is dropped, altered or deleted', () => {
    // The whole design of this step. `alter policy` is in the list because
    // rewriting profiles_select_own in place would be the same mistake wearing a
    // different verb.
    expect(statements).not.toMatch(/\bdrop\b/i)
    expect(statements).not.toMatch(/\balter\b/i)
    expect(statements).not.toMatch(/\bdelete\b/i)
    expect(statements).not.toMatch(/\btruncate\b/i)
    expect(statements).not.toMatch(/\brevoke\b/i)
  })

  it('leaves the two existing profiles policies untouched', () => {
    // They are discussed in the comments on purpose -- the file explains why
    // profiles_select_own survives -- so this asserts about statements only.
    expect(statements).not.toContain('profiles_select_own')
    expect(statements).not.toContain('profiles_update_own')
  })

  it('creates exactly one policy and grants nothing', () => {
    // A grant here would widen the write surface, which is the vulnerability
    // this project shipped with. The table-level select grant already exists in
    // 20260820225355; this migration changes which ROWS come back, not which
    // verbs are reachable.
    expect(statements.match(/create policy/g)).toHaveLength(1)
    expect(statements).not.toMatch(/\bgrant\b/i)
    expect(statements).not.toMatch(/\bcreate (table|index|function)\b/i)
  })
})
