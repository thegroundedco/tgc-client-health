import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The two dark blocks are the cost of rejecting light-dark() (spec §4.1). They
// cannot drift in VALUE -- each contains only var(--dark-*) repointings, and the
// literals are defined once. They can still drift in MEMBERSHIP: someone adds an
// eighth token to one block and not the other, and the app is then correct on a
// dark-preferring OS and wrong for anyone who pressed the Dark button. No DOM
// test can see that; jsdom computes no cascade and vitest stubs CSS Modules.
//
// Lives outside src/ because it needs node:fs, and tsconfig.app.json gives src/
// no Node types -- the same reason tests/tokens.test.ts lives here.

const SOURCE = readFileSync(
  join(import.meta.dirname, '..', 'src', 'styles', 'tokens.css'),
  'utf8',
)

// Comments stripped before any assertion reads the file. tokens.css explains its
// own traps by naming the tokens that caused them, so a check run against the raw
// text would match the prose and pass on the explanation rather than the code.
// tokenRules.ts warns about this in its own header; matrixGrid.test.ts hit it too.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')

const MEDIA = ":root:not([data-theme='light'])"
const OVERRIDE = ":root[data-theme='dark']"

function declarations(selector: string): string[] {
  const opener = `${selector} {`
  const start = CODE.indexOf(opener)
  if (start === -1) throw new Error(`no rule for "${selector}" in tokens.css`)
  const end = CODE.indexOf('}', start)
  if (end === -1) throw new Error(`rule "${selector}" is never closed`)
  return CODE.slice(start + opener.length, end)
    .split(';')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort()
}

describe('the two dark blocks', () => {
  // A test that silently found nothing would pass forever. This project has
  // already shipped one check that reported success by finding no data.
  it('is read, not silently skipped', () => {
    expect(SOURCE.length).toBeGreaterThan(1000)
    expect(CODE).toContain(`${MEDIA} {`)
    expect(CODE).toContain(`${OVERRIDE} {`)
  })

  it('declare exactly the same properties with the same values', () => {
    expect(declarations(MEDIA)).toEqual(declarations(OVERRIDE))
  })

  it('both set color-scheme, or the platform widgets stay light', () => {
    expect(declarations(MEDIA)).toContain('color-scheme: dark')
    expect(declarations(OVERRIDE)).toContain('color-scheme: dark')
  })

  it('repoint every --dark-* literal the brand block defines, and no more', () => {
    const defined = [...CODE.matchAll(/(--dark-[a-z-]+)\s*:/g)]
      .map((match) => match[1])
      .sort()
    const used = [...declarations(OVERRIDE).join(';').matchAll(/var\((--dark-[a-z-]+)\)/g)]
      .map((match) => match[1])
      .sort()
    expect(defined.length).toBeGreaterThan(0)
    expect(used).toEqual(defined)
  })

  // Spec §3. Both of these inherit correctly in light and catastrophically in
  // dark: a flipped --brand-ink puts the health labels at 1.72:1 on teal, and a
  // flipped --brand-rule puts them at 1.71:1 on the "not scored" fill. The chips
  // stay the right colour and become unreadable, which is the encoding failing
  // without anything looking broken.
  it('never repoints the pinned tokens', () => {
    const both = [...declarations(MEDIA), ...declarations(OVERRIDE)].join(';')
    expect(both).not.toContain('--brand-ink-fixed')
    expect(both).not.toContain('--brand-stone')
  })

  it('points the band label and the not-scored fill at the pinned tokens', () => {
    expect(CODE).toContain('--text-on-band: var(--brand-ink-fixed)')
    expect(CODE).toContain('--band-none: var(--brand-stone)')
  })
})
