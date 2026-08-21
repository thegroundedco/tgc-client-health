import { beforeEach, describe, expect, it } from 'vitest'
import {
  DRAFT_KEY_PREFIX,
  EMPTY_DRAFT,
  clearDraft,
  draftKey,
  draftsDiffer,
  isDraftEmpty,
  readDraft,
  writeDraft,
} from './draftCache'
import type { StorageLike } from './draftCache'

function fakeStore(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed))
  return {
    values,
    store: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    } satisfies StorageLike,
  }
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

describe('draftKey', () => {
  it('is namespaced by client and period', () => {
    // Spec §5.5 names this key. Two clients scored in the same session must not
    // share a draft, and last month's abandoned draft must not surface as this
    // month's.
    expect(draftKey(7, '2026-08-01')).toBe(`${DRAFT_KEY_PREFIX}:7:2026-08-01`)
  })
})

describe('readDraft', () => {
  let fake: ReturnType<typeof fakeStore>
  beforeEach(() => {
    fake = fakeStore()
  })

  it('returns null when nothing was stored', () => {
    expect(readDraft(1, '2026-08-01', fake.store)).toBeNull()
  })

  it('returns null when storage cannot be read at all', () => {
    expect(readDraft(1, '2026-08-01', throwingStore)).toBeNull()
    expect(readDraft(1, '2026-08-01', null)).toBeNull()
  })

  it('round-trips a draft', () => {
    writeDraft(1, '2026-08-01', { pillars: { relationship: 4 }, notes: 'slow month' }, fake.store)
    expect(readDraft(1, '2026-08-01', fake.store)).toEqual({
      pillars: { relationship: 4 },
      notes: 'slow month',
    })
  })

  it('returns null on stored text that is not JSON', () => {
    // Not hypothetical: a half-written value, a different app on the same
    // origin, or a hand-edited key. A crash here would take out the whole
    // screen on load, which is a worse outcome than losing one draft.
    fake.values.set(draftKey(1, '2026-08-01'), '{not json')
    expect(readDraft(1, '2026-08-01', fake.store)).toBeNull()
  })

  it('drops pillar values outside 1 to 5', () => {
    // The database has `check (relationship between 1 and 5)`, so an
    // out-of-range value would be refused on save with a constraint error
    // nobody can act on. Dropping it here means the form shows that pillar as
    // unscored, which is both true and fixable.
    fake.values.set(
      draftKey(1, '2026-08-01'),
      JSON.stringify({ pillars: { relationship: 9, delivery: 0, financial: 3 }, notes: '' }),
    )
    expect(readDraft(1, '2026-08-01', fake.store)).toEqual({
      pillars: { financial: 3 },
      notes: '',
    })
  })

  it('drops values that are not whole numbers', () => {
    fake.values.set(
      draftKey(1, '2026-08-01'),
      JSON.stringify({ pillars: { relationship: 3.5, delivery: '4', financial: null }, notes: 'x' }),
    )
    expect(readDraft(1, '2026-08-01', fake.store)).toEqual({ pillars: {}, notes: 'x' })
  })

  it('drops keys that are not pillars', () => {
    fake.values.set(
      draftKey(1, '2026-08-01'),
      JSON.stringify({ pillars: { relationship: 3, nonsense: 4 }, notes: '' }),
    )
    expect(readDraft(1, '2026-08-01', fake.store)).toEqual({
      pillars: { relationship: 3 },
      notes: '',
    })
  })

  it('treats a missing or non-string notes field as empty', () => {
    fake.values.set(draftKey(1, '2026-08-01'), JSON.stringify({ pillars: { growth: 2 } }))
    expect(readDraft(1, '2026-08-01', fake.store)).toEqual({ pillars: { growth: 2 }, notes: '' })
  })

  it('returns null for a draft that survives validation with nothing in it', () => {
    // An empty draft is not a draft. If it were returned, it would win over the
    // stored row on load and blank a real check-in.
    fake.values.set(
      draftKey(1, '2026-08-01'),
      JSON.stringify({ pillars: { relationship: 99 }, notes: '   ' }),
    )
    expect(readDraft(1, '2026-08-01', fake.store)).toBeNull()
  })
})

