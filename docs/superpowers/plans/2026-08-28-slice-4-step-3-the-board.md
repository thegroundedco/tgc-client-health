# Slice 4 Step 3 — The Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each board card's five pillar bars into six bucket bars fed by the new scoring model, read the headline number from `checkin_scores`, retire the five-pillar modules, and rename the old columns to `legacy_*` once nothing reads them.

**Architecture:** The card's six bars read the six generated bucket columns straight off `checkins`; the headline number and the gate read `overall_score` and `advocacy_applies` from the `checkin_scores` view, which is a second query keyed by `client_id`. A gated-out client draws five bars and a sentence, never an empty sixth bar, because an empty bar reads as a zero. Once `ClientCard` and `cardSummary` stop importing them, `src/lib/score.ts` and `src/lib/pillars.ts` are deleted outright rather than left to rot, and only then are the six old columns renamed.

**Tech Stack:** React 19 + TypeScript, Vite, CSS Modules, Supabase (postgrest-js), Postgres 17.6, Vitest + Testing Library, jsdom.

**Spec:** `docs/superpowers/specs/2026-08-27-phase-2-slice-4-scoring-model-design.md` — read §8 (the board), §5.4 (the rename), §9.1, and §3.2's amendment block. Commit `90c934b`.

**Branch:** `slice-4-scoring-model`. **`main` is LIVE at `04e030a` and production is migrated and serving real users.** Read the deployment section below before writing any migration.

---

## THE DEPLOYMENT CONSTRAINT — read this first, it shapes the whole plan

This is the first step in this project where the branch is behind a **live** production. Two facts:

1. **Production's database already has** both the six-bucket and the yes/no migrations. All 22 answer columns, all six bucket scores, `started_on`, and the single-branch `checkin_scores` view exist there now. Ten clients carry real start dates.
2. **Production's deployed app still reads the five old columns** — `relationship`, `delivery`, `financial`, `sentiment`, `growth` and `total_score` — through `cardSummary.ts`'s `CHECKIN_COLUMNS`. Twelve real check-in rows hold that data.

Therefore **the `legacy_*` rename cannot ship in the same release as the board.** Renaming those columns while the live site still selects them breaks the board instantly, for real users, with a Postgres error on every load. The order is forced:

```
Tasks 1-5  build the board against the new columns
Task 6     rename on STAGING only, and prove the board survives it
           -> OWNER DEPLOYS the new board to production
Task 7     OWNER applies the rename to production, after the deploy
```

Task 6's migration file is written and applied to staging during this plan. **It is applied to production by the owner, after the deploy, and Task 7 is his checklist, not ours.** Any implementer who applies a migration to production has made an unrecoverable mistake.

`npm run db:which` must print `tgc-client-health-staging` before every database command. Production is `jizavsawtbkmvzllxhtk`; staging is `dexsdhtpfsswgiytxntl`. Never run `db:push` against production.

---

## Global Constraints

- **The overall score NEVER includes Advocacy.** It is the mean of the eighteen non-Advocacy answers, always, in both gate states. The board reads it from `checkin_scores.overall_score` and never recomputes it.
- **A missing answer must never read as a low score.** An unscored bucket draws an empty track and its label says "not scored"; it never draws a zero-height fill that could be read as a score of 0. An unscored card shows an em dash, never `0`.
- **`false` and null are different for Advocacy.** Four Nos is `adv_score` 1.00 — a real, low bar. One unanswered question is `adv_score` null — no bar. The card must not conflate them.
- **A gated-out client shows FIVE bars and a note**, not six with an empty one (spec §8).
- **`src/lib/scoreMath.ts` and `src/lib/buckets.ts` must keep ZERO runtime imports.** `tests/leafModules.test.ts` enforces it; `npm run verify:score` breaks otherwise.
- **No colour or typeface literals outside `src/styles/tokens.css`** — `tests/tokens.test.ts` walks every `.css`/`.ts`/`.tsx`/`.html`/`.svg`, comments included.
- **No per-element margins for spacing** — gaps come from flex/grid containers.
- **`@testing-library/jest-dom` is NOT installed.** Plain vitest matchers only: `toBe`, `toEqual`, `toContain`, `toHaveProperty`, `toBeNull`, `toHaveLength`, `toThrow`. Negations (`.not.toBeNull()`) are fine.
- **`import type` for type-only imports** (`verbatimModuleSyntax` is on).
- **Never `git commit -a`.** Stage explicit paths.
- **Do NOT consolidate existing tests into broader new ones.** This has gone wrong twice in this project; once it silently lost two real cases. Change in place only where a premise was genuinely retired, and name each such change in the report.
- **Baseline before Task 1: 685 tests / 45 files, build clean, lint clean, all nine verifiers green.** Confirm with `npm test -- --run` before starting.

---

## A trap that has already been checked, so nobody re-checks it wrong

`src/lib/buckets.ts:15-16` and `scripts/score-parity.mjs:85-86` both contain the words `relationship` and `delivery`. **These are BUCKET names, not column names.** The buckets are `communication, growth, finances, relationship, delivery, advocacy`; the columns being renamed are `relationship, delivery, financial, sentiment, growth, total_score`. The words collide; the meanings do not.

