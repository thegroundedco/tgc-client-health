import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// What this test does and does not do, stated because it would be easy to
// mistake for more than it is. It pins the text of the generated column's
// expression, so an edit to the migration has to change this line too and
// think about it. It does NOT prove that Postgres evaluates that expression
// the same way score.ts does -- nothing without a database can. That is
// `npm run verify:score`, which reads the live expression out of the
// catalogue and checks all 7,776 combinations against totalScore().
const MIGRATION = 'supabase/migrations/20260821021840_create_clients_and_checkins.sql'

const EXPECTED = `total_score smallint generated always as (
    (relationship + delivery + financial + sentiment + growth)::smallint
  ) stored,`

describe('the total_score generated column', () => {
  it('still has the expression the parity check was written against', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    expect(sql).toContain(EXPECTED)
  })
})
