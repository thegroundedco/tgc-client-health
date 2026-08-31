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
      const expectedAlias = [...questionsFor(bucket).map((q) => q.key), 'expected']
      expect(aliasLists[index], bucket).toEqual(expectedAlias)
    })
  })

  it('states a total that matches the number of states it actually generated', () => {
    // 3*6^3 (Communication, Growth, Finances) + 2*6^4 (Relationship, Delivery)
    // + 3^4 (Advocacy, yes/no since spec §3.1/§3.2 amended 2026-08-28)
    // = 648 + 2,592 + 81 = 3,321. Asserted explicitly, not just echoed from
    // `total`, so a miscount in the generator (e.g. Advocacy silently reverting
    // to 6^4) fails this test loudly instead of shrinking the proof silently.
    expect(total).toBe(3321)
    expect(sql).toContain(
      `score parity PASSED: all ${total} states agree, across ${BUCKETS.length} buckets`,
    )
  })
})
