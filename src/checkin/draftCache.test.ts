import { describe, expect, it } from 'vitest'
import { ALL_QUESTIONS } from '../lib/buckets'
import {
  DRAFT_KEY_PREFIX,
  DRAFT_VERSION,
  EMPTY_DRAFT,
  clearDraft,
  draftKey,
  draftsDiffer,
  isDraftEmpty,
  readDraft,
  writeDraft,
  type StorageLike,
} from './draftCache'

function memoryStore(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  const store: StorageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
  return { store, map }
}

// Every entry point has to survive this. Safari in private browsing throws on
// setItem once its quota is spent, and an embedded context can throw on the
// property access itself.
const throwingStore: StorageLike = {
  getItem: () => {
    throw new Error('storage unavailable')
  },
  setItem: () => {
    throw new Error('quota exceeded')
  },
  removeItem: () => {
    throw new Error('storage unavailable')
  },
}

describe('readDraft', () => {
  it('returns null when nothing was stored', () => {
    const { store } = memoryStore()
    expect(readDraft(1, '2026-08-01', store)).toBeNull()
  })

  it('returns null when storage cannot be read at all', () => {
    expect(readDraft(1, '2026-08-01', throwingStore)).toBeNull()
    expect(readDraft(1, '2026-08-01', null)).toBeNull()
  })

  it('round-trips a draft', () => {
    const { store } = memoryStore()
    writeDraft(1, '2026-08-01', { answers: { comm_timely: 4 }, notes: 'slow month' }, store)
    expect(readDraft(1, '2026-08-01', store)).toEqual({
      answers: { comm_timely: 4 },
      notes: 'slow month',
    })
  })

  it('returns null on stored text that is not JSON', () => {
    // Not hypothetical: a half-written value, a different app on the same
    // origin, or a hand-edited key. A crash here would take out the whole
    // screen on load, which is a worse outcome than losing one draft.
    const { store } = memoryStore({ [draftKey(1, '2026-08-01')]: '{not json' })
    expect(readDraft(1, '2026-08-01', store)).toBeNull()
  })

  it('returns null when the stored value parses to something other than an object', () => {
    // JSON.parse happily succeeds on a bare number, string, or array. readDraft
    // must reject anything that is not an object before it looks for `answers`
    // on it.
    const { store } = memoryStore({ [draftKey(1, '2026-08-01')]: JSON.stringify(5) })
    expect(readDraft(1, '2026-08-01', store)).toBeNull()
  })

  it('treats a missing or non-string notes field as empty', () => {
    const { store } = memoryStore({
      [draftKey(1, '2026-08-01')]: JSON.stringify({ answers: { comm_timely: 2 } }),
    })
    expect(readDraft(1, '2026-08-01', store)).toEqual({ answers: { comm_timely: 2 }, notes: '' })
  })

  it('returns null for a draft that survives validation with nothing in it', () => {
    // An empty draft is not a draft. If it were returned, it would win over the
    // stored row on load and blank a real check-in.
    const { store } = memoryStore({
      [draftKey(1, '2026-08-01')]: JSON.stringify({ answers: { comm_timely: 99 }, notes: '   ' }),
    })
    expect(readDraft(1, '2026-08-01', store)).toBeNull()
  })
})

