import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GATE_DAYS } from '../src/lib/gate.ts'

// The TypeScript gate against the SQL one. Two copies of a rule exist because
// the view can only answer for a check-in that has a row and the screen must
// answer for one that does not; this file is what keeps them from drifting --
// the same bargain, and the same remedy, as tests/clientFormDrift.test.ts.
//
// What this does NOT prove: that Postgres actually evaluates the predicate this
// way. That is `npm run verify:scoring-view`, which exercises the real view
// against the 89/90/91-day boundary on a live database.
const MIGRATIONS = 'supabase/migrations'

function migration(suffix: string): string {
  const names = readdirSync(MIGRATIONS).filter((name) => name.endsWith(suffix))
  expect(names, `migrations ending in ${suffix}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

describe('the screen agrees with the view about the gate', () => {
  const sql = migration('_six_bucket_scoring.sql')

  it('uses the same number of days the view adds to started_on', () => {
    const matches = [...sql.matchAll(/started_on\s*\+\s*(\d+)/g)].map((m) => Number(m[1]))
    // A positive count first, so a regex that matched nothing cannot read as
    // agreement. This project has shipped one check that reported success by
    // finding no data.
    expect(matches.length).toBeGreaterThan(0)
    for (const days of matches) expect(days).toBe(GATE_DAYS)
  })

  // `>=`, not `>`. The difference is one day at the boundary, it is invisible in
  // every test that does not sit exactly on it, and gate.test.ts pins the
  // TypeScript side of the same boundary.
  it('compares the period inclusively, as the TypeScript gate does', () => {
    expect(sql).toMatch(/period\s*>=\s*c\.started_on\s*\+\s*90/)
  })
})
