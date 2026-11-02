import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Text-level pins on 20261102120000_client_retainers.sql, the same limit as
// tests/revenueMigration.test.ts: this proves what the migration TEXT says,
// not what Postgres does with it. The comments are stripped before asserting
// absence, so an explanation of what the migration avoids cannot trip a pin.
const MIGRATIONS = 'supabase/migrations'
const NAME = '20261102120000_client_retainers.sql'

function migration(name: string): string {
  const names = readdirSync(MIGRATIONS).filter((entry) => entry === name)
  expect(names, `migration named ${name}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

function withoutComments(sql: string): string {
  return sql.replaceAll(/--[^\n]*/g, '')
}

function statement(sql: string, start: RegExp): string {
  const found = sql.match(start)
  expect(found, String(start)).not.toBeNull()
  return found![0]
}

describe('the client_retainers migration', () => {
  const statements = withoutComments(migration(NAME)).toLowerCase()

  it('revokes from anon and authenticated before granting all four verbs to authenticated', () => {
    const revoked = statements.indexOf('revoke all on public.client_retainers from anon, authenticated')
    const granted = statements.indexOf(
      'grant select, insert, update, delete on public.client_retainers to authenticated',
    )
    expect(revoked, 'the revoke').toBeGreaterThan(-1)
    expect(granted, 'the grant').toBeGreaterThan(-1)
    expect(revoked).toBeLessThan(granted)
  })

  it('enables row level security', () => {
    expect(statements).toContain('alter table public.client_retainers enable row level security')
  })

  it('has exactly four policies', () => {
    expect(statements.match(/create policy/g) ?? []).toHaveLength(4)
  })

  it('pins select to view_revenue', () => {
    const body = statement(statements, /create policy [a-z_]+\s+on public\.client_retainers\s+for select[\s\S]*?;/)
    expect(body).toMatch(/using\s*\(\(select private\.has_capability\('view_revenue'\)\)\)/)
    expect(body).not.toContain('edit_revenue')
  })

  it('pins insert to edit_revenue', () => {
    const body = statement(statements, /create policy [a-z_]+\s+on public\.client_retainers\s+for insert[\s\S]*?;/)
    expect(body).toMatch(/with check\s*\(\(select private\.has_capability\('edit_revenue'\)\)\)/)
    expect(body).not.toContain('view_revenue')
  })

  it('pins update to edit_revenue on both using and with check', () => {
    const body = statement(statements, /create policy [a-z_]+\s+on public\.client_retainers\s+for update[\s\S]*?;/)
    expect(body).toMatch(/using\s*\(\(select private\.has_capability\('edit_revenue'\)\)\)/)
    expect(body).toMatch(/with check\s*\(\(select private\.has_capability\('edit_revenue'\)\)\)/)
    expect(body).not.toContain('view_revenue')
  })

  it('pins delete to edit_revenue', () => {
    const body = statement(statements, /create policy [a-z_]+\s+on public\.client_retainers\s+for delete[\s\S]*?;/)
    expect(body).toMatch(/using\s*\(\(select private\.has_capability\('edit_revenue'\)\)\)/)
    expect(body).not.toContain('view_revenue')
  })

  it('restricts rather than cascades the client foreign key', () => {
    expect(statements).toMatch(/references public\.clients\s*\(id\)\s+on delete restrict/)
    expect(statements).not.toContain('on delete cascade')
  })

  it('wires updated_at to private.touch_updated_at()', () => {
    const body = statement(statements, /create trigger client_retainers_touch_updated_at[\s\S]*?;/)
    expect(body).toContain('before update on public.client_retainers')
    expect(body).toContain('for each row execute function private.touch_updated_at()')
  })

  describe('save_month_payment', () => {
    const fn = statement(statements, /create (or replace )?function public\.save_month_payment[\s\S]*?\$\$;/)

    it('is security invoker with an empty search_path, never definer', () => {
      expect(fn).toContain('security invoker')
      expect(fn).not.toContain('security definer')
      expect(fn).toContain("set search_path = ''")
    })

    it('takes the five documented arguments and returns void', () => {
      expect(fn).toMatch(
        /\(\s*p_client_id\s+bigint,\s*p_period\s+date,\s*p_retainer_cents\s+integer,\s*p_project_cents\s+integer,\s*p_set_retainer\s+boolean\s*\)\s*returns void/,
      )
    })

    it('upserts revenue by (client_id, period) stamping entered_by, in the revenue statement itself', () => {
      const revenue = statement(fn, /insert into public\.client_month_revenue[\s\S]*?;/).replaceAll(/\s+/g, ' ')
      expect(revenue).toMatch(/\(client_id, period, retainer_cents, project_cents, entered_by\)/)
      expect(revenue).toContain('(select auth.uid())')
      expect(revenue).toContain('on conflict (client_id, period) do update')
      expect(revenue).toContain('entered_by = excluded.entered_by')
      expect(revenue).toContain('retainer_cents = excluded.retainer_cents')
      expect(revenue).toContain('project_cents = excluded.project_cents')
    })

    it('upserts the retainer stamping updated_by, in the retainer statement itself', () => {
      const retainer = statement(fn, /insert into public\.client_retainers[\s\S]*?;/).replaceAll(/\s+/g, ' ')
      expect(retainer).toMatch(/\(client_id, monthly_cents, updated_by\)/)
      expect(retainer).toContain('(select auth.uid())')
      expect(retainer).toContain('on conflict (client_id) do update')
      expect(retainer).toContain('monthly_cents = excluded.monthly_cents')
      expect(retainer).toContain('updated_by = excluded.updated_by')
    })

    it('upserts the retainer when positive and deletes it otherwise, in that branch order', () => {
      const gate = fn.indexOf('if p_set_retainer then')
      const positive = fn.indexOf('if p_retainer_cents > 0 then')
      const insert = fn.indexOf('insert into public.client_retainers')
      const otherwise = fn.indexOf('else', positive)
      const del = fn.search(/delete from public\.client_retainers\s+where client_id = p_client_id/)
      for (const [label, at] of Object.entries({ gate, positive, insert, otherwise, del })) {
        expect(at, label).toBeGreaterThan(-1)
      }
      expect(gate).toBeLessThan(positive)
      expect(positive).toBeLessThan(insert)
      expect(insert).toBeLessThan(otherwise)
      expect(otherwise).toBeLessThan(del)
    })

    it('revokes execute from public and anon, and grants it to authenticated', () => {
      const sig = 'public.save_month_payment(bigint, date, integer, integer, boolean)'
      const revoked = statements.indexOf(`revoke execute on function ${sig} from public, anon`)
      const granted = statements.indexOf(`grant execute on function ${sig} to authenticated`)
      expect(revoked, 'the revoke').toBeGreaterThan(-1)
      expect(granted, 'the grant').toBeGreaterThan(-1)
      expect(revoked).toBeLessThan(granted)
    })
  })
})
