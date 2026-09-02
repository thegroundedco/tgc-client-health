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

const THEME_MODULE = readFileSync(
  join(import.meta.dirname, '..', 'src', 'styles', 'theme.ts'),
  'utf8',
)

// THEME_PREFERENCES and DEFAULT_PREFERENCE, read out of theme.ts's source text
// rather than imported. Not for tests/bootTheme.test.ts's reason -- these two
// are not single literal strings a second file must independently spell the
// same way, so importing them would not let this test agree with theme.ts by
// construction about anything this file actually checks. It is ruled out on a
// plainer, structural ground: this file is compiled under tsconfig.node.json,
// which has Node's lib and no DOM, while theme.ts's own types reach for
// `Element` and `Storage` -- importing it here would pull those DOM types into
// a program with no DOM lib and fail the BUILD, not the assertion. Reading the
// values out of source text sidesteps that, at the same modest cost
// tests/bootTheme.test.ts's exportedString already pays for a different reason.
function exportedString(name: string): string {
  const match = THEME_MODULE.match(new RegExp(`export const ${name}[^=]*=\\s*'([^']*)'`))
  if (!match) throw new Error(`theme.ts does not export ${name} as a string literal`)
  return match[1]
}

function exportedArray(name: string): string[] {
  const match = THEME_MODULE.match(new RegExp(`export const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`))
  if (!match) throw new Error(`theme.ts does not export ${name} as an array literal`)
  return [...match[1].matchAll(/'([^']*)'/g)].map((entry) => entry[1])
}

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

describe('theme coverage', () => {
  // The hole tests/bootTheme.test.ts closes on the HTML side: THEME_PREFERENCES
  // gaining a fourth entry with no matching CSS ships silently, because nothing
  // before this asserted that every non-default preference has SOMEWHERE in
  // tokens.css keyed to its attribute value. Today's two shapes differ on
  // purpose -- dark gets its own :root[data-theme='dark'] override block,
  // while light is the baseline and only needs the media query NEUTRALISED via
  // :root:not([data-theme='light']), because there is nothing left to repoint
  // once the media query is out of the way. Both shapes leave the literal
  // selector text `[data-theme='<preference>']` somewhere in the file, which is
  // the one thing a third kind of preference with no CSS written for it at all
  // could never do -- so this checks for the selector's presence rather than
  // for either specific shape, which is what lets it catch a preference nobody
  // has invented yet instead of only re-confirming the two that already exist.
  //
  // See the note above THEME_MODULE for why these are read out of source text
  // rather than imported. That reasoning is structural (a DOM-typed module
  // cannot be imported into this file's no-DOM program), not the
  // agree-by-construction concern tests/bootTheme.test.ts's exportedString
  // guards against -- but it still leaves this assertion honest: the array
  // only chooses WHICH selector text to go looking for in tokens.css, a file
  // theme.ts plays no part in, so nothing here lets tokens.css off the hook
  // for containing the literal text.
  it('gives every non-default preference a selector in tokens.css', () => {
    const overrides = exportedArray('THEME_PREFERENCES').filter(
      (preference) => preference !== exportedString('DEFAULT_PREFERENCE'),
    )
    expect(overrides.length).toBeGreaterThan(0)
    for (const preference of overrides) {
      expect(CODE).toContain(`[data-theme='${preference}']`)
    }
  })
})