Task 6 must not touch either file. A search-and-replace across the repo for `relationship` would break the rubric and the parity verifier at once.

---

## File Structure

**Modified**
| File | Change |
|---|---|
| `src/board/cardSummary.ts` | `CardCheckin` gains the 22 answers and six bucket scores, loses the five pillars and `total_score`. `CHECKIN_COLUMNS` rewritten. `cardFooter` counts against a gate-dependent `required`. |
| `src/board/useBoard.ts` | Second query against `checkin_scores`; `BoardScores` map exposed on `UseBoard`. |
| `src/board/ClientCard.tsx` | Six bars from `BUCKET_DEFINITIONS`, five plus a note when gated out; band and total from `scoreMath`. |
| `src/board/ClientCard.module.css` | `.pillar` → `.bucket`; a class for the gated note. |
| `src/board/Board.tsx` | Passes the score row to each card. |
| Their tests | `cardSummary.test.ts`, `useBoard.dom.test.ts`, `ClientCard.dom.test.tsx`, `Board.test.tsx` |

**Deleted**
| File | Why |
|---|---|
| `src/lib/score.ts`, `src/lib/pillars.ts` | The five-pillar rubric and its arithmetic. Nothing imports them after Task 3. |
| `src/lib/pillars.test.ts` | Tests a deleted module. |

**Created**
| File | Responsibility |
|---|---|
| `supabase/migrations/<ts>_rename_legacy_pillars.sql` | Renames the six old columns to `legacy_*`. Staging only within this plan. |

**Deliberately untouched:** `src/checkin/` (step 2.5 owns it, reviewed clean), `src/lib/gate.ts`, `src/lib/buckets.ts`, `src/lib/scoreMath.ts`, `src/lib/scoreV2.ts`, `scripts/score-parity.mjs`.

---

## Task 1: `cardSummary` reads the new model

**Files:** Modify `src/board/cardSummary.ts`; Test `src/board/cardSummary.test.ts`.

**Interfaces:**
- Consumes: `BUCKETS`, `BUCKET_DEFINITIONS`, `questionsFor`, `ALL_QUESTIONS` from `src/lib/buckets.ts`; `requiredQuestions`, `answeredCount` from `src/lib/scoreV2.ts`; `formatSavedAt` from `src/lib/month.ts`.
- Produces:
  - `type BucketScoreKey = 'comm_score' | 'growth_score' | 'fin_score' | 'rel_score' | 'del_score' | 'adv_score'`
  - `const BUCKET_SCORE_KEY: Record<Bucket, BucketScoreKey>`
  - `type CardCheckin = { client_id: number; submitted_at: string | null; submitted_by: string | null } & Partial<Record<BucketScoreKey, number | null>> & Partial<Record<string, number | boolean | null>>`
  - `const CHECKIN_COLUMNS: string`
  - `function cardFooter(checkin: CardCheckin | null, viewerId: string, advocacyApplies: boolean): string`
  - `function progressLine(submitted: number, total: number): string` — unchanged

**Why the card reads bucket scores off `checkins` and not off the view.** Both carry them. `checkins` is already being queried for `submitted_at` and the answers behind the footer's count, so taking the bars from the same row costs nothing, and it keeps the view query narrow — `client_id, overall_score, advocacy_applies` only. The view is the authority for the *headline* number because §8 says so and because the overall cannot be a generated column.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { BUCKETS, ALL_QUESTIONS, questionsFor } from '../lib/buckets'
import { BUCKET_SCORE_KEY, CHECKIN_COLUMNS, cardFooter, progressLine } from './cardSummary'

describe('CHECKIN_COLUMNS', () => {
  // The literal is typed by supabase-js, so a mistyped column fails the build
  // rather than surfacing at runtime -- but only the build knows that. This
  // test is what catches the literal drifting from the rubric.
  it('names every one of the 22 answers', () => {
    const named = CHECKIN_COLUMNS.split(',').map((c) => c.trim())
    for (const key of ALL_QUESTIONS) expect(named).toContain(key)
  })

  it('names all six bucket score columns', () => {
    const named = CHECKIN_COLUMNS.split(',').map((c) => c.trim())
    for (const bucket of BUCKETS) expect(named).toContain(BUCKET_SCORE_KEY[bucket])
  })

  it('names what the footer needs', () => {
    const named = CHECKIN_COLUMNS.split(',').map((c) => c.trim())
    expect(named).toContain('client_id')
    expect(named).toContain('submitted_at')
    expect(named).toContain('submitted_by')
  })

  // The retired five. Selecting a renamed column is a Postgres error on every
  // board load, so this is the test that would catch the rename landing before
  // this file stopped asking for them.
  it('no longer names the retired pillar columns', () => {
    for (const gone of ['total_score', 'sentiment', 'financial']) {
      expect(CHECKIN_COLUMNS.split(',').map((c) => c.trim())).not.toContain(gone)
    }
  })
})

