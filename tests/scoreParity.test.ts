import { describe, expect, it } from 'vitest'

// @ts-expect-error -- a .mjs script with no type declarations; the assertions
// below are the contract, and `npm run build` does not typecheck this file's
// import target.
import { buildRows, buildSql, CHUNK } from '../scripts/score-parity.mjs'

// Why this exists. `npm run verify:score` prints "all 7776 combinations agree",
// and that sentence is generated from the same array it describes -- so a
// generator that emitted a hundred rows would print a number that matched its
// own output and still claim the whole space had been checked. Nothing else in
// the repo looks at the generator. These tests check the row set itself:
// that it is the complete product exactly once each, and that every expected
// total is right when re-derived by arithmetic written out here rather than by
// calling totalScore(), which is the function under test on the other side.

const PILLAR_COUNT = 5
const CASES_PER_PILLAR = 6 // 1..5 and unscored
const EXPECTED_ROWS = CASES_PER_PILLAR ** PILLAR_COUNT // 7776
const FULLY_SCORED = 5 ** PILLAR_COUNT // 3125

type Row = { pillars: (number | null)[]; expected: number | null }

function parse(rows: string[]): Row[] {
  return rows.map((row) => {
    const cells = row.slice(1, -1).split(',')
    expect(cells).toHaveLength(PILLAR_COUNT + 1)
    const values = cells.map((c) =>
      c === 'null::smallint' ? null : Number(c.replace('::smallint', '')),
    )
    return { pillars: values.slice(0, PILLAR_COUNT), expected: values[PILLAR_COUNT] }
  })
}

const rows = buildRows() as string[]
const parsed = parse(rows)

describe('the score-parity row set', () => {
  it('covers every combination exactly once', () => {
    expect(rows).toHaveLength(EXPECTED_ROWS)
    const distinct = new Set(parsed.map((r) => r.pillars.join('|')))
    expect(distinct.size).toBe(EXPECTED_ROWS)
  })

  it('offers each pillar 1 through 5 and unscored, and nothing else', () => {
    const seen = new Set<number | null>()
    for (const row of parsed) for (const value of row.pillars) seen.add(value)
    expect([...seen].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([null, 1, 2, 3, 4, 5])
  })

  it('expects a total that plain addition agrees with, on all of them', () => {
    const disagreements = parsed.filter((row) => {
      const truth = row.pillars.includes(null)
        ? null
        : row.pillars.reduce((sum, value) => (sum as number) + (value as number), 0)
      return truth !== row.expected
    })
    expect(disagreements).toEqual([])
  })

  it('expects no total wherever a pillar is unscored', () => {
    const incomplete = parsed.filter((row) => row.pillars.includes(null))
    expect(incomplete).toHaveLength(EXPECTED_ROWS - FULLY_SCORED)
    expect(incomplete.every((row) => row.expected === null)).toBe(true)
    const complete = parsed.filter((row) => !row.pillars.includes(null))
    expect(complete).toHaveLength(FULLY_SCORED)
    expect(complete.every((row) => row.expected !== null)).toBe(true)
  })
})

describe('the generated SQL', () => {
  const { sql, chunkCount } = buildSql(rows) as { sql: string; chunkCount: number }

  it('puts every row in a chunk, and says how many are in each', () => {
    expect(chunkCount).toBe(Math.ceil(EXPECTED_ROWS / CHUNK))
    const claimed = [...sql.matchAll(/chunk \d+: (\d+) combinations agree/g)].map((m) =>
      Number(m[1]),
    )
    expect(claimed).toHaveLength(chunkCount)
    expect(claimed.reduce((a, b) => a + b, 0)).toBe(EXPECTED_ROWS)
  })

  it('states a final count that matches the rows it actually contains', () => {
    // The claim a green run leaves on screen. It is generated, so it is only
    // evidence if it equals the number of tuples in the file.
    expect(sql).toContain(`score parity PASSED: all ${EXPECTED_ROWS} combinations agree`)
    expect([...sql.matchAll(/::smallint\)/g)]).toHaveLength(EXPECTED_ROWS)
  })

  it('reads the live expression out of the catalogue rather than hard-coding it', () => {
    expect(sql).toContain('pg_get_expr(d.adbin, d.adrelid)')
    expect(sql).toContain("d.adrelid = 'public.checkins'::regclass")
    // The arithmetic must appear nowhere on the SQL side: if it did, the check
    // would be comparing score.ts against a copy of the column instead of
    // against the column.
    expect(sql).not.toContain('relationship + delivery')
  })

  it('raises on disagreement instead of reporting a count nobody reads', () => {
    const raises = [...sql.matchAll(/raise exception/g)]
    expect(raises).toHaveLength(chunkCount)
    expect(sql).toContain('is distinct from expected')
  })

  it('inserts nothing', () => {
    expect(sql).not.toMatch(/\binsert\b/i)
    expect(sql).not.toMatch(/\bupdate\b/i)
    expect(sql).not.toMatch(/\bdelete\b/i)
  })
})
