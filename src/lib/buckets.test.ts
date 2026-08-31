import { describe, expect, it } from 'vitest'
import {
  ALL_QUESTIONS,
  BUCKETS,
  BUCKET_DEFINITIONS,
  CHOICE_OPTIONS,
  GATED_BUCKET,
  OVERALL_EXCLUDED,
  OVERALL_QUESTIONS,
  questionsFor,
} from './buckets'

describe('the six buckets', () => {
  it('is six of them, in the order the rubric was written', () => {
    expect(BUCKETS).toEqual([
      'communication',
      'growth',
      'finances',
      'relationship',
      'delivery',
      'advocacy',
    ])
  })

  it('puts the gated bucket last, because the screen renders in this order', () => {
    expect(BUCKETS[BUCKETS.length - 1]).toBe(GATED_BUCKET)
  })

  it('holds 21 questions in total', () => {
    expect(ALL_QUESTIONS).toHaveLength(21)
  })

  it('holds the question counts the rubric specifies', () => {
    const counts = BUCKETS.map((bucket) => questionsFor(bucket).length)
    expect(counts).toEqual([3, 3, 3, 4, 4, 4])
  })
})

describe('the single-letter initials the board labels its bars with', () => {
  it('gives every bucket one capital letter', () => {
    for (const bucket of BUCKETS) {
      expect(BUCKET_DEFINITIONS[bucket].initial, bucket).toMatch(/^[A-Z]$/)
    }
  })

  it('matches each initial to its own label, so a rename cannot orphan it', () => {
    for (const bucket of BUCKETS) {
      const definition = BUCKET_DEFINITIONS[bucket]
      expect(definition.initial, bucket).toBe(definition.label[0])
    }
  })

  it('keeps all six distinct, so no two bars label identically', () => {
    const initials = BUCKETS.map((bucket) => BUCKET_DEFINITIONS[bucket].initial)
    expect(new Set(initials).size).toBe(BUCKETS.length)
  })
})

describe('the question keys', () => {
  // These keys ARE the column names. A duplicate would mean two prompts writing
  // to one column, and the last write would silently win.
  it('are all distinct', () => {
    expect(new Set(ALL_QUESTIONS).size).toBe(ALL_QUESTIONS.length)
  })

  it('are shaped like the Postgres identifiers they are', () => {
    for (const key of ALL_QUESTIONS) {
      expect(key, key).toMatch(/^[a-z]+(_[a-z]+)+$/)
    }
  })

  it('lists every bucket\'s questions in ALL_QUESTIONS, in bucket order', () => {
    const gathered = BUCKETS.flatMap((bucket) =>
      questionsFor(bucket).map((question) => question.key),
    )
    expect(gathered).toEqual([...ALL_QUESTIONS])
  })

  it('gives every question a prompt that reads as a statement', () => {
    for (const bucket of BUCKETS) {
      for (const question of questionsFor(bucket)) {
        expect(question.prompt.length, question.key).toBeGreaterThan(0)
        expect(question.prompt.trim(), question.key).toBe(question.prompt)
      }
    }
  })

  // The question the owner removed on 2026-08-31. It was never defined -- the
  // source doc carried the boss's own question mark -- and scoring one client's
  // undefined question against another's is not measurement.
  it('no longer carries the retired "On terms" question', () => {
    expect(ALL_QUESTIONS).not.toContain('fin_on_terms')
    expect(questionsFor('finances')).toHaveLength(3)
  })
})

describe('one answer type', () => {
  it('offers exactly three choices, ascending, mapped to 1 / 3 / 5', () => {
    // The mapping IS the losslessness argument in spec §3.2: a four-question
    // bucket of 5s and 1s reproduces `1 + yeses` exactly. A different value
    // here silently rescales Advocacy's whole history.
    expect(CHOICE_OPTIONS.map((option) => option.value)).toEqual([1, 3, 5])
    expect(CHOICE_OPTIONS.map((option) => option.label)).toEqual(['No', 'Unsure', 'Yes'])
  })

  it('gives Finances and Advocacy the choice control and nothing else', () => {
    const choiceBuckets = BUCKETS.filter((bucket) =>
      questionsFor(bucket).some((question) => question.kind === 'choice'),
    )
    expect(choiceBuckets).toEqual(['finances', 'advocacy'])
  })

  it('never mixes kinds inside one bucket', () => {
    // score-parity.mjs no longer dispatches on kind, but CheckIn.tsx renders
    // per question, so a mixed bucket would render fine and read oddly. Pinned
    // because the rubric is the only place that could introduce one.
    for (const bucket of BUCKETS) {
      const kinds = new Set(questionsFor(bucket).map((question) => question.kind))
      expect(kinds.size).toBe(1)
    }
  })

  it('averages seventeen answers into the overall, excluding only Advocacy', () => {
    // The number that broke before. OVERALL_QUESTIONS used to be derived from
    // `kind === 'scale'`, so moving Finances to a choice control would have cut
    // the divisor to 14 with nothing failing. This is the guard.
    expect(OVERALL_QUESTIONS).toHaveLength(17)
    expect(ALL_QUESTIONS).toHaveLength(21)
    expect(OVERALL_EXCLUDED).toBe('advocacy')
    for (const question of questionsFor('finances')) {
      expect(OVERALL_QUESTIONS).toContain(question.key)
    }
    for (const question of questionsFor('advocacy')) {
      expect(OVERALL_QUESTIONS).not.toContain(question.key)
    }
  })

  it('keeps every question on one smallint scale', () => {
    // No question may declare a kind the scoring does not understand.
    for (const bucket of BUCKETS) {
      for (const question of questionsFor(bucket)) {
        expect(['scale', 'choice']).toContain(question.kind)
      }
    }
    expect(Object.keys(BUCKET_DEFINITIONS)).toHaveLength(6)
  })
})
