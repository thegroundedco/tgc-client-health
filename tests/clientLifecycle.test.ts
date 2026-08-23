import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// What this test does and does not do. It pins the text of the lifecycle
// constraint, the reason-code list and the unique index, so an edit to the
// migration has to change this file too and think about it. It does NOT prove
// Postgres enforces any of it -- nothing without a database can. That is
// `npm run verify:lifecycle`, which reads the live constraint out of
// pg_constraint and evaluates it over all 32 combinations of its inputs.
const MIGRATIONS = 'supabase/migrations'

function migration(suffix: string): string {
  const names = readdirSync(MIGRATIONS).filter((name) => name.endsWith(suffix))
  // Exactly one, or the assertions below could be reading a file nobody meant.
  expect(names, `migrations ending in ${suffix}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

const LIFECYCLE = `alter table public.clients add constraint clients_lifecycle_coherent check (
  case
    when status in ('cancelled', 'former')
      then ended_on is not null and end_reason_code is not null
    else ended_on is null and end_reason_code is null and end_reason_note is null
  end
);`

const REASON_CODES = [
  'price',
  'scope_fit',
  'in_housed',
  'went_quiet',
  'project_completed',
  'agency_initiated',
  'other',
]

describe('the client lifecycle migration', () => {
  const sql = migration('_add_client_lifecycle.sql')

  it('adds the three columns the parent spec requires', () => {
    expect(sql).toContain('add column ended_on date')
    expect(sql).toContain('add column end_reason_code text')
    expect(sql).toContain('add column end_reason_note text')
  })

  it('still has the constraint verify:lifecycle was written against', () => {
    expect(sql).toContain(LIFECYCLE)
  })

  it('offers exactly the seven reason codes, and no others', () => {
    const listed = sql.match(/end_reason_code in \(([^)]*)\)/s)
    expect(listed, 'the reason-code list').not.toBeNull()

    for (const code of REASON_CODES) {
      expect(listed![1], code).toContain(`'${code}'`)
    }
    // The count as well as the membership: an eighth code added without thought
    // would pass a membership-only check.
    expect(listed![1].match(/'[a-z_]+'/g)).toHaveLength(REASON_CODES.length)
  })

  it('indexes lower(name), so case cannot make a duplicate', () => {
    expect(sql).toContain(
      'create unique index clients_name_unique on public.clients (lower(name))',
    )
  })

  it('does not delete or drop anything', () => {
    // A migration on the table holding the real roster, against a database with
    // no backups. Comments are stripped first so this asserts about statements
    // rather than about prose that happens to mention dropping -- the
    // assert-absence-against-prose defect this project has now hit twice.
    const statements = sql.replaceAll(/--[^\n]*/g, '')
    expect(statements).not.toMatch(/\bdrop\b/i)
    expect(statements).not.toMatch(/\bdelete\b/i)
    expect(statements).not.toMatch(/\btruncate\b/i)
  })
})
