import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ALL_QUESTIONS } from '../src/lib/buckets.ts'

const MIGRATIONS = 'supabase/migrations'
const NAME = '20261031090000_ai_suggestion_runs.sql'

// The two answers the tool fills from revenue data; the AI never scores them,
// so the backfilled copy must not carry them (spec §2.1).
const FINANCE_FROM_REVENUE = ['fin_rack_rate', 'fin_rate_increased']

// Derived, not typed out: if a question is added or renamed, this list moves
// with it and the backfill assertion fails rather than going stale.
const AI_KEYS = ALL_QUESTIONS.filter((key: string) => !FINANCE_FROM_REVENUE.includes(key))

function migration(name: string): string {
  const names = readdirSync(MIGRATIONS).filter((entry) => entry === name)
  // Exactly one, or the assertions below could be reading a file nobody meant.
  expect(names, `migration named ${name}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

// Same rationale as tests/suggestedMigration.test.ts: comments name things the
// migration is deliberately not doing, so absence checks must run on SQL only.
function withoutComments(sql: string): string {
  return sql.replaceAll(/--[^\n]*/g, '')
}

// One statement, sliced at its own semicolon, so an assertion cannot pass on
// text from a neighbouring statement.
function statement(sql: string, startsWith: RegExp): string {
  const match = sql.match(new RegExp(`${startsWith.source}[\\s\\S]*?;`, 'i'))
  expect(match, String(startsWith)).not.toBeNull()
  return match![0].replaceAll(/\s+/g, ' ').trim()
}

// A plpgsql body runs to its closing $$, past the semicolons inside it, so
// statement() would stop at the first one. Slice dollar-quote to dollar-quote.
function functionBody(sql: string, name: RegExp): string {
  const match = sql.match(new RegExp(`create function ${name.source}[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`, 'i'))
  expect(match, String(name)).not.toBeNull()
  return match![1].replaceAll(/\s+/g, ' ').trim()
}

describe('the AI suggestion runs migration', () => {
  const sql = withoutComments(migration(NAME))

  it('scores exactly nineteen keys, neither finance-from-revenue key among them', () => {
    expect(AI_KEYS).toHaveLength(19)
  })

  it('adds exactly one nullable jsonb column', () => {
    expect(statement(sql, /alter table public\.checkins/)).toBe(
      'alter table public.checkins add column ai_suggestion jsonb;',
    )
  })

  describe('the backfill', () => {
    const update = () => statement(sql, /update public\.checkins/)

    it('touches only rows still suggested', () => {
      expect(update()).toContain('where suggested_at is not null')
    })

    it('copies the suggestion time, the note and a null run id', () => {
      expect(update()).toContain("'suggested_at', suggested_at")
      expect(update()).toContain("'run_id', null")
      expect(update()).toContain("'notes', notes")
    })

    it.each(AI_KEYS)('copies %s from its own column', (key: string) => {
      expect(update()).toContain(`'${key}', ${key}`)
    })

    it('leaves both finance-from-revenue answers out', () => {
      for (const key of FINANCE_FROM_REVENUE) {
        expect(update()).not.toContain(`'${key}'`)
      }
    })

    it('is the only update of public.checkins', () => {
      expect(sql.match(/update public\.checkins/gi)?.length ?? 0).toBe(1)
    })
  })

  it('allows one requested run per period', () => {
    expect(statement(sql, /create unique index/)).toBe(
      "create unique index ai_runs_one_requested_per_period on public.ai_runs (period) where status = 'requested';",
    )
  })

  it('guards ai_suggestion against the two API roles, on any change', () => {
    const body = functionBody(sql, /private\.guard_ai_suggestion\(\)/)
    expect(body).toContain("current_user in ('authenticated', 'anon')")
    expect(body).toContain('is distinct from old.ai_suggestion')
    expect(body).toContain("errcode = '42501'")
    expect(body).toContain('ai_suggestion is written only by the AI routine')
  })

  it('attaches the guard before insert or update on checkins', () => {
    expect(statement(sql, /create trigger checkins_guard_ai_suggestion/)).toBe(
      'create trigger checkins_guard_ai_suggestion before insert or update on public.checkins for each row execute function private.guard_ai_suggestion();',
    )
  })

  it('lets authenticated read ai_runs through a view_scores policy', () => {
    expect(sql).toMatch(/grant select on public\.ai_runs to authenticated;/i)
    expect(sql).toMatch(/alter table public\.ai_runs enable row level security;/i)
    expect(statement(sql, /create policy ai_runs_select_view_scores/)).toBe(
      "create policy ai_runs_select_view_scores on public.ai_runs for select to authenticated using ((select private.has_capability('view_scores')));",
    )
  })

  it('gives app users no way to write ai_runs', () => {
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*public\.ai_runs/i)
    expect(sql).not.toMatch(/grant [^;]*(insert|update|delete)[^;]*on public\.ai_runs/i)
    // ai_runs gets exactly one policy, the select above.
    expect(sql.match(/create policy [^;]*on public\.ai_runs/gi)?.length ?? 0).toBe(1)
  })

  it('revokes before it grants on ai_runs', () => {
    const revoke = sql.search(/revoke all on public\.ai_runs from anon, authenticated;/i)
    const grant = sql.search(/grant select on public\.ai_runs to authenticated;/i)
    expect(revoke).toBeGreaterThan(-1)
    expect(revoke).toBeLessThan(grant)
  })

  it('exposes can_run_ai_suggestions to authenticated only', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.can_run_ai_suggestions\(\) from public, anon;/i,
    )
    expect(sql).toMatch(
      /grant execute on function public\.can_run_ai_suggestions\(\) to authenticated;/i,
    )
    expect(statement(sql, /create function public\.can_run_ai_suggestions/)).toContain(
      "private.has_capability('edit_scores')",
    )
  })
})
