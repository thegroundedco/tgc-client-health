import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Postgres silently truncates identifiers to 63 bytes (NAMEDATALEN - 1). A
// policy named with 64 characters was created under a truncated name on
// staging (2026-11-04), and every check that looked it up by its full name
// then failed -- or, worse, could pass for the wrong reason. Pin the limit on
// every name a migration creates.
const MAX = 63
const DIR = join(__dirname, '..', 'supabase', 'migrations')

const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const CREATED =
  /create\s+(?:or\s+replace\s+)?(?:policy|table|view|function|trigger|index|unique\s+index)\s+(?:if\s+not\s+exists\s+)?(?:"?[a-z_][a-z0-9_]*"?\.)?"?([a-z_][a-z0-9_]*)"?/gi
const CONSTRAINT = /constraint\s+"?([a-z_][a-z0-9_]*)"?/gi

export function createdNames(sql: string): string[] {
  const clean = stripComments(sql)
  return [...clean.matchAll(CREATED), ...clean.matchAll(CONSTRAINT)].map((m) => m[1])
}

describe('migration identifiers', () => {
  it('finds names to check (the scan is not vacuous)', () => {
    expect(createdNames('create policy abc on t for select using (true);')).toEqual(['abc'])
    expect(createdNames('create or replace function private.f_x() returns int')).toEqual(['f_x'])
    expect(createdNames('alter table t add constraint t_c_check check (x > 0);')).toEqual(['t_c_check'])
    const files = readdirSync(DIR).filter((f) => f.endsWith('.sql'))
    expect(files.length).toBeGreaterThan(20)
    expect(files.flatMap((f) => createdNames(readFileSync(join(DIR, f), 'utf8'))).length).toBeGreaterThan(50)
  })

  it.each(readdirSync(DIR).filter((f) => f.endsWith('.sql')))('%s creates no name longer than 63 characters', (file) => {
    const long = createdNames(readFileSync(join(DIR, file), 'utf8')).filter((name) => name.length > MAX)
    expect(long).toEqual([])
  })
})
