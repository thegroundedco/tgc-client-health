import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The Revenue page's layout, which no DOM test can see: jsdom computes no
// layout, so Revenue.dom.test.tsx can assert which elements carry the
// full-width class but not that the class does anything. This asserts the
// stylesheet.
//
// Lives outside src/ because it needs node:fs, and tsconfig.app.json gives
// src/ no Node types -- the same reason tests/boardLayout.test.ts does.

const SOURCE = readFileSync(
  join(import.meta.dirname, '..', 'src', 'shell', 'Revenue.module.css'),
  'utf8',
)

// Comments stripped first. This stylesheet explains itself in prose that names
// the properties and tokens it is describing, and a check run against the raw
// text would match the explanation rather than the code -- the trap
// tokenRules.ts warns about and matrixGrid.test.ts hit for real.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')

function ruleBody(selector: string): string {
  const start = CODE.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no rule for "${selector}" in Revenue.module.css`)
  const end = CODE.indexOf('}', start)
  if (end === -1) throw new Error(`rule "${selector}" is never closed`)
  return CODE.slice(start, end)
}

describe('the Revenue stylesheet', () => {
  // A test that silently found nothing would pass forever. This project has
  // already shipped one check that reported success by finding no data.
  it('is read, not silently skipped', () => {
    expect(SOURCE.length).toBeGreaterThan(1000)
    expect(CODE).toContain('.page {')
  })

  // The defect the owner reported on 2026-09-10. --measure-prose is 62ch, the
  // width at which running TEXT stays scannable; capping a page of charts and
  // tables with it left Revenue a narrow strip on a desktop.
  it('is not capped at the prose measure', () => {
    expect(ruleBody('.page')).not.toContain('--measure-prose')
  })

  it('is capped at the dashboard measure and centred under the header', () => {
    const page = ruleBody('.page')
    expect(page).toContain('max-inline-size: var(--measure-dashboard)')
    expect(page).toContain('margin-inline: auto')
  })

  // Two columns rather than one wide one. Stretching a single column to fill a
  // desktop would put a Tenure row's client name and its measurement a screen
  // apart; the pair is the unit that has to stay readable.
  it('pairs the sections into two columns on a wide viewport', () => {
    expect(CODE).toMatch(/@media \(min-width: 60rem\)/)
    expect(CODE).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/)
  })

  it('is a single column below that width', () => {
    expect(ruleBody('.page')).toContain('grid-template-columns: minmax(0, 1fr)')
  })

  // minmax(0, ...) rather than 1fr: a grid track's default minimum is its
  // content, so the billing table would push its own column wider than half
  // the page instead of scrolling inside it.
  it('lets a wide table scroll rather than widening its column', () => {
    expect(CODE).not.toMatch(/grid-template-columns:\s*(repeat\(2,\s*)?1fr/)
  })

  // Not nth-child. The sections are rendered conditionally -- a load or error
  // state present or absent shifts every position by one -- so a rule keyed to
  // position would silently span the wrong section.
  it('spans the heading, the states and the chart across both columns', () => {
    expect(ruleBody('.wide')).toContain('grid-column: 1 / -1')
  })

  // Two sections side by side rarely have the same height, and a stretched
  // shorter one hangs its last row's border in space below the list it belongs
  // to.
  it('tops-aligns the pairs rather than stretching them', () => {
    expect(ruleBody('.page')).toContain('align-items: start')
  })
})
