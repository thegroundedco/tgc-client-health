import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Every global class name a component asks for is one a global stylesheet
// actually declares.
//
// The sibling of tests/customProperties.test.ts, and written the same day for
// the same reason: `className="button-quiet"` when the class is `button--quiet`
// styles nothing, throws nothing, warns nothing, and fails no build. The button
// renders as unstyled text and looks like a deliberate choice. CSS modules are
// safe from this -- `styles.typo` is undefined and shows up -- but the global
// vocabulary (t-body, prose, alert, button) is plain strings with no checking
// anywhere.
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
    else found.push(path)
  }
  return found
}

const FILES = walk(join(ROOT, 'src'))

// Global stylesheets only. A .module.css declares scoped names reached through
// the `styles` object, which the compiler already checks.
const DECLARED = new Set<string>()
for (const path of FILES.filter((p) => p.endsWith('.css') && !p.includes('.module.'))) {
  const source = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of source.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) DECLARED.add(match[1])
}

describe('global class names', () => {
  // A walk that found nothing would pass forever. This project has already
  // shipped one check that reported success by finding no data.
  it('is read, not silently skipped', () => {
    expect(DECLARED.size).toBeGreaterThan(20)
    expect(DECLARED.has('t-body')).toBe(true)
    expect(DECLARED.has('button--quiet')).toBe(true)
  })

  it('are all declared in a global stylesheet', () => {
    const dangling: string[] = []
    for (const path of FILES.filter((p) => p.endsWith('.tsx'))) {
      const source = readFileSync(path, 'utf8')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
      source.split('\n').forEach((line, index) => {
        // Only the literal text of a className. A `${styles.x}` interpolation
        // is a module class the compiler already resolves, so it is blanked
        // out rather than parsed.
        for (const match of line.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
          const literal = (match[1] ?? match[2] ?? '').replace(/\$\{[^}]*\}/g, ' ')
          for (const token of literal.split(/\s+/).filter(Boolean)) {
            if (!DECLARED.has(token)) {
              dangling.push(`${path.slice(ROOT.length + 1)}:${index + 1} uses .${token}`)
            }
          }
        }
      })
    }
    expect(dangling).toEqual([])
  })
})
