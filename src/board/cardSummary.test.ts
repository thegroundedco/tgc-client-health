import { describe, expect, it } from 'vitest'
import { ALL_QUESTIONS, BUCKETS, isYesNo, questionsFor } from '../lib/buckets'
import { BUCKET_SCORE_KEY, CHECKIN_COLUMNS, cardFooter, progressLine } from './cardSummary'

describe('CHECKIN_COLUMNS', () => {
  // The literal is typed by supabase-js, so a mistyped column fails the build
  // rather than surfacing at runtime -- but only the build knows that. This
  // test is what catches the literal drifting from the rubric.
  it('names every one of the 21 answers', () => {
    const named = CHECKIN_COLUMNS.split(',').map((c) => c.trim())
    for (const key of ALL_QUESTIONS) expect(named).toContain(key)
  })

  it('names all six bucket score columns', () => {
    const named = CHECKIN_COLUMNS.split(',').map((c) => c.trim())
    for (const bucket of BUCKETS) expect(named).toContain(BUCKET_SCORE_KEY[bucket])
  })

  it('names what the footer needs', () => {
    const named = CHECKIN_COLUMNS.split(',').map((c) => c.trim())
    expect(named).toContain('client_id')
    expect(named).toContain('submitted_at')
    expect(named).toContain('submitted_by')
  })

  // The retired five. Selecting a renamed column is a Postgres error on every
  // board load, so this is the test that would catch the rename landing before
  // this file stopped asking for them.
  it('no longer names the retired pillar columns', () => {
    for (const gone of ['total_score', 'sentiment', 'financial']) {
      expect(CHECKIN_COLUMNS.split(',').map((c) => c.trim())).not.toContain(gone)
    }
  })

  // `notes` is the one column on this table with no length bound, and the
  // board renders none of it -- eleven rows of unread free text on every load
  // of the screen people open most. Carried over from the five-pillar version
  // of this file: the column still exists, unrenamed, so the reason still
  // holds.
  it('does not fetch notes, which no card renders', () => {
    const named = CHECKIN_COLUMNS.split(',').map((c) => c.trim())
    expect(named).not.toContain('notes')
  })
})

describe('BUCKET_SCORE_KEY', () => {
  it('maps each bucket to its own generated column', () => {
    expect(BUCKET_SCORE_KEY.communication).toBe('comm_score')
    expect(BUCKET_SCORE_KEY.growth).toBe('growth_score')
    expect(BUCKET_SCORE_KEY.finances).toBe('fin_score')
    expect(BUCKET_SCORE_KEY.relationship).toBe('rel_score')
    expect(BUCKET_SCORE_KEY.delivery).toBe('del_score')
    expect(BUCKET_SCORE_KEY.advocacy).toBe('adv_score')
  })

  it('gives all six distinct columns', () => {
    const keys = BUCKETS.map((b) => BUCKET_SCORE_KEY[b])
    expect(new Set(keys).size).toBe(6)
  })
})

// Fills every question in the 17 non-Advocacy buckets, leaving Advocacy blank.
function seventeenAnswered(): Record<string, number> {
  const answers: Record<string, number> = {}
  for (const bucket of BUCKETS) {
    if (bucket === 'advocacy') continue
    for (const q of questionsFor(bucket)) answers[q.key] = 3
  }
  return answers
}

describe('cardFooter', () => {
  const VIEWER = 'viewer-uuid'

  it('says Not started when there is no row', () => {
    expect(cardFooter(null, VIEWER, true)).toBe('Not started')
  })

  it('says Not started when a row exists with no answers', () => {
    const row = { client_id: 1, submitted_at: null, submitted_by: null }
    expect(cardFooter(row, VIEWER, true)).toBe('Not started')
  })

  // Gate open: the denominator is 21, not 17. This is the number that decides
  // whether the person thinks they are finished.
  it('counts against 21 when the gate is open', () => {
    const row = { client_id: 1, submitted_at: null, submitted_by: null, ...seventeenAnswered() }
    expect(cardFooter(row, VIEWER, true)).toBe('Draft, 17 of 21 scored')
  })

  // Same row, gate shut: the same seventeen answers are a COMPLETE check-in.
  it('counts against 17 when the gate is shut', () => {
    const row = { client_id: 1, submitted_at: null, submitted_by: null, ...seventeenAnswered() }
    expect(cardFooter(row, VIEWER, false)).toBe('Draft, 17 of 17 scored')
  })

  // A No is an ANSWER. Counting it as unanswered would leave the card
  // permanently one short for the client most likely to answer No.
  it('counts a false Advocacy answer as scored', () => {
    const row = {
      client_id: 1, submitted_at: null, submitted_by: null,
      ...seventeenAnswered(), adv_left_review: false,
    }
    expect(cardFooter(row, VIEWER, true)).toBe('Draft, 18 of 21 scored')
  })

  it('names you when you submitted it, with the "Submitted" prefix', () => {
    const row = { client_id: 1, submitted_at: '2026-08-28T12:00:00Z', submitted_by: VIEWER }
    const text = cardFooter(row, VIEWER, true)
    expect(text).toContain('by you')
    expect(text.startsWith('Submitted ')).toBe(true)
  })

  it('names another account manager when someone else did', () => {
    const row = { client_id: 1, submitted_at: '2026-08-28T12:00:00Z', submitted_by: 'someone-else' }
    expect(cardFooter(row, VIEWER, true)).toContain('by another account manager')
  })

  // The defect this whole slice exists to fix is a screen that says nothing.
  // Carried over from the five-pillar version of this file and widened to
  // cover the gate, since that is now a third axis a blank string could hide
  // behind.
  it('never returns an empty string, in any combination', () => {
    function answeredPrefix(count: number): Record<string, number | boolean> {
      const answers: Record<string, number | boolean> = {}
      for (const key of ALL_QUESTIONS.slice(0, count)) {
        answers[key] = isYesNo(key) ? true : 3
      }
      return answers
    }

    for (const submitted_at of [null, '2026-08-21T17:04:00.000Z']) {
      for (const submitted_by of [null, VIEWER, 'someone-else']) {
        for (const advocacyApplies of [true, false]) {
          for (const count of [0, 1, ALL_QUESTIONS.length]) {
            const row = {
              client_id: 1,
              submitted_at,
              submitted_by,
              ...answeredPrefix(count),
            }
            const text = cardFooter(row, VIEWER, advocacyApplies)
            expect(
              text.trim(),
              JSON.stringify({ submitted_at, submitted_by, advocacyApplies, count }),
            ).not.toBe('')
          }
        }
      }
    }
  })
})

describe('progressLine', () => {
  it('says no active clients when there are none', () => {
    expect(progressLine(0, 0)).toBe('No active clients')
  })

  it('says all submitted when they are', () => {
    expect(progressLine(10, 10)).toBe('All 10 check-ins submitted this month')
  })

  it('counts otherwise', () => {
    expect(progressLine(3, 10)).toBe('3 of 10 check-ins submitted this month')
  })
})
