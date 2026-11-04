import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  HOURS_OPTIONS,
  HOURS_START_PERIOD,
  overallQuestions,
  questionsFor,
} from '../src/lib/buckets.ts'

// Text-level pins on 20261104120000_productive_hours.sql, the same limit as
// tests/retainersMigration.test.ts: this proves what the migration TEXT says,
// not what Postgres does with it. That is `npm run verify:hours`,
// `verify:score`, `verify:scoring-view` and `verify:privileges` on staging.
//
// Every assertion runs against the migration with its comments stripped, and
// almost every one against ONE statement sliced out of it, so a comment that
// explains what the migration avoids cannot satisfy a pin, and a phrase from
// one statement cannot satisfy a pin on another.
const MIGRATIONS = 'supabase/migrations'
const NAME = '20261104120000_productive_hours.sql'

const TABLES = ['client_productive_projects', 'client_month_budgets', 'client_month_hours_fetch'] as const
const DEFINERS = {
  hours_applies: 'private.hours_applies(bigint, date)',
  set_fin_hours_applies: 'private.set_fin_hours_applies()',
  refresh_fin_hours_applies: 'private.refresh_fin_hours_applies()',
} as const

function migration(name: string): string {
  const names = readdirSync(MIGRATIONS).filter((entry) => entry === name)
  expect(names, `migration named ${name}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

function withoutComments(sql: string): string {
  return sql.replaceAll(/--[^\n]*/g, '')
}

// Collapses whitespace, and drops it just inside parentheses, so a pin does
// not depend on line breaks or indentation.
function squash(sql: string): string {
  return sql
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/\(\s+/g, '(')
    .replaceAll(/\s+\)/g, ')')
    .trim()
}

function statement(sql: string, start: RegExp): string {
  const found = sql.match(start)
  expect(found, String(start)).not.toBeNull()
  return squash(found![0])
}

function statements(sql: string, start: RegExp): string[] {
  return [...sql.matchAll(start)].map((m) => squash(m[0]))
}

// One CREATE FUNCTION, up to the end of its body: `$$;` for a quoted body, or
// the first `;` for a SQL-standard `return ...` body.
function fn(sql: string, qualified: string): string {
  const at = sql.indexOf(`create function ${qualified}(`)
  expect(at, `create function ${qualified}`).toBeGreaterThan(-1)
  const rest = sql.slice(at)
  const quoted = rest.indexOf('$$')
  const firstSemi = rest.indexOf(';')
  const end = quoted > -1 && quoted < firstSemi ? rest.indexOf('$$;', quoted + 2) + 3 : firstSemi + 1
  return squash(rest.slice(0, end))
}

function policies(sql: string, table: string): string[] {
  return statements(sql, new RegExp(`create policy [a-z_]+\\s+on public\\.${table}\\s[\\s\\S]*?;`, 'g'))
}

function dates(text: string): string[] {
  return [...text.matchAll(/'(\d{4}-\d{2}-\d{2})'/g)].map((m) => m[1])
}

// `a + b + c` (with or without a `ch.` prefix) as a sorted list of names.
function terms(sum: string): string[] {
  return sum
    .split('+')
    .map((term) => term.trim().replace(/^ch\./, ''))
    .sort()
}

describe('the productive_hours migration', () => {
  const sql = withoutComments(migration(NAME)).toLowerCase()

  it('revokes then grants on each of the three tables, and enables RLS on each', () => {
    for (const table of TABLES) {
      const revoked = sql.indexOf(`revoke all on public.${table} from anon, authenticated;`)
      const granted = sql.search(new RegExp(`grant [a-z, ]+ on public\\.${table} to authenticated;`))
      expect(revoked, `${table} revoke`).toBeGreaterThan(-1)
      expect(granted, `${table} grant`).toBeGreaterThan(-1)
      expect(revoked, table).toBeLessThan(granted)
      expect(sql, table).toContain(`alter table public.${table} enable row level security;`)
      // Nothing for anon, ever.
      expect(sql, table).not.toMatch(new RegExp(`grant [a-z, ]+ on public\\.${table} to [a-z_, ]*anon`))
    }
  })

  it('lets authenticated insert and delete links only with manage_clients, and never update', () => {
    const grants = statements(sql, /grant [a-z, ]+ on public\.client_productive_projects to authenticated;/g)
    expect(grants).toEqual(['grant select, insert, delete on public.client_productive_projects to authenticated;'])

    const all = policies(sql, 'client_productive_projects')
    expect(all).toHaveLength(3)
    expect(all.filter((p) => / for (update|all) /.test(p))).toEqual([])

    const select = all.filter((p) => p.includes(' for select '))
    expect(select).toHaveLength(1)
    expect(select[0]).toContain(
      "using ((select private.has_capability('view_revenue')) or (select private.has_capability('manage_clients')))",
    )

    const insert = all.filter((p) => p.includes(' for insert '))
    expect(insert).toHaveLength(1)
    expect(insert[0]).toContain("with check ((select private.has_capability('manage_clients')))")
    expect(insert[0]).not.toContain('view_revenue')

    const del = all.filter((p) => p.includes(' for delete '))
    expect(del).toHaveLength(1)
    expect(del[0]).toContain("using ((select private.has_capability('manage_clients')))")
    expect(del[0]).not.toContain('view_revenue')

    for (const p of all) expect(p).toContain(' to authenticated ')
  })

  it('gives authenticated no insert, update or delete on budgets or fetch rows', () => {
    for (const table of ['client_month_budgets', 'client_month_hours_fetch']) {
      const grants = statements(sql, new RegExp(`grant [a-z, ]+ on public\\.${table} to authenticated;`, 'g'))
      expect(grants, table).toEqual([`grant select on public.${table} to authenticated;`])

      const all = policies(sql, table)
      expect(all, table).toHaveLength(1)
      expect(all[0], table).toContain(' for select ')
      expect(all[0], table).toContain(' to authenticated ')
      expect(all[0], table).toContain("using ((select private.has_capability('view_revenue')))")
      expect(all[0], table).not.toContain('manage_clients')
    }
  })

  it('grants execute on record_month_budgets to service_role only', () => {
    const sig = 'public.record_month_budgets(bigint, date, jsonb)'
    const revokes = statements(sql, /revoke execute on function public\.record_month_budgets[^;]*;/g)
    expect(revokes).toEqual([`revoke execute on function ${sig} from public, anon, authenticated;`])
    const grants = statements(sql, /grant execute on function public\.record_month_budgets[^;]*;/g)
    expect(grants).toEqual([`grant execute on function ${sig} to service_role;`])
    expect(sql.indexOf(revokes[0])).toBeLessThan(sql.indexOf(grants[0]))

    const body = fn(sql, 'public.record_month_budgets')
    expect(body).toContain('security invoker')
    expect(body).not.toContain('security definer')
    expect(body).toContain("set search_path = ''")
    expect(body).toMatch(/\(p_client_id bigint, p_period date, p_budgets jsonb\) returns void/)
  })

  it('makes hours_applies and both trigger functions security definer in private with an empty search_path, execute revoked from public, anon, authenticated', () => {
    for (const [name, sig] of Object.entries(DEFINERS)) {
      const body = fn(sql, `private.${name}`)
      expect(body, name).toContain('security definer')
      expect(body, name).not.toContain('security invoker')
      expect(body, name).toContain("set search_path = ''")
      expect(sql, name).toContain(`revoke execute on function ${sig} from public, anon, authenticated;`)
      expect(sql, name).not.toMatch(new RegExp(`grant execute on function private\\.${name}\\b`))
    }
    expect(fn(sql, 'private.hours_applies')).toContain(' stable ')
  })

  it('starts hours on 2026-10-01 in hours_applies and in the refresh', () => {
    const applies = dates(fn(sql, 'private.hours_applies'))
    const refresh = dates(fn(sql, 'private.refresh_fin_hours_applies'))
    const backfill = dates(statement(sql, /update public\.checkins\s+set fin_hours_applies[\s\S]*?;/))
    for (const [label, found] of Object.entries({ applies, refresh, backfill })) {
      expect(found.length, label).toBeGreaterThan(0)
      for (const date of found) expect(date, label).toBe(HOURS_START_PERIOD)
    }
    expect(fn(sql, 'private.hours_applies')).toContain(`p_period >= date '${HOURS_START_PERIOD}'`)
    expect(fn(sql, 'private.refresh_fin_hours_applies')).toContain(`ch.period >= date '${HOURS_START_PERIOD}'`)
  })

  it('constrains fin_hours_in_budget to 1, 2, 3, 5', () => {
    const column = statement(sql, /add column fin_hours_in_budget[\s\S]*?;/)
    const list = column.match(/smallint check \(fin_hours_in_budget in \(([^)]*)\)\)/)
    expect(list, column).not.toBeNull()
    const values = list![1].split(',').map((v) => Number(v.trim()))
    expect(values).toEqual([1, 2, 3, 5])
    expect(values).toEqual(HOURS_OPTIONS.map((o) => o.value).toSorted((a, b) => a - b))
  })

  it('adds fin_hours_applies as not null default false', () => {
    expect(sql).toMatch(/add column fin_hours_applies boolean not null default false\b/)
  })

  it('divides fin_score by 4 only when fin_hours_applies', () => {
    const column = statement(sql, /add column fin_score numeric\(3,2\) generated always as[\s\S]*?\bstored\b/)
    const shape = column.match(
      /\(case when fin_hours_applies then \(([a-z_ +]+)\)::numeric \/ (\d+) else \(([a-z_ +]+)\)::numeric \/ (\d+) end\) stored$/,
    )
    expect(shape, column).not.toBeNull()
    const [, withSum, withDiv, withoutSum, withoutDiv] = shape!
    const withKeys = questionsFor('finances', true).map((q) => q.key)
    const withoutKeys = questionsFor('finances', false).map((q) => q.key)
    expect(terms(withSum)).toEqual([...withKeys].sort())
    expect(Number(withDiv)).toBe(withKeys.length)
    expect(Number(withDiv)).toBe(4)
    expect(terms(withoutSum)).toEqual([...withoutKeys].sort())
    expect(Number(withoutDiv)).toBe(withoutKeys.length)
    expect(Number(withoutDiv)).toBe(3)
  })

  it('divides the overall by 18 only when fin_hours_applies', () => {
    const view = statement(sql, /create view public\.checkin_scores[\s\S]*?;/)
    const shape = view.match(
      /case when ch\.fin_hours_applies then round\(\(([a-z_. +]+)\)::numeric \/ (\d+), 2\) else round\(\(([a-z_. +]+)\)::numeric \/ (\d+), 2\) end as overall_score/,
    )
    expect(shape, view).not.toBeNull()
    const [, withSum, withDiv, withoutSum, withoutDiv] = shape!
    expect(terms(withSum)).toEqual([...overallQuestions(true)].sort())
    expect(Number(withDiv)).toBe(18)
    expect(terms(withoutSum)).toEqual([...overallQuestions(false)].sort())
    expect(Number(withoutDiv)).toBe(17)
  })

  it('recreates checkin_scores with every column it had, security_invoker, and the grant', () => {
    const view = statement(sql, /create view public\.checkin_scores[\s\S]*?;/)
    expect(view).toContain('with (security_invoker = true)')
    const columns = [
      'ch.id,',
      'ch.client_id,',
      'ch.period,',
      'ch.comm_score,',
      'ch.growth_score,',
      'ch.fin_score,',
      'ch.rel_score,',
      'ch.del_score,',
      'ch.adv_score,',
      '(c.started_on is not null and ch.period >= (c.started_on + 90)) as advocacy_applies,',
      'as overall_score from public.checkins ch join public.clients c on c.id = ch.client_id;',
    ]
    let at = -1
    for (const column of columns) {
      const next = view.indexOf(column, at + 1)
      expect(next, column).toBeGreaterThan(at)
      at = next
    }
    const created = sql.indexOf('create view public.checkin_scores')
    const revoked = sql.indexOf('revoke all on public.checkin_scores from anon, authenticated;')
    const granted = sql.indexOf('grant select on public.checkin_scores to authenticated;')
    expect(created).toBeLessThan(revoked)
    expect(revoked).toBeLessThan(granted)
  })

  it('rebuilds in the order drop view, drop fin_score, add columns, add fin_score, view, trigger, backfill', () => {
    const order = [
      'drop view if exists public.checkin_scores;',
      'drop column if exists fin_score;',
      'add column fin_hours_in_budget',
      'add column fin_hours_applies',
      'add column fin_score',
      'create view public.checkin_scores',
      'grant select on public.checkin_scores to authenticated;',
      'create trigger checkins_set_fin_hours_applies',
      'update public.checkins set fin_hours_applies',
    ]
    const flat = squash(sql)
    let at = -1
    for (const step of order) {
      const next = flat.indexOf(step)
      expect(next, step).toBeGreaterThan(at)
      at = next
    }
  })

  it('mirrors rule 1-4 of hoursFromBudgets in hours_applies', () => {
    const body = fn(sql, 'private.hours_applies')
    expect(body).toMatch(
      /return p_period >= date '[\d-]+' and exists \(select 1 from public\.client_productive_projects l where l\.client_id = p_client_id\) and \(not exists \(select 1 from public\.client_month_hours_fetch f where f\.client_id = p_client_id and f\.period = p_period\) or exists \(select 1 from public\.client_month_budgets b where b\.client_id = p_client_id and b\.period = p_period\)\);$/,
    )
  })

  it('sets fin_hours_applies from hours_applies before every insert or update on checkins', () => {
    const body = fn(sql, 'private.set_fin_hours_applies')
    expect(body).toContain('new.fin_hours_applies := private.hours_applies(new.client_id, new.period);')
    expect(body).toContain('return new;')
    const trigger = statement(sql, /create trigger checkins_set_fin_hours_applies[\s\S]*?;/)
    expect(trigger).toBe(
      'create trigger checkins_set_fin_hours_applies before insert or update on public.checkins for each row execute function private.set_fin_hours_applies();',
    )
  })

  it('refreshes after link and fetch changes, touching only fin_hours_applies on rows whose answer changed', () => {
    const body = fn(sql, 'private.refresh_fin_hours_applies')
    const update = statement(body, /update public\.checkins ch[\s\S]*?;/)
    // Only fin_hours_applies is set: never updated_at, suggested_at,
    // submitted_at or ai_suggestion (the migration header says what the touch
    // trigger does to updated_at).
    expect(update).toMatch(/ set fin_hours_applies = private\.hours_applies\(ch\.client_id, ch\.period\) where /)
    expect(update).not.toMatch(/suggested_at|submitted_at|ai_suggestion|updated_at/)
    expect(update).toContain('ch.fin_hours_applies is distinct from private.hours_applies(ch.client_id, ch.period)')
    expect(update).toContain('ch.client_id in (v_old, v_new)')
    expect(body).toContain('return null;')

    for (const table of ['client_productive_projects', 'client_month_hours_fetch']) {
      const trigger = statement(sql, new RegExp(`create trigger ${table}_refresh_fin_hours_applies[\\s\\S]*?;`))
      expect(trigger, table).toBe(
        `create trigger ${table}_refresh_fin_hours_applies after insert or update or delete on public.${table} for each row execute function private.refresh_fin_hours_applies();`,
      )
    }
  })

  it('backfills only rows whose answer changes, so updated_at is not moved on day one', () => {
    const backfill = statement(sql, /update public\.checkins\s+set fin_hours_applies[\s\S]*?;/)
    expect(backfill).toContain('fin_hours_applies is distinct from private.hours_applies(client_id, period)')
  })

  it('saves a month in one call: delete, insert from the jsonb, upsert the fetch stamp', () => {
    const body = fn(sql, 'public.record_month_budgets')
    const del = body.indexOf(
      'delete from public.client_month_budgets where client_id = p_client_id and period = p_period;',
    )
    const insert = body.indexOf('insert into public.client_month_budgets')
    const fetch = body.indexOf(
      'insert into public.client_month_hours_fetch (client_id, period, fetched_at) values (p_client_id, p_period, now()) on conflict (client_id, period) do update set fetched_at = excluded.fetched_at;',
    )
    for (const [label, at] of Object.entries({ del, insert, fetch })) expect(at, label).toBeGreaterThan(-1)
    expect(del).toBeLessThan(insert)
    expect(insert).toBeLessThan(fetch)
    expect(body).toContain(
      'jsonb_to_recordset(p_budgets) as b(productive_deal_id text, productive_project_id text, name text, starts_on date, ends_on date, budgeted_minutes integer, worked_minutes integer)',
    )
  })

  it('keys and checks the tables as specified', () => {
    const links = statement(sql, /create table public\.client_productive_projects[\s\S]*?\);/)
    expect(links).toContain('primary key (client_id, productive_project_id)')
    expect(links).toContain('unique (productive_project_id)')
    const budgets = statement(sql, /create table public\.client_month_budgets[\s\S]*?\);/)
    expect(budgets).toContain('primary key (client_id, period, productive_deal_id)')
    expect(budgets).toContain("check (period = date_trunc('month', period::timestamp)::date)")
    expect(budgets).toMatch(/budgeted_minutes integer not null check \(budgeted_minutes > 0\)/)
    expect(budgets).toMatch(/worked_minutes integer not null check \(worked_minutes >= 0\)/)
    const fetch = statement(sql, /create table public\.client_month_hours_fetch[\s\S]*?\);/)
    expect(fetch).toContain('primary key (client_id, period)')
    expect(fetch).toContain('fetched_at timestamptz not null')
    for (const [table, body] of Object.entries({ links, budgets, fetch })) {
      expect(body, table).toMatch(/references public\.clients\s*\(id\) on delete restrict/)
      expect(body, table).not.toContain('cascade')
    }
  })

  it('adds can_view_revenue as an invoker wrapper over view_revenue, callable by authenticated', () => {
    const body = fn(sql, 'public.can_view_revenue')
    expect(body).toContain('security invoker')
    expect(body).not.toContain('security definer')
    expect(body).toContain("set search_path = ''")
    expect(body).toMatch(/return private\.has_capability\('view_revenue'\);$/)
    const revoked = sql.indexOf('revoke execute on function public.can_view_revenue() from public, anon;')
    const granted = sql.indexOf('grant execute on function public.can_view_revenue() to authenticated;')
    expect(revoked).toBeGreaterThan(-1)
    expect(revoked).toBeLessThan(granted)
  })
})

// The live verifiers can only run against a database (owner-gated), so these
// pin that they at least KNOW about what the migration adds: a policy or grant
// the migration creates and verify:privileges does not list is a verifier that
// fails on its first run, or -- for 10e -- one that cannot notice the policy
// being dropped.
describe('the verifiers know about the productive_hours migration', () => {
  const sql = withoutComments(migration(NAME)).toLowerCase()
  const privileges = withoutComments(readFileSync('scripts/verify-privileges.sql', 'utf8')).toLowerCase()

  it('lists every policy the migration creates in verify-privileges 10e, on its own table', () => {
    const created = [...sql.matchAll(/create policy ([a-z_]+)\s+on public\.([a-z_]+)/g)].map((m) => [m[2], m[1]])
    expect(created).toHaveLength(5)
    for (const [table, policy] of created) {
      expect(privileges, policy).toMatch(new RegExp(`\\('${table}',\\s*'${policy}'\\)`))
    }
  })

  it('allowlists exactly the table grants the migration makes to authenticated, in verify-privileges section 4', () => {
    const granted = [...sql.matchAll(/grant ([a-z, ]+) on public\.([a-z_]+) to authenticated;/g)]
      .filter((m) => (TABLES as readonly string[]).includes(m[2]))
      .flatMap((m) => m[1].split(',').map((verb) => [m[2], verb.trim()]))
    expect(granted).toHaveLength(5)
    for (const [table, verb] of granted) {
      expect(privileges, `${table} ${verb}`).toMatch(new RegExp(`\\('${table}',\\s*'authenticated',\\s*'${verb}'\\)`))
    }
    for (const table of TABLES) {
      const listed = [...privileges.matchAll(new RegExp(`\\('${table}',\\s*'authenticated',\\s*'([a-z]+)'\\)`, 'g'))]
      expect(listed.length, table).toBe(granted.filter(([t]) => t === table).length)
    }
  })

  it('allowlists can_view_revenue for authenticated in section 6, and not record_month_budgets', () => {
    expect(privileges).toContain("('authenticated', 'can_view_revenue()')")
    expect(privileges).not.toContain('record_month_budgets')
  })

  it('has a verify:hours script shaped like verify:ai-runs', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts['verify:hours']).toBe(
      pkg.scripts['verify:ai-runs'].replace('scripts/verify-ai-runs.sql', 'scripts/verify-hours.sql'),
    )
    const verifier = readFileSync('scripts/verify-hours.sql', 'utf8')
    expect(withoutComments(verifier)).toContain("raise exception '%', sentinel;")
  })
})
