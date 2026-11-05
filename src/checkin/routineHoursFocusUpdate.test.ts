import { describe, expect, it } from 'vitest'
// Read through Vite's ?raw, as the app's tsconfig has no Node types.
import UPDATE from '../../docs/superpowers/plans/2026-11-05-routine-hours-and-focus-update.md?raw'

// Brief 2026-11-05 A, section 5. Prose the owner pastes into the live routine,
// so nothing runs it. These pins hold each replacement block to the brief: the
// database owns the hours answer, no Monday placeholder, and a focus for every
// scored client.
type Block = { title: string; old: string; next: string }

function blocks(): Block[] {
  const found = [
    ...UPDATE.matchAll(
      /## Block \d+: ([^\n]+)\n\n\*\*Lines? [\d-]+\*\*, now:\n\n```\n([\s\S]*?)\n```\n\nReplace with:\n\n```\n([\s\S]*?)\n```/g,
    ),
  ]
  return found.map((m) => ({ title: m[1], old: m[2], next: m[3] }))
}
const byTitle = (title: string): Block => {
  const block = blocks().find((b) => b.title === title)
  expect(block, title).toBeDefined()
  return block!
}
const allNew = (): string => blocks().map((b) => b.next).join('\n')

describe('the 2026-11-05 routine update', () => {
  it('quotes every block it replaces, each with its replacement', () => {
    const headings = UPDATE.match(/^## Block \d+:/gm) ?? []
    expect(headings.length).toBeGreaterThanOrEqual(5)
    expect(blocks()).toHaveLength(headings.length)
  })

  it('stands on its own: no source paths, no project refs, no addresses', () => {
    expect(UPDATE).not.toMatch(/src\//)
    expect(UPDATE).not.toMatch(/@[a-z]+\.[a-z]+/)
  })

  it('replaces the whole old hours rule, placeholder and all', () => {
    const hours = byTitle('the hours rule')
    expect(hours.old).toMatch(/^Hours within budget \(fin_hours_in_budget\) is NOT your judgment either/)
    expect(hours.old).toContain('write 3 and put "hours pending – month not finished"')
    expect(hours.old).toMatch(/7\. The manual-row rule is unchanged[^\n]*$/)
  })

  it('hours: the database sets both columns, the routine never writes fin_hours_in_budget', () => {
    const hours = byTitle('the hours rule').next
    expect(hours).toContain('The database sets it, and whether it applies (fin_hours_applies)')
    expect(hours).toContain('Never write fin_hours_in_budget.')
    // Brief 2026-11-05 B §4: ask the database BEFORE writing, not read back after.
    expect(hours).not.toMatch(/read it back/)
    expect(hours).toContain(
      'Before writing the row, run: select private.hours_applies(<id>, <period>) as applies, private.hours_score(<id>, <period>) as score;',
    )
    expect(hours).toContain('(the routine runs as postgres, so it can call them)')
    expect(hours).toContain('Use the result in "complete" and in the Finances why')
    expect(hours).toContain('hours counts toward "complete" only when applies is true')
    expect(hours).toContain('Never write the column.')
    expect(UPDATE).not.toMatch(/read(s)? it back after writing/)
  })

  // The two live lines that still said the routine scores 22 questions and
  // leaves hours untouched as if it could write it. Quoted exactly from the
  // live prompt (routine-prompt-current.md, lines 31 and 114).
  it('the Step 3 heading: 21 questions are the routine\'s, plus hours, which the database sets', () => {
    const heading = byTitle('the Step 3 heading')
    expect(heading.old).toBe('## Step 3: score. 22 questions; every answer is an integer 1-5 or null')
    expect(heading.next).toContain('21 questions are yours to answer')
    expect(heading.next).toContain('plus "Hours within budget", which the database sets')
    expect(heading.next).not.toMatch(/22/)
  })

  it('the manual-row line: hours is never written by the routine anyway', () => {
    const line = byTitle('the manual-row update')
    expect(line.old).toBe(
      '  - otherwise: update ONLY ai_suggestion = ai (it still carries bucket_notes and focus). Leave every answer (finance and hours included), notes, bucket_notes, focus, suggested_at, submitted_at untouched.',
    )
    expect(line.next).not.toContain('(finance and hours included)')
    expect(line.next).toContain('Hours is never yours to write anyway: the database sets it on every row.')
    expect(line.next).toContain('update ONLY ai_suggestion = ai')
  })

  it('Monday runs: no hours placeholder anywhere in the new text', () => {
    expect(byTitle('the hours rule').next).toMatch(/no hours placeholder any more\. Never write 3 for hours, on a Monday run/)
    expect(allNew()).not.toMatch(/hours pending/)
    expect(allNew()).not.toMatch(/write 3 and put/)
    expect(allNew()).not.toMatch(/the hours placeholder where/)
  })

  it('never tells the routine to write the hours column', () => {
    const writes = byTitle('the insert and update').next
    expect(writes).not.toMatch(/22 answers/)
    expect(writes.match(/the 21 answers/g)).toHaveLength(2)
    expect(writes.match(/never fin_hours_in_budget/g)).toHaveLength(2)
    expect(byTitle('ai and complete').next).toContain('every answer column except fin_rack_rate, fin_rate_increased and fin_hours_in_budget')
    expect(byTitle('ai and complete').next).toContain('fin_hours_in_budget counts only when fin_hours_applies is true')
    expect(byTitle('the calibration line on complete answers').next).toContain('Never write fin_hours_in_budget')
    expect(allNew()).not.toMatch(/leave fin_hours_in_budget null/)
  })

  it('focus: for every scored client, healthy ones included, never null', () => {
    const focus = byTitle('the focus rule')
    expect(focus.old).toContain('Write it ONLY when the gate value is below 3.6')
    expect(focus.next).toContain('Write a focus for EVERY client you score, not only those below 3.6.')
    expect(focus.next).toContain('for a healthy client, it is what to protect or grow')
    expect(focus.next).toContain('never null and never ""')
    expect(focus.next).not.toMatch(/ONLY when/)
    expect(allNew()).not.toMatch(/"focus": null|<text or null>|focus = null/)
    expect(byTitle('the focus shape').next).toBe('  "focus": "<text>"')
  })
})
