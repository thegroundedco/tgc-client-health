import { describe, expect, it } from 'vitest'
import { HOURS_START_PERIOD } from '../lib/buckets'
import { hoursScore, signedHours, toHours } from './hoursFromBudgets'
// Read through Vite's ?raw, as the app's tsconfig has no Node types.
import PARAGRAPH from '../../docs/superpowers/plans/2026-11-04-productive-budget-hours-routine-paragraph.md?raw'

// The routine paragraph is prose the owner pastes into the live AI routine, so
// nothing runs it. These pins hold it to the rule the screen runs: the same
// notes, the same bands, the same hours format, the same applicability rule,
// and no step that contradicts another (final review I1, I3).
// The text that is pasted: between the first two --- lines.
const PASTED = PARAGRAPH.split('\n---\n')[1]

describe('the routine paragraph', () => {
  it('has a pasted section', () => {
    expect(PASTED).toBeDefined()
    expect(PASTED).toContain('Hours within budget (fin_hours_in_budget)')
  })

  it('stands on its own: no source paths and no rule numbers from the code', () => {
    expect(PARAGRAPH).not.toMatch(/src\//)
    expect(PARAGRAPH).not.toMatch(/rules? \d+\s*[-–]\s*\d+/i)
  })

  it('decides applicability before writing, never by reading the written row back', () => {
    expect(PASTED).not.toMatch(/read it back/i)
    expect(PASTED).not.toMatch(/fin_hours_applies from public\.checkins/)
    expect(PASTED).toMatch(/BEFORE you write the row/)
  })

  it('states the same three-part rule as private.hours_applies, and offers calling it', () => {
    const sql = PASTED.replaceAll(/\s+/g, ' ')
    expect(sql).toContain(`>= date '${HOURS_START_PERIOD}'`)
    expect(sql).toContain('and exists (select 1 from public.client_productive_projects l where l.client_id = <id>)')
    expect(sql).toContain(
      'and (not exists (select 1 from public.client_month_hours_fetch f where f.client_id = <id> and f.period = <period>) ' +
        'or exists (select 1 from public.client_month_budgets b where b.client_id = <id> and b.period = <period>))',
    )
    expect(sql).toContain('select private.hours_applies(<id>, <period>)')
  })

  it("gives the as-of date in SQL, in America/Denver, and marks the zone confirmed", () => {
    expect(PASTED).toContain("(fetched_at at time zone 'America/Denver')::date")
    expect(PARAGRAPH).toMatch(/America\/Denver, confirmed by the owner on 2026-11-04/)
  })

  // I1: an unfinished month by the run date is 3 + the placeholder note,
  // before any fetch row is looked at.
  it('writes 3 pending for an unfinished month by the run date, before the no-fetch-row case', () => {
    const unfinished = PASTED.indexOf("(now() at time zone 'America/Denver')::date")
    const pending = PASTED.indexOf('write 3 and put "hours pending – month not finished"', unfinished)
    const unreachable = PASTED.indexOf('No fetch row at all')
    expect(unfinished).toBeGreaterThan(-1)
    expect(pending).toBeGreaterThan(unfinished)
    expect(unreachable).toBeGreaterThan(pending)
    expect(PASTED.slice(unfinished, unreachable)).toMatch(/whether or not any hours are stored yet/)
  })

  // Brief 2026-11-05 A: the screen's notes changed and the database scores
  // hours, so this paragraph no longer matches the rule; it says so up front.
  it('is marked superseded by the 2026-11-05 update', () => {
    expect(PARAGRAPH.split('\n')[0]).toMatch(/^SUPERSEDED on 2026-11-05 by 2026-11-05-routine-hours-and-focus-update\.md/)
  })

  it('states bands that agree with hoursScore at every minute from -1000 to +1000', () => {
    const sentence = /Write 5 if ([^;]+); 3 if ([^;]+); 2 if ([^;]+); 1 if ([^.]+)\./.exec(PASTED)
    expect(sentence).not.toBeNull()
    const clauses = sentence!.slice(1, 5).map((clause) => clause.split(' or ').map((term) => term.trim()))
    const holds = (term: string, d: number): boolean => {
      const between = /^(-?\d+) (<=|<) diff (<=|<) (-?\d+)$/.exec(term)
      if (between) {
        const [, lo, a, b, hi] = between
        return (a === '<=' ? Number(lo) <= d : Number(lo) < d) && (b === '<=' ? d <= Number(hi) : d < Number(hi))
      }
      const side = /^diff (<|>) (-?\d+)$/.exec(term)
      if (side) return side[1] === '<' ? d < Number(side[2]) : d > Number(side[2])
      throw new Error(`cannot read band term: ${term}`)
    }
    const scores = [5, 3, 2, 1]
    for (let d = -1000; d <= 1000; d++) {
      const matched = scores.filter((_, i) => clauses[i].some((term) => holds(term, d)))
      expect(matched, `diff ${d}`).toEqual([hoursScore(d)])
    }
  })

  it("gives worked examples of the hours format that match the screen's", () => {
    const examples = [...PASTED.matchAll(/([+−±]?)(\d+) minutes is ([+−]?[\d.]+h)/g)]
    expect(examples.length).toBeGreaterThanOrEqual(3)
    for (const [, sign, n, text] of examples) {
      const signs = sign === '±' ? [1, -1] : [sign === '−' ? -1 : 1]
      for (const s of signs) expect(signedHours(toHours(s * Number(n))), `${sign}${n} minutes`).toBe(text)
    }
    expect(PASTED).toMatch(/drop a trailing \.0 \(write 25h, not 25\.0h/)
  })

  it('tells the owner net.http_post failures are silent and where to look', () => {
    expect(PARAGRAPH).toMatch(/net\.http_post[^.]*silent/)
    expect(PARAGRAPH).toContain('net._http_response')
  })

  it('replaces v2 lines 45, 57, 58 and 60 with the ruled text', () => {
    const replacement = (line: number): string => {
      const block = new RegExp(`\\*\\*Line ${line}\\*\\*, now:\\n\\n\`\`\`\\n.*\\n\`\`\`\\n\\nReplace with:\\n\\n\`\`\`\\n(.*)\\n\`\`\``).exec(PARAGRAPH)
      expect(block, `line ${line}`).not.toBeNull()
      return block![1]
    }
    expect(replacement(45)).not.toMatch(/finance is never null/)
    expect(replacement(57)).toContain('every answer column except fin_rack_rate, fin_rate_increased and fin_hours_in_budget')
    expect(replacement(58)).toContain('every required question is answered; hours counts only when it applies')
    expect(replacement(60)).toContain('fin_hours_in_budget')
    expect(replacement(60)).not.toMatch(/\b21 answers\b/)
  })
})
