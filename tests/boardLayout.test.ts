import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// One property of the board's stylesheet that no DOM test can see: jsdom
// computes no layout, so the rule that actually pushes the Add client button to
// the end of the period bar is invisible to Board.test.tsx. That file asserts
// the button is INSIDE the right wrapper; this asserts the wrapper does its job.
//
// Lives outside src/ because it needs node:fs, and tsconfig.app.json gives src/
// no Node types -- the same reason tests/tokens.test.ts lives here.

const SOURCE = readFileSync(
  join(import.meta.dirname, '..', 'src', 'board', 'Board.module.css'),
  'utf8',
)

// Comments stripped first. Board.module.css explains its rules in prose that
// names the properties it is describing, and a check run against the raw text
// would match the explanation rather than the code -- the trap tokenRules.ts
// warns about in its own header and matrixGrid.test.ts hit for real.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')

function ruleBody(selector: string): string {
  const start = CODE.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no rule for "${selector}" in Board.module.css`)
  const end = CODE.indexOf('}', start)
  if (end === -1) throw new Error(`rule "${selector}" is never closed`)
  return CODE.slice(start, end)
}

describe('the board stylesheet', () => {
  // A test that silently found nothing would pass forever. This project has
  // already shipped one check that reported success by finding no data.
  it('is read, not silently skipped', () => {
    expect(SOURCE.length).toBeGreaterThan(1000)
    expect(CODE).toContain('.periodBar {')
  })

  // An auto inline-start margin rather than justify-content on .periodBar
  // itself. The bar's other members -- the month, the progress line, the
  // archive toggle, the view switch -- must stay grouped at the start, and the
  // bar wraps, so a justify rule would redistribute every wrapped line instead
  // of moving one item.
  it('pushes the add-client wrapper to the end of the period bar', () => {
    expect(ruleBody('.addBar')).toContain('margin-inline-start: auto')
  })

  it('leaves the period bar itself grouped at the start', () => {
    expect(ruleBody('.periodBar')).not.toContain('justify-content')
  })
})
