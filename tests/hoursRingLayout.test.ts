import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Brief 2026-11-05 A, the ring: token colours only (tests/tokens.test.ts also
// walks this file for literals), the healthy fill and the risk over-fill, and
// em sizing, never px. Comments stripped, so prose cannot satisfy a pin.
const css = readFileSync('src/checkin/HoursRing.module.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (selector: string): string => {
  const found = new RegExp(`\\.${selector} \\{([^}]*)\\}`).exec(css)
  expect(found, selector).not.toBeNull()
  return found![1]
}

describe('HoursRing.module.css', () => {
  it('fills with the healthy token and the over state with the risk token', () => {
    expect(rule('fill')).toContain('stroke: var(--band-healthy);')
    expect(rule('over')).toContain('stroke: var(--band-risk);')
    expect(rule('track')).toContain('stroke: var(--rule-hairline);')
  })

  it('declares .over after .fill, so the over colour wins at equal specificity', () => {
    expect(css.indexOf('.over {')).toBeGreaterThan(css.indexOf('.fill {'))
  })

  it('sizes the ring in em, with no px anywhere', () => {
    expect(rule('ring')).toContain('inline-size: 1.5em;')
    expect(rule('ring')).toContain('block-size: 1.5em;')
    expect(css).not.toMatch(/px/)
  })
})
