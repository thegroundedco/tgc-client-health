import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Text-level pins on 20261104170000_project_notes.sql: what the migration TEXT
// says, not what Postgres does with it. Comments are stripped first, and each
// assertion is sliced to the one statement it is about.
const MIGRATIONS = 'supabase/migrations'
const NAME = '20261104170000_project_notes.sql'

function migration(name: string): string {
  const names = readdirSync(MIGRATIONS).filter((entry) => entry === name)
  expect(names, `migration named ${name}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

const withoutComments = (sql: string) => sql.replaceAll(/--[^\n]*/g, '')
const flat = (sql: string) => sql.replaceAll(/\s+/g, ' ')

function statement(sql: string, start: RegExp): string {
  const found = sql.match(start)
  expect(found, String(start)).not.toBeNull()
  return found![0]
}

describe('the project_notes migration', () => {
  const statements = withoutComments(migration(NAME)).toLowerCase()

  it('adds a nullable text column to client_month_revenue with a 1..500 length check', () => {
    const alter = flat(statement(statements, /alter table public\.client_month_revenue\s+add column[\s\S]*?;/))
    expect(alter).toContain('add column project_notes text')
    expect(alter).not.toContain('not null')
    expect(alter).toContain('constraint client_month_revenue_project_notes_length')
    expect(alter).toContain(
      'check (project_notes is null or char_length(project_notes) between 1 and 500)',
    )
  })

  it('adds no policy and no new table grant (the existing ones cover the column)', () => {
    expect(statements).not.toContain('create policy')
    expect(statements).not.toMatch(/grant\s+(select|insert|update|delete|all)/)
  })

  describe('save_month_payment', () => {
    const drop = flat(statement(statements, /drop function[\s\S]*?;/))
    const fn = statement(statements, /create (or replace )?function public\.save_month_payment[\s\S]*?\$\$;/)

    it('drops the old 5-argument overload, and does so before creating the new one', () => {
      expect(drop).toContain(
        'drop function public.save_month_payment(bigint, date, integer, integer, boolean)',
      )
      expect(drop).not.toContain('if exists')
      expect(statements.indexOf('drop function')).toBeLessThan(statements.indexOf('create function'))
      expect(statements.match(/create (or replace )?function public\.save_month_payment/g)).toHaveLength(1)
    })

    it('takes the six arguments, the last defaulting to null, and returns void', () => {
      expect(fn).toMatch(
        /\(\s*p_client_id\s+bigint,\s*p_period\s+date,\s*p_retainer_cents\s+integer,\s*p_project_cents\s+integer,\s*p_set_retainer\s+boolean,\s*p_project_notes\s+text\s+default null\s*\)\s*returns void/,
      )
    })

    it('is security invoker with an empty search_path, never definer', () => {
      expect(fn).toContain('security invoker')
      expect(fn).not.toContain('security definer')
      expect(fn).toContain("set search_path = ''")
    })

    it('writes btrimmed, nullif-blanked notes in the revenue upsert, on insert and on conflict', () => {
      const revenue = flat(statement(fn, /insert into public\.client_month_revenue[\s\S]*?;/))
      expect(revenue).toMatch(/\(client_id, period, retainer_cents, project_cents, project_notes, entered_by\)/)
      expect(revenue).toContain("nullif(btrim(p_project_notes), '')")
      expect(revenue).toContain('project_notes = excluded.project_notes')
      expect(revenue).toContain('entered_by = excluded.entered_by')
      expect(revenue).toContain('on conflict (client_id, period) do update')
    })

    it('revokes execute from public and anon, and grants it to authenticated, on the 6-argument form', () => {
      const sig = 'public.save_month_payment(bigint, date, integer, integer, boolean, text)'
      const revoked = statements.indexOf(`revoke execute on function ${sig} from public, anon`)
      const granted = statements.indexOf(`grant execute on function ${sig} to authenticated`)
      expect(revoked, 'the revoke').toBeGreaterThan(-1)
      expect(granted, 'the grant').toBeGreaterThan(-1)
      expect(revoked).toBeLessThan(granted)
      expect(flat(statements)).toContain(`grant execute on function ${sig} to authenticated;`)
      expect(statements).not.toMatch(/grant[^;]*\banon\b/)
      // Only the drop may name the 5-argument form.
      expect(flat(statements).replace(drop, '')).not.toContain('integer, integer, boolean)')
    })
  })
})
