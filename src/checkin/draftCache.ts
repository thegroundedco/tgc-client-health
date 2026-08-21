import { MAX_PILLAR_SCORE, PILLARS } from '../lib/score'
import type { Pillar } from '../lib/score'

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

export type PillarScores = Partial<Record<Pillar, number>>
export type Draft = { pillars: PillarScores; notes: string }

export const EMPTY_DRAFT: Draft = { pillars: {}, notes: '' }
export const DRAFT_KEY_PREFIX = 'checkin-draft'

// Only the three methods used, so a test can supply a plain object rather than
// a whole Storage.
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function draftKey(clientId: number, period: string): string {
  return `${DRAFT_KEY_PREFIX}:${clientId}:${period}`
}

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function isPillar(key: string): key is Pillar {
  return (PILLARS as readonly string[]).includes(key)
}

function validPillarValue(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_PILLAR_SCORE
  )
}

// The one place invalid pillar entries get dropped. Used by both readDraft,
// where the input is untrusted JSON from storage, and writeDraft, where the
// input is a caller-supplied Draft that can still hold an invalid value (a
// NaN slipped in upstream, for instance) -- sharing this keeps the two paths
// from disagreeing about what counts as a valid pillar, which is what let
// writeDraft report success for a draft that would come back empty.
function normalisePillars(source: unknown): PillarScores {
  const pillars: PillarScores = {}
  if (typeof source === 'object' && source !== null) {
    for (const [key, value] of Object.entries(source)) {
      if (isPillar(key) && validPillarValue(value)) pillars[key] = value
    }
  }
  return pillars
}

export function isDraftEmpty(draft: Draft): boolean {
  return Object.keys(draft.pillars).length === 0 && draft.notes.trim() === ''
}

export function readDraft(
  clientId: number,
  period: string,
  store: StorageLike | null = defaultStorage(),
): Draft | null {
  if (!store) return null

  let raw: string | null
  try {
    raw = store.getItem(draftKey(clientId, period))
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
  if (typeof parsed !== 'object' || parsed === null) return null

  const source = parsed as { pillars?: unknown; notes?: unknown }
  const pillars = normalisePillars(source.pillars)
  const notes = typeof source.notes === 'string' ? source.notes : ''
  const draft: Draft = { pillars, notes }

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
  // that looks non-empty (a pillar key is present) but whose value is invalid
  // (NaN, out of range) -- isDraftEmpty would see the key and call it
  // non-empty, setItem would happily stringify the invalid value, and the very
  // next readDraft would drop that value, find nothing left, and return null.
  // writeDraft would have returned true for a write that round-trips to
  // nothing: a promise made to the person on screen that turns out false the
  // moment it is checked. Normalising first means isDraftEmpty and the stored
  // JSON both reflect what readDraft will actually accept, so the boolean
  // writeDraft returns is honest.
  const normalised: Draft = {
    pillars: normalisePillars(draft.pillars),
    notes: typeof draft.notes === 'string' ? draft.notes : '',
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
    store.removeItem(draftKey(clientId, period))
  } catch {
    // Nothing to do and nothing to say. The save it follows already succeeded,
    // and a stale draft will be compared against the stored row on the next
    // load and found to match.
  }
}

// Compared field by field over PILLARS rather than by stringifying, because
// JSON.stringify is order-sensitive and would call two identical drafts
// different -- which would raise the "you have unsaved changes" warning on
// every load. Notes are trimmed for the same reason: a textarea's trailing
// newline is not a change the person made.
export function draftsDiffer(a: Draft, b: Draft): boolean {
  if (a.notes.trim() !== b.notes.trim()) return true
  for (const pillar of PILLARS) {
    if ((a.pillars[pillar] ?? null) !== (b.pillars[pillar] ?? null)) return true
  }
  return false
}
