import { ALL_QUESTIONS } from '../lib/buckets'
import { MAX_SCORE, MIN_SCORE } from '../lib/scoreMath'
import { bucketNotesDiffer, cleanBucketNotes, hasBucketNoteText } from './bucketNotes'
import type { BucketNotes } from './bucketNotes'

// The local draft. Slice 1 spec §5.5: every click and keystroke is written here,
// and it is cleared only on a confirmed save.
//
// Two things this file is careful about, and a reviewer should check both.
//
// First, storage is optional. Safari in private browsing throws on setItem once
// its quota is spent, and an embedded context can throw on the property access
// itself. Every entry point below treats that as a normal outcome, and
// writeDraft returns whether the write actually happened so the screen can stop
// promising a safety it does not have.
//
// Second, everything read back is untrusted. The value is arbitrary JSON from
// the origin -- stale from an older shape, hand-edited, or half-written -- and
// it is read at the exact moment the screen is deciding what to show. A crash
// here would take out the whole screen on load, and an out-of-range value would
// reach the upsert and come back as a check-constraint error nobody can act on.
//
// Third, the stored shape is VERSIONED, as of the six-bucket model. A v1 draft
// holds `pillars`, whose five keys are columns being retired. Restoring one into
// this form would present values from a different rubric as this month's
// answers, which is the same failure class as reading a value that means one
// thing as though it meant another. So the key carries a version segment, a v1
// key can never be read as the current one, and readDraft deletes any v1 key it
// passes -- rejected rather than migrated, spec §7.
//
// Fourth, that version has already had to bump once more, for the same reason.
// Advocacy's four questions became booleans in the database, and a v2 draft
// holds a NUMBER against a key like adv_left_review -- a 1-5 score where a
// boolean belongs. So the key became v3, a v2 key can never be read as a v3
// one, and readDraft deletes any v2 key it passes -- alongside the v1 discard
// it already did, because a browser that has not opened this tool since before
// the six-bucket change still holds one of those, and it is two shapes out of
// date rather than one.
//
// Fifth, that version has bumped again, and it is the same failure one type
// later. As of 2026-08-31 every question -- Advocacy's four included -- is a
// nullable smallint 1-5, and a v3 draft holds `true`/`false` against a key like
// adv_left_review. So the key is now v4, a v3 key can never be read as a v4
// one, and readDraft deletes any v3 key it passes -- alongside the v1 and v2
// discards it already did, each one shape further out of date than the last.
//
// Sixth, v5 (2026-11-04): the draft gained bucketNotes and focus. This bump is
// different in kind from the three before it. Nothing a v4 draft holds has
// changed meaning -- its answers and notes are exactly the v5 ones -- it is
// only missing two fields. So a v4 entry is READ, not discarded: readDraft
// falls back to it when there is no v5 entry, and gives it empty bucket notes
// and focus. Discarding it would throw away answers somebody typed and has not
// saved. Once a v5 entry is written (writeDraft) or the check-in is saved
// (clearDraft), the v4 entry is removed: left behind, it would be read again
// after the v5 one was cleared and resurface as "unsaved changes from an
// earlier visit" over newer saved answers.

// Absent, not null: an unanswered question has no key. Everything downstream
// counts on that -- normaliseAnswers builds on it, and scoreV2.answeredCount
// treats undefined and null alike so either would be safe there, but the upsert
// in useCheckin spreads the rubric rather than the object's own keys and would
// not notice a null. A 1 is a real answer, not absence: it gets a key like any
// other value, and only its absence means unanswered.
export type QuestionScores = Partial<Record<string, number>>
// bucketNotes and focus hold the text as typed, untrimmed; the upsert trims
// (bucketNotesForSave, focusForSave) and comparisons trim.
export type Draft = { answers: QuestionScores; notes: string; bucketNotes: BucketNotes; focus: string }

export const EMPTY_DRAFT: Draft = { answers: {}, notes: '', bucketNotes: {}, focus: '' }
export const DRAFT_KEY_PREFIX = 'checkin-draft'
export const DRAFT_VERSION = 'v5'

// Only the three methods used, so a test can supply a plain object rather than
// a whole Storage.
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function draftKey(clientId: number, period: string): string {
  return `${DRAFT_KEY_PREFIX}:${DRAFT_VERSION}:${clientId}:${period}`
}

