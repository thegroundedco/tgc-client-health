// Which package a client is on, and how they got there.
//
// The owner's boss, 2026-09-11: "I would love to see a brand join us and we're
// in foundation. And then I'd love to see them graduate from foundation into
// grow... almost being able to see which brands are moving up the ladder with
// us. What's the correlation of someone who signed with us on foundation and
// then graduates to grow? Do they stay with us longer... than a brand who skips
// foundation and jumps straight into grow?"
//
// Pure, and with no Supabase client in sight, for the reason clientForm.ts
// gives about itself: that module throws at import when VITE_ config is absent,
// and CI runs vitest with no VITE_ env at all.

// Only the columns this screen reads, beside the type they produce -- the
// src/board/cardSummary.ts pattern. supabase-js infers the row type from the
// string, so a mistyped column fails the build; a computed string would degrade
// the row to untyped and surface at runtime as undefined.
export const PACKAGE_COLUMNS = 'id, client_id, package_code, started_on, note'

export type PackageStint = {
  id: number
  client_id: number
  package_code: string
  started_on: string
  note: string | null
}

// The three named on the call, IN LADDER ORDER -- the order is the data, not
// presentation: journeyOf compares positions in this array to decide whether a
// client climbed. Unlike the client-type vocabulary, these were actually
// spoken, so they are not a guess.
//
// No CHECK constraint backs this, deliberately, so a fourth rung is one edit
// here rather than a migration. The same arrangement end_reason_code has.
export const PACKAGE_CODES: readonly string[] = ['foundation', 'grow', 'scale']

export const PACKAGE_LABELS: Record<string, string> = {
  foundation: 'Foundation',
  grow: 'Grow',
  scale: 'Scale',
}

// Null is "nobody has said", not "foundation". Defaulting to the first rung
// would invent a journey for every client on the roster -- and the whole
// question being asked is which clients actually climbed.
export function packageLabel(code: string | null): string {
  if (code === null) return 'No package recorded'
  return PACKAGE_LABELS[code] ?? code
}

/** Oldest first, because a journey is read forwards. */
export function sortStints(stints: readonly PackageStint[]): PackageStint[] {
  return [...stints].sort((a, b) => a.started_on.localeCompare(b.started_on))
}

/**
 * The package a client is on today.
 *
 * The latest stint that has actually STARTED, not the last row entered: rows
 * arrive in whatever order the database gives them, somebody correcting history
 * will enter an older stint after a newer one, and a move recorded ahead of
 * time is a plan rather than the current state.
 */
export function currentStint(
  stints: readonly PackageStint[],
  asOf?: string,
): PackageStint | null {
  const started = asOf === undefined ? stints : stints.filter((s) => s.started_on <= asOf)
  const sorted = sortStints(started)
  return sorted.length === 0 ? null : sorted[sorted.length - 1]
}

export type Journey = 'climbed' | 'stayed' | 'descended'

/**
 * Whether a client moved up the ladder, stayed put, or came back down.
 *
 * Judged by the HIGHEST rung reached against the one they signed on at, not by
 * where they are today: foundation to scale and back to grow is still a client
 * who climbed, and the question is whether the ladder works rather than where
 * anybody currently sits.
 *
 * Null when there is no history, or when a rung is not one this list knows: an
 * unrecognised tier has no position, so no movement can be judged, and guessing
 * would put a client in a group they may not belong to.
 */
export function journeyOf(stints: readonly PackageStint[]): Journey | null {
  const sorted = sortStints(stints)
  if (sorted.length === 0) return null

  const rungs = sorted.map((s) => PACKAGE_CODES.indexOf(s.package_code))
  if (rungs.some((rung) => rung === -1)) return null

  const first = rungs[0]
  const highest = Math.max(...rungs)
  const lowest = Math.min(...rungs)

  if (highest > first) return 'climbed'
  if (lowest < first) return 'descended'
  return 'stayed'
}

export type StintDraft = { packageCode: string; startedOn: string; note: string }

export const EMPTY_STINT: StintDraft = { packageCode: '', startedOn: '', note: '' }
export type StintProblem = { field: 'packageCode' | 'startedOn'; text: string }

/**
 * What is wrong with a move before it is sent.
 *
 * The duplicate-date rule is also a database constraint, and that is the point
 * of having it here too: a form that lets Postgres say no is a form that loses
 * what the person typed. The already-on-this-package rule is NOT a constraint,
 * because it is about meaning rather than integrity -- it produces a journey
 * with a step that goes nowhere.
 */
export function stintProblems(
  draft: StintDraft,
  existing: readonly PackageStint[],
): StintProblem[] {
  const problems: StintProblem[] = []

  if (draft.packageCode === '') {
    problems.push({ field: 'packageCode', text: 'Choose a package.' })
  }
  if (draft.startedOn === '') {
    problems.push({ field: 'startedOn', text: 'Give the date they moved.' })
  }
  if (problems.length > 0) return problems

  if (existing.some((stint) => stint.started_on === draft.startedOn)) {
    problems.push({
      field: 'startedOn',
      text: 'There is already a package recorded for that date.',
    })
  }

  // Only the CURRENT package makes a move redundant. Foundation, Grow, back to
  // Foundation is a real thing that happens.
  const current = currentStint(existing)
  if (current !== null && current.package_code === draft.packageCode) {
    problems.push({
      field: 'packageCode',
      text: `They are already on ${packageLabel(draft.packageCode)}.`,
    })
  }

  return problems
}
