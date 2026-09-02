import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The theme switch is animated by adding a class to <html> for the length of
// one change and taking it off again. That splits one duration across two
// files: theme.ts holds the milliseconds JavaScript waits before removing the
// class, and tokens.css holds the milliseconds CSS actually animates for.
//
// Neither half is wrong on its own, so nothing else can catch them disagreeing.
// Set the token to 300ms and the constant to 150 and the class comes off
// mid-fade, cutting the animation dead halfway with every test still green.
// Set it the other way and the class lingers over whatever the person does
// next. This test is the only thing holding them together.
//
// Lives outside src/ because it needs node:fs, and tsconfig.app.json gives src/
// no Node types -- the same reason tests/tokens.test.ts lives here.

const ROOT = join(import.meta.dirname, '..')
const THEME_TS = readFileSync(join(ROOT, 'src', 'styles', 'theme.ts'), 'utf8')
const TOKENS = readFileSync(join(ROOT, 'src', 'styles', 'tokens.css'), 'utf8')
const BASE = readFileSync(join(ROOT, 'src', 'styles', 'base.css'), 'utf8')

// Read out of theme.ts's SOURCE rather than imported, and not by preference:
// tests/ compiles under tsconfig.node.json, which has no DOM lib, while
// theme.ts's types reach for Storage and Element. Importing it here fails the
// build. tests/bootTheme.test.ts hit the same wall and uses the same technique.
function exportedNumber(name: string): number {
  const match = THEME_TS.match(new RegExp(`export const ${name}[^=]*=\\s*(\\d+)`))
  if (!match) throw new Error(`theme.ts does not export ${name} as a number literal`)
  return Number(match[1])
}

function exportedString(name: string): string {
  const match = THEME_TS.match(new RegExp(`export const ${name}[^=]*=\\s*'([^']*)'`))
  if (!match) throw new Error(`theme.ts does not export ${name} as a string literal`)
  return match[1]
}

// The comment-stripped stylesheet, which is what every assertion below reads.
// base.css explains its own traps by naming the selectors that caused them, and
// a check run against the raw text would match the prose and pass on the
// explanation rather than on the code. tokenRules.ts warns about this in its
// own header; matrixGrid.test.ts hit it too.
const BASE_CODE = BASE.replace(/\/\*[\s\S]*?\*\//g, '')
const TOKENS_CODE = TOKENS.replace(/\/\*[\s\S]*?\*\//g, '')

describe('the theme transition', () => {
  // A test that silently found nothing would pass forever. This project has
  // already shipped one check that reported success by finding no data.
  it('is read, not silently skipped', () => {
    expect(THEME_TS.length).toBeGreaterThan(500)
    expect(BASE_CODE.length).toBeGreaterThan(1000)
    expect(TOKENS_CODE.length).toBeGreaterThan(1000)
    expect(exportedString('TRANSITION_CLASS')).toBe('theme-transition')
  })

  it('animates for exactly as long as JavaScript waits before stopping it', () => {
    const match = TOKENS_CODE.match(/--theme-transition:\s*(\d+)ms/)
    if (!match) throw new Error('tokens.css declares no --theme-transition in ms')
    expect(Number(match[1])).toBe(exportedNumber('TRANSITION_MS'))
  })

  it('drives the rule from the same class name theme.ts adds', () => {
    expect(BASE_CODE).toContain(`.${exportedString('TRANSITION_CLASS')}`)
  })

  // The rule must sit inside a no-preference block, not merely be undone by
  // base.css's existing reduce block. A person who asked their machine for less
  // motion should get the instant switch they asked for, from a rule that was
  // never applied -- not from one applied and then overridden.
  it('is only ever declared for a machine that has not asked for less motion', () => {
    const guard = BASE_CODE.indexOf('prefers-reduced-motion: no-preference')
    expect(guard).toBeGreaterThan(-1)
    const rule = BASE_CODE.indexOf('.theme-transition')
    expect(rule).toBeGreaterThan(guard)
  })

  // Colour only. A transition on `all` would animate layout and paint
  // properties nothing about a theme change touches -- and would catch width
  // and height on anything that happens to be mid-render when the class lands.
  it('transitions colour properties rather than everything', () => {
    const start = BASE_CODE.indexOf('.theme-transition')
    const block = BASE_CODE.slice(start, BASE_CODE.indexOf('}', start))
    expect(block).not.toMatch(/transition:\s*all/)
    expect(block).toContain('background-color')
    expect(block).toContain('color')
  })
})
