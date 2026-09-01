# Slice 5 — the client × bucket matrix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Cards | Matrix` view toggle to the board that renders every active client down the rows against the six buckets across the columns, with an overall score, a band, and a per-bucket average across the roster.

**Architecture:** Three new files plus one edit. `src/board/matrix.ts` holds the arithmetic as pure functions with no React and no Supabase client, in the shape `boardScope.ts` and `cardSummary.ts` already use. `src/board/Matrix.tsx` renders a real `<table>` and does no arithmetic of its own. `src/board/Matrix.module.css` carries the fills and the scroll container. `src/board/Board.tsx` gains one piece of state and a branch. **No migration, no new column, no new query** — the matrix reads the same Postgres-generated `*_score` columns the card's bars already read, out of state `useBoard` already holds.

**Tech Stack:** React 19 + TypeScript (`verbatimModuleSyntax`), Vite, CSS Modules, Vitest + Testing Library + jsdom.

**Spec:** `docs/superpowers/specs/2026-09-01-phase-2-slice-5-client-matrix-design.md`

---

## Global Constraints

Every task's requirements implicitly include this section.

- **`@testing-library/jest-dom` is NOT installed.** Use plain vitest matchers only — `toBe`, `toEqual`, `toContain`, `toHaveProperty`, `toBeNull`, `toBeUndefined`, `toHaveLength`, `toThrow`, `toBeTruthy`, `toBeDefined`, `toBeGreaterThan`, and their negations. **`toBeInTheDocument` does not exist and will fail.** Assert presence with `expect(...).toBeTruthy()` or `expect(...).not.toBeNull()`.
- **Scoped test runs use `npx vitest run <path>`.** `npm test -- --run <path>` matches nothing in this repo.
- **Never edit `src/lib/scoreMath.ts` or `src/lib/buckets.ts` to add an import.** `tests/leafModules.test.ts` guards exactly those two files at zero runtime imports; `npm run verify:score` breaks otherwise and the failure looks like a Node bug. Importing *from* them is fine and is what this slice does.
- **`tests/tokens.test.ts` walks every `.css`, `.ts`, `.tsx`, `.html` and `.svg` file under `src/`.** No colour literal of any kind — no hex, no `rgb(`/`hsl(`/`oklch(`/`color-mix(`, and no CSS named colour (`teal`, `red`, `white`, `gray`, …) in the value of any colour property. Every colour is `var(--token)`. The `font:` shorthand is banned outright; `font-family` must be a lone `var(--face-…)` reference and nothing else. Use `font-family` / `font-stretch` / `font-weight` / `font-size` longhands.
- **Existing tokens only.** Spacing `--space-1` … `--space-7`; radii `--radius-sm` / `--radius-md` / `--radius-pill`; sizes `--step--1` … `--step-4`; surfaces `--surface-page` / `--surface-raised` / `--surface-sunken` / `--rule-hairline`; bands `--band-healthy` / `--band-watch` / `--band-risk` / `--band-none` / `--text-on-band`. Do not add a token.
- **Thresholds do not move.** `HEALTHY_AT = 3.6`, `WATCH_AT = 2.2` in `src/lib/scoreMath.ts`. The owner's literal "4 and 5 green, 3 and 2 yellow, 1 red" was ruled against the shipped bands on 2026-09-01 (spec §5, decision 2): a bucket scoring exactly 2.00 reads At risk, not Watch.
- **An em dash, never a zero.** A missing score renders `—`. A missing answer must never read as a low score. This is the property the whole model is built on.
- **One rounding rule.** Every displayed number is `toFixed(2)`; every mean is computed by `meanTo2dp(sum, divisor)` from `src/lib/scoreMath.ts`. Do not write a second rounding.
- **Never `git commit -a`.** Stage explicit paths. Before every commit run `git rev-parse --abbrev-ref HEAD` and confirm it prints `slice-5-client-matrix` — the owner's Terminal.app git moves HEAD between turns and two commits have already landed on `main` unnoticed.
- **Never `git push`.** GitHub Pages deploys on push; the owner pushes himself.
- **No database work in this slice at all.** No migration, no `db:push`, no `execute_sql`.
- Run `npm run build` and `npm test` before the final commit of each task. Full suite is **719 tests / 44 files** before this slice starts.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/board/matrix.ts` | **Create.** Pure arithmetic: row assembly, the per-column average, the asterisk rule, the hidden count sentence. No React, no Supabase. |
| `src/board/matrix.test.ts` | **Create.** Node-environment unit tests for the above. |
| `src/board/Matrix.tsx` | **Create.** The `<table>`. Reads `matrix.ts`, renders cells, bands and the footer. No arithmetic. |
| `src/board/Matrix.module.css` | **Create.** Cell fills, alignment, the scroll container, the visually-hidden utility. |
| `src/board/Matrix.dom.test.tsx` | **Create.** jsdom tests for table semantics, the em dash, the band attribute and the asterisk. |
| `src/board/Board.tsx` | **Modify.** One `view` state, the toggle control, one render branch. |
| `src/board/Board.module.css` | **Modify.** One rule for the toggle. |
| `src/board/Board.test.tsx` | **Modify.** Add a describe block for the toggle. |

Three tasks. Task 1 is the arithmetic and can be rejected on its own. Task 2 is the component and is only reviewable once the arithmetic exists. Task 3 wires it into the board.

---

### Task 1: `src/board/matrix.ts` — the arithmetic

**Files:**
- Create: `src/board/matrix.ts`
- Test: `src/board/matrix.test.ts`

**Interfaces:**
- Consumes (all already exist, do not modify any of them):
  - `src/board/useBoard.ts` — `type BoardClient = { id: number; name: string; status: string; started_on: string | null }`, `type BoardScore = { client_id: number; overall_score: number | null; advocacy_applies: boolean }`
  - `src/board/cardSummary.ts` — `type CardCheckin` (carries `comm_score`, `growth_score`, `fin_score`, `rel_score`, `del_score`, `adv_score`, each `number | null | undefined`), `const BUCKET_SCORE_KEY: Record<Bucket, BucketScoreKey>`
  - `src/board/boardScope.ts` — `function isOnBoard(status: string): boolean`
  - `src/lib/buckets.ts` — `const BUCKETS`, `type Bucket`, `const GATED_BUCKET: Bucket`
  - `src/lib/gate.ts` — `function advocacyApplies(startedOn: string | null, period: string): boolean`
  - `src/lib/scoreMath.ts` — `function meanTo2dp(sum: number, divisor: number): number`
- Produces (Task 2 relies on exactly these):
  - `type MatrixRow = { client: BoardClient; checkin: CardCheckin | null; overall: number | null }`
  - `type ColumnAverage = { mean: number | null; scored: number; eligible: number }`
  - `function matrixRows(clients: readonly BoardClient[], checkins: ReadonlyMap<number, CardCheckin>, scores: ReadonlyMap<number, BoardScore>): MatrixRow[]`
  - `function cellValue(row: MatrixRow, bucket: Bucket): number | null`
  - `function columnAverage(rows: readonly MatrixRow[], bucket: Bucket, period: string): ColumnAverage`
  - `function needsAsterisk(average: ColumnAverage): boolean`
  - `function averageDescription(average: ColumnAverage): string`

**Note on `cellValue`:** spec §8 lists four functions; this is a fifth, added deliberately. Spec §4 requires the cell to be read from `checkin[BUCKET_SCORE_KEY[bucket]]` and spec §8 requires `Matrix.tsx` to hold "no arithmetic of its own". Putting that read here means `BUCKET_SCORE_KEY` is referenced in one place, `columnAverage` and the rendered cell read the value through the same function and cannot diverge, and the read is unit-testable without a DOM.

- [ ] **Step 1: Write the failing test**

Create `src/board/matrix.test.ts` with exactly this content:

```ts
import { describe, expect, it } from 'vitest'
import {
  averageDescription,
  cellValue,
  columnAverage,
  matrixRows,
  needsAsterisk,
} from './matrix'
import type { MatrixRow } from './matrix'
import type { CardCheckin } from './cardSummary'
import type { BoardClient, BoardScore } from './useBoard'

