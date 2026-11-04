import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUCKETS } from '../src/lib/buckets.ts'

// Text-level pins on 20261104150000_bucket_notes_and_focus.sql. They prove what
// the migration TEXT says, not what Postgres does with it. Every assertion runs
// on the migration with comments stripped, and on ONE statement sliced out of
// it, so a comment cannot satisfy a pin and a phrase from one statement cannot
// satisfy a pin on another.
const MIGRATIONS = 'supabase/migrations'
const NAME = '20261104150000_bucket_notes_and_focus.sql'
const FN = 'private.valid_bucket_notes'

function migration(): string {
  const names = readdirSync(MIGRATIONS).filter((entry) => entry === NAME)
  expect(names, `migration named ${NAME}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${NAME}`, 'utf8')
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

// The one CREATE FUNCTION, through its `$$;`.
function fn(sql: string): string {
  const at = sql.indexOf(`create function ${FN}(`)
  expect(at, `create function ${FN}`).toBeGreaterThan(-1)
  const rest = sql.slice(at)
  const open = rest.indexOf('$$')
  expect(open, 'quoted body').toBeGreaterThan(-1)
  return squash(rest.slice(0, rest.indexOf('$$;', open + 2) + 3))
}

describe('the bucket_notes_and_focus migration', () => {
  const sql = withoutComments(migration()).toLowerCase()
  const alters = [...sql.matchAll(/alter table public\.checkins[\s\S]*?;/g)].map((m) => squash(m[0]))
  expect(alters).toHaveLength(2)
  const [columns, constraints] = alters

  it('adds bucket_notes as jsonb not null default {} and focus as nullable text', () => {
    expect(columns).toContain("add column bucket_notes jsonb not null default '{}'::jsonb")
    expect(columns).toMatch(/add column focus text;/)
    expect(columns).not.toMatch(/add column focus text (not null|default)/)
  })

  it('names both constraints and pins their expressions', () => {
    expect(constraints).toContain(
      `add constraint checkins_bucket_notes_valid check (${FN}(bucket_notes))`,
    )
    expect(constraints).toContain(
      'add constraint checkins_focus_length check (focus is null or char_length(focus) between 1 and 1000)',
    )
  })

  describe('the validation function', () => {
    const body = fn(sql)

    it('is immutable, in private, with an empty search_path', () => {
      expect(body).toContain(`create function ${FN}(p jsonb) returns boolean`)
      expect(body).toContain('language sql')
      expect(body).toContain(' immutable ')
      expect(body).toContain("set search_path = ''")
    })

    // A CHECK constraint evaluates the function with the INSERTING role's
    // privileges (ExecInitFunc checks EXECUTE against GetUserId()), so a
    // definer function with execute revoked from authenticated would fail
    // every authenticated insert with "permission denied for function".
    it('is security invoker, not definer, and executable by the roles that write check-ins', () => {
      expect(body).not.toContain('security definer')
      expect(body).toContain('security invoker')
      expect(sql).toContain(`revoke execute on function ${FN}(jsonb) from public, anon;`)
      expect(sql).toContain(`grant execute on function ${FN}(jsonb) to authenticated, service_role;`)
      expect(sql).not.toMatch(/revoke execute on function private\.valid_bucket_notes[^;]*authenticated/)
    })

    it('reads no tables', () => {
      expect(body).not.toMatch(/\b(from|join) (public|private)\./)
    })

    it('names all six bucket keys, and only why and actions as fields', () => {
      const names = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
      for (const bucket of BUCKETS) expect(names, bucket).toContain(bucket)
      const extra = names.filter(
        (n) => !(BUCKETS as readonly string[]).includes(n) && !['why', 'actions', 'object', 'string'].includes(n),
      )
      expect(extra).toEqual([])
      expect(names).toContain('why')
      expect(names).toContain('actions')
    })

    it('limits each string to 1..2000 characters', () => {
      expect(body).toContain('between 1 and 2000')
      expect(body).not.toMatch(/\b(?!2000\b)\d{4,}\b/)
    })

    it('requires objects, rejects an empty bucket object, and guards jsonb_each against non-objects', () => {
      expect(body).toContain("jsonb_typeof(p) = 'object'")
      expect(body).toContain("jsonb_typeof(b.v) <> 'object'")
      expect(body).toContain("b.v = '{}'::jsonb")
      expect(body).toContain("jsonb_typeof(f.fv) <> 'string'")
      expect(body).toContain("case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end")
      expect(body).toContain("case when jsonb_typeof(b.v) = 'object' then b.v else '{}'::jsonb end")
    })
  })
})
