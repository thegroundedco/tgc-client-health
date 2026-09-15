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

// The sections' own stylesheet, which is a different file from the page's:
// src/shell/Revenue.module.css lays the grid out, src/revenue/Revenue.module.css
// draws what sits in the cells.
const SECTIONS = readFileSync(
  join(import.meta.dirname, '..', 'src', 'revenue', 'Revenue.module.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

function bodyIn(code: string, selector: string, file: string): string {
  const start = code.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no rule for "${selector}" in ${file}`)
  const end = code.indexOf('}', start)
  if (end === -1) throw new Error(`rule "${selector}" is never closed`)
  return code.slice(start, end)
}

function ruleBody(selector: string): string {
  return bodyIn(CODE, selector, 'shell/Revenue.module.css')
}

function sectionRule(selector: string): string {
  return bodyIn(SECTIONS, selector, 'revenue/Revenue.module.css')
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

describe('the revenue sections', () => {
  it('is read, not silently skipped', () => {
    expect(SECTIONS.length).toBeGreaterThan(1000)
    expect(SECTIONS).toContain('.section {')
  })

  // The owner's second report, 2026-09-10: "No clear separation between
  // sections or headers." Before this the only thing marking a boundary was a
  // slightly larger gap, on a page whose contents are themselves stacks of
  // bordered cards -- which reads as no boundary at all.
  it('marks each section with a rule above it and room to breathe', () => {
    const section = sectionRule('.section')
    expect(section).toContain('border-block-start: 1px solid var(--rule-hairline)')
    expect(section).toContain('padding-block-start:')
  })

  // A grid of equal cells is the ENTIRE alignment mechanism between the axis
  // and the bars: barGeometry slots bars evenly across the same width, so cell
  // n and bar n share a centre. A flex row would size each cell to its text --
  // "Sep" and "Dec" differ -- and the labels would drift off their bars with
  // nothing failing.
  it('lays the month axis out as equal cells, never as a flex row', () => {
    const axis = sectionRule('.axis')
    expect(axis).toContain('display: grid')
    expect(axis).toContain('grid-auto-columns: minmax(0, 1fr)')
    expect(axis).not.toContain('display: flex')
  })

  // The void the owner reported beside the monthly breakdown. The table now
  // carries five columns and fills the width it is given.
  it('no longer caps the billing table at the reading measure', () => {
    expect(sectionRule('.table')).not.toContain('--measure-prose')
  })

  it('lines the figure columns up on their last digit', () => {
    const figure = sectionRule('.table .figure')
    expect(figure).toContain('text-align: end')
    expect(figure).toContain('font-variant-numeric: tabular-nums')
  })

  // border-radius is IGNORED on a cell of a collapsed table, in every browser.
  // The band's rounded corners are the reason this table separates its borders
  // -- a detail that looks like a stylistic choice and is a hard requirement.
  it('separates its borders, because a collapsed table cannot round a cell', () => {
    const table = sectionRule('.table')
    expect(table).toContain('border-collapse: separate')
    expect(table).toContain('border-spacing: 0')
  })

  it('gives the banded columns a ground and a weight', () => {
    const band = sectionRule('.table .band')
    expect(band).toContain('background: var(--surface-sunken)')
    expect(band).toMatch(/font-weight: var\(--wght-/)
  })

  // Rounded at the OUTER corners of the block only: the band is one shape
  // behind two columns, not a pill per cell.
  it('rounds only the four outer corners of the band', () => {
    expect(SECTIONS).toContain('border-start-start-radius')
    expect(SECTIONS).toContain('border-start-end-radius')
    expect(SECTIONS).toContain('border-end-start-radius')
    expect(SECTIONS).toContain('border-end-end-radius')
  })

  // THE RETENTION CHART'S TWO LINES, and why the assertion is here rather
  // than in RetentionChart.dom.test.tsx. jsdom resolves no CSS module: every
  // className there is an opaque string and getComputedStyle reports nothing,
  // so the DOM test can say the two lines carry DIFFERENT classes and cannot
  // say the classes differ in any way a reader could see. Delete the dash
  // pattern and that test still passes while the chart stops distinguishing
  // its series.
  //
  // THE PRIMARY READER OF THIS PAGE IS COLOURBLIND. The two lines share a
  // colour token on purpose -- as the loss segments above them do -- so the
  // stroke style is not decoration, it is the distinction.
  it('draws GRR dashed and NRR solid, so the two lines differ without colour', () => {
    expect(sectionRule('.retentionGrr')).toMatch(/stroke-dasharray:\s*\S/)
    expect(sectionRule('.retentionNrr')).not.toContain('stroke-dasharray')
    // Both really are drawn, and drawn by these two rules: a pair of unused
    // selectors would satisfy the lines above while the chart showed nothing.
    expect(sectionRule('.retentionGrr')).toContain('stroke:')
    expect(sectionRule('.retentionNrr')).toContain('stroke:')
  })

  // The scale used to share the right margin with those end labels, and on the
  // real data a tick printed on top of one of them.
  it('sets the rate scale against the plot edge rather than under the labels', () => {
    expect(sectionRule('.retentionTick')).toContain('text-anchor: end')
  })
})

describe('the share overlay sits on the chart, not on the plot', () => {
  // THIS SHIPPED WRONG ONCE AND NO DOM TEST COULD HAVE CAUGHT IT. jsdom does no
  // layout, so a rendered assertion cannot tell a label inside its segment from
  // one floating above the bar. The owner caught it by looking at a screenshot:
  // every project percentage on a short segment was drawn outside the bar.
  //
  // The cause is that .plot is TALLER than the svg it contains, by .chart's own
  // margin at each end. An overlay pinned to .plot draws every figure that far
  // too high -- absorbed invisibly by a tall retainer segment, and fatal to a
  // short project one. The two values must therefore agree, and this is the
  // only place that can say so.
  it('insets the overlay by exactly the margin the chart carries', () => {
    const chart = sectionRule('.chart')
    const shares = sectionRule('.shares')
    const margin = /margin-block:\s*([^;]+);/.exec(chart)?.[1]?.trim()
    const inset = /inset-block:\s*([^;]+);/.exec(shares)?.[1]?.trim()

    expect(margin).toBeTruthy()
    expect(inset).toBe(margin)
  })

  it('insets the overlay inline by the same room the plot leaves for the y axis', () => {
    const plot = sectionRule('.plot')
    const shares = sectionRule('.shares')
    const padding = /padding-inline-start:\s*([^;]+);/.exec(plot)?.[1]?.trim()
    const inset = /inset-inline:\s*([^;]+);/.exec(shares)?.[1]?.trim()

    expect(padding).toBeTruthy()
    expect(inset).toBe(`${padding} 0`)
  })
})