// The arithmetic behind the matrix, with no DOM. This is where the slice can be
// wrong in a way nobody notices: a wrong divisor produces a plausible number,
// and a plausible wrong average is worse than a missing one because somebody
// will act on it.

const PERIOD = '2026-08-01'

// Well past the 90-day gate for PERIOD, so Advocacy applies unless a test says
// otherwise.
const OLD = '2020-01-01'

function client(id: number, name: string, overrides: Partial<BoardClient> = {}): BoardClient {
  return { id, name, status: 'active', started_on: OLD, ...overrides }
}

// Only the columns the matrix reads. Every bucket defaults to null, so a test
// names exactly the scores it is about.
function checkin(id: number, scores: Partial<CardCheckin> = {}): CardCheckin {
  return {
    client_id: id,
    submitted_at: null,
    submitted_by: null,
    comm_score: null,
    growth_score: null,
    fin_score: null,
    rel_score: null,
    del_score: null,
    adv_score: null,
    ...scores,
  }
}

function score(id: number, overall: number | null, applies = true): BoardScore {
  return { client_id: id, overall_score: overall, advocacy_applies: applies }
}

// A convenience for the columnAverage tests: build rows straight from
// (name, started_on, comm_score) triples without going through the maps.
function rowsOf(
  entries: readonly { id: number; name: string; started_on?: string | null; scores?: Partial<CardCheckin> }[],
): MatrixRow[] {
  return entries.map((entry) => ({
    // `in`, not `?? OLD`: a null start date is a CASE this file tests -- it is
    // what gates a client out of Advocacy for want of a known tenure -- and ??
    // would quietly replace it with OLD and test the opposite.
    client: client(entry.id, entry.name, {
      started_on: 'started_on' in entry ? (entry.started_on ?? null) : OLD,
    }),
    checkin: entry.scores === undefined ? null : checkin(entry.id, entry.scores),
    overall: null,
  }))
}

describe('matrixRows', () => {
  it('returns every active client, alphabetically, whatever order they arrived in', () => {
    // Not "whatever the cards are showing": the matrix sorts by name directly
    // rather than through visibleClients, whose status-grouping arm it never
    // uses because it only ever holds active clients.
    const rows = matrixRows(
      [client(3, 'York'), client(1, 'Babaloo'), client(2, 'Gait Happens')],
      new Map(),
      new Map(),
    )
    expect(rows.map((row) => row.client.name)).toEqual(['Babaloo', 'Gait Happens', 'York'])
  })

  it('drops every client who is not active', () => {
    // The Average row describes the agency. It must not move because somebody
    // pressed a display control, so the matrix uses isOnBoard rather than the
    // board's show-archived state.
    const rows = matrixRows(
      [
        client(1, 'Active One'),
        client(2, 'Paused One', { status: 'paused' }),
        client(3, 'Churned One', { status: 'churned' }),
      ],
      new Map(),
      new Map(),
    )
    expect(rows.map((row) => row.client.name)).toEqual(['Active One'])
  })

  it('carries the check-in and the overall for a client who has them', () => {
    const rows = matrixRows(
      [client(1, 'Babaloo')],
      new Map([[1, checkin(1, { comm_score: 3.67 })]]),
      new Map([[1, score(1, 3.59)]]),
    )
    expect(rows[0].checkin?.comm_score).toBe(3.67)
    expect(rows[0].overall).toBe(3.59)
  })

  it('gives a client with no check-in a null checkin and a null overall', () => {
    // Never 0. This is the single case where a bug would silently flatter every
    // average in the table.
    const rows = matrixRows([client(1, 'Babaloo')], new Map(), new Map())
    expect(rows[0].checkin).toBeNull()
    expect(rows[0].overall).toBeNull()
  })

  it('does not mutate the array it was given', () => {
    const clients = [client(2, 'York'), client(1, 'Babaloo')]
    matrixRows(clients, new Map(), new Map())
    expect(clients.map((entry) => entry.name)).toEqual(['York', 'Babaloo'])
  })
})

describe('cellValue', () => {
  it('reads the generated column for the bucket, not a recomputed mean', () => {
    const rows = rowsOf([{ id: 1, name: 'Babaloo', scores: { comm_score: 3.67, adv_score: 5 } }])
    expect(cellValue(rows[0], 'communication')).toBe(3.67)
    expect(cellValue(rows[0], 'advocacy')).toBe(5)
  })

  it('is null for an unfinished bucket and for a client with no check-in', () => {
    const [scored, absent] = rowsOf([
      { id: 1, name: 'A', scores: { comm_score: 3 } },
      { id: 2, name: 'B' },
    ])
    expect(cellValue(scored, 'growth')).toBeNull()
    expect(cellValue(absent, 'communication')).toBeNull()
  })
})

