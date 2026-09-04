import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// This pins three things about 20260903120000_revenue_has_capability.sql that
// nothing else in the suite touches -- client_month_revenue has zero
// references anywhere else in *.test.ts, and a trigger cannot be exercised
// without a database. That is `npm run verify:privileges`, which becomes
// `authenticated` and exercises the policies for real; this file proves
// nothing about what Postgres does with any of it, only what the migration
// TEXT says, the same limit tests/hasCapability.test.ts documents for the
// migration it pins.
//
// Deliberately narrow. Three things and no more:
//   1. updated_at is wired to private.touch_updated_at() -- without it,
//      updated_at never advances past insert time, which would quietly gut
//      the audit story parent spec section 8.6 claims for this table.
//   2. revoke arrives before grant -- a new table in public is born writable
//      by anon on this project, so the order and not just the presence of
//      the revoke is what closes that.
//   3. there is no `for delete` policy -- that absence, not a policy, is what
//      refuses every delete, so this must fail the moment somebody
//      "helpfully" adds one back.
const MIGRATIONS = 'supabase/migrations'
const REVENUE_MIGRATION = '20260903120000_revenue_has_capability.sql'

function migration(name: string): string {
  const names = readdirSync(MIGRATIONS).filter((entry) => entry === name)
  // Exactly one, or the assertions below could be reading a file nobody meant.
  expect(names, `migration named ${name}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

// Same rationale as tests/hasCapability.test.ts: this migration's comments
// name things it is deliberately NOT doing (no delete policy, no cascade), so
// an assert-absence run against the raw text would trip on the explanation
// rather than on real SQL. That file's header records this project hitting
// exactly that defect twice.
function withoutComments(sql: string): string {
  return sql.replaceAll(/--[^\n]*/g, '')
}

describe('the revenue migration', () => {
  const sql = migration(REVENUE_MIGRATION)
  const statements = withoutComments(sql)

  it('wires updated_at to private.touch_updated_at(), like every other table', () => {
    // profiles (20260820225355), clients and checkins (20260821021840) all do
    // this. Task 6 writes this table by upsert, so a missing trigger would
    // ship looking right -- inserts get a correct updated_at from the column
    // default -- and only fail silently on the first edit.
    const created = statements.match(/create trigger client_month_revenue_touch_updated_at[\s\S]*?;/)
    expect(created, 'create trigger client_month_revenue_touch_updated_at').not.toBeNull()

    const body = created![0]
    expect(body).toContain('before update on public.client_month_revenue')
    expect(body).toContain('for each row execute function private.touch_updated_at()')
  })

  it('revokes from anon and authenticated before granting to authenticated', () => {
    // Order, not just presence. A new table in public on this project is born
    // writable by anon and authenticated -- 20260821021840's own comment
    // documents the fixing migration that had to run for the original two
    // tables -- so a revoke placed after the grant would silently undo
    // nothing and leave the table open.
    const revoked = statements.indexOf('revoke all on public.client_month_revenue from anon, authenticated')
    const granted = statements.indexOf('grant select, insert, update on public.client_month_revenue to authenticated')

    expect(revoked, 'the revoke').toBeGreaterThan(-1)
    expect(granted, 'the grant').toBeGreaterThan(-1)
    expect(revoked).toBeLessThan(granted)
  })

  it('creates no delete policy on client_month_revenue', () => {
    // The absence IS the enforcement: with no policy, Postgres refuses every
    // delete for every role, needing no additional machinery. A policy added
    // here -- even a narrow, well-intentioned one -- reopens what this
    // migration deliberately left closed, and nothing else in this suite
    // would notice.
    expect(statements.toLowerCase()).not.toContain('for delete')
  })

  // The permission boundary this migration adds is that account_manager gets
  // view_revenue but not edit_revenue -- comment lines 22-25 above call that
  // "the owner's decision". Nothing before this pinned the three policies to
  // the capability each is SUPPOSED to name, as opposed to some capability or
  // other: a `with check` quietly rewritten from edit_revenue to view_revenue
  // would make every account manager able to write revenue, and the suite
  // would not notice -- proven by mutation, not assumed.
  it('pins the select policy to view_revenue', () => {
    const created = statements.match(/create policy client_month_revenue_select_view_revenue[\s\S]*?;/)
    expect(created, 'create policy client_month_revenue_select_view_revenue').not.toBeNull()

    const body = created![0]
    expect(body).toContain('for select')
    expect(body).toMatch(/using\s*\(\(select private\.has_capability\('view_revenue'\)\)\)/)
  })

  it('pins the insert policy to edit_revenue, not view_revenue', () => {
    const created = statements.match(/create policy client_month_revenue_insert_edit_revenue[\s\S]*?;/)
    expect(created, 'create policy client_month_revenue_insert_edit_revenue').not.toBeNull()

    const body = created![0]
    expect(body).toContain('for insert')
    expect(body).toMatch(/with check\s*\(\(select private\.has_capability\('edit_revenue'\)\)\)/)
  })

  it('pins the update policy to edit_revenue on both using and with check', () => {
    // Both halves matter: `using` gates which existing rows the statement can
    // even see, `with check` gates what the row is allowed to become. Loosening
    // either one to view_revenue would let an account manager overwrite a row
    // they can already see, which is exactly the boundary this table exists to
    // hold.
    const created = statements.match(/create policy client_month_revenue_update_edit_revenue[\s\S]*?;/)
    expect(created, 'create policy client_month_revenue_update_edit_revenue').not.toBeNull()

    const body = created![0]
    expect(body).toContain('for update')
    expect(body).toMatch(/using\s*\(\(select private\.has_capability\('edit_revenue'\)\)\)/)
    expect(body).toMatch(/with check\s*\(\(select private\.has_capability\('edit_revenue'\)\)\)/)
  })
})