// The unversioned key v1 wrote. Only readDraft knows it, and only to delete it.
function legacyDraftKey(clientId: number, period: string): string {
  return `${DRAFT_KEY_PREFIX}:${clientId}:${period}`
}

// The key v2 wrote, two versions behind the current shape rather than one.
// Only readDraft knows it, and only to delete it.
function v2DraftKey(clientId: number, period: string): string {
  return `${DRAFT_KEY_PREFIX}:v2:${clientId}:${period}`
}

// The key v3 wrote, two versions behind the current shape. Only readDraft
// knows it, and only to delete it.
function v3DraftKey(clientId: number, period: string): string {
  return `${DRAFT_KEY_PREFIX}:v3:${clientId}:${period}`
}

// The key v4 wrote. Unlike the three above it is still READ (see the header):
// readDraft falls back to it, and writeDraft and clearDraft remove it.
function v4DraftKey(clientId: number, period: string): string {
  return `${DRAFT_KEY_PREFIX}:v4:${clientId}:${period}`
}

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function isQuestion(key: string): boolean {
  return ALL_QUESTIONS.includes(key)
}

// A v3 draft holds booleans against the four adv_* keys; a v4 draft holds 5, 3
// or 1. Restoring the old shape would render an answered question as blank over
// a draft the person believes is saved -- the same failure v2 to v3 was for.
// Version segments make the old shape unreachable rather than merely unlikely.
function validAnswer(key: string, value: unknown): value is number {
  if (!isQuestion(key)) return false
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_SCORE &&
    value <= MAX_SCORE
  )
}

// The one place invalid entries get dropped, shared by readDraft (untrusted JSON
// from storage) and writeDraft (a caller-supplied Draft that can still hold an
// invalid value). Sharing it keeps the two paths from disagreeing about what
// counts as a valid answer, which is what let writeDraft report success for a
// draft that would come back empty.
function normaliseAnswers(source: unknown): QuestionScores {
  const answers: QuestionScores = {}
  if (typeof source === 'object' && source !== null) {
    for (const [key, value] of Object.entries(source)) {
      if (isQuestion(key) && validAnswer(key, value)) answers[key] = value
    }
  }
  return answers
}

// Counts keys, not truthy values: a 1 is a real answer, so a draft holding
// only `{ adv_left_review: 1 }` must not register as empty. Object.keys sees
// the key regardless of what it holds, so this is already correct as written
// -- there is nothing to change here for a "No", only this note for the next
// reader who reaches for `if (value)` and finds it silently drops one.
//
// Bucket notes and a focus are content too (Review Focus 4): a draft holding
// only them is a draft, not nothing. Whitespace-only text is not content, the
// same rule as the general notes.
export function isDraftEmpty(draft: Draft): boolean {
  return (
    Object.keys(draft.answers).length === 0 &&
    draft.notes.trim() === '' &&
    !hasBucketNoteText(draft.bucketNotes) &&
    draft.focus.trim() === ''
  )
}

// Untrusted JSON into a Draft. `current` is false for a v4 entry, which
// predates bucketNotes and focus: anything it holds under those names was not
// written by this app and is ignored.
function draftFromStored(parsed: unknown, current: boolean): Draft | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const source = parsed as { answers?: unknown; notes?: unknown; bucketNotes?: unknown; focus?: unknown }
  return {
    answers: normaliseAnswers(source.answers),
    notes: typeof source.notes === 'string' ? source.notes : '',
    bucketNotes: current ? cleanBucketNotes(source.bucketNotes) : {},
    focus: current && typeof source.focus === 'string' ? source.focus : '',
  }
}

export function readDraft(
  clientId: number,
  period: string,
  store: StorageLike | null = defaultStorage(),
): Draft | null {
  if (!store) return null

  // Before anything else, and its own try/catch: a throwing removeItem must not
  // stop this month's real draft from being read. Nothing depends on any of
  // these deletions succeeding -- a surviving v1, v2 or v3 key is still
  // unreadable, because draftKey can no longer name it.
  try {
    store.removeItem(legacyDraftKey(clientId, period))
  } catch {
    // Nothing to do and nothing to say.
  }
  try {
    store.removeItem(v2DraftKey(clientId, period))
  } catch {
    // Nothing to do and nothing to say.
  }
  try {
    store.removeItem(v3DraftKey(clientId, period))
  } catch {
    // Nothing to do and nothing to say.
  }

  // The v5 entry, else the v4 one. A v5 entry always wins: it is the newer
  // write, and its existence means writeDraft has already run.
  let raw: string | null
  let current = true
  try {
    raw = store.getItem(draftKey(clientId, period))
    if (raw === null) {
      raw = store.getItem(v4DraftKey(clientId, period))
      current = false
    }
  } catch {
    return null
  }
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const draft = draftFromStored(parsed, current)
  if (draft === null) return null

  // An empty draft is not a draft. Returning one would let it win over the
  // stored row on load and blank a real check-in.
  return isDraftEmpty(draft) ? null : draft
}

