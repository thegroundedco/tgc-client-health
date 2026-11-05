import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Text-level pins on 20261105130000_project_line_items.sql: what the migration
// TEXT says, not what Postgres does with it (that is verify:privileges on
// staging). Comments are stripped first, and each assertion is sliced to the
// one statement it is about, so a comment that names what the migration avoids
// cannot satisfy a pin, and a phrase from one statement cannot satisfy another.
const MIGRATIONS = 'supabase/migrations'
const NAME = '20261105130000_project_line_items.sql'
const TABLE = 'client_month_project_items'
const SIG7 = 'public.save_month_payment(bigint, date, integer, integer, boolean, text, jsonb)'
const SIG6 = 'public.save_month_payment(bigint, date, integer, integer, boolean, text)'

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

const SQL = withoutComments(migration(NAME)).toLowerCase()

describe('the project line items table', () => {
  const create = statement(SQL, new RegExp(`create table public\\.${TABLE}\\s*\\([\\s\\S]*?\\n\\);`))

  it('has the columns, types and checks the brief names', () => {
    expect(create).toContain('id bigint generated always as identity primary key')
    expect(create).toContain('client_id bigint not null')
    expect(create).toMatch(/period date not null check \(period = date_trunc\('month', period\)::date\)/)
    expect(create).toMatch(/label text not null check \(char_length\(btrim\(label\)\) between 1 and 120\)/)
    expect(create).toMatch(/cents integer not null check \(cents > 0\)/)
    expect(create).toContain('position smallint not null default 0')
    expect(create).toContain('created_at timestamptz not null default now()')
  })

  it('references clients on delete restrict, never cascade', () => {
    expect(create).toMatch(/foreign key \(client_id\) references public\.clients\(id\) on delete restrict/)
    expect(create).not.toContain('cascade')
  })

  it('is indexed on (client_id, period)', () => {
    expect(squash(SQL)).toMatch(new RegExp(`create index [a-z_]+ on public\\.${TABLE} \\(client_id, period\\);`))
  })

  it('revokes from anon and authenticated before granting the four verbs to authenticated', () => {
    const revoke = SQL.indexOf(`revoke all on public.${TABLE} from anon, authenticated;`)
    const grant = SQL.indexOf(`grant select, insert, update, delete on public.${TABLE} to authenticated;`)
    expect(revoke).toBeGreaterThan(-1)
    expect(grant).toBeGreaterThan(revoke)
    expect(SQL).not.toMatch(/grant[^;]*\banon\b/)
  })

  it('enables row level security, and does not force it', () => {
    expect(SQL).toContain(`alter table public.${TABLE} enable row level security;`)
    expect(SQL).not.toContain('force row level security')
  })

  const policy = (name: string) => statement(SQL, new RegExp(`create policy ${name}\\b[\\s\\S]*?;`))

  it('reads with view_revenue', () => {
    const select = policy(`${TABLE}_select_view_revenue`)
    expect(select).toContain(`on public.${TABLE} for select to authenticated`)
    expect(select).toContain("using ((select private.has_capability('view_revenue')))")
    expect(select).not.toContain('edit_revenue')
  })

  it('writes with edit_revenue: insert, update and delete', () => {
    const insert = policy(`${TABLE}_insert_edit_revenue`)
    expect(insert).toContain('for insert to authenticated')
    expect(insert).toContain("with check ((select private.has_capability('edit_revenue')))")
    const update = policy(`${TABLE}_update_edit_revenue`)
    expect(update).toContain('for update to authenticated')
    expect(update).toContain("using ((select private.has_capability('edit_revenue')))")
    expect(update).toContain("with check ((select private.has_capability('edit_revenue')))")
    const del = policy(`${TABLE}_delete_edit_revenue`)
    expect(del).toContain('for delete to authenticated')
    expect(del).toContain("using ((select private.has_capability('edit_revenue')))")
    for (const body of [insert, update, del]) expect(body).not.toContain('view_revenue')
  })

  it('creates exactly those four policies', () => {
    expect([...SQL.matchAll(/create policy ([a-z_]+)/g)].map((m) => m[1]).sort()).toEqual(
      [
        `${TABLE}_delete_edit_revenue`,
        `${TABLE}_insert_edit_revenue`,
        `${TABLE}_select_view_revenue`,
        `${TABLE}_update_edit_revenue`,
      ].sort(),
    )
  })
})

