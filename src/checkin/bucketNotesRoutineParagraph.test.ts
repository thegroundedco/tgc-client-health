import { describe, expect, it } from 'vitest'
import { BUCKETS } from '../lib/buckets'
import { HEALTHY_AT } from '../lib/scoreMath'
import { BUCKET_NOTE_MAX, FOCUS_MAX } from './bucketNotes'
// Read through Vite's ?raw, as the app's tsconfig has no Node types.
import PARAGRAPH from '../../docs/superpowers/plans/2026-11-04-bucket-notes-routine-paragraph.md?raw'

// The routine paragraph is prose the owner pastes into the live AI routine, so
// nothing runs it. These pins hold it to the rules the database enforces.
// The text that is pasted: between the first two --- lines.
const PASTED = PARAGRAPH.split('\n---\n')[1]
const flat = (s: string): string => s.replaceAll(/\s+/g, ' ')

describe('the bucket notes routine paragraph', () => {
  it('has a pasted section', () => {
    expect(PASTED).toBeDefined()
    expect(PASTED).toContain('Step 4b: per-bucket notes and a monthly focus')
  })

  it('stands on its own: no source paths', () => {
    expect(PARAGRAPH).not.toMatch(/src\//)
  })

  it('gives the exact JSON shape with the shape keys', () => {
    for (const key of ['bucket_notes', 'why', 'actions', 'focus']) expect(PASTED).toContain(`"${key}"`)
    expect(PASTED).toContain('"focus": null')
  })

  it('names exactly the six bucket keys the CHECK allows', () => {
    expect(PASTED).toContain(BUCKETS.join(', '))
  })

  it('states the CHECK limits', () => {
    const text = flat(PASTED)
    expect(text).toContain('Only the six bucket keys')
    expect(text).toContain('Only why and actions inside a bucket')
    expect(text).toContain(`non-empty string of at most ${BUCKET_NOTE_MAX} characters`)
    expect(text).toContain('A bucket with neither field is OMITTED')
    expect(text).toContain('Never write an empty object {}')
    expect(text).toContain(`1-${FOCUS_MAX} characters`)
    expect(text).toMatch(/either null or a non-empty string/)
  })

  it('writes focus only below the healthy threshold', () => {
    expect(flat(PASTED)).toContain(`ONLY when the suggested overall is below ${HEALTHY_AT}`)
    expect(PASTED).toContain(`When the overall is ${HEALTHY_AT} or higher, focus is null`)
  })

  it('never invents evidence', () => {
    expect(PASTED).toContain('Never invent evidence')
  })

  it('writes the row only where answers may be overwritten, while ai_suggestion always carries them', () => {
    const text = flat(PASTED)
    expect(text).toContain('ai_suggestion ALWAYS carries bucket_notes and focus')
    expect(text).toContain("written only for rows you may overwrite: the same rule as the answers")
    expect(text).toContain("leave the row's bucket_notes and focus untouched and update only ai_suggestion")
  })

  it('builds the jsonb with jsonb_build_object', () => {
    expect(PASTED).toContain('jsonb_build_object')
    expect(flat(PASTED)).toContain('cannot break the statement')
  })

  it('quotes the post-hours text for the lines it changes, and never undoes the hours text', () => {
    expect(PARAGRAPH).toContain('APPLY AFTER THE HOURS PARAGRAPH')
    expect(PARAGRAPH).toContain('fin_hours_in_budget), each a JSON number or null')
    expect(PARAGRAPH).toContain('insert the 22 answers')
    expect(PARAGRAPH).toContain('update the 22 answers')
    expect(PARAGRAPH).toContain('Leave every answer (finance and hours included)')
    expect(PARAGRAPH).not.toMatch(/\b21 answers\b/)
    expect(PARAGRAPH).not.toMatch(/never null \(see the finance rule\)\.\n/)
  })
})
