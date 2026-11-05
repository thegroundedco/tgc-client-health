import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HOURS_START_PERIOD } from '../src/lib/buckets.ts'

// Text-level pins on 20261105120000_hours_scored_by_db.sql (brief 2026-11-05
// A): the database owns whether the hours question applies AND its score.
// Proves what the migration TEXT says; scripts/verify-hours.sql proves what
// Postgres does with it.
//
// Every assertion runs against the migration with its comments stripped, and
// against ONE statement sliced out of it, so a comment cannot satisfy a pin
// and a phrase from one statement cannot satisfy a pin on another.
const MIGRATIONS = 'supabase/migrations'
const NAME = '20261105120000_hours_scored_by_db.sql'

function migration(): string {
  const names = readdirSync(MIGRATIONS).filter((entry) => entry === NAME)
  expect(names, `migration named ${NAME}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

function withoutComments(sql: string): string {
  return sql.replaceAll(/--[^\n]*/g, '')
}

function squash(sql: string): string {
  return sql
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/\(\s+/g, '(')
    .replaceAll(/\s+\)/g, ')')
    .trim()
}

// One CREATE [OR REPLACE] FUNCTION, up to the end of its body: `$$;` for a
// quoted body, or the first `;` for a SQL-standard `return ...` body.
function fn(sql: string, qualified: string): string {
  const at = sql.indexOf(`create or replace function ${qualified}(`)
  const at2 = sql.indexOf(`create function ${qualified}(`)
  const start = at > -1 ? at : at2
  expect(start, `create function ${qualified}`).toBeGreaterThan(-1)
  // Exactly one definition, so a pin cannot pass on a second, dead one.
  const count =
    sql.split(`create or replace function ${qualified}(`).length - 1 + (sql.split(`create function ${qualified}(`).length - 1)
  expect(count, `definitions of ${qualified}`).toBe(1)
  const rest = sql.slice(start)
  const quoted = rest.indexOf('$$')
  const firstSemi = rest.indexOf(';')
  const end = quoted > -1 && quoted < firstSemi ? rest.indexOf('$$;', quoted + 2) + 3 : firstSemi + 1
  return squash(rest.slice(0, end))
}

function statement(sql: string, start: RegExp): string {
  const found = sql.match(start)
  expect(found, String(start)).not.toBeNull()
  return squash(found![0])
}

const sql = withoutComments(migration()).toLowerCase()

describe('the hours_scored_by_db migration', () => {
  describe('private.hours_applies', () => {
    const body = fn(sql, 'private.hours_applies')

    it('starts on HOURS_START_PERIOD and needs a link', () => {
      expect(body).toContain(`return p_period >= date '${HOURS_START_PERIOD}' and `)
      expect(body).toContain(
        'exists (select 1 from public.client_productive_projects l where l.client_id = p_client_id)',
      )
    })

    it('needs a fetch row stamped, in Denver, on or after the 1st of the next month', () => {
      expect(body).toContain(
        "exists (select 1 from public.client_month_hours_fetch f where f.client_id = p_client_id and f.period = p_period and (f.fetched_at at time zone 'america/denver')::date >= (p_period + interval '1 month')::date)",
      )
      // No longer "never fetched counts": the old OR branch is gone.
      expect(body).not.toMatch(/not exists \(select 1 from public\.client_month_hours_fetch/)
    })

    it('needs exactly one budget row', () => {
      expect(body).toContain(
        '(select count(*) from public.client_month_budgets b where b.client_id = p_client_id and b.period = p_period) = 1',
      )
    })

    it('needs that budget to start on the period (not a part-month)', () => {
      expect(body).toContain(
        'exists (select 1 from public.client_month_budgets b where b.client_id = p_client_id and b.period = p_period and b.starts_on = p_period)',
      )
    })

    it('joins every condition with AND, none with OR', () => {
      // Five top-level conditions: period, link, fetch, count, starts_on.
      const top = body.replace(/^.*?return /, '').replace(/;$/, '')
      expect(top).not.toMatch(/\bor\b/)
      let depth = 0
      let ands = 0
      for (let i = 0; i < top.length; i++) {
        if (top[i] === '(') depth++
        else if (top[i] === ')') depth--
        else if (depth === 0 && top.startsWith(' and ', i)) ands++
      }
      expect(ands).toBe(4)
    })
  })

  describe('private.hours_score', () => {
    const body = fn(sql, 'private.hours_score')

    it('returns smallint, and only when hours_applies', () => {
      expect(body).toMatch(/^create (or replace )?function private\.hours_score\(p_client_id bigint, p_period date\) returns smallint /)
      expect(body).toContain('where private.hours_applies(p_client_id, p_period)')
    })

    it('scores worked minus budgeted minutes of the client month', () => {
      expect(body).toContain(
        'select b.worked_minutes - b.budgeted_minutes as diff from public.client_month_budgets b where b.client_id = p_client_id and b.period = p_period',
      )
    })

    it('has the four bands, edges inclusive on the gentle side', () => {
      expect(body).toContain('when d.diff >= -360 and d.diff <= 360 then 5')
      expect(body).toContain('when d.diff >= -480 and d.diff < -360 then 3')
      expect(body).toContain('when (d.diff >= -600 and d.diff < -480) or (d.diff > 360 and d.diff <= 480) then 2')
      expect(body).toContain('else 1')
      // In that order: a case takes the first match.
      const order = ['then 5', 'then 3', 'then 2', 'else 1'].map((s) => body.indexOf(s))
      expect([...order].sort((a, b) => a - b)).toEqual(order)
    })
  })

  it('makes both functions stable security definer with an empty search_path, execute revoked from public, anon, authenticated', () => {
    for (const name of ['hours_applies', 'hours_score']) {
      const body = fn(sql, `private.${name}`)
      expect(body, name).toMatch(/ language sql stable security definer set search_path = '' return /)
      const revoke = statement(sql, new RegExp(`revoke execute on function private\\.${name}\\(bigint, date\\)[^;]*;`))
      expect(revoke, name).toBe(`revoke execute on function private.${name}(bigint, date) from public, anon, authenticated;`)
    }
    for (const name of ['set_fin_hours_applies', 'refresh_fin_hours_applies']) {
      const body = fn(sql, `private.${name}`)
      expect(body, name).toContain("returns trigger language plpgsql security definer set search_path = '' as $$")
      const revoke = statement(sql, new RegExp(`revoke execute on function private\\.${name}\\(\\)[^;]*;`))
      expect(revoke, name).toBe(`revoke execute on function private.${name}() from public, anon, authenticated;`)
    }
    expect(sql).not.toMatch(/grant execute on function private\./)
  })

  it('defines hours_applies before hours_score (a SQL-standard body binds at create time)', () => {
    expect(sql.indexOf('function private.hours_applies(')).toBeLessThan(sql.indexOf('function private.hours_score('))
  })

  it('the BEFORE trigger sets both columns, overriding whatever the caller sent', () => {
    const body = fn(sql, 'private.set_fin_hours_applies')
    expect(body).toContain('new.fin_hours_applies := private.hours_applies(new.client_id, new.period);')
    expect(body).toContain('new.fin_hours_in_budget := private.hours_score(new.client_id, new.period);')
    // Unconditional: no IF guarding the override.
    expect(body).not.toMatch(/\bif\b/)
    expect(body).toContain('return new;')
  })

  it('the refresh updates both columns, only on rows where either would change', () => {
    const body = fn(sql, 'private.refresh_fin_hours_applies')
    const update = statement(body, /update public\.checkins ch[\s\S]*?;/)
    expect(update).toContain(
      'set fin_hours_applies = private.hours_applies(ch.client_id, ch.period), fin_hours_in_budget = private.hours_score(ch.client_id, ch.period) where ',
    )
    expect(update).toContain('ch.client_id in (v_old, v_new)')
    expect(update).toContain(`ch.period >= date '${HOURS_START_PERIOD}'`)
    expect(update).toContain(
      '(ch.fin_hours_applies is distinct from private.hours_applies(ch.client_id, ch.period) or ch.fin_hours_in_budget is distinct from private.hours_score(ch.client_id, ch.period))',
    )
    expect(update).not.toMatch(/suggested_at|submitted_at|ai_suggestion|updated_at/)
    expect(body).toContain('return null;')
  })

  it('backfills both columns from the start month, only where either would change', () => {
    const backfill = statement(sql, /update public\.checkins\s+set fin_hours_applies[\s\S]*?;/)
    expect(backfill).toBe(
      `update public.checkins set fin_hours_applies = private.hours_applies(client_id, period), fin_hours_in_budget = private.hours_score(client_id, period) where period >= date '${HOURS_START_PERIOD}' and (fin_hours_applies is distinct from private.hours_applies(client_id, period) or fin_hours_in_budget is distinct from private.hours_score(client_id, period));`,
    )
    // After every function it calls is in place.
    const at = sql.search(/update public\.checkins\s+set fin_hours_applies/)
    expect(at).toBeGreaterThan(sql.indexOf('function private.refresh_fin_hours_applies('))
  })

  it('adds no trigger on client_month_budgets (record_month_budgets writes the fetch row last)', () => {
    expect(sql).not.toMatch(/create trigger[^;]*on public\.client_month_budgets/)
    // And the header says why.
    expect(migration()).toMatch(/record_month_budgets[\s\S]*fetch[\s\S]*last/i)
  })
})

describe('the verifiers know about hours_score', () => {
  const hours = withoutComments(readFileSync('scripts/verify-hours.sql', 'utf8'))
  const privileges = withoutComments(readFileSync('scripts/verify-privileges.sql', 'utf8')).toLowerCase()

  it('verify-hours probes a finished single budget, two budgets, a part-month, a mid-month fetch and an app write of 5', () => {
    for (const tag of ['(s1)', '(s2)', '(s3)', '(s4)', '(s5)']) expect(hours, tag).toContain(tag)
    // (s5) as the account manager, on a row that applies and one that does not:
    // both updates sit between becoming authenticated and resetting the role.
    const oct = hours.indexOf('update public.checkins set fin_hours_in_budget = 5 where id = v_oct;')
    const sep = hours.indexOf('update public.checkins set fin_hours_in_budget = 5 where id = v_sep;')
    expect(oct).toBeGreaterThan(-1)
    expect(sep).toBeGreaterThan(oct)
    const role = hours.lastIndexOf('set local role authenticated;', oct)
    expect(role).toBeGreaterThan(-1)
    expect(hours.slice(role, oct)).not.toContain('reset role;')
    expect(hours.slice(oct, sep)).not.toContain('reset role;')
    expect(hours).toContain("'starts_on', '2026-10-15'")
    expect(hours).toMatch(/fetched_at = '2026-10-2\d/)
  })

  it('verify-privileges names hours_score as existing and unreachable', () => {
    const block = privileges.slice(privileges.indexOf('for r in', privileges.indexOf("'private.hours_score(bigint,date)'") - 200))
    expect(block).toMatch(
      /unnest\(array\['private\.hours_applies\(bigint,date\)', 'private\.hours_score\(bigint,date\)'\]\) sig\s+loop\s+if to_regprocedure\(r\.sig\) is null then[\s\S]*?elsif has_function_privilege\('anon', to_regprocedure\(r\.sig\), 'execute'\)\s+or has_function_privilege\('authenticated', to_regprocedure\(r\.sig\), 'execute'\) then/,
    )
  })
})
