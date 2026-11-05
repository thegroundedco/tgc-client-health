import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Brief 2026-11-05 B2, as revised in review: the overall change sits on the
// big numbers' line because the totals are ONE grid of three rows and each
// score block is a SUBGRID of it -- the number lines share row 2, and the
// change is placed in row 2 on their baseline. No placeholder struts, no
// absolute positioning, no offsets; wrapping flex where it is narrow or
// subgrid is missing. jsdom does no layout, so the rules are pinned in
// source, comments stripped. Where it actually lands needs the owner's eyes.

const ROOT = join(import.meta.dirname, '..')
const css = readFileSync(join(ROOT, 'src/checkin/CheckIn.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const tsx = readFileSync(join(ROOT, 'src/checkin/CheckIn.tsx'), 'utf8')

const ENHANCED_START = css.indexOf('@supports (grid-template-rows: subgrid)')
// The enhancement: everything from the @supports rule to the end of its block.
function enhancement(): string {
  expect(ENHANCED_START, 'the subgrid @supports block').toBeGreaterThan(-1)
  let depth = 0
  for (let i = css.indexOf('{', ENHANCED_START); i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}') depth--
    if (depth === 0) return css.slice(ENHANCED_START, i + 1)
  }
  throw new Error('unclosed @supports block')
}

function declarations(source: string, selector: string): string[] {
  const match = new RegExp(`(^|[\\s}])\\${selector}\\s*\\{([^}]*)\\}`).exec(source)
  if (!match) throw new Error(`no block for ${selector}`)
  return match[2].split(';').map((part) => part.trim().replace(/\s+/g, ' ')).filter(Boolean)
}

describe('the overall change beside the scores', () => {
  it('is enhanced only where there is room, and only where subgrid exists', () => {
    const media = css.lastIndexOf('@media (min-width: 40rem)', ENHANCED_START)
    expect(media).toBeGreaterThan(-1)
    expect(css.slice(media, ENHANCED_START).trim()).toBe('@media (min-width: 40rem) {')
  })

  it('makes the totals one three-row grid, flowing by column, baseline-aligned', () => {
    const totals = declarations(enhancement(), '.totals')
    expect(totals).toContain('display: grid')
    expect(totals).toContain('grid-auto-flow: column')
    expect(totals).toContain('grid-template-rows: auto auto auto')
    expect(totals).toContain('justify-content: start')
    expect(totals).toContain('column-gap: var(--space-5)')
    expect(totals).toContain('align-items: baseline')
  })

  it('makes each score block a subgrid spanning those three rows', () => {
    const total = declarations(enhancement(), '.total')
    expect(total).toContain('display: grid')
    expect(total).toContain('grid-row: 1 / span 3')
    expect(total).toContain('grid-template-rows: subgrid')
    expect(total).toContain('row-gap: var(--space-2)')
  })

  it('puts the change in row 2, on the baseline', () => {
    const change = declarations(enhancement(), '.overallChange')
    expect(change).toContain('grid-row: 2')
    expect(change).toContain('align-self: baseline')
  })

  it('falls back to wrapping flex outside the enhancement', () => {
    const base = css.slice(0, css.lastIndexOf('@media (min-width: 40rem)', ENHANCED_START))
    const totals = declarations(base, '.totals')
    expect(totals).toContain('display: flex')
    expect(totals).toContain('flex-wrap: wrap')
  })

  it('positions nothing absolutely on the check-in screen', () => {
    expect(css).not.toMatch(/position\s*:\s*(absolute|fixed)/)
  })

  it('has no placeholder struts in the markup', () => {
    const start = tsx.indexOf('data-testid="overall-change"')
    expect(start).toBeGreaterThan(-1)
    const element = tsx.slice(tsx.lastIndexOf('<', start), tsx.indexOf('</p>', start))
    expect(element).toContain('styles.overallChange')
    expect(element).not.toMatch(/\\u00a0|&nbsp;| /)
    expect(element).not.toContain('t-label')
    expect(element).not.toContain('styles.totalValue')
    expect(tsx).not.toContain("{'\\u00a0'}")
  })
})