describe('BUCKET_SCORE_KEY', () => {
  it('maps each bucket to its own generated column', () => {
    expect(BUCKET_SCORE_KEY.communication).toBe('comm_score')
    expect(BUCKET_SCORE_KEY.growth).toBe('growth_score')
    expect(BUCKET_SCORE_KEY.finances).toBe('fin_score')
    expect(BUCKET_SCORE_KEY.relationship).toBe('rel_score')
    expect(BUCKET_SCORE_KEY.delivery).toBe('del_score')
    expect(BUCKET_SCORE_KEY.advocacy).toBe('adv_score')
  })

  it('gives all six distinct columns', () => {
    const keys = BUCKETS.map((b) => BUCKET_SCORE_KEY[b])
    expect(new Set(keys).size).toBe(6)
  })
})

// Fills every question in the 18 non-Advocacy buckets, leaving Advocacy blank.
function eighteenAnswered(): Record<string, number> {
  const answers: Record<string, number> = {}
  for (const bucket of BUCKETS) {
    if (bucket === 'advocacy') continue
    for (const q of questionsFor(bucket)) answers[q.key] = 3
  }
  return answers
}

describe('cardFooter', () => {
  const VIEWER = 'viewer-uuid'

  it('says Not started when there is no row', () => {
    expect(cardFooter(null, VIEWER, true)).toBe('Not started')
  })

  it('says Not started when a row exists with no answers', () => {
    const row = { client_id: 1, submitted_at: null, submitted_by: null }
    expect(cardFooter(row, VIEWER, true)).toBe('Not started')
  })

  // Gate open: the denominator is 22, not 18. This is the number that decides
  // whether the person thinks they are finished.
  it('counts against 22 when the gate is open', () => {
    const row = { client_id: 1, submitted_at: null, submitted_by: null, ...eighteenAnswered() }
    expect(cardFooter(row, VIEWER, true)).toBe('Draft, 18 of 22 scored')
  })

  // Same row, gate shut: the same eighteen answers are a COMPLETE check-in.
  it('counts against 18 when the gate is shut', () => {
    const row = { client_id: 1, submitted_at: null, submitted_by: null, ...eighteenAnswered() }
    expect(cardFooter(row, VIEWER, false)).toBe('Draft, 18 of 18 scored')
  })

  // A No is an ANSWER. Counting it as unanswered would leave the card
  // permanently one short for the client most likely to answer No.
  it('counts a false Advocacy answer as scored', () => {
    const row = {
      client_id: 1, submitted_at: null, submitted_by: null,
      ...eighteenAnswered(), adv_left_review: false,
    }
    expect(cardFooter(row, VIEWER, true)).toBe('Draft, 19 of 22 scored')
  })

  it('names you when you submitted it', () => {
    const row = { client_id: 1, submitted_at: '2026-08-28T12:00:00Z', submitted_by: VIEWER }
    expect(cardFooter(row, VIEWER, true)).toContain('by you')
  })

  it('names another account manager when someone else did', () => {
    const row = { client_id: 1, submitted_at: '2026-08-28T12:00:00Z', submitted_by: 'someone-else' }
    expect(cardFooter(row, VIEWER, true)).toContain('by another account manager')
  })
})