export function writeDraft(
  clientId: number,
  period: string,
  draft: Draft,
  store: StorageLike | null = defaultStorage(),
): boolean {
  if (!store) return false
  const key = draftKey(clientId, period)

  // Normalised before anything else, through the same rules readDraft applies
  // on the way back out. Without this, a caller could hand writeDraft a draft
  // that looks non-empty (an answer key is present) but whose value is invalid
  // (NaN, out of range) -- isDraftEmpty would see the key and call it
  // non-empty, setItem would happily stringify the invalid value, and the very
  // next readDraft would drop that value, find nothing left, and return null.
  // writeDraft would have returned true for a write that round-trips to
  // nothing: a promise made to the person on screen that turns out false the
  // moment it is checked. Normalising first means isDraftEmpty and the stored
  // JSON both reflect what readDraft will actually accept, so the boolean
  // writeDraft returns is honest.
  const normalised: Draft = {
    answers: normaliseAnswers(draft.answers),
    notes: typeof draft.notes === 'string' ? draft.notes : '',
    bucketNotes: cleanBucketNotes(draft.bucketNotes),
    focus: typeof draft.focus === 'string' ? draft.focus : '',
  }

  // This write supersedes any v4 entry (see the header). Its own try/catch,
  // and before the write, so a failure here cannot cost the write itself.
  try {
    store.removeItem(v4DraftKey(clientId, period))
  } catch {
    // Nothing to do: readDraft prefers v5, so a surviving v4 entry only
    // matters once v5 is gone, and clearDraft removes it then too.
  }

  try {
    if (isDraftEmpty(normalised)) {
      // Removed rather than stored. A stored empty value would sit as dead
      // bytes against this key -- consuming a share of a quota that, per the
      // file header, can already run out -- for a draft that carries no
      // information: readDraft treats it identically to no key ever having
      // been written, via the same isDraftEmpty check above. Removing it also
      // means anything that ever lists keys by DRAFT_KEY_PREFIX without going
      // through readDraft sees no entry for a client and period with nothing
      // saved, rather than one it would have to inspect to find empty.
      store.removeItem(key)
      return true
    }
    store.setItem(key, JSON.stringify(normalised))
    return true
  } catch {
    return false
  }
}

export function clearDraft(
  clientId: number,
  period: string,
  store: StorageLike | null = defaultStorage(),
): void {
  if (!store) return
  try {
    store.removeItem(v4DraftKey(clientId, period))
  } catch {
    // As below.
  }
  try {
    store.removeItem(draftKey(clientId, period))
  } catch {
    // Nothing to do and nothing to say. The save it follows already succeeded,
    // and a stale draft will be compared against the stored row on the next
    // load and found to match.
  }
}

// Compared key by key over ALL_QUESTIONS rather than by stringifying, because
// JSON.stringify is order-sensitive and would call two identical drafts
// different -- which would raise the "you have unsaved changes" warning on every
// load. Notes are trimmed for the same reason: a textarea's trailing newline is
// not a change the person made.
//
// The `?? null` per key already distinguishes `1` from absent -- `1` coalesces
// to itself, only `undefined` becomes `null` -- so a "No" compares unequal to
// that same question being unanswered, exactly as it must.
//
// Bucket notes and focus are compared by the same trimmed rule as the notes.
export function draftsDiffer(a: Draft, b: Draft): boolean {
  if (a.notes.trim() !== b.notes.trim()) return true
  if (a.focus.trim() !== b.focus.trim()) return true
  if (bucketNotesDiffer(a.bucketNotes, b.bucketNotes)) return true
  for (const key of ALL_QUESTIONS) {
    if ((a.answers[key] ?? null) !== (b.answers[key] ?? null)) return true
  }
  return false
}
