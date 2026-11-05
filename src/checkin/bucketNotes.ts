import { BUCKETS, type Bucket } from '../lib/buckets'

// Per-bucket notes and the monthly focus (spec 2026-11-04 §2). The column is
// checkins.bucket_notes, jsonb, and a CHECK (private.valid_bucket_notes)
// refuses anything but the six bucket keys, each an object holding only `why`
// and/or `actions`, each a 1-2000 character string, with no empty objects.
// checkins.focus is null or 1-1000 characters. Everything here exists so the
// app only ever sends what those constraints accept.
//
// Notes never count: nothing in this file is read by completeness, the counts
// or any score.

export type BucketNoteField = 'why' | 'actions'
export type BucketNote = { why?: string; actions?: string }
export type BucketNotes = Partial<Record<Bucket, BucketNote>>

export const BUCKET_NOTE_FIELDS: readonly BucketNoteField[] = ['why', 'actions']

// The DB limits. char_length counts code points, so the caps below do too.
export const BUCKET_NOTE_MAX = 2000
export const FOCUS_MAX = 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Trimmed, then capped at `max` code points. Cut by code point, not by
// .slice(), because a UTF-16 slice can split a surrogate pair and leave a lone
// surrogate, which jsonb refuses -- the save would fail on the exact text it
// was trying to make safe. Capping is the last line of defence: Task 3's
// textareas carry maxLength, so in practice nothing reaches here over the
// limit. Re-trimmed after the cut so a cap landing on whitespace leaves none.
function capped(text: string, max: number): string {
  const trimmed = text.trim()
  const points = Array.from(trimmed)
  if (points.length <= max) return trimmed
  return points.slice(0, max).join('').trim()
}

// Tolerant parse of anything claiming to be bucket notes: the stored row, the
// local draft, an AI suggestion. Never throws. Drops unknown buckets, unknown
// fields, non-strings and whitespace-only strings, and any bucket left with
// nothing; trims and caps what it keeps.
export function cleanBucketNotes(raw: unknown): BucketNotes {
  const out: BucketNotes = {}
  if (!isRecord(raw)) return out
  for (const bucket of BUCKETS) {
    const value = raw[bucket]
    if (!isRecord(value)) continue
    const note: BucketNote = {}
    for (const field of BUCKET_NOTE_FIELDS) {
      const text = value[field]
      if (typeof text !== 'string') continue
      const kept = capped(text, BUCKET_NOTE_MAX)
      if (kept !== '') note[field] = kept
    }
    if (note.why !== undefined || note.actions !== undefined) out[bucket] = note
  }
  return out
}

// The draft cache's version of cleanBucketNotes: the same structural rules
// (known buckets, known fields, strings only, nothing that is empty after a
// trim) but the kept text is NOT trimmed or capped, so whitespace typed
// mid-sentence ("abc " on the way to "abc def") survives a reload, the same as
// the general notes and the focus. Comparisons trim; the upsert cleans.
export function keepBucketNotes(raw: unknown): BucketNotes {
  const out: BucketNotes = {}
  if (!isRecord(raw)) return out
  for (const bucket of BUCKETS) {
    const value = raw[bucket]
    if (!isRecord(value)) continue
    const note: BucketNote = {}
    for (const field of BUCKET_NOTE_FIELDS) {
      const text = value[field]
      if (typeof text === 'string' && text.trim() !== '') note[field] = text
    }
    if (note.why !== undefined || note.actions !== undefined) out[bucket] = note
  }
  return out
}

// What the upsert sends: trimmed, empties removed, capped at the DB limit.
// The same rules as cleanBucketNotes, named for the call site so a reader of
// the upsert sees what it is for.
export function bucketNotesForSave(notes: BucketNotes): BucketNotes {
  return cleanBucketNotes(notes)
}

// The focus column's value: trimmed and capped, or null for nothing. An empty
// string is never sent -- the CHECK refuses it.
export function focusForSave(text: string): string | null {
  const kept = capped(text, FOCUS_MAX)
  return kept === '' ? null : kept
}

// One keystroke. Keeps the text exactly as typed, untrimmed, so the textarea
// shows what the person wrote; trimming happens on save and in comparisons.
// Only a truly empty string removes the field (and the bucket, once it has no
// field left), so a cleared box leaves no key behind in the draft.
export function setBucketNote(
  notes: BucketNotes,
  bucket: Bucket,
  field: BucketNoteField,
  text: string,
): BucketNotes {
  const note: BucketNote = { ...notes[bucket] }
  if (text === '') delete note[field]
  else note[field] = text
  const next: BucketNotes = { ...notes }
  if (note.why === undefined && note.actions === undefined) delete next[bucket]
  else next[bucket] = note
  return next
}

// Field by field, trimmed, absent and whitespace-only alike -- the same rule
// draftsDiffer applies to the general notes, so a textarea's trailing newline
// is never an "unsaved change".
export function bucketNotesDiffer(a: BucketNotes, b: BucketNotes): boolean {
  for (const bucket of BUCKETS) {
    for (const field of BUCKET_NOTE_FIELDS) {
      const left = (a[bucket]?.[field] ?? '').trim()
      const right = (b[bucket]?.[field] ?? '').trim()
      if (left !== right) return true
    }
  }
  return false
}

export function hasBucketNoteText(notes: BucketNotes): boolean {
  return bucketNotesDiffer(notes, {})
}
