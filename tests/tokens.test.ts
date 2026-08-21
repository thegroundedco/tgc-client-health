import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findViolations,
  formatViolations,
  type SourceFile,
} from '../src/styles/tokenRules.ts'

// Lives outside src/ because it needs node:fs, and tsconfig.app.json gives src/
// no Node types on purpose. Vitest's default include pattern picks up
// **/*.test.ts, so this runs under a plain `npm test` and inside the deploy
// workflow's test gate with no configuration change.

const ROOT = join(import.meta.dirname, '..')

// The extensions that can carry a colour or a typeface. Everything else in the
// tree — .json, .sql, .md, .woff2 — either cannot style the app or is not ours
// to police.
//
// .svg is in the list although there is no SVG in the tree yet. Spec §10 carries
// two open items that are SVGs — the logo lockup and the kiwi favicon — and an
// exported asset arrives with its brand colours written into it as literals. The
// day those land is the day the rule needs to already be watching; adding the
// extension afterwards means noticing first, which is the failure mode this
// whole check exists to remove.
const EXTENSIONS = ['.css', '.ts', '.tsx', '.html', '.svg']

const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'supabase', 'docs'])

function collect(directory: string, found: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      collect(absolute, found)
      continue
    }
    if (!EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue
    found.push({
      // Forward slashes on every platform, so EXEMPT_PATHS can be written once.
      path: relative(ROOT, absolute).split(sep).join('/'),
      source: readFileSync(absolute, 'utf8'),
    })
  }
  return found
}

describe('the repository', () => {
  const files: SourceFile[] = [
    ...collect(join(ROOT, 'src')),
    // Read directly rather than by walking the repository root and filtering
    // down to one file. A root walk would recurse through .superpowers,
    // .github and scripts on every run, and would start policing files there
    // the moment one of them had a .ts extension. index.html is in the list
    // because it is the only file outside src/ that can style the app: it
    // links the two global stylesheets.
    { path: 'index.html', source: readFileSync(join(ROOT, 'index.html'), 'utf8') },
  ]

  // A walk that silently finds nothing would pass forever. This project has
  // already shipped one check that reported success by finding no data — see
  // "What a silent grep looks like" in the README. Assert the walk actually walked.
  it('is walked, not silently skipped', () => {
    expect(files.length).toBeGreaterThan(15)
    expect(files.map((f) => f.path)).toContain('index.html')
    expect(files.map((f) => f.path)).toContain('src/styles/tokens.css')
    expect(files.map((f) => f.path)).toContain('src/board/Board.tsx')
  })

  it('keeps every colour and typeface in src/styles/tokens.css', () => {
    const violations = findViolations(files)
    expect(formatViolations(violations)).toBe('')
  })
})
