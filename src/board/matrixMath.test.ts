import { describe, expect, it } from 'vitest'
import {
  advocacyContext,
  averageDescription,
  cellValue,
  columnAverage,
  matrixRows,
  needsAsterisk,
} from './matrixMath'
import type { MatrixRow } from './matrixMath'
import type { CardCheckin } from './cardSummary'
import type { BoardClient, BoardScore } from './useBoard'

// The arithmetic behind the matrix, with no DOM. This is where the slice can be
// wrong in a way nobody notices: a wrong divisor produces a plausible number,
// and a plausible wrong average is worse than a missing one because somebody
// will act on it.

const PERIOD = '2026-08-01'

// Well past the 90-day gate for PERIOD, so Advocacy applies unless a test says
// otherwise.
const OLD = '2020-01-01'

function client(id: number, name: string, overrides: Partial<BoardClient> = {}): BoardClient {
  return { id, name, status: 'active', started_on: OLD, ...overrides }
}

// Only the columns the matrix reads. Every bucket defaults to null, so a test
// names exactly the scores it is about.
function checkin(id: number, scores: Partial<CardCheckin> = {}): CardCheckin {
  return {
    client_id: id,
    submitted_at: null,
    submitted_by: null,
    comm_score: null,
    growth_score: null,
    fin_score: null,
    rel_score: null,
    del_score: null,
    adv_score: null,
    ...scores,
  }
}

function score(id: number, overall: number | null, applies = true): BoardScore {
  return { client_id: id, overall_score: overall, advocacy_applies: applies }
}

// A convenience for the columnAverage tests: build rows straight from
// (name, started_on, scores) entries without going through the maps.
function rowsOf(
  entries: readonly {
    id: number
    name: string
    started_on?: string | null
    scores?: Partial<CardCheckin>
  }[],
): MatrixRow[] {
  return entries.map((entry) => ({
    // `in`, not `?? OLD`: a null start date is a CASE this file tests -- it is
    // what gates a client out of Advocacy for want of a known tenure -- and ??
    // would quietly replace it with OLD and test the opposite.
    client: client(entry.id, entry.name, {
      started_on: 'started_on' in entry ? (entry.started_on ?? null) : OLD,
    }),
    checkin: entry.scores === undefined ? null : checkin(entry.id, entry.scores),
    overall: null,
  }))
}

describe('matrixRows', () => {
  it('returns every active client, alphabetically, whatever order they arrived in', () => {
    // Not "whatever the cards are showing": the matrix sorts by name directly
    // rather than through visibleClients, whose status-grouping arm it never
    // uses because it only ever holds active clients.
    const rows = matrixRows(
      [client(3, 'York'), client(1, 'Babaloo'), client(2, 'Gait Happens')],
      new Map(),
      new Map(),
    )
    expect(rows.map((row) => row.client.name)).toEqual(['Babaloo', 'Gait Happens', 'York'])
  })

  it('drops every client who is not active', () => {
    // The Average row describes the agency. It must not move because somebody
    // pressed a display control, so the matrix uses isOnBoard rather than the
    // board's show-archived state.
    const rows = matrixRows(
      [
        client(1, 'Active One'),
        client(2, 'Paused One', { status: 'paused' }),
        client(3, 'Churned One', { status: 'churned' }),
      ],
      new Map(),
      new Map(),
    )
    expect(rows.map((row) => row.client.name)).toEqual(['Active One'])
  })

  it('carries the check-in and the overall for a client who has them', () => {
    const rows = matrixRows(
      [client(1, 'Babaloo')],
      new Map([[1, checkin(1, { comm_score: 3.67 })]]),
      new Map([[1, score(1, 3.59)]]),
    )
    expect(rows[0].checkin?.comm_score).toBe(3.67)
    expect(rows[0].overall).toBe(3.59)
  })

  it('gives a client with no check-in a null checkin and a null overall', () => {
    // Never 0. This is the single case where a bug would silently flatter every
    // average in the table.
    const rows = matrixRows([client(1, 'Babaloo')], new Map(), new Map())
    expect(rows[0].checkin).toBeNull()
    expect(rows[0].overall).toBeNull()
  })

  it('does not mutate the array it was given', () => {
    const clients = [client(2, 'York'), client(1, 'Babaloo')]
    matrixRows(clients, new Map(), new Map())
    expect(clients.map((entry) => entry.name)).toEqual(['York', 'Babaloo'])
  })
})

