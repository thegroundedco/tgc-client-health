import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUCKETS, HOURS_QUESTION, questionsFor } from '../src/lib/buckets.ts'
import { meanOrNull } from '../src/lib/scoreMath.ts'
// @ts-expect-error -- a .mjs script with no type declarations; the assertions
// below are the contract, and `npm run build` does not typecheck this file's
// import target.
import { APPLIES_COLUMN, enumerateBucketStates, expectedBucketScore } from '../scripts/score-parity.mjs'
// bucketScore (scoreV2.ts) is NOT imported here, even though vitest can
// resolve its extensionless imports at runtime: scoreV2.ts's own relative
// imports ('./buckets', './scoreMath') have no extension, and `tsc -b` type-
// checks any file reachable from this tests/ project under its own
// (node16/nodenext) compiler options -- which require one. Measured: a bare
// `import { bucketScore } from '../src/lib/scoreV2.ts'` here compiles fine
// under vitest but fails `npm run build` with TS2835 on scoreV2.ts's own
// import lines. buckets.ts and scoreMath.ts have no imports of their own, so
// they carry none of that risk -- meanOrNull composes the same arithmetic
// bucketScore does, applied to the same questionsFor(bucket, hoursApplies) keys.

// What this test does and does not do, stated because it would be easy to
// mistake for more than it is. It pins the text of the generated column's
// expression, so an edit to the migration has to change this line too and
// think about it. It does NOT prove that Postgres evaluates that expression
// the same way meanOrNull() does -- nothing without a database can. That is
// `npm run verify:score`, which reads the six live *_score expressions out of
// the catalogue and checks them against meanOrNull(), across 6,480 states
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

type State = Record<string, number | boolean | null>

const STATES: Record<string, State[]> = Object.fromEntries(
  BUCKETS.map((bucket) => [bucket, enumerateBucketStates(bucket)]),
)

// Finances is enumerated twice over, once per state of fin_hours_applies
// (20261104120000_productive_hours.sql); every other bucket once. `branches`
// gives each bucket's states split by that flag, with the questions that
// branch averages.
function branches(bucket: string): { hoursApplies: boolean; keys: string[]; states: State[] }[] {
  const all = STATES[bucket]
  if (bucket !== 'finances') {
    return [{ hoursApplies: false, keys: questionsFor(bucket as never, false).map((q) => q.key), states: all }]
  }
  return [false, true].map((hoursApplies) => ({
    hoursApplies,
    keys: questionsFor('finances', hoursApplies).map((q) => q.key),
    states: all.filter((state) => state[APPLIES_COLUMN] === hoursApplies),
  }))
}

