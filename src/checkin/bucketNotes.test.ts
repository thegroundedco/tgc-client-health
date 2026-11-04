import { describe, expect, it } from 'vitest'
import {
  BUCKET_NOTE_MAX,
  FOCUS_MAX,
  bucketNotesDiffer,
  bucketNotesForSave,
  cleanBucketNotes,
  focusForSave,
  hasBucketNoteText,
  setBucketNote,
} from './bucketNotes'

describe('cleanBucketNotes', () => {
  it('keeps a well-formed value, trimmed', () => {
    expect(
      cleanBucketNotes({ communication: { why: '  slow replies \n', actions: 'weekly call' } }),
    ).toEqual({ communication: { why: 'slow replies', actions: 'weekly call' } })
  })

  it('drops an unknown bucket', () => {
    expect(cleanBucketNotes({ sentiment: { why: 'x' }, growth: { why: 'y' } })).toEqual({
      growth: { why: 'y' },
    })
  })

  it('drops a field other than why and actions', () => {
    expect(cleanBucketNotes({ growth: { why: 'y', extra: 'z' } })).toEqual({ growth: { why: 'y' } })
  })

  it('drops a non-string value', () => {
    expect(cleanBucketNotes({ growth: { why: 5, actions: 'a' } })).toEqual({ growth: { actions: 'a' } })
    expect(cleanBucketNotes({ growth: { why: null } })).toEqual({})
  })

  it('drops a whitespace-only value, and a bucket left with nothing', () => {
    expect(cleanBucketNotes({ growth: { why: '   ', actions: '\n' }, delivery: { why: 'd' } })).toEqual({
      delivery: { why: 'd' },
    })
  })

  it('drops an empty object for a bucket', () => {
    expect(cleanBucketNotes({ growth: {} })).toEqual({})
  })

  it('drops a bucket whose value is not an object', () => {
    expect(cleanBucketNotes({ growth: 'why', delivery: ['a'] })).toEqual({})
  })

  it.each([null, undefined, 'x', 5, ['a'], true])('gives {} for %p', (raw) => {
    expect(cleanBucketNotes(raw)).toEqual({})
  })
})

describe('bucketNotesForSave', () => {
  it('trims and removes empties, so nothing the DB CHECK refuses is sent', () => {
    expect(
      bucketNotesForSave({
        communication: { why: '  ', actions: ' call weekly ' },
        growth: { why: '\n\t' },
      }),
    ).toEqual({ communication: { actions: 'call weekly' } })
  })

  it('sends {} for notes that are all whitespace', () => {
    expect(bucketNotesForSave({ advocacy: { why: ' ', actions: ' ' } })).toEqual({})
  })

  it(`caps each string at ${BUCKET_NOTE_MAX} characters`, () => {
    const out = bucketNotesForSave({ growth: { why: 'a'.repeat(BUCKET_NOTE_MAX + 50) } })
    expect(out.growth?.why).toBe('a'.repeat(BUCKET_NOTE_MAX))
  })

  it('caps by character, never splitting a surrogate pair', () => {
    // The DB counts code points (char_length); a split pair would be a lone
    // surrogate, which jsonb refuses.
    const out = bucketNotesForSave({ growth: { why: '😀'.repeat(BUCKET_NOTE_MAX + 1) } })
    expect(Array.from(out.growth?.why ?? '')).toHaveLength(BUCKET_NOTE_MAX)
    expect(out.growth?.why).toBe('😀'.repeat(BUCKET_NOTE_MAX))
  })

  it('keeps a value of exactly the limit', () => {
    const exact = 'b'.repeat(BUCKET_NOTE_MAX)
    expect(bucketNotesForSave({ growth: { why: exact } }).growth?.why).toBe(exact)
  })
})

describe('focusForSave', () => {
  it('is null for empty or whitespace-only text', () => {
    expect(focusForSave('')).toBeNull()
    expect(focusForSave('  \n')).toBeNull()
  })

  it('trims', () => {
    expect(focusForSave('  renewal talk ')).toBe('renewal talk')
  })

  it(`caps at ${FOCUS_MAX} characters`, () => {
    expect(focusForSave('f'.repeat(FOCUS_MAX + 1))).toBe('f'.repeat(FOCUS_MAX))
    expect(focusForSave('f'.repeat(FOCUS_MAX))).toBe('f'.repeat(FOCUS_MAX))
  })
})

describe('setBucketNote', () => {
  it('sets a field without touching the others or the input', () => {
    const before = { growth: { why: 'w' } }
    const after = setBucketNote(before, 'growth', 'actions', 'a ')
    expect(after).toEqual({ growth: { why: 'w', actions: 'a ' } })
    expect(before).toEqual({ growth: { why: 'w' } })
  })

  it('keeps what was typed, untrimmed, so the box shows it', () => {
    expect(setBucketNote({}, 'delivery', 'why', 'late ')).toEqual({ delivery: { why: 'late ' } })
  })

  it('removes a field set to empty, and the bucket once it has none', () => {
    const one = setBucketNote({ growth: { why: 'w', actions: 'a' } }, 'growth', 'why', '')
    expect(one).toEqual({ growth: { actions: 'a' } })
    expect(setBucketNote(one, 'growth', 'actions', '')).toEqual({})
  })
})

describe('bucketNotesDiffer', () => {
  it('ignores surrounding whitespace and key order', () => {
    expect(
      bucketNotesDiffer(
        { growth: { why: 'w\n', actions: 'a' } },
        { growth: { actions: 'a', why: 'w' } },
      ),
    ).toBe(false)
  })

  it('treats a whitespace-only field as absent', () => {
    expect(bucketNotesDiffer({ growth: { why: '  ' } }, {})).toBe(false)
  })

  it('is true for a real difference in either field, in any bucket', () => {
    expect(bucketNotesDiffer({ advocacy: { actions: 'x' } }, { advocacy: { actions: 'y' } })).toBe(true)
    expect(bucketNotesDiffer({}, { communication: { why: 'x' } })).toBe(true)
  })
})

describe('hasBucketNoteText', () => {
  it('is false for nothing or only whitespace, true for any text', () => {
    expect(hasBucketNoteText({})).toBe(false)
    expect(hasBucketNoteText({ growth: { why: ' ' } })).toBe(false)
    expect(hasBucketNoteText({ growth: { actions: 'x' } })).toBe(true)
  })
})
