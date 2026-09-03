import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// The check that would have caught `t-small` and `t-subhead`.
//
// Both shipped referenced-but-undefined and stayed that way through a spec, a
// plan, per-task reviews and a whole-branch review, because nothing anywhere
// connects the class a component asks for to the stylesheet that has to define
// it. A missing type role does not throw, does not warn and does not blank the
// screen -- the element simply inherits, so the page still renders and still
// reads like a page. `t-small` was live for a week on a span that also carried
// `text-transform: uppercase` and --tracking-label, which meant the quiet
// marker in each revenue row was set at body size in caps: the loudest thing
// on the row, on a screen nobody had reason to re-check.
//
// Lives outside src/ because it needs node:fs, like tests/tokens.test.ts.

const ROOT = join(import.meta.dirname, '..')
const SRC = join(ROOT, 'src')

function collect(directory: string, extension: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      collect(absolute, extension, found)
      continue
    }
    if (entry.name.endsWith(extension)) found.push(absolute)
  }
  return found
}

function show(path: string): string {
  return relative(ROOT, path).split(sep).join('/')
}

// Only NON-module stylesheets can define one of these. A `.t-subhead` written
// in a *.module.css is compiled to a hashed local name, so a component writing
// the bare string `className="t-subhead"` would match nothing -- the same
// silent inheritance as never defining it at all, arrived at by a different
// road. Restricting the definitions to global stylesheets is what makes this
// test refuse that near-miss rather than bless it.
const GLOBAL_SHEETS = collect(SRC, '.css').filter((path) => !path.endsWith('.module.css'))

const DEFINED = new Set(
  GLOBAL_SHEETS.flatMap((path) => [
    ...readFileSync(path, 'utf8').matchAll(/\.(t-[a-z][a-z0-9-]*)\b/g),
  ]).map((match) => match[1]),
)

// className values only, never the whole file. The word "t-" appears all over
// this codebase's prose -- "component-under-test-dom", "the request-under-test
// -- and" -- and a scan of raw source text would collect those as roles and
// fail on comments. Both attribute forms are matched: the quoted string and the
// braced expression, which covers the template literals that pair a global role
// with a CSS-module class.
const USED = new Map<string, string[]>()

for (const path of collect(SRC, '.tsx')) {
  const source = readFileSync(path, 'utf8')
  for (const attribute of source.matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)) {
    const value = attribute[1] ?? attribute[2] ?? ''
    for (const role of value.matchAll(/\bt-[a-z][a-z0-9-]*\b/g)) {
      const seen = USED.get(role[0]) ?? []
      if (!seen.includes(path)) seen.push(path)
      USED.set(role[0], seen)
    }
  }
}

describe('every type role a component asks for', () => {
  // Guards the two scans above. If the walk breaks, or the className regex
  // stops matching, the real assertion below passes over an empty set and
  // reports nothing wrong -- a green test that checks nothing, which is the
  // exact shape of failure this file exists to stop.
  it('is actually found by this test', () => {
    expect(GLOBAL_SHEETS.length).toBeGreaterThan(0)
    expect(DEFINED.has('t-body')).toBe(true)
    expect(DEFINED.has('t-caption')).toBe(true)
    expect(USED.has('t-body')).toBe(true)
    expect(USED.size).toBeGreaterThan(4)
  })

  it('is defined in a global stylesheet', () => {
    const undefinedRoles = [...USED.entries()]
      .filter(([role]) => !DEFINED.has(role))
      .map(([role, paths]) => `  .${role} — used in ${paths.map(show).join(', ')}`)

    expect(undefinedRoles.join('\n')).toBe('')
  })
})