describe('the per-bucket enumeration the verifier rests on', () => {
  it('covers exactly 6^n states for every bucket but Finances, and 2 x 6^3 x 5 for Finances', () => {
    for (const bucket of BUCKETS) {
      const n = questionsFor(bucket, false).length
      const expected = bucket === 'finances' ? 2 * 6 ** n * 5 : 6 ** n
      expect(STATES[bucket].length, bucket).toBe(expected)
    }
    expect(STATES.finances.length).toBe(2160)
  })

  it('enumerates Finances over both fin_hours_applies states, half each, and no other bucket over either', () => {
    const flags = STATES.finances.map((state) => state[APPLIES_COLUMN])
    expect(flags.filter((flag) => flag === true)).toHaveLength(1080)
    expect(flags.filter((flag) => flag === false)).toHaveLength(1080)
    for (const bucket of BUCKETS.filter((b) => b !== 'finances')) {
      expect(STATES[bucket].some((state) => APPLIES_COLUMN in state), bucket).toBe(false)
    }
  })

  it('includes the all-null and all-5s states for every bucket, in every branch', () => {
    for (const bucket of BUCKETS) {
      for (const { hoursApplies, keys, states } of branches(bucket)) {
        const label = `${bucket} hoursApplies=${hoursApplies}`
        const allNull = states.find((state) => keys.every((key) => state[key] === null))
        const allMax = states.find((state) => keys.every((key) => state[key] === 5))
        expect(allNull, label).toBeDefined()
        expect(allMax, label).toBeDefined()
        expect(expectedBucketScore(allNull, bucket), label).toBeNull()
        expect(expectedBucketScore(allMax, bucket), label).toBe(5)
      }
    }
  })

  it('includes the all-1s state for every bucket, in every branch, and it scores 1 -- not null', () => {
    // The safety property, and the reason the old test existed for yes/no
    // buckets specifically: four Nos is 1.00 and a single blank is nothing at
    // all. It is now true of every bucket, so it is asserted of every bucket.
    for (const bucket of BUCKETS) {
      for (const { hoursApplies, keys, states } of branches(bucket)) {
        const label = `${bucket} hoursApplies=${hoursApplies}`
        const allMin = states.find((state) => keys.every((key) => state[key] === 1))
        expect(allMin, label).toBeDefined()
        expect(expectedBucketScore(allMin, bucket), label).toBe(1)
      }
    }
  })

  // Cardinality alone is not enough: a typo'd SCALE_VALUES that repeats one
  // number and substitutes another (e.g. an out-of-range 0 in place of 4)
  // still has size 6, still leaves the all-null/all-5s/all-1s checks above
  // green, and would leave verify:score silently checking an unreachable
  // value while never checking a real one. So both the count AND the
  // membership of the exact expected set are asserted here.
  it("covers each question's full, distinct value set -- {null,1,2,3,4,5}, and {null,1,2,3,5} for hours", () => {
    for (const bucket of BUCKETS) {
      for (const question of questionsFor(bucket, true)) {
        for (const { hoursApplies, states } of branches(bucket)) {
          const label = `${bucket}.${question.key} hoursApplies=${hoursApplies}`
          const wanted = question.key === HOURS_QUESTION ? [null, 1, 2, 3, 5] : [null, 1, 2, 3, 4, 5]
          const seen = new Set(states.map((state) => state[question.key]))
          expect(seen.size, label).toBe(wanted.length)
          for (const value of wanted) {
            expect(seen.has(value), `${label} should reach ${value}`).toBe(true)
          }
        }
      }
    }
  })

  it("expects, for every state, meanOrNull over exactly that branch's questions", () => {
    // The oracle here is meanOrNull and questionsFor, called by this test --
    // not the generator's own expectedBucketScore agreeing with itself.
    for (const bucket of BUCKETS) {
      for (const { hoursApplies, keys, states } of branches(bucket)) {
        for (const state of states) {
          const expected = meanOrNull(keys.map((key) => state[key] as number | null))
          expect(expectedBucketScore(state, bucket), `${bucket} hoursApplies=${hoursApplies}`).toBe(expected)
        }
      }
    }
  })

  it('scores Finances over four answers with hours and three without', () => {
    const at = (applies: boolean, hours: number | null) =>
      STATES.finances.find(
        (state) =>
          state[APPLIES_COLUMN] === applies &&
          state.fin_rack_rate === 5 &&
          state.fin_pays_on_time === 5 &&
          state.fin_rate_increased === 2 &&
          state.fin_hours_in_budget === hours,
      )
    expect(expectedBucketScore(at(true, 1), 'finances')).toBe(3.25)
    expect(expectedBucketScore(at(true, null), 'finances')).toBeNull()
    expect(expectedBucketScore(at(false, null), 'finances')).toBe(4)
  })

  it('never lets a stray hours answer move Finances when hours do not apply', () => {
    const without = STATES.finances.filter((state) => state[APPLIES_COLUMN] === false)
    const keys = questionsFor('finances', false).map((q) => q.key)
    const byOthers = new Map<string, Set<number | null>>()
    for (const state of without) {
      const id = keys.map((key) => String(state[key])).join(',')
      if (!byOthers.has(id)) byOthers.set(id, new Set())
      byOthers.get(id)!.add(expectedBucketScore(state, 'finances'))
    }
    expect(byOthers.size).toBe(216)
    for (const [id, scores] of byOthers) expect(scores.size, id).toBe(1)
  })
})
