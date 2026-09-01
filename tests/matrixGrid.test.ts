import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Two properties of the matrix's stylesheet that no DOM test can see, because
// vitest stubs CSS Modules and jsdom computes no layout. Both were found by the
// owner looking at the deployed page, and both are invisible failures: the table
// still renders, still has every cell, still passes all 18 DOM tests, and simply
// draws the wrong lines.
//
// Lives outside src/ because it needs node:fs, and tsconfig.app.json gives src/
// no Node types -- the same reason tests/tokens.test.ts lives here.

const SOURCE = readFileSync(
  join(import.meta.dirname, '..', 'src', 'board', 'Matrix.module.css'),
  'utf8',
)

// The body of one top-level rule, by exact selector. `.name {` and `.nameRow {`
// are different rules and a startsWith match would confuse them.
function ruleBody(selector: string): string {
  const start = SOURCE.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no rule for "${selector}" in Matrix.module.css`)
  const end = SOURCE.indexOf('}', start)
  return SOURCE.slice(start, end)
}

describe('the matrix stylesheet', () => {
  // A test that silently found nothing would pass forever. This project has
  // already shipped one check that reported success by finding no data -- see
  // "What a silent grep looks like" in the README.
  it('is read, not silently skipped', () => {
    expect(SOURCE.length).toBeGreaterThan(1000)
    expect(SOURCE).toContain('.name {')
    expect(SOURCE).toContain('.nameRow {')
  })

  it('leaves every table cell as a table cell', () => {
    // A cell given `display: flex` (or grid, or block) LEAVES the table
    // formatting context: the browser wraps it in an anonymous table-cell and
    // its border no longer collapses with its neighbours'. It then draws its own
    // full 1px on top of theirs, so every line touching that column comes out at
    // 2px while the rest of the grid is 1px.
    //
    // That shipped on 2026-09-01: `.name` carried the flex that right-aligns the
    // band word, and the client column was the only part of the table ruled
    // differently from the rest. The flex belongs on .nameRow, inside the cell.
    for (const selector of ['.name', '.cell', '.head', '.headName', '.blank']) {
      expect(ruleBody(selector)).not.toContain('display')
    }
  })

  it('keeps the borders collapsed, which is what the two weights rest on', () => {
    // `collapse` merges each pair of adjacent cell borders into one line, and
    // where two weights meet it keeps the WIDER one -- which is the only reason
    // a 2px divider beats its neighbour's 1px edge without either cell knowing
    // about the other. Under `separate` every shared edge doubles and the whole
    // grid reads at the wrong weight.
    expect(ruleBody('.table')).toContain('border-collapse: collapse')
  })
})
