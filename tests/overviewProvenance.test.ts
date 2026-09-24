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

// The page AND the rules it renders. Splitting them would let the contents move
// from one file to another and slip past this check without changing. Slice D
// adds packageProgress.ts to the list for the same reason: it is where
// ladderStanding and onRampComparison actually live, and without it here a
// rung count could migrate from Overview.tsx into that module and slip the pin
// below.
const FILES = [
  join('src', 'shell', 'Overview.tsx'),
  join('src', 'shell', 'overviewMath.ts'),
  join('src', 'clients', 'packageProgress.ts'),
].map((path) => readFileSync(join(import.meta.dirname, '..', path), 'utf8'))

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

  // Slice D, 2026-09-24. The assertion that used to stand here forbade any
  // mention of Foundation, with a note that progression "needs a schema change.
  // When it arrives it belongs here, and this assertion should be the thing
  // that gets updated." The schema arrived on 2026-09-12 and this is that
  // update -- not a weakening, but the same pinning applied to the contents
  // that are now sourced.
  it('shows the ladder the owner\'s boss asked for', () => {
    expect(CODE).toContain('ladderStanding')
    expect(CODE).toContain('onRampComparison')
  })

  // The climbers list came from the call. The DESCENTS list did not: it is the
  // spec's own proposal, approved by the owner on 2026-09-24, and recorded here
  // so that the trail stays honest about which contents were asked for.
  it('records that the descents list was proposed, not requested', () => {
    expect(SOURCE).toMatch(/proposal|proposed/i)
    expect(CODE).toContain('descended')
  })

  it('has still not grown contents nobody asked for', () => {
    expect(CODE).not.toMatch(/lead ?source/i)
  })
})
