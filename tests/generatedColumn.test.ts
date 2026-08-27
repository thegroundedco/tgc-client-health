import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUCKETS, questionsFor } from '../src/lib/buckets.ts'
import { meanOrNull } from '../src/lib/scoreMath.ts'
// @ts-expect-error -- a .mjs script with no type declarations; the assertions
// below are the contract, and `npm run build` does not typecheck this file's
// import target.
import { enumerateBucketStates } from '../scripts/score-parity.mjs'
// bucketScore (scoreV2.ts) is NOT imported here, even though vitest can
// resolve its extensionless imports at runtime: scoreV2.ts's own relative
// imports ('./buckets', './scoreMath') have no extension, and `tsc -b` type-
// checks any file reachable from this tests/ project under its own
// (node16/nodenext) compiler options -- which require one. Measured: a bare
// `import { bucketScore } from '../src/lib/scoreV2.ts'` here compiles fine
// under vitest but fails `npm run build` with TS2835 on scoreV2.ts's own
// import lines. buckets.ts and scoreMath.ts have no imports of their own, so
// they carry none of that risk -- meanOrNull composes the same arithmetic
// bucketScore does, applied to the same questionsFor(bucket) keys.

// What this test does and does not do, stated because it would be easy to
// mistake for more than it is. It pins the text of the generated column's
// expression, so an edit to the migration has to change this line too and
// think about it. It does NOT prove that Postgres evaluates that expression
// the same way meanOrNull() does -- nothing without a database can. That is
// `npm run verify:score`, which reads the six live *_score expressions out of
// the catalogue and checks them against meanOrNull(), across 5,616 states
// decomposed per bucket (see the next describe block below).
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

describe('the per-bucket enumeration the verifier rests on', () => {
  it('covers exactly 6^n states for an n-question bucket', () => {
    for (const bucket of BUCKETS) {
      const n = questionsFor(bucket).length
      expect(enumerateBucketStates(bucket).length, bucket).toBe(6 ** n)
    }
  })

  it('totals 5,616 states across all six buckets -- fewer than the 7,776 checked before', () => {
    const total = BUCKETS.reduce(
      (sum, bucket) => sum + enumerateBucketStates(bucket).length,
      0,
    )
    expect(total).toBe(5616)
  })

  it('includes the all-null state and the all-5s state for every bucket', () => {
    for (const bucket of BUCKETS) {
      const keys = questionsFor(bucket).map((q) => q.key)
      const states: Record<string, number | null>[] = enumerateBucketStates(bucket)
      const allNull = states.find((s) => keys.every((k) => s[k] === null))
      const allFive = states.find((s) => keys.every((k) => s[k] === 5))
      expect(allNull, bucket).toBeDefined()
      expect(allFive, bucket).toBeDefined()
      expect(meanOrNull(keys.map((k) => allNull![k])), bucket).toBeNull()
      expect(meanOrNull(keys.map((k) => allFive![k])), bucket).toBe(5)
    }
  })
})
