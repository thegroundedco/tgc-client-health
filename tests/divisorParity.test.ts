import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { overallQuestions } from '../src/lib/buckets.ts'

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

// TS side, both branches: 17 questions (so divisor 17) without hours, 18 with.
describe.each([
  [false, 17],
  [true, 18],
])('the TypeScript overall (hoursApplies=%s)', (hoursApplies, divisor) => {
  it(`averages ${divisor} questions`, () => {
    expect(overallQuestions(hoursApplies)).toHaveLength(divisor)
  })
})

// SQL side. Since 20261104120000_productive_hours.sql the view's overall is a
// CASE over fin_hours_applies: 18 questions (divisor 18) when the hours
// question applies, 17 when it does not. Both branches are read out of the
// same CASE and each is compared against its own overallQuestions().
//
// Comments are stripped first: the migration's prose talks about both
// divisors, and a pin that a comment could satisfy is no pin.
function withoutComments(sql: string): string {
  return sql.replaceAll(/--[^\n]*/g, '')
}

const sql = withoutComments(latestMigrationContaining('as overall_score')).toLowerCase()

// The whole CASE, from its `case` to `as overall_score`, sliced out of the one
// create view statement, so the condition, both divisors and both sets of
// summed terms are read out of the same text rather than from searches that
// could land in different statements.
const view = sql.slice(
  sql.lastIndexOf('create view public.checkin_scores'),
  sql.indexOf(';', sql.lastIndexOf('create view public.checkin_scores')),
)
const end = view.lastIndexOf('as overall_score')
const expression = view.slice(view.lastIndexOf('case', end), end).replaceAll(/\s+/g, ' ')
const shape = expression.match(/^case when ch\.fin_hours_applies then ([\s\S]*) else ([\s\S]*) end $/)

const BRANCHES = [
  { hoursApplies: true, text: () => shape![1] },
  { hoursApplies: false, text: () => shape![2] },
] as const

describe('the screen agrees with the view about the overall score', () => {
  it('is one CASE over ch.fin_hours_applies, true branch first', () => {
    expect(view).toContain('create view public.checkin_scores')
    expect(shape, expression).not.toBeNull()
  })

  describe.each(BRANCHES)('when fin_hours_applies is $hoursApplies', ({ hoursApplies, text }) => {
    const OVERALL = overallQuestions(hoursApplies)

    it('divides by the number of questions the overall averages', () => {
      const divisors = [...text().matchAll(/\/\s*(\d+)/g)].map((m) => Number(m[1]))
      // A positive count first, so a regex that matched nothing cannot read as
      // agreement. This project has shipped one check that reported success by
      // finding no data.
      expect(divisors.length).toBeGreaterThan(0)
      for (const divisor of divisors) expect(divisor).toBe(OVERALL.length)
    })

    it('sums exactly the questions the overall averages, and no others', () => {
      // The divisor alone is not enough. Swapping one summed column for another
      // keeps the count and still produces a number for every client -- a wrong
      // one, quietly. So the terms are matched as a set too.
      const summed = [...text().matchAll(/ch\.([a-z_]+)/g)].map((m) => m[1])
      expect([...summed].sort()).toEqual([...OVERALL].sort())
    })

    it('leaves every Advocacy answer out of the overall', () => {
      // Stated separately from the set comparison above because this is the
      // OWNER'S RULING, not an implementation detail: Advocacy must not move the
      // number clients are compared on, whether the 90-day gate is open or shut
      // (spec 3.2). If it ever re-enters, this is the line that should fail.
      expect(text()).not.toContain('adv_')
    })
  })
})
