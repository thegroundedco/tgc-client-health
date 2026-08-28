import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUCKETS, questionsFor } from '../src/lib/buckets.ts'
import { meanOrNull, yesNoScore } from '../src/lib/scoreMath.ts'
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
// the catalogue and checks them against meanOrNull()/yesNoScore(), across
// 4,401 states decomposed per bucket (see the next describe block below).
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
  // Dispatch on the QUESTION's kind, never on the bucket's name: a scale
  // question has 6 reachable states (null, 1-5); a yesno question has 3
  // (null, true, false). Today Advocacy is the only all-yesno bucket, but
  // that is the rubric's fact, not this test's.
  it('covers exactly 3^n states for a yesno bucket, 6^n for a scale bucket', () => {
    for (const bucket of BUCKETS) {
      const questions = questionsFor(bucket)
      const perQuestion = questions[0].kind === 'yesno' ? 3 : 6
      expect(enumerateBucketStates(bucket).length, bucket).toBe(perQuestion ** questions.length)
    }
  })

  it('totals 4,401 states across all six buckets: 2*6^3 + 3*6^4 + 3^4', () => {
    const total = BUCKETS.reduce(
      (sum, bucket) => sum + enumerateBucketStates(bucket).length,
      0,
    )
    expect(total).toBe(4401)
  })

  it('includes the all-null state and the all-max state for every bucket (all-5s for scale, all-yes for yesno)', () => {
    for (const bucket of BUCKETS) {
      const questions = questionsFor(bucket)
      const keys = questions.map((q) => q.key)
      const isYesNoBucket = questions[0].kind === 'yesno'
      const states: Record<string, number | boolean | null>[] = enumerateBucketStates(bucket)
      const allNull = states.find((s) => keys.every((k) => s[k] === null))
      const allMax = states.find((s) =>
        keys.every((k) => (isYesNoBucket ? s[k] === true : s[k] === 5)),
      )
      expect(allNull, bucket).toBeDefined()
      expect(allMax, bucket).toBeDefined()
      if (isYesNoBucket) {
        expect(yesNoScore(keys.map((k) => allNull![k] as boolean | null)), bucket).toBeNull()
        expect(yesNoScore(keys.map((k) => allMax![k] as boolean | null)), bucket).toBe(5)
      } else {
        expect(meanOrNull(keys.map((k) => allNull![k] as number | null)), bucket).toBeNull()
        expect(meanOrNull(keys.map((k) => allMax![k] as number | null)), bucket).toBe(5)
      }
    }
  })
})
