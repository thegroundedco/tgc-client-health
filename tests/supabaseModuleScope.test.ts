import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// src/lib/supabase.ts calls readSupabaseConfig at MODULE SCOPE and throws when
// VITE_ config is absent. CI runs vitest with no VITE_ env at all, so any test
// whose import graph reaches that module fails to LOAD in CI -- the whole file,
// every test in it -- while passing on a developer machine, which has
// .env.local.
//
// That is not a hypothetical. On 2026-09-12 filling the Overview page gave a
// previously hook-free component two hooks, and the chain
//
//   pages.dom.test.tsx -> Overview -> useBoard -> lib/supabase
//
// took `npx vitest run` to exit 1 in CI while `npm test` passed 1521/1521
// locally. Both the test and deploy workflows failed and the deploy was
// skipped, so the pushed work never reached the live site.
//
// The hazard was already written down, in clientForm.ts's own header, and was
// still walked into -- because a comment cannot fail a build. This guard can.
// It reproduces CI's condition statically: a test file must not be able to
// reach lib/supabase through unmocked imports.
const ROOT = join(import.meta.dirname, '..')
const SRC = join(ROOT, 'src')
const SUPABASE = join(SRC, 'lib/supabase.ts')

// rls.test.ts talks to a real database on purpose and is the one file CI
// excludes by name (`--exclude '**/rls.test.ts'`), so the module-scope throw
// is never reached there.
const EXCLUDED = ['src/lib/rls.test.ts']

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

// Only edges Node/Vite actually resolve at runtime. `import type` and
// `export type` are erased before any module is loaded, so a type-only edge
// cannot drag lib/supabase into the graph and is not counted.
function runtimeImports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const specs: string[] = []
  for (const line of source.split('\n')) {
    if (/^\s*(import|export)\s+type\s/.test(line)) continue
    for (const match of line.matchAll(/from\s+'(\.[^']*)'|import\('(\.[^']*)'\)/g)) {
      specs.push(match[1] ?? match[2])
    }
  }
  return specs
}

// Mirrors Vite's extensionless resolution for this codebase's relative imports.
// A specifier that resolves to no .ts/.tsx file (a CSS module, an asset) has no
// edge to follow and is dropped.
function resolveSpec(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // not this candidate
    }
  }
  return null
}

// vi.mock replaces a module everywhere in the test's graph, not just on the
// edge the test file itself declares -- so a mocked module is removed as a
// node, which is what makes mocking useBoard enough to cut Overview's chain.
function mockedModules(testFile: string): Set<string> {
  const source = readFileSync(testFile, 'utf8')
  const mocked = new Set<string>()
  for (const match of source.matchAll(/vi\.mock\(\s*'(\.[^']*)'/g)) {
    const target = resolveSpec(testFile, match[1])
    if (target) mocked.add(target)
  }
  return mocked
}

function reachesSupabase(testFile: string): string[] | null {
  const blocked = mockedModules(testFile)
  const seen = new Set<string>([testFile])
  const queue: Array<{ file: string; path: string[] }> = [{ file: testFile, path: [testFile] }]
  while (queue.length > 0) {
    const { file, path } = queue.shift()!
    for (const spec of runtimeImports(file)) {
      const target = resolveSpec(file, spec)
      if (!target || blocked.has(target) || seen.has(target)) continue
      const next = [...path, target]
      if (target === SUPABASE) return next
      seen.add(target)
      queue.push({ file: target, path: next })
    }
  }
  return null
}

describe('module-scope Supabase config in tests', () => {
  const testFiles = walk(SRC)
    .filter((file) => /\.test\.tsx?$/.test(file))
    .filter((file) => !EXCLUDED.includes(relative(ROOT, file)))

  it('finds the test files to check', () => {
    expect(testFiles.length).toBeGreaterThan(20)
  })

  it.each(testFiles.map((file) => relative(ROOT, file)))(
    '%s cannot reach lib/supabase through unmocked imports',
    (relativePath) => {
      const chain = reachesSupabase(join(ROOT, relativePath))
      const trace = chain?.map((file) => relative(ROOT, file)).join('\n  -> ')
      expect(
        chain === null,
        `${relativePath} imports lib/supabase, which throws at module scope with no VITE_ env.\n` +
          `This file loads locally and fails in CI. Mock a module on this chain:\n  ${trace}`,
      ).toBe(true)
    },
  )
})
