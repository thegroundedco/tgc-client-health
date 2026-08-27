import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Same convention as tests/tokens.test.ts: resolve from the file, not the
// process CWD, so the guard holds however vitest is invoked.
const ROOT = join(import.meta.dirname, '..')

// scripts/score-parity.mjs is run by plain `node`, which cannot resolve this
// codebase's extensionless relative imports. Any module it reaches must
// therefore be a leaf. Adding an import to either file below breaks
// `npm run verify:score` with an ERR_MODULE_NOT_FOUND that looks like a Node
// bug rather than what it is -- so it is caught here instead.
const LEAVES = ['src/lib/scoreMath.ts', 'src/lib/buckets.ts']

describe('the modules scripts/score-parity.mjs loads under plain node', () => {
  for (const path of LEAVES) {
    it(`${path} has no runtime imports`, () => {
      const source = readFileSync(join(ROOT, path), 'utf8')
      const runtimeImports = source
        .split('\n')
        .filter((line) => /^\s*import\s/.test(line))
        // `import type` is erased before Node sees it, so it is harmless.
        .filter((line) => !/^\s*import\s+type\s/.test(line))
      expect(runtimeImports, `${path} must stay a leaf`).toEqual([])
    })
  }
})
