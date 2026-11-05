import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Text-level pins on 20261105140000_project_items_total_guard.sql: what the
// migration TEXT says. What Postgres does with it is `npm run
// verify:line-items` (scripts/verify-line-items.sql) and verify:privileges 9f.
// Comments stripped first; each assertion sliced to its one statement.
const MIGRATIONS = 'supabase/migrations'
const NAME = '20261105140000_project_items_total_guard.sql'
const FN = 'private.check_project_items_total()'

function migration(name: string): string {
  const names = readdirSync(MIGRATIONS).filter((entry) => entry === name)
  expect(names, `migration named ${name}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

const withoutComments = (sql: string) => sql.replaceAll(/--[^\n]*/g, '')
const squash = (sql: string) =>
  sql.replaceAll(/\s+/g, ' ').replaceAll(/\(\s+/g, '(').replaceAll(/\s+\)/g, ')').trim()

function statement(sql: string, start: RegExp): string {
  const found = sql.match(start)
  expect(found, String(start)).not.toBeNull()
  return squash(found![0])
}

const RAW = withoutComments(migration(NAME))
const SQL = RAW.toLowerCase()

describe('the project items total guard', () => {
  const fn = statement(SQL, /create function private\.check_project_items_total\(\)[\s\S]*?\$\$;/)
  const body = fn.slice(fn.indexOf('$$'))

  it('is a private trigger function: definer, empty search_path', () => {
    expect(fn).toContain('returns trigger')
    expect(fn).toContain('language plpgsql')
    expect(fn).toContain('security definer')
    expect(fn).not.toContain('security invoker')
    expect(fn).toContain("set search_path = ''")
    expect(SQL.match(/create (or replace )?function/g)).toHaveLength(1)
  })

  it('revokes execute from public, anon and authenticated, and grants it to no one', () => {
    expect(SQL).toContain(`revoke execute on function ${FN} from public, anon, authenticated;`)
    expect(SQL).not.toMatch(/\bgrant\b/)
  })

  it('checks only months that have items, comparing project_cents with the sum of item cents', () => {
    expect(body).toContain(
      'select count(*), coalesce(sum(i.cents), 0) into v_items, v_sum from public.client_month_project_items i where i.client_id = v_client and i.period = v_period;',
    )
    expect(body).toContain('if v_items > 0 then')
    expect(body).toContain(
      'select r.project_cents into v_project from public.client_month_revenue r where r.client_id = v_client and r.period = v_period;',
    )
    expect(body).toContain('if v_project is distinct from v_sum then')
    // The comparison sits inside the items branch.
    expect(body.indexOf('if v_items > 0 then')).toBeLessThan(body.indexOf('if v_project is distinct from v_sum then'))
  })

  it('judges the OLD month on delete and on update, and the NEW one on insert and update', () => {
    expect(body).toMatch(/if tg_op = 'delete' then v_keys := jsonb_build_array\(jsonb_build_object\('c', old\.client_id, 'p', old\.period\)\);/)
    expect(body).toMatch(
      /elsif tg_op = 'update' then v_keys := jsonb_build_array\(jsonb_build_object\('c', new\.client_id, 'p', new\.period\), jsonb_build_object\('c', old\.client_id, 'p', old\.period\)\);/,
    )
    expect(body).toMatch(/else v_keys := jsonb_build_array\(jsonb_build_object\('c', new\.client_id, 'p', new\.period\)\);/)
    expect(body).toContain('return null;')
  })

  it('refuses with 23514 and the plain-words message', () => {
    const raise = statement(RAW, /raise exception using[\s\S]*?\);/)
    expect(raise).toContain("errcode = '23514'")
    expect(raise).toContain(
      "message = 'This month has project line items; change them in the check-in''s payments box.'",
    )
  })

  const trigger = (name: string) => statement(SQL, new RegExp(`create constraint trigger ${name}\\b[\\s\\S]*?;`))

  it('fires deferred, after insert or update, on client_month_revenue', () => {
    expect(trigger('client_month_revenue_items_total')).toBe(
      `create constraint trigger client_month_revenue_items_total after insert or update on public.client_month_revenue deferrable initially deferred for each row execute function ${FN};`,
    )
  })

  it('fires deferred, after insert, update or delete, on client_month_project_items', () => {
    expect(trigger('client_month_project_items_total')).toBe(
      `create constraint trigger client_month_project_items_total after insert or update or delete on public.client_month_project_items deferrable initially deferred for each row execute function ${FN};`,
    )
  })

  it('creates exactly those two triggers and does not touch the earlier migration', () => {
    expect([...SQL.matchAll(/create (constraint )?trigger ([a-z_]+)/g)].map((m) => m[2]).sort()).toEqual([
      'client_month_project_items_total',
      'client_month_revenue_items_total',
    ])
    expect(SQL).not.toContain('save_month_payment')
  })
})

describe('the verifiers know about the guard', () => {
  const privileges = withoutComments(readFileSync('scripts/verify-privileges.sql', 'utf8')).toLowerCase()
  const lineItems = withoutComments(readFileSync('scripts/verify-line-items.sql', 'utf8'))

  it('verify-privileges 9f: the definer exists and is unreachable, and both deferred triggers exist', () => {
    expect(privileges).toContain(`if to_regprocedure('${FN}') is null then`)
    expect(privileges).toContain(`has_function_privilege('authenticated', to_regprocedure('${FN}'), 'execute')`)
    expect(privileges).toContain("('client_month_revenue', 'client_month_revenue_items_total')")
    expect(privileges).toContain("('client_month_project_items', 'client_month_project_items_total')")
    expect(privileges).toMatch(/and t\.tgdeferrable\s+and t\.tginitdeferred/)
  })

  it('verify-line-items covers the RPC with items, a refused direct update, and clearing with []', () => {
    for (const tag of ['(l1)', '(l2)', '(l3)']) expect(lineItems, tag).toContain(tag)
    expect(lineItems).toContain('perform public.save_month_payment(v_client, per, 400000, 0, false, null, two_items);')
    expect(lineItems).toContain("perform public.save_month_payment(v_client, per, 400000, 999, false, null, '[]'::jsonb);")
    expect(lineItems).toContain('update public.client_month_revenue set project_cents = 100000')
    // Forced immediately, since the block never commits.
    expect(lineItems.match(/set constraints public\.client_month_revenue_items_total, public\.client_month_project_items_total immediate;/g)?.length).toBeGreaterThanOrEqual(4)
    expect(lineItems).toContain("raise exception '%', sentinel;")
  })

  it('has a verify:line-items script shaped like verify:hours', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts['verify:line-items']).toBe(
      pkg.scripts['verify:hours'].replace('scripts/verify-hours.sql', 'scripts/verify-line-items.sql'),
    )
  })
})