describe('save_month_payment with line items', () => {
  const drop = statement(SQL, /drop function[\s\S]*?;/)
  const fn = statement(SQL, /create (or replace )?function public\.save_month_payment[\s\S]*?\$\$;/)
  const body = fn.slice(fn.indexOf('$$'))

  it('drops the 6-argument overload before creating the 7-argument one', () => {
    expect(drop).toBe(`drop function ${SIG6};`)
    expect(SQL.indexOf('drop function')).toBeLessThan(SQL.indexOf('create function public.save_month_payment'))
    expect(SQL.match(/create (or replace )?function public\.save_month_payment/g)).toHaveLength(1)
  })

  it('takes seven arguments, the last two defaulting to null, and returns void', () => {
    expect(fn).toMatch(
      /\(p_client_id bigint, p_period date, p_retainer_cents integer, p_project_cents integer, p_set_retainer boolean, p_project_notes text default null, p_items jsonb default null\) returns void/,
    )
  })

  it('is security invoker with an empty search_path, never definer', () => {
    expect(fn).toContain('security invoker')
    expect(fn).not.toContain('security definer')
    expect(fn).toContain("set search_path = ''")
  })

  it('takes project_cents from the items when there are items, and from p_project_cents when not', () => {
    expect(body).toMatch(
      /select coalesce\(sum\(x\.cents\), 0\) into v_project_cents from jsonb_to_recordset\(p_items\) as x\(label text, cents integer\);/,
    )
    // The sum replaces p_project_cents only inside the items branch.
    const branch = body.slice(body.indexOf('if p_items is not null then'))
    expect(body.indexOf('v_project_cents := p_project_cents;')).toBeGreaterThan(-1)
    expect(body.indexOf('v_project_cents := p_project_cents;')).toBeLessThan(body.indexOf('if p_items is not null then'))
    expect(branch.indexOf('coalesce(sum(x.cents), 0)')).toBeGreaterThan(-1)
  })

  it('upserts the revenue row with the computed project amount, notes as before', () => {
    const revenue = statement(body, /insert into public\.client_month_revenue[\s\S]*?;/)
    expect(revenue).toContain('(client_id, period, retainer_cents, project_cents, project_notes, entered_by)')
    expect(revenue).toContain("values (p_client_id, p_period, p_retainer_cents, v_project_cents, nullif(btrim(p_project_notes), ''), (select auth.uid()))")
    expect(revenue).toContain('on conflict (client_id, period) do update')
    expect(revenue).toContain('project_cents = excluded.project_cents')
    expect(revenue).toContain('project_notes = excluded.project_notes')
    expect(revenue).toContain('retainer_cents = excluded.retainer_cents')
  })

  it("replaces the month's items: delete, then insert in array order", () => {
    const branch = body.slice(body.indexOf('if p_items is not null then'))
    const del = statement(branch, new RegExp(`delete from public\\.${TABLE}[\\s\\S]*?;`))
    expect(del).toBe(`delete from public.${TABLE} where client_id = p_client_id and period = p_period;`)
    const ins = statement(branch, new RegExp(`insert into public\\.${TABLE}[\\s\\S]*?;`))
    expect(ins).toContain('(client_id, period, label, cents, position)')
    expect(ins).toContain('select p_client_id, p_period, btrim(x.label), x.cents, (x.ord - 1)::smallint')
    expect(ins).toContain('from rows from (jsonb_to_recordset(p_items) as (label text, cents integer)) with ordinality as x(label, cents, ord)')
    expect(branch.indexOf(`delete from public.${TABLE}`)).toBeLessThan(branch.indexOf(`insert into public.${TABLE}`))
    // The replace runs right after the revenue upsert, and only when p_items is given.
    expect(body).toContain(
      `entered_by = excluded.entered_by; if p_items is not null then delete from public.${TABLE} where`,
    )
    expect(body.match(/if p_items is not null then/g)).toHaveLength(2)
    // Items are touched only when p_items is given: no delete outside the branch.
    expect(body.slice(0, body.indexOf('if p_items is not null then'))).not.toContain(TABLE)
  })

  it('keeps the retainer branch exactly as before', () => {
    expect(body).toContain('if p_set_retainer then')
    expect(body).toContain('insert into public.client_retainers (client_id, monthly_cents, updated_by)')
    expect(body).toContain('delete from public.client_retainers where client_id = p_client_id;')
  })

  it('revokes from public and anon, then grants to authenticated, on the 7-argument form only', () => {
    const revoked = SQL.indexOf(`revoke execute on function ${SIG7} from public, anon;`)
    const granted = SQL.indexOf(`grant execute on function ${SIG7} to authenticated;`)
    expect(revoked).toBeGreaterThan(-1)
    expect(granted).toBeGreaterThan(revoked)
    // Only the drop may name the 6-argument form.
    expect(squash(SQL).replace(drop, '')).not.toContain('boolean, text)')
  })
})

describe('the verifiers know about the line items migration', () => {
  const privileges = withoutComments(readFileSync('scripts/verify-privileges.sql', 'utf8')).toLowerCase()

  it('lists every policy the migration creates in verify-privileges 10e', () => {
    const created = [...SQL.matchAll(/create policy ([a-z_]+)\s+on public\.([a-z_]+)/g)].map((m) => [m[2], m[1]])
    expect(created).toHaveLength(4)
    for (const [table, name] of created) {
      expect(privileges, name).toMatch(new RegExp(`\\('${table}',\\s*'${name}'\\)`))
    }
  })

  it('allowlists exactly the four table grants', () => {
    const listed = [...privileges.matchAll(new RegExp(`\\('${TABLE}',\\s*'authenticated',\\s*'([a-z]+)'\\)`, 'g'))]
      .map((m) => m[1])
      .sort()
    expect(listed).toEqual(['delete', 'insert', 'select', 'update'])
  })

  it('allowlists the 7-argument save_month_payment, and not the 6-argument one', () => {
    expect(privileges).toContain("('authenticated', 'save_month_payment(bigint,date,integer,integer,boolean,text,jsonb)')")
    expect(privileges).not.toContain("'save_month_payment(bigint,date,integer,integer,boolean,text)'")
  })
})