describe('writeDraft', () => {
  it('reports whether the draft was actually persisted', () => {
    // The return value is not decoration. §5.5 promises nothing typed can be
    // lost, and that promise does not hold when storage refuses. The screen
    // says so rather than implying a safety it does not have.
    const fake = fakeStore()
    expect(writeDraft(1, '2026-08-01', { pillars: { growth: 1 }, notes: '' }, fake.store)).toBe(true)
    expect(writeDraft(1, '2026-08-01', { pillars: { growth: 1 }, notes: '' }, throwingStore)).toBe(
      false,
    )
    expect(writeDraft(1, '2026-08-01', { pillars: { growth: 1 }, notes: '' }, null)).toBe(false)
  })

  it('removes the key instead of storing an empty draft', () => {
    const fake = fakeStore()
    writeDraft(1, '2026-08-01', { pillars: { growth: 1 }, notes: '' }, fake.store)
    writeDraft(1, '2026-08-01', EMPTY_DRAFT, fake.store)
    expect(fake.values.has(draftKey(1, '2026-08-01'))).toBe(false)
  })
})

describe('clearDraft', () => {
  it('removes only that client and period', () => {
    const fake = fakeStore()
    writeDraft(1, '2026-08-01', { pillars: { growth: 1 }, notes: '' }, fake.store)
    writeDraft(2, '2026-08-01', { pillars: { growth: 5 }, notes: '' }, fake.store)
    clearDraft(1, '2026-08-01', fake.store)
    expect(readDraft(1, '2026-08-01', fake.store)).toBeNull()
    expect(readDraft(2, '2026-08-01', fake.store)).not.toBeNull()
  })

  it('does not throw when storage refuses', () => {
    expect(() => clearDraft(1, '2026-08-01', throwingStore)).not.toThrow()
    expect(() => clearDraft(1, '2026-08-01', null)).not.toThrow()
  })
})

describe('isDraftEmpty', () => {
  it('is true for no pillars and blank notes', () => {
    expect(isDraftEmpty(EMPTY_DRAFT)).toBe(true)
    expect(isDraftEmpty({ pillars: {}, notes: '   ' })).toBe(true)
  })

  it('is false when anything is there', () => {
    expect(isDraftEmpty({ pillars: { growth: 1 }, notes: '' })).toBe(false)
    expect(isDraftEmpty({ pillars: {}, notes: 'a note' })).toBe(false)
  })
})

describe('draftsDiffer', () => {
  it('is false for the same content', () => {
    expect(
      draftsDiffer({ pillars: { growth: 1 }, notes: 'x' }, { pillars: { growth: 1 }, notes: 'x' }),
    ).toBe(false)
  })

  it('ignores key order', () => {
    // JSON.stringify would call these different, which would raise the "you
    // have unsaved changes" warning on every single load.
    expect(
      draftsDiffer(
        { pillars: { growth: 1, relationship: 2 }, notes: '' },
        { pillars: { relationship: 2, growth: 1 }, notes: '' },
      ),
    ).toBe(false)
  })

  it('treats an absent pillar and an unscored one as the same', () => {
    expect(draftsDiffer({ pillars: {}, notes: '' }, { pillars: {}, notes: '' })).toBe(false)
  })

  it('sees a changed pillar, an added pillar and changed notes', () => {
    const base = { pillars: { growth: 1 }, notes: 'x' }
    expect(draftsDiffer(base, { pillars: { growth: 2 }, notes: 'x' })).toBe(true)
    expect(draftsDiffer(base, { pillars: { growth: 1, delivery: 1 }, notes: 'x' })).toBe(true)
    expect(draftsDiffer(base, { pillars: { growth: 1 }, notes: 'y' })).toBe(true)
  })

  it('ignores surrounding whitespace in notes', () => {
    // The stored column holds what was typed; a trailing newline from a
    // textarea must not be reported to the person as an unsaved change.
    expect(
      draftsDiffer({ pillars: {}, notes: 'a note\n' }, { pillars: {}, notes: 'a note' }),
    ).toBe(false)
  })
})