describe('cellValue', () => {
  it('reads the generated column for the bucket, not a recomputed mean', () => {
    const rows = rowsOf([{ id: 1, name: 'Babaloo', scores: { comm_score: 3.67, adv_score: 5 } }])
    expect(cellValue(rows[0], 'communication')).toBe(3.67)
    expect(cellValue(rows[0], 'advocacy')).toBe(5)
  })

  it('is null for an unfinished bucket and for a client with no check-in', () => {
    const [scored, absent] = rowsOf([
      { id: 1, name: 'A', scores: { comm_score: 3 } },
      { id: 2, name: 'B' },
    ])
    expect(cellValue(scored, 'growth')).toBeNull()
    expect(cellValue(absent, 'communication')).toBeNull()
  })
})

describe('columnAverage', () => {
  it('is the plain mean when every client is scored', () => {
    const rows = rowsOf([
      { id: 1, name: 'A', scores: { comm_score: 4 } },
      { id: 2, name: 'B', scores: { comm_score: 5 } },
    ])
    expect(columnAverage(rows, 'communication', PERIOD)).toEqual({
      mean: 4.5,
      scored: 2,
      eligible: 2,
    })
  })

  it('divides by the count of the scored, not by the roster', () => {
    // The owner's ruling, 2026-09-01, in his own words: "the total of the scored
    // clients divided by the number of scored clients, not the total of scored
    // clients divided by total clients."
    //
    // The fixture is chosen so the two rules give DIFFERENT answers: 9 / 2 = 4.50
    // against 9 / 3 = 3.00. A fixture where they agreed would pass under either
    // implementation and guard nothing.
    const rows = rowsOf([
      { id: 1, name: 'A', scores: { comm_score: 4 } },
      { id: 2, name: 'B', scores: { comm_score: 5 } },
      { id: 3, name: 'C' },
    ])
    const average = columnAverage(rows, 'communication', PERIOD)
    expect(average.mean).toBe(4.5)
    expect(average.mean).not.toBe(3)
    expect(average).toEqual({ mean: 4.5, scored: 2, eligible: 3 })
  })

  it('is null, never 0, when nobody in the column is scored', () => {
    const rows = rowsOf([{ id: 1, name: 'A' }, { id: 2, name: 'B' }])
    expect(columnAverage(rows, 'communication', PERIOD)).toEqual({
      mean: null,
      scored: 0,
      eligible: 2,
    })
  })

  it('rounds to two decimals through the app\'s one rounding rule', () => {
    // 3.67 + 5.00 + 4.67 + 4.67 + 3.00 = 21.01 over five, which is 4.202 before
    // rounding -- and 21.01 is not exactly representable in binary floating
    // point, so this also pins that the float error does not reach the output.
    const rows = rowsOf([
      { id: 1, name: 'A', scores: { comm_score: 3.67 } },
      { id: 2, name: 'B', scores: { comm_score: 5 } },
      { id: 3, name: 'C', scores: { comm_score: 4.67 } },
      { id: 4, name: 'D', scores: { comm_score: 4.67 } },
      { id: 5, name: 'E', scores: { comm_score: 3 } },
    ])
    expect(columnAverage(rows, 'communication', PERIOD).mean).toBe(4.2)
  })

  it('excludes gated clients from Advocacy\'s eligible count', () => {
    // A client inside their first 90 days cannot have an Advocacy score, and
    // that is the gate working rather than data going missing. Counting them as
    // missing would light the Advocacy asterisk every month until the newest
    // client passed 90 days, and an asterisk that is always on stops being read.
    const rows = rowsOf([
      { id: 1, name: 'A', scores: { adv_score: 5 } },
      { id: 2, name: 'B', scores: { adv_score: 1 } },
      // Started inside PERIOD's 90-day window, so the gate is shut and their
      // Advocacy cell is empty by design.
      { id: 3, name: 'New', started_on: '2026-07-15', scores: {} },
    ])
    expect(columnAverage(rows, 'advocacy', PERIOD)).toEqual({ mean: 3, scored: 2, eligible: 2 })
  })

  it('still counts a gated client in every ungated column', () => {
    // The gate is Advocacy's alone. A new client's Communication score is a
    // real score and belongs in the agency's Communication average.
    const rows = rowsOf([
      { id: 1, name: 'A', scores: { comm_score: 4 } },
      { id: 2, name: 'New', started_on: '2026-07-15', scores: { comm_score: 2 } },
    ])
    expect(columnAverage(rows, 'communication', PERIOD)).toEqual({
      mean: 3,
      scored: 2,
      eligible: 2,
    })
  })

  it('treats a null start date as gated out of Advocacy', () => {
    // advocacyApplies returns false for a null start date -- an unknown tenure
    // scoring a bucket about referrals is a number nobody has grounds for. The
    // matrix inherits that rule rather than restating it.
    const rows = rowsOf([{ id: 1, name: 'A', started_on: null, scores: { adv_score: 5 } }])
    expect(columnAverage(rows, 'advocacy', PERIOD)).toEqual({
      mean: null,
      scored: 0,
      eligible: 0,
    })
  })

  it('yields no eligible clients at all when everybody is inside 90 days', () => {
    const rows = rowsOf([
      { id: 1, name: 'A', started_on: '2026-07-15' },
      { id: 2, name: 'B', started_on: '2026-07-20' },
    ])
    expect(columnAverage(rows, 'advocacy', PERIOD)).toEqual({
      mean: null,
      scored: 0,
      eligible: 0,
    })
  })

  it('reads the bucket it was asked for and no other', () => {
    const rows = rowsOf([{ id: 1, name: 'A', scores: { comm_score: 5, growth_score: 1 } }])
    expect(columnAverage(rows, 'communication', PERIOD).mean).toBe(5)
    expect(columnAverage(rows, 'growth', PERIOD).mean).toBe(1)
    expect(columnAverage(rows, 'finances', PERIOD).mean).toBeNull()
  })
})

