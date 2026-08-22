import { describe, expect, it } from 'vitest'
import { cardFooter, progressLine } from './cardSummary'
import type { CardCheckin } from './cardSummary'
import { PILLARS } from '../lib/score'

const ME = '11111111-1111-1111-1111-111111111111'
const SOMEBODY_ELSE = '22222222-2222-2222-2222-222222222222'

// A submitted check-in always has all five pillars, because submitted_at is
// only ever set on a complete five -- useCheckin's submit() enforces that.
// Building a fixture that violates it would manufacture a bug that cannot
// happen, which is a mistake this project has already made once.
const COMPLETE = {
  relationship: 3,
  delivery: 3,
  financial: 3,
  sentiment: 3,
  growth: 3,
} as const

describe('cardFooter', () => {
  it('says not started when there is no check-in at all', () => {
    expect(cardFooter(null, ME)).toBe('Not started')
  })

  it('names you and the time for your own submission', () => {
    const checkin: CardCheckin = {
      total_score: 15,
      submitted_at: '2026-08-21T17:04:00.000Z',
      submitted_by: ME,
      ...COMPLETE,
    }
    expect(cardFooter(checkin, ME)).toMatch(/^Submitted /)
    expect(cardFooter(checkin, ME)).toContain('by you')
  })

  // §10 item 7: profiles_select_own means another person's name is unreadable,
  // so the footer says the role instead of inventing a name.
  it('says another account manager when somebody else submitted it', () => {
    const checkin: CardCheckin = {
      total_score: 15,
      submitted_at: '2026-08-21T17:04:00.000Z',
      submitted_by: SOMEBODY_ELSE,
      ...COMPLETE,
    }
    expect(cardFooter(checkin, ME)).toContain('by another account manager')
    expect(cardFooter(checkin, ME)).not.toContain('by you')
  })

  it('counts the scored pillars for a draft', () => {
    const checkin: CardCheckin = {
      total_score: null,
      submitted_at: null,
      submitted_by: null,
      relationship: 4,
      delivery: 2,
      financial: null,
      sentiment: 3,
      growth: null,
    }
    expect(cardFooter(checkin, ME)).toBe('Draft, 3 of 5 scored')
  })

  it('treats a row with nothing scored as not started', () => {
    // The upsert can leave a row with only notes on it. A card saying
    // "Draft, 0 of 5" invites the reader to look for scores that were never
    // entered; "Not started" is what actually happened.
    const checkin: CardCheckin = {
      total_score: null,
      submitted_at: null,
      submitted_by: null,
    }
    expect(cardFooter(checkin, ME)).toBe('Not started')
  })

  it('never returns an empty string, in any combination', () => {
    // The defect this whole slice exists to fix is a screen that says nothing.
    for (const submitted_at of [null, '2026-08-21T17:04:00.000Z']) {
      for (const submitted_by of [null, ME, SOMEBODY_ELSE]) {
        for (const scored of [0, 1, 5]) {
          const pillars = Object.fromEntries(
            PILLARS.map((pillar, index) => [pillar, index < scored ? 3 : null]),
          )
          const text = cardFooter(
            { total_score: null, submitted_at, submitted_by, ...pillars },
            ME,
          )
          expect(text.trim(), JSON.stringify({ submitted_at, submitted_by, scored })).not.toBe('')
        }
      }
    }
  })
})

describe('progressLine', () => {
  it('counts submissions against active clients', () => {
    expect(progressLine(4, 11)).toBe('4 of 11 check-ins submitted this month')
  })

  it('reads correctly at both ends', () => {
    expect(progressLine(0, 11)).toBe('0 of 11 check-ins submitted this month')
    expect(progressLine(11, 11)).toBe('All 11 check-ins submitted this month')
  })

  it('says something even with no clients', () => {
    expect(progressLine(0, 0)).toBe('No active clients')
  })
})
