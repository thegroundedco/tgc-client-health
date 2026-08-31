import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OVERALL_QUESTIONS } from '../src/lib/buckets.ts'

// The TypeScript overall against the SQL one, by the same bargain and the same
// remedy as tests/gateParity.test.ts: two copies of one rule exist because the
// view can only answer for a check-in that has a row and the screen must answer
// for one that does not.
//
// This file exists because the final whole-branch review of 2026-08-31 proved
// the gap by mutation: changing `/ 17::numeric` to `/ 14::numeric` in the live
// migration left all 704 tests passing. A wrong divisor is the one defect in
// this model that is wrong for EVERY client simultaneously while every number
// on screen stays plausible -- 3.59 becomes 4.36 and nothing looks broken.
//
// What this does NOT prove: that Postgres evaluates it this way. That is
// `npm run verify:scoring-view`, which exercises the real view on a live
// database.
const MIGRATIONS = 'supabase/migrations'

// Whichever migration most recently (re)defines the expression -- not a fixed
// filename. The view has been redefined four times now, and gateParity.test.ts
// records what happened the last time a parity check read a stale one: it kept
// passing against a predicate the database no longer used.
function latestMigrationContaining(needle: string): string {
  const names = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  const matches = names.filter((name) =>
    readFileSync(`${MIGRATIONS}/${name}`, 'utf8').includes(needle),
  )
  expect(matches.length, `migrations containing ${needle}`).toBeGreaterThan(0)
  return readFileSync(`${MIGRATIONS}/${matches[matches.length - 1]}`, 'utf8')
}

describe('the screen agrees with the view about the overall score', () => {
  const sql = latestMigrationContaining('as overall_score')

  // The whole expression, from `round(` to `as overall_score`, so the divisor
  // and the summed terms are read out of the same text rather than from two
  // searches that could land in different statements.
  const expression = sql.slice(
    sql.lastIndexOf('round(', sql.lastIndexOf('as overall_score')),
    sql.lastIndexOf('as overall_score'),
  )

  it('divides by the number of questions the overall averages', () => {
    const divisors = [...expression.matchAll(/\/\s*(\d+)::numeric/g)].map((m) => Number(m[1]))
    // A positive count first, so a regex that matched nothing cannot read as
    // agreement. This project has shipped one check that reported success by
    // finding no data.
    expect(divisors.length).toBeGreaterThan(0)
    for (const divisor of divisors) expect(divisor).toBe(OVERALL_QUESTIONS.length)
  })

  it('sums exactly the questions the overall averages, and no others', () => {
    // The divisor alone is not enough. Swapping one summed column for another
    // keeps the count at seventeen and still produces a number for every
    // client -- a wrong one, quietly. So the terms are matched as a set too.
    const summed = [...expression.matchAll(/ch\.([a-z_]+)/g)].map((m) => m[1])
    expect([...summed].sort()).toEqual([...OVERALL_QUESTIONS].sort())
  })

  it('leaves every Advocacy answer out of the overall', () => {
    // Stated separately from the set comparison above because this is the
    // OWNER'S RULING, not an implementation detail: Advocacy must not move the
    // number clients are compared on, whether the 90-day gate is open or shut
    // (spec 3.2). If it ever re-enters, this is the line that should fail.
    expect(expression).not.toContain('adv_')
  })
})
