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

  // It must recognise exactly the two OVERRIDES. 'system' is represented by the
  // key's absence (theme.ts's writePreference clears it), so a script that also
  // matched the word would be reading a value that is never written.
  it('recognises the two overrides and not the default', () => {
    const head = HTML.slice(0, HTML.indexOf('</head>'))
    const script = head.slice(head.lastIndexOf('<script'))
    expect(script).toContain("'light'")
    expect(script).toContain("'dark'")
    expect(script).not.toContain("'system'")
  })
})