describe('columnAverage', () => {
  it('is the plain mean when every client is scored', () => {
    const rows = rowsOf([
      { id: 1, name: 'A', scores: { comm_score: 4 } },
      { id: 2, name: 'B', scores: { comm_score: 5 } },
    ])
    expect(columnAverage(rows, 'communication', PERIOD)).toEqual({
      mean: 4.5,
      scored: 2,
      eligible: 2,
    })
  })

  it('divides by the count of the scored, not by the roster', () => {
    // The owner's ruling, 2026-09-01, in his own words: "the total of the scored
    // clients divided by the number of scored clients, not the total of scored
    // clients divided by total clients."
    //
    // The fixture is chosen so the two rules give DIFFERENT answers: 9 / 2 = 4.50
    // against 9 / 3 = 3.00. A fixture where they agreed would pass under either
    // implementation and guard nothing.
    const rows = rowsOf([
      { id: 1, name: 'A', scores: { comm_score: 4 } },
      { id: 2, name: 'B', scores: { comm_score: 5 } },
      { id: 3, name: 'C' },
    ])
    const average = columnAverage(rows, 'communication', PERIOD)
    expect(average.mean).toBe(4.5)
    expect(average.mean).not.toBe(3)
    expect(average).toEqual({ mean: 4.5, scored: 2, eligible: 3 })
  })

  it('is null, never 0, when nobody in the column is scored', () => {
    const rows = rowsOf([{ id: 1, name: 'A' }, { id: 2, name: 'B' }])
    expect(columnAverage(rows, 'communication', PERIOD)).toEqual({
      mean: null,
      scored: 0,
      eligible: 2,
    })
  })

  it('rounds to two decimals through the app\'s one rounding rule', () => {
    // 3.67 + 5.00 + 4.67 + 4.67 + 3.00 = 21.01 over five, which is 4.202 before
    // rounding -- and 21.01 is not exactly representable in binary floating
    // point, so this also pins that the float error does not reach the output.
    const rows = rowsOf([
      { id: 1, name: 'A', scores: { comm_score: 3.67 } },
      { id: 2, name: 'B', scores: { comm_score: 5 } },
      { id: 3, name: 'C', scores: { comm_score: 4.67 } },
      { id: 4, name: 'D', scores: { comm_score: 4.67 } },
      { id: 5, name: 'E', scores: { comm_score: 3 } },
    ])
    expect(columnAverage(rows, 'communication', PERIOD).mean).toBe(4.2)
  })

  it('excludes gated clients from Advocacy\'s eligible count', () => {
    // A client inside their first 90 days cannot have an Advocacy score, and
    // that is the gate working rather than data going missing. Counting them as
    // missing would light the Advocacy asterisk every month until the newest
    // client passed 90 days, and an asterisk that is always on stops being read.
    const rows = rowsOf([
      { id: 1, name: 'A', scores: { adv_score: 5 } },
      { id: 2, name: 'B', scores: { adv_score: 1 } },
      // Started inside PERIOD's 90-day window, so the gate is shut and their
      // Advocacy cell is empty by design.
      { id: 3, name: 'New', started_on: '2026-07-15', scores: {} },
    ])
    expect(columnAverage(rows, 'advocacy', PERIOD)).toEqual({ mean: 3, scored: 2, eligible: 2 })
  })

  it('still counts a gated client in every ungated column', () => {
    // The gate is Advocacy's alone. A new client's Communication score is a
    // real score and belongs in the agency's Communication average.
    const rows = rowsOf([
      { id: 1, name: 'A', scores: { comm_score: 4 } },
      { id: 2, name: 'New', started_on: '2026-07-15', scores: { comm_score: 2 } },
    ])
    expect(columnAverage(rows, 'communication', PERIOD)).toEqual({
      mean: 3,
      scored: 2,
      eligible: 2,
    })
  })

  it('treats a null start date as gated out of Advocacy', () => {
    // advocacyApplies returns false for a null start date -- an unknown tenure
    // scoring a bucket about referrals is a number nobody has grounds for. The
    // matrix inherits that rule rather than restating it.
    const rows = rowsOf([{ id: 1, name: 'A', started_on: null, scores: { adv_score: 5 } }])
    expect(columnAverage(rows, 'advocacy', PERIOD)).toEqual({
      mean: null,
      scored: 0,
      eligible: 0,
    })
  })

  it('yields no eligible clients at all when everybody is inside 90 days', () => {
    const rows = rowsOf([
      { id: 1, name: 'A', started_on: '2026-07-15' },
      { id: 2, name: 'B', started_on: '2026-07-20' },
    ])
    expect(columnAverage(rows, 'advocacy', PERIOD)).toEqual({
      mean: null,
      scored: 0,
      eligible: 0,
    })
  })

  it('reads the bucket it was asked for and no other', () => {
    const rows = rowsOf([{ id: 1, name: 'A', scores: { comm_score: 5, growth_score: 1 } }])
    expect(columnAverage(rows, 'communication', PERIOD).mean).toBe(5)
    expect(columnAverage(rows, 'growth', PERIOD).mean).toBe(1)
    expect(columnAverage(rows, 'finances', PERIOD).mean).toBeNull()
  })
})

describe('needsAsterisk', () => {
  it('is true when somebody who could have been scored was not', () => {
    expect(needsAsterisk({ mean: 4.5, scored: 2, eligible: 3 })).toBe(true)
  })

  it('is false for a complete column', () => {
    expect(needsAsterisk({ mean: 4.5, scored: 3, eligible: 3 })).toBe(false)
  })

  it('is false when nobody is scored at all', () => {
    // The cell already reads as an em dash. An asterisk beside nothing would
    // imply somebody had failed to do something in a column that has no answer
    // to give.
    expect(needsAsterisk({ mean: null, scored: 0, eligible: 4 })).toBe(false)
  })

  it('is false when nobody was eligible', () => {
    expect(needsAsterisk({ mean: null, scored: 0, eligible: 0 })).toBe(false)
  })
})

