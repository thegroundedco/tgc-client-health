import { describe, expect, it } from 'vitest'
import {
  ALL_QUESTIONS,
  BUCKETS,
  BUCKET_DEFINITIONS,
  GATED_BUCKET,
  isYesNo,
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

describe('question kinds', () => {
  it('marks every Advocacy question yes/no and every other question scale', () => {
    for (const bucket of BUCKETS) {
      for (const question of questionsFor(bucket)) {
        expect(question.kind).toBe(bucket === GATED_BUCKET ? 'yesno' : 'scale')
      }
    }
  })

  it('isYesNo agrees with the definitions, and is false for an unknown key', () => {
    expect(isYesNo('adv_left_review')).toBe(true)
    expect(isYesNo('comm_timely')).toBe(false)
    expect(isYesNo('not_a_question')).toBe(false)
  })

  // The seventeen that make the overall. Spec §3.2 as amended: Advocacy is
  // excluded whatever the gate says, so this list is fixed and does not take a
  // gate argument.
  it('OVERALL_QUESTIONS is the 17 non-Advocacy keys, in rubric order', () => {
    expect(OVERALL_QUESTIONS).toHaveLength(17)
    expect(OVERALL_QUESTIONS.some((k) => isYesNo(k))).toBe(false)
    expect([...OVERALL_QUESTIONS]).toEqual(
      ALL_QUESTIONS.filter((k) => !isYesNo(k)),
    )
  })

  it('the four yes/no keys are exactly the Advocacy bucket', () => {
    expect(ALL_QUESTIONS.filter(isYesNo)).toEqual(
      questionsFor(GATED_BUCKET).map((q) => q.key),
    )
  })
})
