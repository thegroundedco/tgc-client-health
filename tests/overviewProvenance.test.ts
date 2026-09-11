import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The Overview page was empty on purpose until 2026-09-11. Six stat lines were
// invented for it once, the owner did not recognise them, and they were retired
// as never-sourced. A tripwire in pages.dom.test.tsx asserted the page invented
// nothing, with a note that whoever filled it "will have to delete this
// assertion deliberately".
//
// It was deleted deliberately. The contents came from the owner describing this
// screen to his boss on the 2026-09-11 call: clients over 20% of revenue, and
// clients scoring at risk. This replaces the tripwire -- not with a weaker
// check, but with one that pins WHICH things belong here, so a third guess has
// to change this file on purpose.
//
// Lives outside src/ because it reads the source, and tsconfig.app.json gives
// src/ no Node types -- the same reason tests/tokens.test.ts does.

// The page AND the rule it renders. Splitting them would let the contents move
// from one file to the other and slip past this check without changing.
const FILES = ['Overview.tsx', 'overviewMath.ts'].map((name) =>
  readFileSync(join(import.meta.dirname, '..', 'src', 'shell', name), 'utf8'),
)

const SOURCE = FILES.join('\n')
const CODE = SOURCE.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/[^\n]*/g, '')

describe('the Overview page', () => {
  // A test that silently found nothing would pass forever. This project has
  // already shipped one check that reported success by finding no data.
  it('is read, not silently skipped', () => {
    expect(SOURCE.length).toBeGreaterThan(1000)
    expect(CODE).toContain('export function Overview')
  })

  it('shows the two things the owner named', () => {
    expect(CODE).toContain('needs attention')
    expect(CODE).toContain('overExposed')
    expect(CODE).toContain('at_risk')
  })

  // The board's other bands are deliberately absent. "Watch" says keep an eye
  // out and is not actionable; "incomplete" is not a bad score, and a false
  // "at risk" is as harmful as a false "healthy".
  it('raises neither watch nor incomplete', () => {
    expect(CODE).not.toContain("'watch'")
    expect(CODE).not.toContain("'incomplete'")
  })

  // Foundation-to-Grow progression was asked for by the owner's boss on the
  // same call and needs a schema change. When it arrives it belongs here, and
  // this assertion should be the thing that gets updated.
  it('has not grown contents nobody asked for', () => {
    expect(CODE).not.toMatch(/lead ?source/i)
    expect(CODE).not.toMatch(/foundation/i)
  })
})
