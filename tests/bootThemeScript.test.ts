import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// tests/bootTheme.test.ts proves the inline script's TEXT agrees with
// theme.ts's constants -- the key, the attribute, wrapped in try/catch,
// sitting before main.tsx. None of that proves the script actually WORKS.
// oxlint does not lint .html, and Vite passes a classic inline script through
// to the browser verbatim, unparsed and untyped, all the way to production. A
// typo in a string, a swapped `||` for `&&`, a dropped quote -- nothing
// before a real browser loads the real page would catch it, and the failure
// mode is silent: the preference the script exists to apply before first
// paint just stops applying, and the flash spec §5 was written to prevent
// comes back, invisible to every regex-based check of the same text.
//
// So this test does the one thing none of those do: pulls the script's own
// source text out of index.html and RUNS it, against stand-ins for
// localStorage and document.documentElement built the same way
// src/styles/theme.test.ts stubs them for the pure functions this script is a
// hand-written copy of. It is also the third site for the "system means
// absence" contract -- theme.ts's own tests cover readPreference and
// applyPreference, this covers the HTML copy of the same idea -- so all three
// places that must agree on it now are actually exercised, not just read.

const ROOT = join(import.meta.dirname, '..')
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8')

// Exactly one inline script belongs in <head> today -- this one.
// tests/bootTheme.test.ts's own "is the only inline script in <head>"
// assertion is what stops a second one landing there silently; this
// extraction leans on that same invariant rather than re-asserting it.
function headScriptBody(): string {
  const head = HTML.slice(HTML.indexOf('<head'), HTML.indexOf('</head>'))
  const matches = [...head.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one inline <script> in <head>, found ${matches.length}`,
    )
  }
  return matches[0][1]
}

// A stubbed document.documentElement, and the script's own body run against
// it with `new Function`. Not eval: Function gives the script its own scope
// with exactly the two names it is allowed to see passed in as parameters --
// `localStorage` and `document` -- the same discipline theme.ts's
// StorageLike and RootLike types put on the module this script hand-copies.
function run(storage: unknown): { setAttribute: ReturnType<typeof vi.fn> } {
  const documentElement = { setAttribute: vi.fn() }
  const fakeDocument = { documentElement }
  const body = headScriptBody()
  const fn = new Function('localStorage', 'document', body)
  fn(storage, fakeDocument)
  return documentElement
}

describe('the inline theme script, actually run', () => {
  it('is read, not silently skipped', () => {
    expect(headScriptBody().length).toBeGreaterThan(20)
  })

  it('stamps the attribute for a stored dark override', () => {
    const el = run({ getItem: () => 'dark' })
    expect(el.setAttribute).toHaveBeenCalledWith('data-theme', 'dark')
  })

  it('stamps the attribute for a stored light override', () => {
    const el = run({ getItem: () => 'light' })
    expect(el.setAttribute).toHaveBeenCalledWith('data-theme', 'light')
  })

  it('does nothing for an unrecognised value', () => {
    const el = run({ getItem: () => 'midnight' })
    expect(el.setAttribute).not.toHaveBeenCalled()
  })

  it('does nothing when the key is absent', () => {
    const el = run({ getItem: () => null })
    expect(el.setAttribute).not.toHaveBeenCalled()
  })

  // Safari in private browsing throws on the property ACCESS, not only on
  // quota, and this is the one script in the app with nothing above it to
  // catch a throw before first paint.
  it('does nothing, rather than throwing past first paint, when storage throws on access', () => {
    const el = run({
      getItem: () => {
        throw new Error('denied')
      },
    })
    expect(el.setAttribute).not.toHaveBeenCalled()
  })
})