describe('needsAsterisk', () => {
  it('is true when somebody who could have been scored was not', () => {
    expect(needsAsterisk({ mean: 4.5, scored: 2, eligible: 3 })).toBe(true)
  })

  it('is false for a complete column', () => {
    expect(needsAsterisk({ mean: 4.5, scored: 3, eligible: 3 })).toBe(false)
  })

  it('is false when nobody is scored at all', () => {
    // The cell already reads as an em dash. An asterisk beside nothing would
    // imply somebody had failed to do something in a column that has no answer
    // to give.
    expect(needsAsterisk({ mean: null, scored: 0, eligible: 4 })).toBe(false)
  })

  it('is false when nobody was eligible', () => {
    expect(needsAsterisk({ mean: null, scored: 0, eligible: 0 })).toBe(false)
  })
})

describe('averageDescription', () => {
  it('names both counts, so the exact shortfall is available', () => {
    expect(averageDescription({ mean: 4.5, scored: 8, eligible: 10 })).toBe(
      'averaged from 8 of 10 clients',
    )
  })
})

describe('advocacyContext', () => {
  // The Advocacy score is a mean of four yes/no answers, and on its own "2.00"
  // does not say WHICH two. This is the second half of that column: the things
  // the client actually is, listed. Owner's design, 2026-09-01.
  //
  // Only Yes counts. Unsure is deliberately not listed and is not lost either --
  // it is a 3, so it already shows in the score. The two halves of the column
  // say different things on purpose: the number is the temperature including
  // every maybe, the words are only what you can bank on.

  function scored(answers: Partial<CardCheckin>): MatrixRow {
    // adv_score non-null is what "this bucket is finished" means: the generated
    // column is null if ANY of the four answers is missing.
    return rowsOf([{ id: 1, name: 'A', scores: { adv_score: 3, ...answers } }])[0]
  }

  it('names the one thing a client has', () => {
    expect(advocacyContext(scored({ adv_left_review: 5 }))).toBe('Review')
  })

  it('joins two with "and"', () => {
    expect(advocacyContext(scored({ adv_left_review: 5, adv_case_study: 5 }))).toBe(
      'Review and Case study',
    )
  })

  it('joins three or more with commas and a final "and"', () => {
    expect(
      advocacyContext(
        scored({ adv_left_review: 5, adv_case_study: 5, adv_would_refer: 5 }),
      ),
    ).toBe('Review, Case study and Referral')
  })

  it('lists them in rubric order, not in the order the row happens to hold them', () => {
    // The reader compares this cell down a column of eleven clients. A list that
    // reordered itself per client would make two identical clients look
    // different.
    expect(advocacyContext(scored({ adv_would_refer: 5, adv_left_review: 5 }))).toBe(
      'Review and Referral',
    )
  })

  it('says None yet when the bucket is scored but nothing is a Yes', () => {
    // NOT an em dash, and not blank. Blank is what an unscored bucket reads as,
    // and the whole model rests on those two never looking alike: one is a
    // question nobody answered, the other is four answered No.
    expect(advocacyContext(scored({ adv_left_review: 1, adv_case_study: 3 }))).toBe('None yet')
  })

  it('counts only Yes, never Unsure', () => {
    expect(advocacyContext(scored({ adv_case_study: 3 }))).toBe('None yet')
  })

  it('is null when the bucket is not scored at all', () => {
    // Which covers all three ways that happens: no check-in, an unfinished
    // Advocacy section, and a client inside their first 90 days. All three make
    // adv_score null, and all three read as an em dash beside an em dash.
    expect(advocacyContext(rowsOf([{ id: 1, name: 'A' }])[0])).toBeNull()
    expect(advocacyContext(rowsOf([{ id: 1, name: 'A', scores: {} }])[0])).toBeNull()
  })
})
