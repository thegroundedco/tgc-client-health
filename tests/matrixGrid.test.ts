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

// The stylesheet with its comments removed, which is what every assertion below
// reads. Matrix.module.css explains its own traps by NAMING the selectors that
// caused them, and a check run against the raw file matches that prose and fails
// on the explanation rather than on the defect. tokenRules.ts hit this first and
// warns about it in its own header; this is the same lesson, one file over.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')

// The body of one top-level rule, by exact selector. `.name {` and `.nameRow {`
// are different rules and a startsWith match would confuse them.
function ruleBody(selector: string): string {
  const start = CODE.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no rule for "${selector}" in Matrix.module.css`)
  const end = CODE.indexOf('}', start)
  return CODE.slice(start, end)
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

  // ONE EDGE, ONE OWNER. Both weights are 2px, so the collapsing rules no longer
  // settle a conflict by width. CSS 2.1 §17.6.2.1 falls through width, then
  // style, then POSITION -- and two 2px solid borders differing only in colour
  // reach that last step, where "the one further to the left and further to the
  // top wins". A heavy ink rule declared on a start edge therefore loses to the
  // hairline on the cell before it and silently disappears.
  //
  // The whole model rests on no edge ever being declared twice: cells draw only
  // their END edges, and each heavy rule is that one owner's edge in ink.
  describe('the one-edge-one-owner model', () => {
    it('gives cells end edges only, never the four-sided shorthand', () => {
      expect(CODE).toContain('border-inline-end: 2px solid var(--rule-hairline)')
      expect(CODE).toContain('border-block-end: 2px solid var(--rule-hairline)')
      // `border: <n>px solid var(--rule-hairline)` would declare all four sides
      // and put two owners on every interior edge again.
      expect(/border:\s*\d+px\s+solid\s+var\(--rule-hairline\)/.test(CODE)).toBe(false)
    })

    it('yields the perimeter only on rows that span the whole table', () => {
      // A bare `.table tr > *:last-child` catches the header's SECOND row, whose
      // last cell is Context -- in the middle of the table, not on its edge --
      // and zeroes the heavy rule before Overall. It also outweighs .divider, so
      // it wins whatever the source order. That shipped once.
      expect(/\.table\s+tr\s*>\s*\*:last-child/.test(CODE)).toBe(false)
      expect(CODE).toContain('.table thead tr:first-child > *:last-child')
    })

    it('carries both heavy rules on END edges', () => {
      // .divider on the last BUCKET column's right, not Overall's left.
      expect(ruleBody('.divider')).toContain('border-inline-end')
      expect(ruleBody('.divider')).not.toContain('border-inline-start')
      // .footRule on the last CLIENT row's bottom, not the footer's top.
      expect(ruleBody('.footRule')).toContain('border-block-end')
      expect(ruleBody('.footRule')).not.toContain('border-block-start')
    })
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
