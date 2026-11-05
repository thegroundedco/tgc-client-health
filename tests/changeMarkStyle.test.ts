import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Brief 2026-11-05 B1, the owner's words: "Not a red or green background, just
// make the arrow and numbers colored." So the change mark is coloured TEXT: no
// fill, no pill, the glyph and the number in the direction's colour. Up
// green/teal, down red, same the muted text.
//
// jsdom computes no colour, so the decisions are pinned in the module's own
// text, comments stripped, and the contrast is COMPUTED here from tokens.css:
// every text token is resolved through the semantic and brand layers, in light
// and in dark (the dark override block applied), and measured with the WCAG 2.x
// formula against all three surfaces. 4.5:1 is the floor for normal text.

const ROOT = join(import.meta.dirname, '..')
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')
const source = stripComments(readFileSync(join(ROOT, 'src/board/ChangeMark.module.css'), 'utf8'))
const TOKENS = stripComments(readFileSync(join(ROOT, 'src/styles/tokens.css'), 'utf8'))

function block(prelude: string): string {
  const match = new RegExp(`(^|\\n)${prelude.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(source)
  if (!match) throw new Error(`no block for ${prelude}`)
  return match[2]
}
const has = (body: string, declaration: string) =>
  body.split(';').map((part) => part.trim().replace(/\s+/g, ' ')).includes(declaration)

describe('the change mark colours', () => {
  it('sets up in the up text colour', () => {
    expect(has(block('.up'), '--change-text: var(--change-up-text)')).toBe(true)
  })

  it('sets down in the down text colour', () => {
    expect(has(block('.down'), '--change-text: var(--change-down-text)')).toBe(true)
  })

  it('sets no change in the neutral muted text', () => {
    expect(has(block('.same'), '--change-text: var(--change-same-text)')).toBe(true)
  })

  it('colours the text, the glyph and the number alike', () => {
    expect(has(block('.change'), 'color: var(--change-text)')).toBe(true)
  })

  it('has no fill and no pill padding', () => {
    const declarations = source.split(/[;{}]/).map((part) => part.trim())
    expect(declarations.filter((d) => /^background/.test(d))).toEqual([])
    expect(declarations.filter((d) => /^padding/.test(d))).toEqual([])
    expect(declarations.filter((d) => /^border-radius/.test(d))).toEqual([])
  })

  it('declares no colour of its own anywhere else', () => {
    const colours = [...source.matchAll(/(?:^|[;{\s])(color|background[a-z-]*|--change-[a-z-]+)\s*:\s*([^;}]+)/g)].map(
      (match) => `${match[1]}: ${match[2].trim()}`,
    )
    expect(colours.sort()).toEqual(
      [
        '--change-text: var(--change-same-text)',
        'color: var(--change-text)',
        '--change-text: var(--change-up-text)',
        '--change-text: var(--change-down-text)',
        '--change-text: var(--change-same-text)',
      ].sort(),
    )
  })
})

// --- contrast, computed from tokens.css -------------------------------------

function declarationsOf(selector: string): Map<string, string> {
  const opener = `${selector} {`
  const start = TOKENS.indexOf(opener)
  if (start === -1) throw new Error(`no rule for "${selector}" in tokens.css`)
  const end = TOKENS.indexOf('}', start)
  const map = new Map<string, string>()
  for (const part of TOKENS.slice(start + opener.length, end).split(';')) {
    const match = /^\s*(--[a-z0-9-]+)\s*:\s*([\s\S]+?)\s*$/.exec(part)
    if (match) map.set(match[1], match[2])
  }
  return map
}

const LIGHT = declarationsOf(':root')
const DARK = new Map([...LIGHT, ...declarationsOf(":root[data-theme='dark']")])

function resolve(theme: Map<string, string>, token: string, depth = 0): string {
  if (depth > 10) throw new Error(`cycle resolving ${token}`)
  const value = theme.get(token)
  if (value === undefined) throw new Error(`${token} is not defined`)
  const reference = /^var\((--[a-z0-9-]+)\)$/.exec(value)
  if (reference) return resolve(theme, reference[1], depth + 1)
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`${token} resolves to ${value}, not a hex colour`)
  return value
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

const round = (value: number) => Math.round(value * 100) / 100
const SURFACES = ['--surface-page', '--surface-raised', '--surface-sunken'] as const
const TEXTS = ['--change-up-text', '--change-down-text', '--change-same-text'] as const

function ratios(theme: Map<string, string>, text: string): number[] {
  return SURFACES.map((surface) => round(contrast(resolve(theme, text), resolve(theme, surface))))
}

describe('the change mark contrast', () => {
  it('measures the formula against a known pair', () => {
    expect(round(contrast('#000000', '#FFFFFF'))).toBe(21)
    expect(round(contrast('#B82B25', '#FBF7EB'))).toBe(5.75)
  })

  // page, raised, sunken.
  it('pins the light ratios', () => {
    expect(ratios(LIGHT, '--change-up-text')).toEqual([5.11, 5.38, 4.64])
    expect(ratios(LIGHT, '--change-down-text')).toEqual([5.75, 6.05, 5.22])
    expect(ratios(LIGHT, '--change-same-text')).toEqual([5.46, 5.74, 4.95])
  })

  it('pins the dark ratios', () => {
    expect(ratios(DARK, '--change-up-text')).toEqual([8.28, 7.41, 8.89])
    expect(ratios(DARK, '--change-down-text')).toEqual([6.02, 5.39, 6.46])
    expect(ratios(DARK, '--change-same-text')).toEqual([6.32, 5.66, 6.78])
  })

  it('meets WCAG AA for normal text on every surface in both themes', () => {
    for (const theme of [LIGHT, DARK]) {
      for (const text of TEXTS) {
        for (const ratio of ratios(theme, text)) expect(ratio).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps up and down apart from each other, not only from the ground', () => {
    for (const theme of [LIGHT, DARK]) {
      expect(resolve(theme, '--change-up-text')).not.toBe(resolve(theme, '--change-down-text'))
    }
  })
})
