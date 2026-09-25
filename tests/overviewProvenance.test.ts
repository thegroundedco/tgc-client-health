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

// Two constants, built from overlapping but distinct file sets, and the
// overlap is the point.
//
// PAGE is Overview.tsx + overviewMath.ts: what the PAGE renders. Every
// assertion about what a reader sees on screen must be checked against this
// one, and must key on a string that exists ONLY in this page's own JSX --
// never on an identifier packageProgress.ts also declares. `ladderStanding`,
// `onRampComparison` and `descended` are all names packageProgress.ts defines
// for itself; a check for those strings against a SOURCE that includes that
// file would stay true even if Overview.tsx stopped calling them entirely, or
// stopped rendering the section that uses them. Slice D shipped exactly that
// mistake once, caught in review: `CODE.toContain('ladderStanding')` and
// `CODE.toContain('onRampComparison')` cannot fail on the regression they
// claimed to pin, because packageProgress.ts's own source supplies both
// strings regardless of whether the page reads them.
//
// ALL is PAGE plus packageProgress.ts, and exists for a narrower purpose:
// stopping page CONTENT from migrating out of Overview.tsx and overviewMath.ts
// and slipping past this file's pin without changing. A rung count moved into
// packageProgress.ts would vanish from PAGE but still show up in ALL, which is
// exactly the failure mode "has still not grown contents nobody asked for" is
// checking for -- so that one check, and only that one, reads ALL.
const PAGE_FILES = [join('src', 'shell', 'Overview.tsx'), join('src', 'shell', 'overviewMath.ts')].map(
  (path) => readFileSync(join(import.meta.dirname, '..', path), 'utf8'),
)
const ALL_FILES = [...PAGE_FILES, readFileSync(join(import.meta.dirname, '..', 'src', 'clients', 'packageProgress.ts'), 'utf8')]

const PAGE_SOURCE = PAGE_FILES.join('\n')
const PAGE_CODE = PAGE_SOURCE.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/[^\n]*/g, '')
const ALL_SOURCE = ALL_FILES.join('\n')
const ALL_CODE = ALL_SOURCE.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/[^\n]*/g, '')

describe('the Overview page', () => {
  // A test that silently found nothing would pass forever. This project has
  // already shipped one check that reported success by finding no data.
  it('is read, not silently skipped', () => {
    expect(PAGE_SOURCE.length).toBeGreaterThan(1000)
    expect(PAGE_CODE).toContain('export function Overview')
  })

  it('shows the two things the owner named', () => {
    expect(PAGE_CODE).toContain('needs attention')
    expect(PAGE_CODE).toContain('overExposed')
    expect(PAGE_CODE).toContain('at_risk')
  })

  // The board's other bands are deliberately absent. "Watch" says keep an eye
  // out and is not actionable; "incomplete" is not a bad score, and a false
  // "at risk" is as harmful as a false "healthy".
  it('raises neither watch nor incomplete', () => {
    expect(PAGE_CODE).not.toContain("'watch'")
    expect(PAGE_CODE).not.toContain("'incomplete'")
  })

  // Slice D, 2026-09-24. The assertion that used to stand here forbade any
  // mention of Foundation, with a note that progression "needs a schema change.
  // When it arrives it belongs here, and this assertion should be the thing
  // that gets updated." The schema arrived on 2026-09-12 and this is that
  // update -- not a weakening, but the same pinning applied to the contents
  // that are now sourced.
  //
  // Keyed on the JSX's own heading and test id, NOT on `ladderStanding` /
  // `onRampComparison` -- see the note above PAGE/ALL for why those identifiers
  // cannot tell "the page renders this" from "the rules module exists".
  it('shows the ladder the owner\'s boss asked for', () => {
    expect(PAGE_CODE).toContain('Graduating from Foundation')
    expect(PAGE_CODE).toContain('onramp-verdict')
  })

  // A descents list was rendered here from 2026-09-24 to 2026-09-25. It was the
  // spec's own proposal rather than something asked for, and it was removed with
  // the three-rung model that made it look sensible: while Scale sat above Grow,
  // a client finishing a website rebuild read as a demotion, and this page would
  // have published that under their name.
  //
  // Pinned as an ABSENCE, keyed on the rendered heading rather than on
  // `descended` -- that identifier is one packageProgress.ts declares for
  // itself, so asserting on it would tell us nothing about what the page shows.
  it('does not publish descents, which are a data error rather than news', () => {
    expect(PAGE_CODE).not.toContain('Moved down')
    expect(PAGE_SOURCE).toMatch(/Moved down. list stood here until/i)
  })

  it('has still not grown contents nobody asked for', () => {
    expect(ALL_CODE).not.toMatch(/lead ?source/i)
  })
})
