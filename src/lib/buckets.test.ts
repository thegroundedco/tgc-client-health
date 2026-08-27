import { describe, expect, it } from 'vitest'
import {
  ALL_QUESTIONS,
  BUCKETS,
  BUCKET_DEFINITIONS,
  GATED_BUCKET,
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

  it('holds 22 questions in total', () => {
    expect(ALL_QUESTIONS).toHaveLength(22)
  })

  it('holds the question counts the rubric specifies', () => {
    const counts = BUCKETS.map((bucket) => questionsFor(bucket).length)
    expect(counts).toEqual([3, 3, 4, 4, 4, 4])
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
})
