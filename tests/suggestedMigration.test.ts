import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const MIGRATIONS = 'supabase/migrations'
const NAME = '20261029120000_suggested_checkins.sql'

function migration(name: string): string {
  const names = readdirSync(MIGRATIONS).filter((entry) => entry === name)
  // Exactly one, or the assertions below could be reading a file nobody meant.
  expect(names, `migration named ${name}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

// Same rationale as tests/revenueMigration.test.ts: comments name things the
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

describe('the suggested check-ins migration', () => {
  const sql = withoutComments(migration(NAME))

  it('adds exactly one nullable timestamptz column', () => {
    expect(statement(sql, /alter table public\.checkins/)).toBe(
      'alter table public.checkins add column suggested_at timestamptz;',
    )
  })

  it('backfills only untouched AI rows, from their creation time', () => {
    expect(statement(sql, /update public\.checkins/)).toBe(
      "update public.checkins set suggested_at = created_at where notes like 'AI-suggested:%' and updated_at <= created_at + interval '1 minute';",
    )
  })

  it('contains exactly one update of public.checkins', () => {
    expect(sql.match(/update public\.checkins/gi)?.length ?? 0).toBe(1)
  })

  it('adds no policy, grant or constraint', () => {
    expect(sql).not.toMatch(/create policy|grant |check \(/i)
  })
})
