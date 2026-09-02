import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// index.html's inline theme script duplicates two string constants from
// src/styles/theme.ts, and it has to: it runs before the bundle exists, so it
// cannot import them. This test is the thing that stops the duplicate drifting.
//
// The failure it prevents is quiet. Change THEME_KEY in the module, forget the
// HTML, and every automated test still passes: the control still works, the
// preference is still stored, still read back, still applied -- and every page
// load flashes the wrong theme until React mounts, because the script is
// reading a key nobody writes any more.

const ROOT = join(import.meta.dirname, '..')
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8')
const MODULE = readFileSync(join(ROOT, 'src', 'styles', 'theme.ts'), 'utf8')

// The value of an exported string constant, read out of theme.ts's source. Not
// imported: importing would make this test agree with the module by
// construction, and agreeing with the module is the entire question.
function exportedString(name: string): string {
  const match = MODULE.match(new RegExp(`export const ${name}[^=]*=\\s*'([^']*)'`))
  if (!match) throw new Error(`theme.ts does not export ${name} as a string literal`)
  return match[1]
}

// THEME_PREFERENCES, read out of source text rather than imported -- and here
// the reason is not the same one exportedString is for. Importing it would
// have been the natural choice: the array only says WHICH words to go looking
// for in the script's actual text, so importing does not let this test agree
// with the module about anything the script itself has to independently
// contain. It is ruled out on a plainer, structural ground instead: this file
// is compiled under tsconfig.node.json, which gives it Node's lib and no DOM,
// while src/styles/theme.ts's own types reach for `Element` and `Storage` --
// importing it from here would pull those DOM types into a program that has
// no DOM lib and fail the build, not fail the assertion. Reading the array out
// of source text sidesteps that entirely, at the same small cost exportedString
// already pays.
function exportedArray(name: string): string[] {
  const match = MODULE.match(new RegExp(`export const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`))
  if (!match) throw new Error(`theme.ts does not export ${name} as an array literal`)
  return [...match[1].matchAll(/'([^']*)'/g)].map((entry) => entry[1])
}

const allPreferences = exportedArray('THEME_PREFERENCES')

// The state that was retired on 2026-09-02 when the control became a
// two-position pill. There is no longer a default to exclude -- both live
// preferences are explicit and both are written to storage -- but the retired
// word must stay OUT of the script: a browser holding it falls through to the
// OS by failing validation, and a script that started matching it again would
// stamp data-theme="system", an attribute no CSS block matches.
const RETIRED_PREFERENCE = 'system'

describe('the inline theme script', () => {
  it('is read, not silently skipped', () => {
    expect(HTML.length).toBeGreaterThan(500)
    expect(MODULE.length).toBeGreaterThan(500)
    expect(exportedString('THEME_KEY')).toBe('theme')
    expect(exportedString('THEME_ATTRIBUTE')).toBe('data-theme')
  })

  // In <head>, so it runs before the body paints. In the body it would still
  // run before React -- and still after the first paint, which is the whole
  // failure it exists to prevent.
  it('runs in the head', () => {
    const head = HTML.slice(0, HTML.indexOf('</head>'))
    expect(head).toContain(`localStorage.getItem('${exportedString('THEME_KEY')}')`)
    expect(head).toContain(`setAttribute('${exportedString('THEME_ATTRIBUTE')}'`)
  })

  it('runs before the module bundle is even requested', () => {
    expect(HTML.indexOf(exportedString('THEME_ATTRIBUTE'))).toBeLessThan(
      HTML.indexOf('src="/src/main.tsx"'),
    )
  })

  // Storage that throws must not take out the page before it has drawn
  // anything. This is the one script in the app with nothing above it to catch.
  it('is wrapped against storage that throws', () => {
    const head = HTML.slice(0, HTML.indexOf('</head>'))
    const script = head.slice(head.lastIndexOf('<script'))
    expect(script).toContain('try')
    expect(script).toContain('catch')
  })

  // It must recognise every live preference, and not the retired one. Derived
  // from THEME_PREFERENCES rather than the two words 'light' and 'dark'
  // written out here: hardcoding them is exactly how a THIRD preference, added
  // to the module tomorrow, would ship with this test still green and the
  // script silently blind to it -- stamping an attribute no CSS block matches
  // and flashing the wrong theme on every load.
  it('recognises every live preference and not the retired one', () => {
    expect(allPreferences.length).toBeGreaterThan(0)
    const head = HTML.slice(0, HTML.indexOf('</head>'))
    const script = head.slice(head.lastIndexOf('<script'))
    for (const preference of allPreferences) {
      expect(script).toContain(`'${preference}'`)
    }
    expect(script).not.toContain(`'${RETIRED_PREFERENCE}'`)
  })

  // type="module" defers execution until the module graph resolves and the
  // bundle is fetched -- past first paint, which is the one thing this script
  // exists to run before. Every other assertion in this file would still pass
  // against a script that had quietly grown that attribute; only this one
  // would catch it.
  it('is a classic script, not a module', () => {
    const head = HTML.slice(0, HTML.indexOf('</head>'))
    expect(head).not.toContain('type="module"')
    expect(head).not.toContain("type='module'")
  })

  // head.lastIndexOf('<script') above silently retargets to whichever inline
  // script was added to <head> most recently, if a second one ever is. That
  // would not fail loudly -- it would just start reading and asserting
  // against the wrong script's text, quietly. Pinning the count to exactly
  // one is what turns that retarget into a failing test instead of a passing
  // one that stopped checking what it claims to check.
  it('is the only inline script in <head>', () => {
    const head = HTML.slice(0, HTML.indexOf('</head>'))
    const openTags = head.match(/<script(?:\s[^>]*)?>/g) ?? []
    expect(openTags.length).toBe(1)
  })
})