describe('averageDescription', () => {
  it('names both counts, so the exact shortfall is available', () => {
    expect(averageDescription({ mean: 4.5, scored: 8, eligible: 10 })).toBe(
      'averaged from 8 of 10 clients',
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/board/matrix.test.ts`

Expected: FAIL — `Failed to resolve import "./matrix"`.

- [ ] **Step 3: Write the implementation**

Create `src/board/matrix.ts` with exactly this content:

```ts
import { GATED_BUCKET } from '../lib/buckets'
import type { Bucket } from '../lib/buckets'
import { advocacyApplies } from '../lib/gate'
import { meanTo2dp } from '../lib/scoreMath'
import { isOnBoard } from './boardScope'
import { BUCKET_SCORE_KEY } from './cardSummary'
import type { CardCheckin } from './cardSummary'
import type { BoardClient, BoardScore } from './useBoard'

// The matrix's arithmetic, with no React and no Supabase client -- the shape
// boardScope.ts and cardSummary.ts already use on this screen. Everything here
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
  return clients
    // .filter() returns a new array, so the .sort() below cannot reach the
    // caller's. The board's clients array belongs to the hook's state and React
    // compares it by identity: sorting it in place would be a silent mutation.
    .filter((client) => isOnBoard(client.status))
    .map((client) => ({
      client,
      checkin: checkins.get(client.id) ?? null,
      overall: scores.get(client.id)?.overall_score ?? null,
    }))
    .sort((a, b) => a.client.name.localeCompare(b.client.name))
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/board/matrix.test.ts`

Expected: PASS, 20 tests.

- [ ] **Step 5: Prove two guards by mutation, then revert**

A test not seen to fail is not a guard. Make each change, run the file, confirm the named test fails, then revert:

1. In `columnAverage`, change `meanTo2dp(sum, scored)` to `meanTo2dp(sum, eligible)`.
   Expected: **"divides by the count of the scored, not by the roster"** fails (4.5 vs 3). Revert.
2. In `needsAsterisk`, delete `average.scored > 0 &&`.
   Expected: **"is false when nobody is scored at all"** fails. Revert.

Confirm `npx vitest run src/board/matrix.test.ts` is green again before moving on.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run build
npm run lint
git rev-parse --abbrev-ref HEAD   # must print slice-5-client-matrix
git add src/board/matrix.ts src/board/matrix.test.ts
git commit -m "matrix: the arithmetic, with the divisor being the scored not the roster"
```

---

### Task 2: `src/board/Matrix.tsx` and `Matrix.module.css` — the table

**Files:**
- Create: `src/board/Matrix.tsx`
- Create: `src/board/Matrix.module.css`
- Test: `src/board/Matrix.dom.test.tsx`

**Interfaces:**
- Consumes from Task 1: `matrixRows`, `cellValue`, `columnAverage`, `needsAsterisk`, `averageDescription`, `type MatrixRow`, `type ColumnAverage` — signatures exactly as listed in Task 1's Produces block.
- Consumes (already exist): `BUCKETS` and `BUCKET_DEFINITIONS` from `src/lib/buckets.ts` (`BUCKET_DEFINITIONS[bucket]` has `.label` and `.initial`); `BAND_LABELS` and `bandFor` from `src/lib/scoreMath.ts`; `formatPeriod` from `src/lib/month.ts`; `isOpenable` from `src/board/boardScope.ts`.
- Produces (Task 3 relies on this):
  ```ts
  export function Matrix(props: {
    clients: readonly BoardClient[]
    checkins: ReadonlyMap<number, CardCheckin>
    scores: ReadonlyMap<number, BoardScore>
    period: string
    onOpen: (client: BoardClient) => void
  }): JSX.Element
  ```

**Two implementation rulings, both deliberate:**

1. **Bands are carried as a `data-band` attribute, not as `bandClassName()`.** `bandClassName` produces `band band--healthy`, and `.band` in `base.css` is a *pill*: inline-flex, pill radius, uppercase, caption face, `--tracking-band`. Putting it on a `<td>` would restyle every number as an uppercase chip. `data-band` gives the CSS module a selector (`.cell[data-band='healthy']`), keeps the four band values out of a second hand-written mapping, and gives the DOM tests something exact to assert on without depending on how vitest stubs CSS Modules.
2. **`Overall` and `Band` are two columns, each with its own `<th scope="col">`.** Spec §4's sketch shows the band word sitting beside the number with no header over it; a headerless column would break `scope="col"` completeness and leave a screen reader announcing a bare word with no context.

- [ ] **Step 1: Write the failing test**

Create `src/board/Matrix.dom.test.tsx` with exactly this content:

```tsx
// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Matrix } from './Matrix'
import type { CardCheckin } from './cardSummary'
import type { BoardClient, BoardScore } from './useBoard'

afterEach(() => {
  document.body.innerHTML = ''
})

const PERIOD = '2026-08-01'
const OLD = '2020-01-01'

function client(id: number, name: string, overrides: Partial<BoardClient> = {}): BoardClient {
  return { id, name, status: 'active', started_on: OLD, ...overrides }
}

function checkin(id: number, scores: Partial<CardCheckin> = {}): CardCheckin {
  return {
    client_id: id,
    submitted_at: null,
    submitted_by: null,
    comm_score: null,
    growth_score: null,
    fin_score: null,
    rel_score: null,
    del_score: null,
    adv_score: null,
    ...scores,
  }
}

type Given = {
  clients?: BoardClient[]
  checkins?: [number, CardCheckin][]
  scores?: [number, BoardScore][]
  onOpen?: (client: BoardClient) => void
}

function renderMatrix(given: Given = {}) {
  const {
    clients = [client(1, 'Babaloo')],
    checkins = [],
    scores = [],
    onOpen = () => {},
  } = given
  return render(
    <Matrix
      checkins={new Map(checkins)}
      clients={clients}
      onOpen={onOpen}
      period={PERIOD}
      scores={new Map(scores)}
    />,
  )
}

const cells = () => screen.getAllByTestId('matrix-cell')
const averages = () => screen.getAllByTestId('matrix-average')

describe('the matrix table', () => {
  it('is a real table with a caption naming the month', () => {
    // Not a grid of divs. This is what makes a screen reader announce
    // "Colorfil, Growth, 5.00" instead of reading sixty loose numbers.
    renderMatrix()
    const table = screen.getByTestId('matrix-table')
    expect(table.tagName).toBe('TABLE')
    expect(table.querySelector('caption')?.textContent).toContain('August 2026')
  })

  it('heads every bucket column with its initial and its full label', () => {
    renderMatrix()
    // The visible letter, plus the word a screen reader reads instead of "C".
    const heads = screen.getAllByRole('columnheader')
    const text = heads.map((head) => head.textContent)
    expect(text).toEqual([
      'Client',
      'CCommunication',
      'GGrowth',
      'FFinances',
      'RRelationship',
      'DDelivery',
      'AAdvocacy',
      'Overall',
      'Band',
    ])
  })

  it('scopes both header axes, and puts the Average row in a tfoot', () => {
    renderMatrix()
    const table = screen.getByTestId('matrix-table')
    for (const head of table.querySelectorAll('thead th')) {
      expect(head.getAttribute('scope')).toBe('col')
    }
    for (const head of table.querySelectorAll('tbody th')) {
      expect(head.getAttribute('scope')).toBe('row')
    }
    const feet = table.querySelectorAll('tfoot')
    expect(feet).toHaveLength(1)
    expect(feet[0].querySelector('th')?.getAttribute('scope')).toBe('row')
    expect(feet[0].querySelector('th')?.textContent).toBe('Average')
  })

  it('draws one row per active client, alphabetically', () => {
    renderMatrix({
      clients: [client(3, 'York'), client(1, 'Babaloo'), client(2, 'Gait Happens')],
    })
    const rows = screen.getAllByTestId('matrix-row')
    expect(rows.map((row) => row.querySelector('th')?.textContent)).toEqual([
      'Babaloo',
      'Gait Happens',
      'York',
    ])
  })

  it('draws six bucket cells per row, in rubric order', () => {
    renderMatrix({
      checkins: [
        [
          1,
          checkin(1, {
            comm_score: 3.67,
            growth_score: 3.33,
            fin_score: 4,
            rel_score: 3.75,
            del_score: 3.5,
            adv_score: 5,
          }),
        ],
      ],
    })
    expect(cells().map((cell) => cell.textContent)).toEqual([
      '3.67',
      '3.33',
      '4.00',
      '3.75',
      '3.50',
      '5.00',
    ])
  })

  it('renders an em dash for a missing cell, never a 0', () => {
    // The property the whole model is built on: a missing answer must never
    // read as a low score.
    renderMatrix({ checkins: [[1, checkin(1, { comm_score: 4 })]] })
    const text = cells().map((cell) => cell.textContent)
    expect(text[0]).toBe('4.00')
    for (const value of text.slice(1)) {
      expect(value).toContain('—')
      expect(value).not.toContain('0')
    }
  })

  it('gives a client with no check-in at all a full row of em dashes', () => {
    renderMatrix({ clients: [client(1, 'Babaloo')] })
    for (const cell of cells()) {
      expect(cell.textContent).toContain('—')
    }
    expect(screen.getByTestId('matrix-overall').textContent).toContain('—')
  })

  it('bands each cell on its own value, and the name and overall on the overall', () => {
    renderMatrix({
      checkins: [[1, checkin(1, { comm_score: 5, growth_score: 3, fin_score: 1 })]],
      scores: [[1, { client_id: 1, overall_score: 3, advocacy_applies: true }]],
    })
    const banded = cells().map((cell) => cell.getAttribute('data-band'))
    // 3.6 and 2.2 -- the shipped bands, not a second set. A cell at 3.00 is
    // Watch and a cell at 1.00 is At risk.
    expect(banded).toEqual([
      'healthy',
      'watch',
      'at_risk',
      'incomplete',
      'incomplete',
      'incomplete',
    ])
    const row = screen.getByTestId('matrix-row')
    expect(row.querySelector('th')?.getAttribute('data-band')).toBe('watch')
    expect(screen.getByTestId('matrix-overall').getAttribute('data-band')).toBe('watch')
  })

  it('prints the band word beside the overall, so colour is never the only signal', () => {
    // Parent spec §9.3: teal against amber measures 1.06:1. Every coloured thing
    // in this grid already prints its own number; the overall additionally
    // prints its word.
    renderMatrix({
      scores: [[1, { client_id: 1, overall_score: 4.71, advocacy_applies: true }]],
    })
    expect(screen.getByTestId('matrix-band').textContent).toBe('Healthy')
    expect(screen.getByTestId('matrix-overall').textContent).toBe('4.71')
  })

  it('reads Not scored for a client whose overall is null', () => {
    // Read by testid, not by text: every em-dash cell in the row also carries a
    // visually-hidden "Not scored", so getByText would match eight elements and
    // throw. That collision is deliberate on both sides -- it is the right word
    // in both places -- so the test addresses the cell it means.
    renderMatrix({ scores: [[1, { client_id: 1, overall_score: null, advocacy_applies: true }]] })
    expect(screen.getByTestId('matrix-band').textContent).toBe('Not scored')
  })

  it('averages each bucket across the roster', () => {
    renderMatrix({
      clients: [client(1, 'A'), client(2, 'B')],
      checkins: [
        [1, checkin(1, { comm_score: 4 })],
        [2, checkin(2, { comm_score: 5 })],
      ],
    })
    expect(averages()[0].textContent).toBe('4.50')
  })

  it('asterisks an average built from fewer clients than were eligible', () => {
    renderMatrix({
      clients: [client(1, 'A'), client(2, 'B')],
      checkins: [[1, checkin(1, { comm_score: 4 })]],
    })
    expect(averages()[0].textContent).toContain('*')
    // The exact shortfall, for a screen reader and for inspection.
    expect(averages()[0].textContent).toContain('averaged from 1 of 2 clients')
    expect(screen.getByTestId('matrix-footnote')).toBeTruthy()
  })

  it('does not asterisk Advocacy for a client the gate excludes', () => {
    // Nothing is missing; the gate is doing its job. An asterisk that is always
    // on stops being read.
    renderMatrix({
      clients: [client(1, 'A'), client(2, 'New', { started_on: '2026-07-15' })],
      checkins: [[1, checkin(1, { adv_score: 5 })]],
    })
    expect(averages()[5].textContent).toBe('5.00')
    expect(averages()[5].textContent).not.toContain('*')
  })

  it('shows no footnote when nothing is asterisked', () => {
    renderMatrix({ checkins: [[1, checkin(1, { comm_score: 4 })]] })
    // Communication is complete for the one client; every other column has
    // nobody scored, which is an em dash rather than an asterisk.
    expect(screen.queryByTestId('matrix-footnote')).toBeNull()
  })

  it('opens a client when their row header is clicked', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    renderMatrix({ clients: [client(7, 'Babaloo')], onOpen })

    await user.click(screen.getByRole('button', { name: 'Babaloo' }))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0][0].id).toBe(7)
  })

  it('says so plainly when there is no active client to show', () => {
    // Reachable with the archive toggle on and every client archived: Board's
    // empty-roster branch does not fire, because `visible` is not empty.
    renderMatrix({ clients: [client(1, 'Gone', { status: 'churned' })] })
    expect(screen.queryByTestId('matrix-table')).toBeNull()
    expect(screen.getByText(/No active clients/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/board/Matrix.dom.test.tsx`

Expected: FAIL — `Failed to resolve import "./Matrix"`.

- [ ] **Step 3: Write the stylesheet**

Create `src/board/Matrix.module.css` with exactly this content:

```css
/* The client × bucket matrix. One table, banded per cell.

   Every colour here is a var(--token) reference: tests/tokens.test.ts walks this
   file and fails the build on a literal, in any notation. */

.matrix {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* Horizontal scroll lives here, never on the page body. Seven columns plus a
   name fit a laptop; a phone scrolls the grid sideways while the rest of the
   screen stays put. */
.scroller {
  overflow-x: auto;
  max-inline-size: 100%;
}

/* border-collapse so the 1px gutters below meet rather than double. */
.table {
  border-collapse: collapse;
  inline-size: 100%;
}

/* Left, not centred: the caption is a sentence, and a centred sentence over a
   left-aligned table reads as a title for the page rather than for the table. */
.caption {
  padding-block-end: var(--space-3);
  text-align: start;
}

/* The column headers. The bucket initials sit over numbers, so they align end
   with them; the corner cell sits over names and aligns start. */
.head {
  padding: var(--space-2) var(--space-3);
  text-align: end;
  white-space: nowrap;
}

.headName {
  padding: var(--space-2) var(--space-3);
  text-align: start;
}

/* The client's name, and the tfoot's "Average". A row header, so it aligns with
   the names beneath rather than with the numbers beside. */
.name {
  padding: var(--space-2) var(--space-3);
  text-align: start;
  white-space: nowrap;
}

.cell {
  padding: var(--space-2) var(--space-3);
  text-align: end;
  white-space: nowrap;
}

/* The gutter between fills. A page-coloured border rather than a hairline, so
   two adjacent bands read as two cells rather than as one wide stripe. */
.name[data-band],
.cell[data-band] {
  border: 1px solid var(--surface-page);
  border-radius: var(--radius-sm);
  color: var(--text-on-band);
}

.name[data-band='healthy'],
.cell[data-band='healthy'] {
  background: var(--band-healthy);
}

.name[data-band='watch'],
.cell[data-band='watch'] {
  background: var(--band-watch);
}

.name[data-band='at_risk'],
.cell[data-band='at_risk'] {
  background: var(--band-risk);
}

/* An unscored cell is grey, and it prints an em dash. Never a colour that means
   something, and never a 0. */
.name[data-band='incomplete'],
.cell[data-band='incomplete'] {
  background: var(--band-none);
}

/* The two footer cells under Overall and Band. The Average row stops before
   them: an agency-wide "overall of overalls" is a number nobody asked for and
   would average two different divisors together. */
.blank {
  padding: var(--space-2) var(--space-3);
}

/* The name as a control. Same treatment as the card's .cardOpen -- one real
   button, so Enter and Space work with no keydown handler -- minus the
   card-wide overlay, which has no meaning in a table cell. Colour is inherited
   so the button reads as ink on its band rather than as an action colour. */
.open {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  text-align: start;
  cursor: pointer;
  font-family: var(--face-body);
  font-stretch: var(--wdth-body);
  font-weight: var(--wght-body);
  font-size: var(--step-0);
}

.open:hover {
  text-decoration: underline;
}

/* Read by a screen reader, invisible on screen. Not `display: none`, which
   removes it from the accessibility tree along with the page -- the whole point
   is that it stays announced. */
.hidden {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 4: Write the component**

Create `src/board/Matrix.tsx` with exactly this content:

```tsx
import { BUCKETS, BUCKET_DEFINITIONS } from '../lib/buckets'
import { formatPeriod } from '../lib/month'
import { BAND_LABELS, bandFor } from '../lib/scoreMath'
import { isOpenable } from './boardScope'
import type { CardCheckin } from './cardSummary'
import {
  averageDescription,
  cellValue,
  columnAverage,
  matrixRows,
  needsAsterisk,
} from './matrix'
import type { BoardClient, BoardScore } from './useBoard'
import styles from './Matrix.module.css'

type Props = {
  clients: readonly BoardClient[]
  checkins: ReadonlyMap<number, CardCheckin>
  scores: ReadonlyMap<number, BoardScore>
  period: string
  onOpen: (client: BoardClient) => void
}

// One number, or the absence of one. An em dash and never a 0: an incomplete
// check-in has no score, and a false "at risk" is as harmful as a false
// "healthy". The dash is aria-hidden with a word beside it, because a screen
// reader announcing "em dash" in a grid of sixty cells says nothing.
//
// Two decimals everywhere, matching the card's total and what the view stores.
// 3.5 and 3.50 are the same number, but only one of them lines up in a column.
function Score({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className={styles.hidden}>Not scored</span>
      </>
    )
  }
  return <>{value.toFixed(2)}</>
}

// The board's second view: every active client down the rows, the six buckets
// across, and what the agency averages in each. Spec §4.
//
// It holds no arithmetic. Every number here comes from matrix.ts, and every
// bucket cell is the Postgres-generated column the card's bar already reads --
// so the two views cannot disagree about a bucket by construction rather than
// by test.
//
// The band is carried as `data-band` rather than through bandClassName(),
// which produces the `.band` PILL from base.css: inline-flex, pill radius,
// uppercase, caption face. That is right for a chip beside a name and wrong for
// a table cell full of digits. The attribute gives the stylesheet a selector and
// keeps the four band values from being spelled out a second time here.
export function Matrix({ clients, checkins, scores, period, onOpen }: Props) {
  const rows = matrixRows(clients, checkins, scores)

  // Reachable with the archive toggle on and every client archived: Board's
  // empty-roster branch does not fire in that case, because what it measures is
  // the list the CARDS are showing. Said outright rather than left as an empty
  // table, which reads as a failed load.
  if (rows.length === 0) {
    return <p className="t-body prose">No active clients to show.</p>
  }

  // Computed once: the footer cells need them, and so does the decision about
  // whether the footnote is drawn at all.
  const columns = BUCKETS.map((bucket) => ({
    bucket,
    definition: BUCKET_DEFINITIONS[bucket],
    average: columnAverage(rows, bucket, period),
  }))
  const anyAsterisk = columns.some((column) => needsAsterisk(column.average))

  return (
    <div className={styles.matrix}>
      <div className={styles.scroller}>
        <table className={styles.table} data-testid="matrix-table">
          {/* Names what the table is and which month it covers, so it is
              self-describing when read out of the page's context. */}
          <caption className={`t-caption ${styles.caption}`}>
            Client health by bucket, {formatPeriod(period)}
          </caption>
          <thead>
            <tr>
              <th className={`t-label ${styles.headName}`} scope="col">
                Client
              </th>
              {columns.map(({ bucket, definition }) => (
                // The letter for the eye, the word for the ear: without the
                // hidden label a screen reader announces "C" and the reader has
                // to know the rubric by heart to place the column.
                <th className={`t-label ${styles.head}`} key={bucket} scope="col">
                  <span aria-hidden="true">{definition.initial}</span>
                  <span className={styles.hidden}>{definition.label}</span>
                </th>
              ))}
              <th className={`t-label ${styles.head}`} scope="col">
                Overall
              </th>
              <th className={`t-label ${styles.head}`} scope="col">
                Band
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const band = bandFor(row.overall)
              return (
                <tr data-testid="matrix-row" key={row.client.id}>
                  <th className={styles.name} data-band={band} scope="row">
                    {/* isOpenable is applied rather than assumed. The matrix
                        only ever shows active clients, so it never refuses
                        here -- but the reason the rule exists is that
                        checkins_insert_edit_scores carries no status predicate
                        of its own, and a view that assumes instead of asking is
                        how that gap gets reopened. */}
                    {isOpenable(row.client.status) ? (
                      <button
                        className={styles.open}
                        onClick={() => onOpen(row.client)}
                        type="button"
                      >
                        {row.client.name}
                      </button>
                    ) : (
                      row.client.name
                    )}
                  </th>
                  {columns.map(({ bucket }) => {
                    const value = cellValue(row, bucket)
                    return (
                      <td
                        className={`${styles.cell} numeric`}
                        data-band={bandFor(value)}
                        data-testid="matrix-cell"
                        key={bucket}
                      >
                        <Score value={value} />
                      </td>
                    )
                  })}
                  <td
                    className={`${styles.cell} numeric`}
                    data-band={band}
                    data-testid="matrix-overall"
                  >
                    <Score value={row.overall} />
                  </td>
                  {/* The band always carries its text label. Colour is never
                      the only signal: teal against warm red measures 1.76:1.
                      Parent spec §9.3. */}
                  <td className={styles.cell} data-band={band} data-testid="matrix-band">
                    {BAND_LABELS[band]}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th className={styles.name} scope="row">
                Average
              </th>
              {columns.map(({ bucket, average }) => (
                <td
                  className={`${styles.cell} numeric`}
                  data-band={bandFor(average.mean)}
                  data-testid="matrix-average"
                  key={bucket}
                >
                  <Score value={average.mean} />
                  {needsAsterisk(average) && (
                    <>
                      <span aria-hidden="true">*</span>
                      <span className={styles.hidden}>{averageDescription(average)}</span>
                    </>
                  )}
                </td>
              ))}
              {/* The Average row stops before Overall. An agency-wide "overall
                  of overalls" would average numbers built on different
                  divisors, and nobody has asked for one. */}
              <td className={styles.blank} colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      {/* The asterisk's meaning, stated once rather than left to be guessed --
          and only when there is an asterisk to explain. */}
      {anyAsterisk && (
        <p className="t-caption" data-testid="matrix-footnote">
          * Averaged from the clients scored for that bucket. Not every client who could be scored
          has been.
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/board/Matrix.dom.test.tsx`

Expected: PASS, 15 tests.

If the column-header test fails on whitespace, the cause is JSX inserting a space between the two spans — it does not, because they are adjacent siblings with no text between them. If it fails on the `Score` fragment, check that `toFixed(2)` is inside the fragment and not stringified with the dash.

- [ ] **Step 6: Prove two guards by mutation, then revert**

1. In `Score`, change the null branch to return `<>{'0.00'}</>`.
   Expected: **"renders an em dash for a missing cell, never a 0"** fails. Revert.
2. In the `<td>` for a bucket cell, change `data-band={bandFor(value)}` to `data-band={band}`.
   Expected: **"bands each cell on its own value…"** fails. Revert.

Confirm the file is green again.

- [ ] **Step 7: Typecheck, lint, full suite, commit**

```bash
npm run build
npm run lint
npm test
git rev-parse --abbrev-ref HEAD   # must print slice-5-client-matrix
git add src/board/Matrix.tsx src/board/Matrix.module.css src/board/Matrix.dom.test.tsx
git commit -m "matrix: the table, banded per cell with the average in a tfoot"
```

`npm run lint` matters here: oxlint's `react-refresh/only-export-components` rule is why `bandClass.ts` exists as its own file. `Matrix.tsx` exports one component and nothing else, and `Score` is deliberately not exported.

---

### Task 3: `src/board/Board.tsx` — the `Cards | Matrix` toggle

**Files:**
- Modify: `src/board/Board.tsx`
- Modify: `src/board/Board.module.css`
- Test: `src/board/Board.test.tsx` (append one describe block)

**Interfaces:**
- Consumes from Task 2: `import { Matrix } from './Matrix'`, props `{ clients, checkins, scores, period, onOpen }` exactly as in Task 2's Produces block.
- Produces: nothing new. `Board`'s own signature is unchanged.

**Why a toggle and not a screen** (spec §3, decision 1): `Board.tsx` already owns a single `period` and passes it to the check-in it opens, with a comment saying why the two must never disagree. A separate matrix screen would need its own month control and there would be two places for a period to drift. `useBoard` already loads every active client and every check-in for the period, so the matrix is a second rendering of data already in memory — no new query.

- [ ] **Step 1: Write the failing test**

Two edits to `src/board/Board.test.tsx`.

**(a) Add a fourth module mock**, beside the three at the top of the file (after the `vi.mock('../clients/useClients', ...)` block, before `import { Board } from './Board'`):

```tsx
// The FOURTH mock, and it is new in this slice. `supabase` is mocked as `{}`
// above, so the real CheckIn -- which uses useCheckin, which calls
// supabase.from() -- would throw the moment a test navigated into it. No test
// in this file navigated into it before, so the seam was never needed; the
// matrix's row click is the first thing here that opens a check-in.
//
// Mocked rather than made to work: what this file is testing is that clicking a
// row hands the right client to the navigation, not anything the check-in
// screen does with it. CheckIn has its own tests.
vi.mock('../checkin/CheckIn', () => ({
  CheckIn: ({ client }: { client: { name: string } }) => <p>Check-in for {client.name}</p>,
}))
```

**(b) Append this describe block** to the end of the file. It uses the file's existing `given` helper and `clientList` helper; do not redefine either.

```tsx
describe('the Cards | Matrix toggle', () => {
  const cardsButton = () => screen.getByRole('button', { name: 'Cards' })
  const matrixButton = () => screen.getByRole('button', { name: 'Matrix' })

  it('opens on the cards, which is where the monthly work is done', () => {
    given()
    expect(clientList()).toBeTruthy()
    expect(screen.queryByTestId('matrix-table')).toBeNull()
    expect(cardsButton().getAttribute('aria-pressed')).toBe('true')
    expect(matrixButton().getAttribute('aria-pressed')).toBe('false')
  })

  it('swaps the cards for the table, and back', () => {
    given()

    fireEvent.click(matrixButton())
    expect(screen.getByTestId('matrix-table')).toBeTruthy()
    expect(clientList()).toBeNull()
    expect(matrixButton().getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(cardsButton())
    expect(clientList()).toBeTruthy()
    expect(screen.queryByTestId('matrix-table')).toBeNull()
  })

  it('keeps the month dropdown, and the matrix follows it', () => {
    // The whole reason this is a view of the board rather than a screen of its
    // own: one period, and nowhere for a second one to drift.
    given()
    fireEvent.click(matrixButton())

    const select = screen.getByRole('combobox', { name: 'Month' }) as HTMLSelectElement
    const target = periodOptions()[4]
    fireEvent.change(select, { target: { value: target } })

    expect(
      screen.getByTestId('matrix-table').querySelector('caption')?.textContent,
    ).toContain(formatPeriod(target))
  })

  it('shows every active client whatever the archive toggle is doing', () => {
    // Decision 3: the agency's own average must not move because somebody
    // pressed a display control.
    given({
      clients: [
        { id: 1, name: 'Active One', status: 'active', started_on: null },
        { id: 2, name: 'Gone', status: 'churned', started_on: null },
      ],
      activeTotal: 1,
    })
    fireEvent.click(matrixButton())

    const rows = screen.getAllByTestId('matrix-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].querySelector('th')?.textContent).toBe('Active One')
  })

  it('opens a client\'s check-in from a matrix row', () => {
    // The wiring Matrix's own tests cannot see: Matrix proves it calls onOpen
    // with the client, and this proves onOpen is the board's navigation.
    given()
    fireEvent.click(matrixButton())
    fireEvent.click(screen.getByRole('button', { name: 'Babaloo' }))
    // The check-in replaces the board entirely, the same as clicking a card.
    expect(screen.queryByTestId('matrix-table')).toBeNull()
    expect(screen.getByText('Check-in for Babaloo')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/board/Board.test.tsx`

Expected: FAIL — `Unable to find an accessible element with the role "button" and name "Cards"`.

- [ ] **Step 3: Add the stylesheet rule**

Append to `src/board/Board.module.css`:

```css
/* The Cards | Matrix switch, in the period bar beside the month and the archive
   toggle. A flex row of its own so the two buttons sit together and read as one
   control rather than as two unrelated links. */
.viewToggle {
  display: flex;
  gap: var(--space-2);
}
```

- [ ] **Step 4: Wire it into Board.tsx**

Four edits, in file order.

**(a)** After the existing `import { ClientCard } from './ClientCard'` line (currently `src/board/Board.tsx:8`), add:

```tsx
import { Matrix } from './Matrix'
```

**(b)** After the `showArchived` state declaration and its comment (currently ending `src/board/Board.tsx:51`), add:

```tsx
  // Not persisted, matching every other view state on this screen: a reload
  // lands on the cards, which is where the monthly work is done. The matrix is
  // a second rendering of the SAME board -- same period, same fetch, same
  // state -- so it cannot disagree with the cards about a month or a number.
  const [view, setView] = useState<'cards' | 'matrix'>('cards')
```

**(c)** After the `archiveToggle` const (currently ending `src/board/Board.tsx:161`), add:

```tsx
  // Two buttons rather than one that says what it will become: a single
  // "Matrix" button gives no indication that the current view is the cards, and
  // aria-pressed on a pair says which of the two is showing without a person
  // having to work it out from the label.
  //
  // Deliberately not in the empty-roster branch below. A view switch that
  // reveals a second empty screen is a control with nothing to control.
  const viewToggle = (
    <div aria-label="View" className={styles.viewToggle} role="group">
      <button
        aria-pressed={view === 'cards'}
        className="button button--quiet"
        onClick={() => setView('cards')}
        type="button"
      >
        Cards
      </button>
      <button
        aria-pressed={view === 'matrix'}
        className="button button--quiet"
        onClick={() => setView('matrix')}
        type="button"
      >
        Matrix
      </button>
    </div>
  )
```

**(d)** In the final `return`, add the toggle to the period bar and branch the body. Replace the line `        {archiveToggle}` (currently `src/board/Board.tsx:257`) with:

```tsx
        {archiveToggle}
        {viewToggle}
```

and replace the whole `<ul aria-label="Clients" …>…</ul>` block (currently `src/board/Board.tsx:260-277`, including the `role="list"` comment above it) with:

```tsx
      {view === 'matrix' ? (
        // Every active client, not `visible`: the cards are the month's work
        // list and honour the archive toggle, the matrix is the roster's health
        // picture and does not. Spec §8, decision 3.
        <Matrix
          checkins={board.checkins}
          clients={board.clients}
          onOpen={setSelected}
          period={period}
          scores={board.scores}
        />
      ) : (
        /* role="list" because base.css removes the markers globally, and WebKit
           drops a list's semantics when its markers are removed — so in Safari
           with VoiceOver this would otherwise announce as a group of paragraphs
           with no count and no position. The role puts the semantics back. The
           label is what lets a test address this list, and what tells a screen
           reader which list it is. */
        <ul aria-label="Clients" className={styles.grid} role="list">
          {visible.map((client) => (
            <ClientCard
              checkin={board.checkins.get(client.id) ?? null}
              client={client}
              key={client.id}
              onOpen={() => setSelected(client)}
              score={board.scores.get(client.id) ?? null}
              viewerId={profile.id}
            />
          ))}
        </ul>
      )}
```

`onOpen={setSelected}` is correct without a wrapper: `Matrix`'s `onOpen` takes the client, and `setSelected` is a `Dispatch<SetStateAction<BoardClient | null>>`, which accepts a `BoardClient`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/board/Board.test.tsx`

Expected: PASS. Every pre-existing test in the file must still pass — in particular `renders exactly one such button per client card`, which counts buttons inside `clientList()` and is unaffected because the toggle sits in the period bar, outside the list.

- [ ] **Step 6: Prove one guard by mutation, then revert**

1. In `src/board/matrix.ts`, change `matrixRows`'s filter to `.filter(() => true)`.
   Expected: **"shows every active client whatever the archive toggle is doing"** fails with two rows instead of one. Revert.
2. In edit (d), change `onOpen={setSelected}` to `onOpen={() => {}}`.
   Expected: **"opens a client's check-in from a matrix row"** fails. Revert.

Note that swapping `clients={board.clients}` for `clients={visible}` would NOT fail any test here, because the archive toggle is off in every fixture and the two lists agree. That is a real gap and it is deliberate: the assertion this slice can actually make is the one in `matrix.test.ts` — `matrixRows` drops non-active clients whatever it is handed — and duplicating it against Board's prop would need a fixture that turns the archive toggle on, which is three clicks of setup to re-test one line.

Confirm the file is green again.

- [ ] **Step 7: Full suite, build, lint, commit**

```bash
npm test
npm run build
npm run lint
git rev-parse --abbrev-ref HEAD   # must print slice-5-client-matrix
git add src/board/Board.tsx src/board/Board.module.css src/board/Board.test.tsx
git commit -m "board: a Cards | Matrix toggle, sharing one period and one fetch"
```

Expected suite total: **719 + 20 + 15 + 6 = 760 tests / 46 files.**

---

## After the three tasks

**Do not push.** GitHub Pages deploys on push and the owner pushes from Terminal.app himself. Report the branch and the commits, and hand him the eyeball list below.

**What only a browser can check** (spec §9: CSS Modules are stubbed under jsdom, so none of this is testable here):

1. **The name column's fill.** A client with no overall score gets `--band-none`, which is `--brand-rule` — a hairline grey. Ink on it may be too quiet for a client's own name. This is the most likely thing to need an adjustment.
2. **The band gutters.** `1px solid var(--surface-page)` is what separates two adjacent fills. Check that a row of six bands reads as six cells and not one stripe.
3. **Horizontal scroll on a phone.** The grid should scroll sideways inside `.scroller` while the page body stays put.
4. **The asterisk.** It is a bare `*` after the number; check it is legible against a band fill and not mistaken for part of the figure.
5. **The toggle's position** in the period bar, which wraps at narrow widths.

**Next slice, decided 2026-09-01 while this plan was being written:** a **light/dark theme**. The owner asked for it and chose *follow the OS with a manual override* — three internal states (system / light / dark), `prefers-color-scheme` for the default, the toggle overriding it, and the choice **persisted**, which is a deliberate exception to this screen's rule that no view state survives a reload: a month or a view is about the work, a theme is about the person. It needs its own design pass before any code, because every contrast ratio recorded in `tokens.css` was measured on warm paper. Early finding worth carrying in: the health bands are light fills with ink labels, a treatment that already works on a dark ground, so the work concentrates on surfaces, text and the action colours rather than on the bands. It also needs a `color-scheme` declaration, or the browser's own chrome — the month `<select>`, scrollbars — stays light under a dark page.

**Not in this slice, carried forward** (spec §11): revenue as its own slice (`sows`, `client_month_revenue`, four capabilities — owed to the owner as a scoped proposal, not a question); the tenure and churn report as Slice 6; lifting Clients and People out of `Board.tsx` into an app shell nav; and reading a bucket's average across several months, which is the obvious next question the moment somebody looks at this table.
