import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Brief 2026-11-04 B: up green, down red, same neutral, and the text meets
// contrast in both themes. jsdom computes no colour, so the decisions are
// pinned in the module's own text, comments stripped. The fills are the band
// tokens, pinned out of the dark flip (tests/themeParity.test.ts), and the
// label is the pinned ink, so the measured ratios (8.13, 4.61, 9.88) hold in
// both themes.

const ROOT = join(import.meta.dirname, '..')
const source = readFileSync(join(ROOT, 'src/board/ChangeMark.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function block(prelude: string): string {
  const match = new RegExp(`(^|\\n)${prelude.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(source)
  if (!match) throw new Error(`no block for ${prelude}`)
  return match[2]
}
const has = (body: string, declaration: string) =>
  body.split(';').map((part) => part.trim().replace(/\s+/g, ' ')).includes(declaration)

describe('the change chip colours', () => {
  it('fills up with the healthy teal', () => {
    expect(has(block('.up'), '--change-fill: var(--band-healthy)')).toBe(true)
  })

  it('fills down with the risk red', () => {
    expect(has(block('.down'), '--change-fill: var(--band-risk)')).toBe(true)
  })

  it('fills no change with the neutral stone', () => {
    expect(has(block('.same'), '--change-fill: var(--band-none)')).toBe(true)
  })

  it('sets the label in the pinned ink, on the fill', () => {
    const chip = block('.change')
    expect(has(chip, '--change-text: var(--text-on-band)')).toBe(true)
    expect(has(chip, 'color: var(--change-text)')).toBe(true)
    expect(has(chip, 'background: var(--change-fill)')).toBe(true)
  })

  it('declares no colour of its own anywhere else', () => {
    const colours = [...source.matchAll(/(?:^|[;{\s])(color|background|--change-[a-z]+)\s*:\s*([^;}]+)/g)].map(
      (match) => `${match[1]}: ${match[2].trim()}`,
    )
    expect(colours.sort()).toEqual(
      [
        '--change-fill: var(--band-none)',
        '--change-text: var(--text-on-band)',
        'background: var(--change-fill)',
        'color: var(--change-text)',
        '--change-fill: var(--band-healthy)',
        '--change-fill: var(--band-risk)',
        '--change-fill: var(--band-none)',
      ].sort(),
    )
  })
})