describe('the versioned key', () => {
  it('carries a version segment, so a v1 draft can never be read as a v2 one', () => {
    expect(draftKey(7, '2026-08-01')).toBe(`${DRAFT_KEY_PREFIX}:${DRAFT_VERSION}:7:2026-08-01`)
    expect(DRAFT_VERSION).not.toBe('')
  })

  // §7: rejected rather than migrated. A v1 draft holds `pillars`, whose five
  // keys are retired columns; restoring it would put values from a different
  // rubric into this form and call them this month's answers.
  it('ignores a v1 draft entirely', () => {
    const legacyKey = `${DRAFT_KEY_PREFIX}:7:2026-08-01`
    const { store } = memoryStore({
      [legacyKey]: JSON.stringify({ pillars: { relationship: 4, delivery: 5 }, notes: 'hi' }),
    })
    expect(readDraft(7, '2026-08-01', store)).toBeNull()
  })

  // Discarded, not merely ignored. An ignored key sits in a quota that this
  // file's header records as exhaustible, forever, for a value nothing will
  // ever read again.
  it('deletes the v1 draft it found, so it stops occupying the quota', () => {
    const legacyKey = `${DRAFT_KEY_PREFIX}:7:2026-08-01`
    const { store, map } = memoryStore({
      [legacyKey]: JSON.stringify({ pillars: { relationship: 4 }, notes: '' }),
    })
    readDraft(7, '2026-08-01', store)
    expect(map.has(legacyKey)).toBe(false)
  })

  it('discarding a v1 draft cannot throw out of readDraft', () => {
    const store: StorageLike = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error('quota')
      },
    }
    expect(() => readDraft(7, '2026-08-01', store)).not.toThrow()
  })
})

describe('the 22 answers', () => {
  it('round-trips every question key the rubric defines', () => {
    const answers = Object.fromEntries(ALL_QUESTIONS.map((key, index) => [key, (index % 5) + 1]))
    const { store } = memoryStore()
    expect(writeDraft(7, '2026-08-01', { answers, notes: '' }, store)).toBe(true)
    expect(readDraft(7, '2026-08-01', store)?.answers).toEqual(answers)
  })

  // The stray-key case. A draft is arbitrary JSON from the origin, and a key
  // that is not in the rubric would reach the upsert as a column that does not
  // exist -- a whole-save failure caused by a value nobody typed.
  it('drops a key the rubric does not define', () => {
    const { store } = memoryStore({
      [draftKey(7, '2026-08-01')]: JSON.stringify({
        answers: { comm_timely: 3, relationship: 4, not_a_question: 5 },
        notes: '',
      }),
    })
    expect(readDraft(7, '2026-08-01', store)?.answers).toEqual({ comm_timely: 3 })
  })

  it.each([0, 6, 2.5, Number.NaN, '3', null])('drops the out-of-range value %p', (bad) => {
    const { store } = memoryStore({
      [draftKey(7, '2026-08-01')]: JSON.stringify({
        answers: { comm_timely: 3, comm_constructive: bad },
        notes: '',
      }),
    })
    expect(readDraft(7, '2026-08-01', store)?.answers).toEqual({ comm_timely: 3 })
  })
})

describe('writeDraft', () => {
  it('reports whether the draft was actually persisted', () => {
    // The return value is not decoration. §5.5 promises nothing typed can be
    // lost, and that promise does not hold when storage refuses. The screen
    // says so rather than implying a safety it does not have.
    const { store } = memoryStore()
    expect(
      writeDraft(1, '2026-08-01', { answers: { growth_hitting_goals: 1 }, notes: '' }, store),
    ).toBe(true)
    expect(
      writeDraft(
        1,
        '2026-08-01',
        { answers: { growth_hitting_goals: 1 }, notes: '' },
        throwingStore,
      ),
    ).toBe(false)
    expect(
      writeDraft(1, '2026-08-01', { answers: { growth_hitting_goals: 1 }, notes: '' }, null),
    ).toBe(false)
  })

  it('removes the key instead of storing an empty draft', () => {
    const { store, map } = memoryStore()
    writeDraft(1, '2026-08-01', { answers: { growth_hitting_goals: 1 }, notes: '' }, store)
    writeDraft(1, '2026-08-01', EMPTY_DRAFT, store)
    expect(map.has(draftKey(1, '2026-08-01'))).toBe(false)
  })

  it('a draft that writes must read back identically', () => {
    // writeDraft's returned true is a promise that the draft is now safe. If
    // the write path and the read path judged validity differently, that
    // promise could be false the moment it was checked: a draft could report
    // a successful write and then read back as something else entirely, or as
    // nothing at all. This pins the round trip rather than the stored string,
    // because the string is an implementation detail and a future change to
    // it should not have to touch this test.
    const { store, map } = memoryStore()

    // A valid draft round-trips to itself.
    const valid = { answers: { rel_collaborative: 3, del_on_time: 5 }, notes: 'steady' }
    expect(writeDraft(1, '2026-08-01', valid, store)).toBe(true)
    expect(readDraft(1, '2026-08-01', store)).toEqual(valid)

    // A draft whose only answer is invalid has nothing left once normalised,
    // so the key is removed rather than left holding a garbage value that
    // would only consume quota for something readDraft can never return, and
    // the write is still honestly reported. Checked both ways: the key itself
    // must be gone, not merely read back as null, because a normalised-write
    // bug that stores instead of removing would still read back as null
    // through readDraft's own normalisation and hide behind it.
    const onlyInvalid = { answers: { growth_hitting_goals: Number.NaN }, notes: '' }
    expect(writeDraft(2, '2026-08-01', onlyInvalid, store)).toBe(true)
    expect(map.has(draftKey(2, '2026-08-01'))).toBe(false)
    expect(readDraft(2, '2026-08-01', store)).toBeNull()

    // A draft with one valid and one invalid answer keeps only the valid one,
    // and that is exactly what comes back.
    const mixed = { answers: { growth_hitting_goals: 2, fin_pays_on_time: Number.NaN }, notes: 'x' }
    expect(writeDraft(3, '2026-08-01', mixed, store)).toBe(true)
    expect(readDraft(3, '2026-08-01', store)).toEqual({
      answers: { growth_hitting_goals: 2 },
      notes: 'x',
    })
  })
})

