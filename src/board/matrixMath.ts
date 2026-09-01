import { GATED_BUCKET } from '../lib/buckets'
import type { Bucket } from '../lib/buckets'
import { advocacyApplies } from '../lib/gate'
import { meanTo2dp } from '../lib/scoreMath'
import { isOnBoard } from './boardScope'
import { BUCKET_SCORE_KEY } from './cardSummary'
import type { CardCheckin } from './cardSummary'
import type { BoardClient, BoardScore } from './useBoard'

// The matrix's arithmetic, with no React and no Supabase client -- the shape
// boardScope.ts and cardSummary.ts already use on this screen.
//
// Named matrixMath rather than matrix, which is what the spec called it, for a
// reason worth stating so nobody "corrects" it back: macOS's filesystem is
// case-INSENSITIVE, so `./matrix` and `./Matrix` are the same path. With a
// matrix.ts beside a Matrix.tsx, the resolver takes .ts first and BOTH imports
// land here -- Matrix.tsx imports itself, `Matrix` is undefined, and every test
// in the file fails with "Element type is invalid". The pairing mirrors
// src/lib/scoreMath.ts, which is the same split for the same reason: the
// arithmetic in one module, the thing that renders it in another. Everything here
// is a pure function of rows that are already in memory: this slice adds no
// column, no table and no query.
//
// This module must not import ../lib/supabase, for the reason boardScope.ts
// states: the client reads its config at module scope and THROWS when VITE_ env
// is absent, and CI runs vitest with no VITE_ env at all.

export type MatrixRow = {
  client: BoardClient
  checkin: CardCheckin | null
  // From checkin_scores, never recomputed here. The overall cannot be a
  // generated column (parent spec §6), so the view is the one place it exists.
  overall: number | null
}

export type ColumnAverage = {
  // null when nobody in the column is scored. Never 0.
  mean: number | null
  scored: number
  eligible: number
}

// Every active client, alphabetically, carrying whatever was loaded for them.
//
// isOnBoard rather than the board's show-archived state, deliberately: the
// Average row describes the agency, and that number must not move because
// somebody pressed a display control. Spec §4, decision 3.
//
// Sorted by name directly rather than through visibleClients, whose
// status-grouping arm this list never exercises -- every row here is active, so
// the status rank is uniform and only the name comparison ever runs.
export function matrixRows(
  clients: readonly BoardClient[],
  checkins: ReadonlyMap<number, CardCheckin>,
  scores: ReadonlyMap<number, BoardScore>,
): MatrixRow[] {
  return (
    clients
      // .filter() returns a new array, so the .sort() below cannot reach the
      // caller's. The board's clients array belongs to the hook's state and
      // React compares it by identity: sorting it in place would be a silent
      // mutation.
      .filter((client) => isOnBoard(client.status))
      .map((client) => ({
        client,
        checkin: checkins.get(client.id) ?? null,
        overall: scores.get(client.id)?.overall_score ?? null,
      }))
      .sort((a, b) => a.client.name.localeCompare(b.client.name))
  )
}

// The generated bucket column, read rather than recomputed. This is not an
// optimisation: it means the matrix and the card's bars cannot disagree about a
// bucket, by construction rather than by test. Spec §4, decision 6.
//
// It lives here rather than inline in Matrix.tsx so BUCKET_SCORE_KEY is
// referenced once, and so the cell the reader sees and the value the average
// counts come from the same function.
export function cellValue(row: MatrixRow, bucket: Bucket): number | null {
  return row.checkin?.[BUCKET_SCORE_KEY[bucket]] ?? null
}

// One bucket, down the roster. `period` is needed only for Advocacy's gate.
//
// The divisor is the count of the SCORED, never the roster. Dividing by the
// roster would pretend an unscored client scored zero and drag every average
// down -- the same falsehood as a zero in a cell, wearing a different hat.
// Ruled by the owner 2026-09-01.
//
// advocacyApplies() is used rather than the view's advocacy_applies column
// because the view can only answer for a client who HAS a check-in row, and
// this function has to answer for clients who have not been scored at all --
// which is exactly the case the Average row exists to notice. The two
// definitions are pinned to each other by tests/gateParity.test.ts.
export function columnAverage(
  rows: readonly MatrixRow[],
  bucket: Bucket,
  period: string,
): ColumnAverage {
  let eligible = 0
  let scored = 0
  let sum = 0

  for (const row of rows) {
    if (bucket === GATED_BUCKET && !advocacyApplies(row.client.started_on, period)) continue
    eligible += 1

    const value = cellValue(row, bucket)
    if (value === null) continue
    scored += 1
    sum += value
  }

  return {
    // meanTo2dp, not a local division: one rounding rule in the app, and it is
    // the same one the view's round(x, 2) is pinned against.
    mean: scored === 0 ? null : meanTo2dp(sum, scored),
    scored,
    eligible,
  }
}

// Shown when somebody who could have been scored was not.
//
// `scored > 0` is what keeps it off a column with no answers at all: that cell
// already reads as an em dash, and an asterisk beside nothing would imply
// somebody had failed to do something. An empty column also satisfies
// scored < eligible, so dropping this clause would light the asterisk on every
// unstarted month.
export function needsAsterisk(average: ColumnAverage): boolean {
  return average.scored > 0 && average.scored < average.eligible
}

// The visually-hidden half of an asterisked footer cell, so the exact shortfall
// is available to a screen reader and on inspection without putting a second
// number in every cell.
export function averageDescription(average: ColumnAverage): string {
  return `averaged from ${average.scored} of ${average.eligible} clients`
}
