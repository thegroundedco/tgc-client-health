import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// The three-layer palette (docs/superpowers/specs/2026-09-02-light-dark-theme-
// design.md §2) rests on one rule that nothing until now enforced: a component
// reaches the SEMANTIC layer only. BRAND is the layer dark mode overrides --
// tokens.css repoints every --brand-* token twice, once per scheme -- so a rule
// that reaches PAST semantics for a brand token directly gets whichever value
// the current scheme happens to hold, under a name that records nothing about
// the job it is doing.
//
// That is not hypothetical. src/styles/base.css's .status-pill--ended did
// exactly this: `background: var(--brand-blush)` paired with a flipping
// `color: var(--text-primary)`, and it was invisible to the spec §3 review
// because that review swept the SEMANTIC layer -- the one place components are
// supposed to live -- and this was the only reference to a BRAND token
// anywhere else in the tree. tokenRules.ts bans a colour LITERAL outside
// tokens.css; nothing banned a reference to the layer one below the one
// components are allowed to touch. This test is that ban.
//
// Lives outside src/ because it needs node:fs, and tsconfig.app.json gives
// src/ no Node types -- the same reason tests/tokens.test.ts and
// tests/matrixGrid.test.ts live here. The file-walk below is modelled directly
// on tests/tokens.test.ts's `collect`.

const ROOT = join(import.meta.dirname, '..')

// The extensions that can carry a CSS custom-property reference. Matches
// tests/tokens.test.ts's list for the same reason: anything else in the tree
// cannot style the app and is not this check's to police.
const EXTENSIONS = ['.css', '.ts', '.tsx', '.html', '.svg']

const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'supabase', 'docs'])

// tokens.css is the layer's own home: BRAND is declared there, and FUNCTIONAL
// and SEMANTIC repoint it there too. Every reference in this one file is the
// layering working as designed, not a violation of it.
const EXEMPT_PATH = 'src/styles/tokens.css'

type SourceFile = { path: string; source: string }

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
      // Forward slashes on every platform, so EXEMPT_PATH can be written once.
      path: relative(ROOT, absolute).split(sep).join('/'),
      source: readFileSync(absolute, 'utf8'),
    })
  }
  return found
}

// The tail allows an optional `, fallback` before the closing paren -- CSS's
// `var(--brand-x, var(--surface-y))` is the same layering bypass as the bare
// form, just spelled with a fallback. `[^()]*(?:\([^()]*\)[^()]*)*` accepts one
// level of nested parens (a fallback that is itself a var() call) without
// running past this reference's own closing paren into unrelated text.
const BRAND_REFERENCE = /var\(\s*--brand-[a-zA-Z0-9-]+\s*(?:,[^()]*(?:\([^()]*\)[^()]*)*)?\)/g

describe('the brand layer', () => {
  const files: SourceFile[] = [
    ...collect(join(ROOT, 'src')),
    // Read directly, as tests/tokens.test.ts also does, rather than by walking
    // the repository root: index.html is the only file outside src/ that can
    // style the app, since it links the two global stylesheets.
    { path: 'index.html', source: readFileSync(join(ROOT, 'index.html'), 'utf8') },
  ]

  // A walk that silently finds nothing would pass forever. This project has
  // already shipped one check that reported success by finding no data -- see
  // "What a silent grep looks like" in the README. Assert the walk actually
  // walked, the same way tests/tokens.test.ts and tests/matrixGrid.test.ts do.
  it('is walked, not silently skipped', () => {
    expect(files.length).toBeGreaterThan(15)
    expect(files.map((f) => f.path)).toContain('index.html')
    expect(files.map((f) => f.path)).toContain(EXEMPT_PATH)
    expect(files.map((f) => f.path)).toContain('src/board/Board.tsx')
  })

  it('is referenced only from its own file', () => {
    const offenders = files
      .filter((file) => file.path !== EXEMPT_PATH)
      .flatMap((file) =>
        [...file.source.matchAll(BRAND_REFERENCE)].map(
          (match) => `${file.path}: ${match[0]}`,
        ),
      )
    expect(offenders).toEqual([])
  })
})

describe('BRAND_REFERENCE', () => {
  // The regex once required the closing paren immediately after the token
  // name, so `var(--brand-blush, var(--surface-sunken))` -- the same layering
  // bypass, spelled with a fallback -- slipped past it. These three cases are
  // the hole and the two things widening it must not break.
  it('catches the plain form', () => {
    expect('var(--brand-blush)'.match(BRAND_REFERENCE)).toEqual(['var(--brand-blush)'])
  })

  it('catches the same reference written with a var() fallback', () => {
    const source = 'background: var(--brand-blush, var(--surface-sunken));'
    expect([...source.matchAll(BRAND_REFERENCE)].map((m) => m[0])).toEqual([
      'var(--brand-blush, var(--surface-sunken))',
    ])
  })

  it('does not match the token name in prose', () => {
    const prose = '-- brand-blush and brand-stone are discussed here, never inside var().'
    expect(prose.match(BRAND_REFERENCE)).toBeNull()
  })
})