describe('progressLine', () => {
  it('says no active clients when there are none', () => {
    expect(progressLine(0, 0)).toBe('No active clients')
  })

  it('says all submitted when they are', () => {
    expect(progressLine(10, 10)).toBe('All 10 check-ins submitted this month')
  })

  it('counts otherwise', () => {
    expect(progressLine(3, 10)).toBe('3 of 10 check-ins submitted this month')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run src/board/cardSummary.test.ts`
Expected: FAIL — `BUCKET_SCORE_KEY` is not exported, and `cardFooter` takes two arguments.

- [ ] **Step 3: Rewrite `cardSummary.ts`**

```ts
import { ALL_QUESTIONS, BUCKETS, type Bucket } from '../lib/buckets'
import { answeredCount, requiredQuestions } from '../lib/scoreV2'
import { formatSavedAt } from '../lib/month'

// The six generated bucket columns. Named here rather than derived from the
// bucket name, because the abbreviations are not derivable -- `finances` is
// `fin_score` and `communication` is `comm_score` -- and a derivation could not
// complain when it guessed wrong. cardSummary.test.ts pins all six.
export type BucketScoreKey =
  | 'comm_score' | 'growth_score' | 'fin_score'
  | 'rel_score' | 'del_score' | 'adv_score'

export const BUCKET_SCORE_KEY: Record<Bucket, BucketScoreKey> = {
  communication: 'comm_score',
  growth: 'growth_score',
  finances: 'fin_score',
  relationship: 'rel_score',
  delivery: 'del_score',
  advocacy: 'adv_score',
}

// Only what the card reads. Narrower than the table row on purpose: useBoard
// selects exactly these, and a type admitting the whole row would let a future
// edit read a column nothing fetched.
//
// The answers are typed `number | boolean | null` because the four Advocacy
// columns are boolean and the other eighteen are smallint. `false` is an
// ANSWER; only null and absence mean unanswered.
export type CardCheckin = {
  client_id: number
  submitted_at: string | null
  submitted_by: string | null
} & Partial<Record<BucketScoreKey, number | null>>
  & Partial<Record<string, number | boolean | null>>

// One literal, checked against the generated database types by supabase-js, so
// a mistyped column fails `npm run build` rather than arriving at runtime as
// undefined. Built from the rubric so it cannot drift from it -- the previous
// version spelled five pillar names by hand and cardSummary.test.ts existed to
// catch exactly that drift. Now the drift is impossible and the test proves the
// construction instead.
export const CHECKIN_COLUMNS = [
  'client_id',
  'submitted_at',
  'submitted_by',
  ...ALL_QUESTIONS,
  ...BUCKETS.map((bucket) => BUCKET_SCORE_KEY[bucket]),
].join(', ')

// The footer IS the save confirmation -- §6. Better than a toast because it
// survives a reload, which is the check the owner ran on v1 and got no answer
// from. Every branch returns a non-empty sentence.
//
// `advocacyApplies` is a parameter rather than something read off the row: the
// gate lives on the client's start date, not on the check-in, and the view is
// what answers it. Without it this line would say "of 22" for a client whose
// Advocacy questions are not being asked, and the person would hunt for four
// questions that are not on the screen.
export function cardFooter(
  checkin: CardCheckin | null,
  viewerId: string,
  advocacyApplies: boolean,
): string {
  if (!checkin) return 'Not started'

  if (checkin.submitted_at !== null) {
    const who = checkin.submitted_by === viewerId ? 'you' : 'another account manager'
    return `Submitted ${formatSavedAt(checkin.submitted_at)} by ${who}`
  }

  const scored = answeredCount(checkin, advocacyApplies)
  // A row can exist with notes and no answers. "Draft, 0 of 22" would send the
  // reader looking for scores that were never entered.
  if (scored === 0) return 'Not started'
  return `Draft, ${scored} of ${requiredQuestions(advocacyApplies).length} scored`
}

export function progressLine(submitted: number, total: number): string {
  if (total === 0) return 'No active clients'
  if (submitted === total) return `All ${total} check-ins submitted this month`
  return `${submitted} of ${total} check-ins submitted this month`
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- --run src/board/cardSummary.test.ts`
Expected: PASS. The rest of the suite will NOT pass yet — `ClientCard` still calls `cardFooter` with two arguments. That is Task 3's. Do not fix it here.

- [ ] **Step 5: Commit**

```bash
git add src/board/cardSummary.ts src/board/cardSummary.test.ts
git commit -m "feat(board): cardSummary reads the 22 answers and six bucket scores"
```

---

## Task 2: `useBoard` fetches the view

**Files:** Modify `src/board/useBoard.ts`; Test `src/board/useBoard.dom.test.ts`.

**Interfaces:**
- Consumes: `CHECKIN_COLUMNS`, `CardCheckin` from Task 1.
- Produces:
  - `type BoardScore = { client_id: number; overall_score: number | null; advocacy_applies: boolean }`
  - `const SCORE_COLUMNS = 'client_id, overall_score, advocacy_applies'`
  - `UseBoard` gains `scores: Map<number, BoardScore>`
  - `BoardClient` unchanged: `{ id: number; name: string; status: string; started_on: string | null }`

**A third round trip, deliberately.** The board already makes two. The view cannot supply `submitted_at` or the answers, and `checkins` cannot supply `overall_score`, so one of them has to be a second read. Eleven clients make this immaterial, and the alternative — recomputing the overall in the browser from eighteen answers — would be a second implementation of the number the whole verification apparatus exists to pin to one.

- [ ] **Step 1: Write the failing test**

Add to `src/board/useBoard.dom.test.ts`, alongside the existing tests — do not merge them:

```ts
it('exposes a score row per client, keyed by client_id', async () => {
  const { result } = renderUseBoard({
    clients: [{ id: 1, name: 'Acme', status: 'active', started_on: '2026-01-01' }],
    checkins: [{ client_id: 1, submitted_at: null, submitted_by: null, comm_score: 4 }],
    scores: [{ client_id: 1, overall_score: 3.5, advocacy_applies: true }],
  })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.scores.get(1)?.overall_score).toBe(3.5)
  expect(result.current.scores.get(1)?.advocacy_applies).toBe(true)
})

// A client with no check-in has no score row. The card must cope, and the map
// must not invent an entry.
it('has no score entry for a client with no check-in', async () => {
  const { result } = renderUseBoard({
    clients: [{ id: 1, name: 'Acme', status: 'active', started_on: null }],
    checkins: [],
    scores: [],
  })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.scores.get(1)).toBe(undefined)
})

// The view read failing must fail the board the same way the other two do --
// not leave a board rendering cards with no scores and no message.
it('reports an error when the view read fails', async () => {
  const { result } = renderUseBoard({
    clients: [{ id: 1, name: 'Acme', status: 'active', started_on: null }],
    checkins: [],
    scoresError: { message: 'permission denied for view checkin_scores' },
  })
  await waitFor(() => expect(result.current.status).toBe('error'))
  expect(result.current.loadError).not.toBeNull()
})
```

Extend the file's existing Supabase test double so `.from('checkin_scores')` resolves `scores` / `scoresError`, mirroring how it already handles `clients` and `checkins`. Keep every existing test passing unchanged.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run src/board/useBoard.dom.test.ts`
Expected: FAIL — `result.current.scores` is undefined.

- [ ] **Step 3: Add the query**

In `src/board/useBoard.ts`, add beside the existing types:

```ts
// The view's answer to two questions the checkins row cannot answer: what the
// headline number is, and whether Advocacy is being asked. Both belong to the
// view because the overall cannot be a generated column (spec §6) and the gate
// reads clients.started_on, which a generation expression may not touch.
export type BoardScore = {
  client_id: number
  overall_score: number | null
  advocacy_applies: boolean
}

export const SCORE_COLUMNS = 'client_id, overall_score, advocacy_applies'
```

Add `scores: Map<number, BoardScore>` to `UseBoard`, a `useState<Map<number, BoardScore>>(new Map())` beside the others, and after the existing `checkinResult` block:

```ts
        const scoreResult = await supabase
          .from('checkin_scores')
          .select(SCORE_COLUMNS)
          .eq('period', period)

        if (isCancelled()) return

        if (scoreResult.error) {
          setLoadError(describeError(scoreResult.error))
          setStatus('error')
          return
        }

        const scoreByClient = new Map<number, BoardScore>()
        for (const row of scoreResult.data) {
          scoreByClient.set(row.client_id, row)
        }
```

Set `setScores(scoreByClient)` alongside `setCheckins(byClient)`, inside the same "never write after a failed read" block, and return `scores` from the hook.

- [ ] **Step 4: Run the test**

Run: `npm test -- --run src/board/useBoard.dom.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/board/useBoard.ts src/board/useBoard.dom.test.ts
git commit -m "feat(board): read overall_score and the gate from checkin_scores"
```

---

## Task 3: The card draws six bars

**Files:** Modify `src/board/ClientCard.tsx`, `src/board/ClientCard.module.css`; Test `src/board/ClientCard.dom.test.tsx`.

**Interfaces:**
- Consumes: `CardCheckin`, `BUCKET_SCORE_KEY`, `cardFooter` (Task 1); `BoardScore` (Task 2); `BUCKETS`, `BUCKET_DEFINITIONS`, `GATED_BUCKET` from `src/lib/buckets.ts`; `BAND_LABELS`, `MAX_SCORE`, `bandFor` from `src/lib/scoreMath.ts`.
- Produces: `ClientCard` props gain `score: BoardScore | null`.

**Three things change at once and all three are visible.** The bars go from five to six and are fed by different columns. The headline number goes from an integer out of 25 to a two-decimal mean out of 5, so `bandFor` comes from `scoreMath` (3.6 / 2.2) rather than `score.ts` (18 / 11). And a gated-out client draws five bars plus a sentence.

**Do not import `src/lib/score.ts` or `src/lib/pillars.ts`.** Task 5 deletes them.

- [ ] **Step 1: Write the failing tests**

```tsx
// Six bars when the gate is open, and every one of them labelled.
it('draws six bars for a client past 90 days', () => {
  renderCard({
    client: { id: 1, name: 'Acme', status: 'active', started_on: '2026-01-01' },
    checkin: { client_id: 1, submitted_at: null, submitted_by: null,
               comm_score: 4, growth_score: 3, fin_score: 5,
               rel_score: 2, del_score: 4, adv_score: 1 },
    score: { client_id: 1, overall_score: 3.5, advocacy_applies: true },
  })
  expect(screen.getAllByTestId('bucket-bar')).toHaveLength(6)
})

// FIVE bars and a sentence -- not six with an empty one, which reads as a zero.
it('draws five bars and a note for a client inside 90 days', () => {
  renderCard({
    client: { id: 1, name: 'Acme', status: 'active', started_on: '2026-08-01' },
    checkin: { client_id: 1, submitted_at: null, submitted_by: null, comm_score: 4 },
    score: { client_id: 1, overall_score: 3.5, advocacy_applies: false },
  })
  expect(screen.getAllByTestId('bucket-bar')).toHaveLength(5)
  expect(screen.queryByTestId('card-gated')).not.toBeNull()
})

it('names the six buckets in rubric order, so a reader compares positions across cards', () => {
  renderCard({ /* gate open, as above */ })
  const initials = screen.getAllByTestId('bucket-initial').map((n) => n.textContent)
  expect(initials).toEqual(['C', 'G', 'F', 'R', 'D', 'A'])
})

// Four Nos is adv_score 1.00 -- a real, low bar, NOT an absent one.
it('draws a bar for an Advocacy score of 1', () => {
  renderCard({
    client: { id: 1, name: 'Acme', status: 'active', started_on: '2026-01-01' },
    checkin: { client_id: 1, submitted_at: null, submitted_by: null, adv_score: 1 },
    score: { client_id: 1, overall_score: 3.5, advocacy_applies: true },
  })
  const advocacy = screen.getAllByTestId('bucket-bar')[5]
  expect(advocacy.getAttribute('aria-label')).toBe('Advocacy: 1 of 5')
})

// ...and an unanswered Advocacy question is adv_score null, which is not a score.
it('says not scored for a null bucket', () => {
  renderCard({
    client: { id: 1, name: 'Acme', status: 'active', started_on: '2026-01-01' },
    checkin: { client_id: 1, submitted_at: null, submitted_by: null, adv_score: null },
    score: { client_id: 1, overall_score: 3.5, advocacy_applies: true },
  })
  const advocacy = screen.getAllByTestId('bucket-bar')[5]
  expect(advocacy.getAttribute('aria-label')).toBe('Advocacy: not scored')
})

it('shows the overall from the view, to two decimals, out of 5', () => {
  renderCard({ /* score: overall_score 3.5 */ })
  expect(screen.getByTestId('total').textContent).toBe('3.50')
})

// An em dash, never a 0. A false "at risk" is as harmful as a false "healthy".
it('shows an em dash and Not scored when there is no overall', () => {
  renderCard({
    client: { id: 1, name: 'Acme', status: 'active', started_on: '2026-01-01' },
    checkin: null,
    score: null,
  })
  expect(screen.getByTestId('total').textContent).toBe('—')
  expect(screen.getByText('Not scored')).not.toBeNull()
})

// The band thresholds moved with the scale: 3.6 and 2.2 on 1-5, not 18 and 11
// out of 25. A card reading the old thresholds would call 3.50 healthy.
it('bands on the 1-5 thresholds', () => {
  renderCard({ /* overall_score: 3.5 */ })
  expect(screen.getByText('Watch')).not.toBeNull()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run src/board/ClientCard.dom.test.tsx`
Expected: FAIL — no `bucket-bar` testid; `ClientCard` has no `score` prop.

- [ ] **Step 3: Rewrite the card's scoring parts**

Replace the two imports at the top:

```tsx
import { BAND_LABELS, MAX_SCORE, bandFor } from '../lib/scoreMath'
import { BUCKETS, BUCKET_DEFINITIONS, GATED_BUCKET } from '../lib/buckets'
import { BUCKET_SCORE_KEY, cardFooter } from './cardSummary'
import type { BoardScore } from './useBoard'
```

Add `score: BoardScore | null` to `Props`, then:

```tsx
  // From the view, never recomputed here. The overall cannot be a generated
  // column (spec §6), so the view is the one place it exists -- and `npm run
  // verify:scoring-view` is what proves that expression is right. A second
  // local calculation would be a second thing to keep in agreement.
  const total = score?.overall_score ?? null
  const band = bandFor(total)

  // The gate decides how many bars there are, not whether one of them is empty.
  // An empty sixth bar reads as a score of zero, and Advocacy inside 90 days is
  // not a zero -- it is a question nobody was asked. Spec §8.
  const advocacyApplies = score?.advocacy_applies ?? false
  const drawnBuckets = advocacyApplies
    ? BUCKETS
    : BUCKETS.filter((bucket) => bucket !== GATED_BUCKET)
```

The total line becomes:

```tsx
      <p className={styles.score}>
        {/* An em dash, never a 0. An incomplete check-in has no score, and a
            false "at risk" is as harmful as a false "healthy". Two decimals,
            matching what the view stores -- 3.5 and 3.50 are the same number
            but only one of them lines up in a column of eleven cards. */}
        <span className="t-score numeric" data-testid="total">
          {total === null ? '—' : total.toFixed(2)}
        </span>
        <span className="t-caption numeric">/ {MAX_SCORE}</span>
      </p>
```

The bars become:

```tsx
      <div className={styles.bars}>
        {drawnBuckets.map((bucket) => {
          const definition = BUCKET_DEFINITIONS[bucket]
          const value = checkin?.[BUCKET_SCORE_KEY[bucket]] ?? null
          return (
            <span
              aria-label={
                value === null
                  ? `${definition.label}: not scored`
                  : `${definition.label}: ${value} of ${MAX_SCORE}`
              }
              className={styles.bucket}
              data-testid="bucket-bar"
              key={bucket}
              role="img"
            >
              <span className={styles.track}>
                {/* A bucket score runs 1.00 to 5.00, so a zero-height fill
                    unambiguously means unscored -- there is no real score that
                    draws nothing. */}
                <span
                  className={styles.fill}
                  style={{ blockSize: `${((value ?? 0) / MAX_SCORE) * 100}%` }}
                />
              </span>
              <span aria-hidden="true" className={styles.initial} data-testid="bucket-initial">
                {definition.initial}
              </span>
            </span>
          )
        })}
      </div>

      {/* Said outright rather than implied by a missing bar. Without it the
          card is five bars where its neighbour has six and nothing explains
          the difference. */}
      {!advocacyApplies && (
        <p className="t-caption" data-testid="card-gated">
          Advocacy begins at 90 days.
        </p>
      )}
```

Update the `cardFooter` call to pass `advocacyApplies` as its third argument.

In `ClientCard.module.css`, rename `.pillar` to `.bucket` and change nothing else about it. Add no new colour or typeface literals.

- [ ] **Step 4: Run the test**

Run: `npm test -- --run src/board/ClientCard.dom.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/board/ClientCard.tsx src/board/ClientCard.module.css src/board/ClientCard.dom.test.tsx
git commit -m "feat(board): six bucket bars, the gated note, and the overall from the view"
```

---

## Task 4: `Board.tsx` passes the score through

**Files:** Modify `src/board/Board.tsx`; Test `src/board/Board.test.tsx`.

**Interfaces:** Consumes `scores` from Task 2 and the `score` prop from Task 3. Produces nothing new.

- [ ] **Step 1: Write the failing test**

```tsx
it('gives each card its own score row', () => {
  renderBoard({
    clients: [
      { id: 1, name: 'Acme', status: 'active', started_on: '2026-01-01' },
      { id: 2, name: 'Beta', status: 'active', started_on: '2026-08-01' },
    ],
    scores: new Map([
      [1, { client_id: 1, overall_score: 4.5, advocacy_applies: true }],
      [2, { client_id: 2, overall_score: 2.0, advocacy_applies: false }],
    ]),
  })
  // Acme is past 90 days and draws six; Beta is inside it and draws five.
  expect(screen.getAllByTestId('bucket-bar')).toHaveLength(11)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run src/board/Board.test.tsx`
Expected: FAIL — every card receives `score={null}` or the prop is missing.

- [ ] **Step 3: Pass it**

In `Board.tsx`, where `ClientCard` is rendered, add `score={scores.get(client.id) ?? null}`, taking `scores` from `useBoard`.

- [ ] **Step 4: Run the whole board suite**

Run: `npm test -- --run src/board/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/board/Board.tsx src/board/Board.test.tsx
git commit -m "feat(board): hand each card its score row"
```

---

## Task 5: Delete the five-pillar modules

**Files:** Delete `src/lib/score.ts`, `src/lib/pillars.ts`, `src/lib/pillars.test.ts`.

**Interfaces:** Consumes nothing. Produces nothing. This task only removes.

**Check before deleting, do not assume.** Run `grep -rn "lib/score'\|lib/pillars\|from './pillars'\|from './score'" src tests scripts` and confirm the only hits are the files being deleted. If anything else still imports them, STOP and report it — a task earlier in this plan did not finish its job, and deleting the module would break that consumer.

`src/lib/scoreV2.ts` re-exports `BAND_LABELS`, `bandFor`, `SCORE_VALUES` and friends from `scoreMath.ts`. Those are the replacements. They are NOT the same file and `scoreV2` must not be edited here.

- [ ] **Step 1: Prove nothing imports them**

```bash
grep -rn "lib/score'\|lib/pillars\|from './pillars'\|from './score'" src tests scripts
```
Expected: only `src/lib/score.ts`, `src/lib/pillars.ts`, `src/lib/pillars.test.ts` themselves.

- [ ] **Step 2: Delete**

```bash
git rm src/lib/score.ts src/lib/pillars.ts src/lib/pillars.test.ts
```

- [ ] **Step 3: Run the whole gate**

Run: `npm test -- --run && npm run build && npm run lint`
Expected: all clean. Test count drops by however many `pillars.test.ts` held; that is the point, and the report must state the new number.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: retire the five-pillar rubric and its arithmetic"
```

---

## Task 6: The `legacy_*` rename — STAGING ONLY

**Files:** Create `supabase/migrations/<timestamp>_rename_legacy_pillars.sql`; modify `src/types/database.ts` (regenerated).

**Interfaces:** Produces the renamed columns. Nothing in `src/` reads them after Task 1.

**READ THE DEPLOYMENT CONSTRAINT AT THE TOP OF THIS PLAN BEFORE STARTING.** This migration is applied to **staging only**. The live site still selects the old names until the owner deploys Tasks 1-5. Applying this to production before that deploy takes the board down for real users. Task 7 is the owner's production checklist and is not executed by any implementer.

**Do not touch `src/lib/buckets.ts` or `scripts/score-parity.mjs`.** Both contain the words `relationship` and `delivery` as BUCKET names. See the trap section at the top of this plan.

- [ ] **Step 1: Confirm the target**

```bash
npm run db:which
```
Expected: `linked project: tgc-client-health-staging`. **Stop if it says anything else.**

- [ ] **Step 2: Write the migration**

Generate the timestamp with `date -u +%Y%m%d%H%M%S`.

```sql
-- Spec §5.4. The five pillars and their total become legacy_*, keeping the
-- history rather than dropping it.
--
-- RENAME, NEVER DROP. These columns hold twelve real check-ins from the v1
-- rubric -- the only record that those months were scored at all. A drop would
-- be unrecoverable and buys nothing: the cost of keeping them is a wider table,
-- which is the cheaper mistake.
--
-- Renaming rather than leaving them alone is what makes the table readable: a
-- column named `growth` sitting beside `growth_goals_defined` and
-- `growth_score` is a trap for the next person, and `relationship` beside
-- `rel_score` is the same trap twice.
--
-- ORDERING, AND IT IS NOT OPTIONAL. The deployed app selects these columns by
-- name until the Slice 4 step 3 board ships. Applying this to production before
-- that deploy makes every board load fail with "column does not exist" for
-- real users. Staging first; production only after the deploy.
--
-- total_score is a generated column. Renaming it is a catalogue operation and
-- recomputes nothing.
alter table public.checkins rename column relationship to legacy_relationship;
alter table public.checkins rename column delivery to legacy_delivery;
alter table public.checkins rename column financial to legacy_financial;
alter table public.checkins rename column sentiment to legacy_sentiment;
alter table public.checkins rename column growth to legacy_growth;
alter table public.checkins rename column total_score to legacy_total_score;
```

- [ ] **Step 3: Apply to staging and regenerate types**

```bash
npm run db:which && npm run db:push
```

Then regenerate the types. **There is no `gen:types` npm script — do not invent one, and do not add one as part of this task.** Verified against `package.json` on 2026-08-28: every database command in this repo is spelled `npx --yes supabase@latest <cmd> --linked`, guarded by `npm run db:which`. Follow that pattern:

```bash
npm run db:which && npx --yes supabase@latest gen types typescript --linked > src/types/database.ts
```

Check the result before staging it: `git diff --stat src/types/database.ts` should show the six `legacy_*` renames and nothing else. If the file comes back empty or truncated the redirect has clobbered it — `git checkout src/types/database.ts` and retry, because an empty types file makes `npm run build` fail in a way that looks unrelated to this task.

- [ ] **Step 4: Prove the board survives the rename**

This is the whole point of doing it on staging first.

```bash
npm test -- --run && npm run build && npm run lint
npm run verify:score
npm run verify:scoring-view
```
Expected: all clean. `verify:score` must still report **0 mismatches across 4,401 states** — it reads the six bucket expressions, none of which reference a renamed column.

Then confirm the renamed columns still hold their data:

```sql
select count(*) as rows, count(legacy_total_score) as kept from public.checkins;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ src/types/database.ts
git commit -m "feat(db): the five pillars become legacy_*, keeping the history"
```

---

## Task 7: The owner's production checklist — NOT EXECUTED BY AN IMPLEMENTER

This task is a document, not a change. Write it to `docs/superpowers/plans/2026-08-28-slice-4-step-3-production-checklist.md` and commit it. It exists so the sequencing survives outside this conversation.

- [ ] **Step 1: Write the checklist**

It must say, in this order:

1. **Merge and deploy Tasks 1-5 first.** `git checkout main && git merge slice-4-scoring-model && git push origin main`. Wait for the Actions run to go green. The deployed board now reads the six bucket columns and `checkin_scores`, and no longer selects `relationship`, `delivery`, `financial`, `sentiment`, `growth` or `total_score`.
2. **Confirm the live board renders** before touching the database. Open the site, check a card draws its bars and a headline number. If it does not, STOP — the rename would turn a broken board into a broken board with an unrecoverable cause.
3. **Only then apply the rename to production**, from `supabase/migrations/<ts>_rename_legacy_pillars.sql`.
4. **Verify:** `select count(*), count(legacy_total_score) from public.checkins;` — expect 12 and 12.
5. **Reload the live board.** It must look exactly as it did at step 2. If it breaks here, the deploy at step 1 did not actually ship the new board.

It must also record that production's migration history does not match the repo's filenames — the two earlier migrations were applied under regenerated timestamps — so `db push` against production is not a safe way to apply this one.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-08-28-slice-4-step-3-production-checklist.md
git commit -m "docs: the production checklist for the legacy_* rename"
```

---

## Self-Review

**Spec coverage.** §8's six bars → Task 3. §8's five-bars-and-a-note → Task 3. §8's "total and progress sentence read `overall_score` from the view" → Tasks 2, 3. §8's distinct initials C G F R D A → Task 3, and `buckets.test.ts` already asserts distinctness, unchanged. §4.4's counts against the required number → Task 1's `cardFooter`. §5.4's rename → Tasks 6 and 7. §5.4's warning that `score-parity.mjs` breaks on the rename → already handled: step 2.5 rewrote that generator to read the six bucket expressions, and it no longer looks up `total_score`. Verified by grep on 2026-08-28, and Task 6 Step 4 re-proves it.

**Placeholders.** None. Every code step carries its code. Task 6's `gen:types` step deliberately says to read `package.json` rather than naming a command this plan has not verified — an earlier plan in this project shipped an invented script name and it had to be corrected in a follow-up commit.

**Type consistency.** `CardCheckin` widens to `number | boolean | null` in Task 1 and is consumed that way in Task 3. `BUCKET_SCORE_KEY` is defined in Task 1 and used in Task 3. `BoardScore` is defined in Task 2 and consumed in Tasks 3 and 4. `cardFooter` gains its third parameter in Task 1, and Task 3 is its only caller. `bandFor` and `MAX_SCORE` come from `scoreMath` in Task 3, which is what allows Task 5 to delete `score.ts`.

**The highest-risk thing in this plan is not code.** It is the ordering in Task 6 and 7. Every other mistake here is caught by a test; that one is caught by real users seeing a broken board. It is stated three times on purpose.

**One thing a reviewer should check that no task asserts.** `Board.test.tsx` and `useBoard.dom.test.ts` both build Supabase test doubles. Task 2 adds a third table to the double. If the double's default for an unknown table is an empty success rather than a throw, a future query against a mistyped table name would silently return no rows and the board would render empty with no error. Worth a look while Task 2 is open.
