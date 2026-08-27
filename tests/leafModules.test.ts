import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Same convention as tests/tokens.test.ts: resolve from the file, not the
// process CWD, so the guard holds however vitest is invoked.
const ROOT = join(import.meta.dirname, '..')

// scripts/score-parity.mjs is run by plain `node`, which cannot resolve this
// codebase's extensionless relative imports. Any module it reaches must
// therefore be a leaf. Adding an import -- a value import, a re-export, or a
// dynamic import -- to either file below breaks `npm run verify:score` with
// an ERR_MODULE_NOT_FOUND that looks like a Node bug rather than what it is --
// so it is caught here instead.
const LEAVES = ['src/lib/scoreMath.ts', 'src/lib/buckets.ts']

// Every line form that is a genuine ESM module-resolution dependency: a value
// import, a re-export (`export ... from ...`, including `export * from`), or
// a dynamic `import(...)` anywhere on the line. `import type` and
// `export type` are erased before Node ever sees them, so they are excluded
// rather than flagged.
function runtimeImportLines(source: string): string[] {
  return source
    .split('\n')
    .filter(
      (line) =>
        /^\s*import\s/.test(line) ||
        /^\s*export\s.*\bfrom\s/.test(line) ||
        line.includes('import('),
    )
    .filter((line) => !/^\s*import\s+type\s/.test(line))
    .filter((line) => !/^\s*export\s+type\s/.test(line))
}

describe('runtimeImportLines', () => {
  it('catches a value import', () => {
    expect(runtimeImportLines("import { x } from './dep'")).toEqual([
      "import { x } from './dep'",
    ])
  })

  it('catches a named re-export', () => {
    expect(runtimeImportLines("export { x } from './dep'")).toEqual([
      "export { x } from './dep'",
    ])
  })

  it('catches a wildcard re-export', () => {
    expect(runtimeImportLines("export * from './dep'")).toEqual([
      "export * from './dep'",
    ])
  })

  it('catches a dynamic import', () => {
    expect(runtimeImportLines("const m = await import('./dep')")).toEqual([
      "const m = await import('./dep')",
    ])
  })

  it('does not catch a type-only import', () => {
    expect(runtimeImportLines("import type { T } from './dep'")).toEqual([])
  })

  it('does not catch a type-only re-export', () => {
    expect(runtimeImportLines("export type { T } from './dep'")).toEqual([])
  })
})

describe('the modules scripts/score-parity.mjs loads under plain node', () => {
  for (const path of LEAVES) {
    it(`${path} has no runtime imports`, () => {
      const source = readFileSync(join(ROOT, path), 'utf8')
      expect(runtimeImportLines(source), `${path} must stay a leaf`).toEqual([])
    })
  }
})