describe('clearDraft', () => {
  it('removes only that client and period', () => {
    const { store } = memoryStore()
    writeDraft(1, '2026-08-01', { answers: { growth_hitting_goals: 1 }, notes: '' }, store)
    writeDraft(2, '2026-08-01', { answers: { growth_hitting_goals: 5 }, notes: '' }, store)
    clearDraft(1, '2026-08-01', store)
    expect(readDraft(1, '2026-08-01', store)).toBeNull()
    expect(readDraft(2, '2026-08-01', store)).not.toBeNull()
  })

  it('does not throw when storage refuses', () => {
    expect(() => clearDraft(1, '2026-08-01', throwingStore)).not.toThrow()
    expect(() => clearDraft(1, '2026-08-01', null)).not.toThrow()
  })
})

describe('isDraftEmpty', () => {
  it('is true for the empty draft', () => {
    expect(isDraftEmpty(EMPTY_DRAFT)).toBe(true)
    expect(isDraftEmpty({ answers: {}, notes: '   ' })).toBe(true)
  })

  it('is false once any answer or note is present', () => {
    expect(isDraftEmpty({ answers: { comm_timely: 1 }, notes: '' })).toBe(false)
    expect(isDraftEmpty({ answers: {}, notes: 'x' })).toBe(false)
  })
})

describe('draftsDiffer', () => {
  it('is false for two drafts that differ only in key order', () => {
    const a = { answers: { comm_timely: 3, del_on_time: 4 }, notes: 'x' }
    const b = { answers: { del_on_time: 4, comm_timely: 3 }, notes: 'x ' }
    expect(draftsDiffer(a, b)).toBe(false)
  })

  it('treats an absent answer and an unscored one as the same', () => {
    // The `??` in draftsDiffer normalises both to null, so a key that is
    // present with an undefined value must compare equal to the key being
    // absent altogether -- otherwise a draft that once held an answer and lost
    // it could look "different" from one that never had it.
    expect(
      draftsDiffer(
        { answers: { comm_timely: undefined }, notes: '' },
        { answers: {}, notes: '' },
      ),
    ).toBe(false)
  })

  it('is true when any one of the 22 differs', () => {
    for (const key of ALL_QUESTIONS) {
      expect(draftsDiffer({ answers: {}, notes: '' }, { answers: { [key]: 3 }, notes: '' })).toBe(
        true,
      )
    }
  })

  it('ignores surrounding whitespace in notes', () => {
    // The stored column holds what was typed; a trailing newline from a
    // textarea must not be reported to the person as an unsaved change.
    expect(
      draftsDiffer({ answers: {}, notes: 'a note\n' }, { answers: {}, notes: 'a note' }),
    ).toBe(false)
  })
})
