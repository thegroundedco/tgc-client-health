import { describe, expect, it } from 'vitest'
import { BUCKETS, questionsFor } from '../src/lib/buckets.ts'

// @ts-expect-error -- a .mjs script with no type declarations; the assertions
// below are the contract, and `npm run build` does not typecheck this file's
// import target.
import { buildSql } from '../scripts/score-parity.mjs'

// Why this exists. These assertions do NOT touch a database -- they check
// the generator's own output: three non-obvious properties of the SQL it
// produces -- the round() wrapper (pg_get_expr strips the column's
// numeric(3,2) rounding, so without it every state disagrees), `is distinct
// from` rather than `<>` (half these states are null on both sides, and
// `null <> null` is null, not true, so `<>` would silently pass the whole
// null-propagation half), and the values alias list naming the real columns
// (the expression read from the catalogue refers to them by name). Without a
// test like this, dropping any of the three would pass the whole suite
// silently in CI, and only be caught later by a manual `verify:score` run
// against a real database.
const { sql, total } = buildSql() as { sql: string; total: number }

const BUCKET_SCORE_COLUMN: Record<string, string> = {
  communication: 'comm_score',
  growth: 'growth_score',
  finances: 'fin_score',
  relationship: 'rel_score',
  delivery: 'del_score',
  advocacy: 'adv_score',
}

describe('the generated SQL', () => {
  it('rounds the live expression to 2dp before comparing, matching numeric(3,2) storage', () => {
    expect(sql).toContain('round((')
  })

  it('uses IS DISTINCT FROM, never a bare <> against the expected value', () => {
    expect(sql).toContain('is distinct from')
    // null <> null is null, not true, so a bare <> would silently pass every
    // state where both sides are null -- half the space. Check neither
    // spelling of that comparison appears against `expected`.
    expect(sql).not.toMatch(/<>\s*t\.expected/)
    expect(sql).not.toMatch(/expected\s*<>/)
  })

  it('inserts, updates and deletes nothing', () => {
    expect(sql).not.toMatch(/\binsert\b/i)
    expect(sql).not.toMatch(/\bupdate\b/i)
    expect(sql).not.toMatch(/\bdelete\b/i)
  })

  it('raises one named exception per bucket, each naming that bucket -- and only that bucket -- own column', () => {
    const failures = [...sql.matchAll(/raise exception 'score parity FAILED for (\w+):/g)].map(
      (m) => m[1],
    )
    expect(failures).toEqual(BUCKETS.map((bucket) => BUCKET_SCORE_COLUMN[bucket]))
    // Six distinct columns, not the same one repeated -- a copy-paste bug
    // that hard-coded one bucket's column into every block would still
    // produce six matches above, but not six distinct ones.
    expect(new Set(failures).size).toBe(BUCKETS.length)
  })

  it("aliases each bucket's values list to that bucket's own question keys, plus expected", () => {
    const aliasLists = [...sql.matchAll(/as t\(([^)]*)\)/g)].map((m) =>
      m[1].split(',').map((s) => s.trim()),
    )
    expect(aliasLists).toHaveLength(BUCKETS.length)
    BUCKETS.forEach((bucket, index) => {
      // Finances also reads fin_hours_applies, the column its expression
      // branches on (20261104120000_productive_hours.sql), and the hours
      // answer in both branches.
      const keys = questionsFor(bucket, true).map((q) => q.key)
      const expectedAlias =
        bucket === 'finances' ? [...keys, 'fin_hours_applies', 'expected'] : [...keys, 'expected']
      expect(aliasLists[index], bucket).toEqual(expectedAlias)
    })
    expect(aliasLists[BUCKETS.indexOf('finances')]).toEqual([
      'fin_rack_rate',
      'fin_pays_on_time',
      'fin_rate_increased',
      'fin_hours_in_budget',
      'fin_hours_applies',
      'expected',
    ])
  })

  it('writes fin_hours_applies as a boolean literal, both ways, in the Finances block only', () => {
    const blocks = sql.split('do $parity$').slice(1)
    expect(blocks).toHaveLength(BUCKETS.length)
    blocks.forEach((block, index) => {
      const rows = block.slice(block.indexOf('$rows$'), block.lastIndexOf('$rows$'))
      const trues = rows.match(/, true, -?[\d.]+::numeric\)|, true, null::numeric\)/g) ?? []
      const falses = rows.match(/, false, -?[\d.]+::numeric\)|, false, null::numeric\)/g) ?? []
      if (BUCKETS[index] === 'finances') {
        expect(trues).toHaveLength(1080)
        expect(falses).toHaveLength(1080)
      } else {
        expect(trues.length + falses.length, BUCKETS[index]).toBe(0)
      }
    })
  })

  it('expects the three-answer mean whatever the hours answer when hours do not apply', () => {
    const fin = sql.split('do $parity$')[1 + BUCKETS.indexOf('finances')]
    // rack 5, pays 5, rate 2: 4.00 without hours, whatever hours holds.
    for (const hours of ['null', '1', '2', '3', '5']) {
      const h = hours === 'null' ? 'null::smallint' : `${hours}::smallint`
      expect(fin).toContain(`(5::smallint, 5::smallint, 2::smallint, ${h}, false, 4::numeric)`)
    }
    // ...and the four-answer mean, or null, with hours.
    expect(fin).toContain('(5::smallint, 5::smallint, 2::smallint, 1::smallint, true, 3.25::numeric)')
    expect(fin).toContain('(5::smallint, 5::smallint, 2::smallint, null::smallint, true, null::numeric)')
  })

  it('states a total that matches the number of states it actually generated', () => {
    // 2 x 6^3 (Communication, Growth) + 2 x 6^3 x 5 (Finances, over both
    // states of fin_hours_applies and the five hours values) + 3 x 6^4
    // (Relationship, Delivery, Advocacy) = 432 + 2,160 + 3,888 = 6,480.
    // Asserted explicitly, not echoed from the generator, so that a change to
    // the rubric has to be acknowledged here rather than silently absorbed.
    expect(total).toBe(6480)
    expect(sql).toContain(
      `score parity PASSED: all ${total} states agree, across ${BUCKETS.length} buckets`,
    )
  })
})
