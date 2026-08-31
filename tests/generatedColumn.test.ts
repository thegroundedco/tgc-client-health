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
// the catalogue and checks them against meanOrNull(), across 4,536 states
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
  it('covers exactly 6^n states for every bucket', () => {
    // One value set for every question now: null, 1, 2, 3, 4, 5. The dispatch
    // this test used to carry is gone because the model's is.
    for (const bucket of BUCKETS) {
      const questions = questionsFor(bucket)
      expect(enumerateBucketStates(bucket).length, bucket).toBe(6 ** questions.length)
    }
  })

  it('includes the all-null and all-5s states for every bucket', () => {
    for (const bucket of BUCKETS) {
      const keys = questionsFor(bucket).map((question) => question.key)
      const states: Record<string, number | null>[] = enumerateBucketStates(bucket)
      const allNull = states.find((state) => keys.every((key) => state[key] === null))
      const allMax = states.find((state) => keys.every((key) => state[key] === 5))
      expect(allNull, bucket).toBeDefined()
      expect(allMax, bucket).toBeDefined()
      expect(meanOrNull(keys.map((key) => allNull![key])), bucket).toBeNull()
      expect(meanOrNull(keys.map((key) => allMax![key])), bucket).toBe(5)
    }
  })

  it('includes the all-1s state for every bucket, and it scores 1 -- not null', () => {
    // The safety property, and the reason the old test existed for yes/no
    // buckets specifically: four Nos is 1.00 and a single blank is nothing at
    // all. It is now true of every bucket, so it is asserted of every bucket.
    for (const bucket of BUCKETS) {
      const keys = questionsFor(bucket).map((question) => question.key)
      const states: Record<string, number | null>[] = enumerateBucketStates(bucket)
      const allMin = states.find((state) => keys.every((key) => state[key] === 1))
      expect(allMin, bucket).toBeDefined()
      expect(meanOrNull(keys.map((key) => allMin![key])), bucket).toBe(1)
    }
  })

  // Cardinality alone is not enough: a typo'd SCALE_VALUES that repeats one
  // number and substitutes another (e.g. an out-of-range 0 in place of 4)
  // still has size 6, still leaves the all-null/all-5s/all-1s checks above
  // green, and would leave verify:score silently checking an unreachable
  // value while never checking a real one. So both the count AND the
  // membership of the exact expected set are asserted here.
  it("covers each question's full, distinct value set -- {null,1,2,3,4,5}", () => {
    for (const bucket of BUCKETS) {
      const states: Record<string, number | null>[] = enumerateBucketStates(bucket)
      for (const question of questionsFor(bucket)) {
        const label = `${bucket}.${question.key}`
        const seen = new Set(states.map((state) => state[question.key]))
        expect(seen.size, label).toBe(6)
        for (const value of [null, 1, 2, 3, 4, 5]) {
          expect(seen.has(value), `${label} should reach ${value}`).toBe(true)
        }
      }
    }
  })
})
