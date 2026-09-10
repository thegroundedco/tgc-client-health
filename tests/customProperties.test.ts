import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Every var(--x) in the repository names a custom property that is actually
// declared somewhere.
//
// Written after shipping --text-muted, which does not exist and never has. A
// var() pointing at nothing does not throw, does not warn, and does not fail a
// build: the declaration is simply dropped and the element inherits, so the
// text was the wrong colour and everything looked deliberate. That is the same
// failure shape as .status-pill--ended at 1.45:1 -- the encoding fails while
// nothing looks broken -- and it is the shape this project keeps deciding to
// catch with a test rather than with care.
//
// Lives outside src/ because it needs node:fs, like tests/tokens.test.ts.

const ROOT = join(import.meta.dirname, '..')
const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage', '.superpowers'])

function walk(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...walk(path))
    else if (path.endsWith('.css') || path.endsWith('.tsx') || path.endsWith('.ts')) {
      found.push(path)
    }
  }
  return found
}

// Comments stripped before anything reads the source. This repository
// explains its own token rules in prose that names and demonstrates them --
// tokenRules.ts warns about exactly this and matrixGrid.test.ts hit it for
// real -- and the first run of this check reported two findings, both of them
// a sentence in a comment rather than a line of code.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

const FILES = walk(ROOT).map((path) => ({
  path: path.slice(ROOT.length + 1),
  source: withoutComments(readFileSync(path, 'utf8')),
}))

// Declarations are `--name:` at the start of a declaration; references are
// `var(--name`. A file may do both, and tokens.css does almost nothing else.
const DECLARED = new Set<string>()
for (const file of FILES) {
  for (const match of file.source.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) {
    DECLARED.add(match[1])
  }
}

describe('custom properties', () => {
  // A walk that found nothing would pass forever. This project has already
  // shipped one check that reported success by finding no data.
  it('is read, not silently skipped', () => {
    expect(FILES.length).toBeGreaterThan(40)
    expect(DECLARED.size).toBeGreaterThan(50)
    expect(DECLARED.has('--text-primary')).toBe(true)
  })

  it('are all declared somewhere before they are referenced', () => {
    const dangling: string[] = []
    for (const file of FILES) {
      const lines = file.source.split('\n')
      lines.forEach((line, index) => {
        // The closing delimiter is required. Without it this also matched
        // `var(--face-\u2026)` inside tokenRules.ts's advice string -- prose
        // telling a developer the SHAPE of a reference, not a reference. A
        // name that is not syntactically a complete var() is not one.
        for (const match of line.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*[),]/g)) {
          if (!DECLARED.has(match[1])) {
            dangling.push(`${file.path}:${index + 1} references ${match[1]}`)
          }
        }
      })
    }
    expect(dangling).toEqual([])
  })
})
