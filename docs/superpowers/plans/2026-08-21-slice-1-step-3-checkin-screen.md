# Slice 1 Step 3 — The Check-In Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the screen where an account manager scores a client's five pillars against written anchors, sees last month alongside, writes notes, and saves — with a confirmation that survives a reload.

**Architecture:** A `selectedClient` state in `Board.tsx` swaps the grid for `CheckIn.tsx`; no router. All decision logic is extracted into pure, unit-testable modules — the save lifecycle is a reducer (`src/checkin/saveState.ts`), the local draft is a validated cache (`src/checkin/draftCache.ts`), and the rubric is data (`src/lib/pillars.ts`). One imperative shell, `useCheckin.ts`, owns the single read, the form state, and the one write. `CheckIn.tsx` renders and dispatches, and holds no branching a test cannot reach.

**Tech Stack:** React 19, TypeScript 6 (strict), Vite 8, Vitest 4, `@supabase/supabase-js` 2.112, CSS modules over the token layers in `src/styles/tokens.css`.

**Spec:** `docs/superpowers/specs/2026-08-21-phase-1-slice-1-design.md` §5 (with §3 for ordering and §8 for the testing layers). Parent spec: `docs/superpowers/specs/2026-08-20-tgc-client-health-design.md`.

---

## Global Constraints

Every task's requirements implicitly include this section.

**The token gate — `tests/tokens.test.ts` fails the build on any of these anywhere under `src/`, comments included. Only `src/styles/tokens.css` is exempt.**

- No hex colour, in any length (`#fff`, `#ffff`, `#ffffff`, `#ffffffff`). Matched anywhere in the file, **comments included**.
- No functional colour notation: `rgb(`, `rgba(`, `hsl(`, `hsla(`, `oklch(`, `oklab(`, `lab(`, `lch(`, `color-mix(`. Also matched anywhere, comments included.
- No CSS named colour (`teal`, `red`, `white`, `tan`…) **in the value of a colour property**. Read `COLOUR_PROPERTIES` in `src/styles/tokenRules.ts` for the exact list — it is `background`, every `border*`, `color`, `fill`, `stroke`, `outline*`, the shadows and a few more. This rule is anchored to a property on purpose, so ordinary prose naming the palette does not trip it. **It can still fire inside a comment**, when the comment happens to contain something shaped like a declaration — `/* not the fill: teal */` is a real false positive, and it is a known parked item. If it fires: **reword the comment. Never weaken the rule, and never add a file to `EXEMPT_PATHS`.**
- No `font:` shorthand — flagged unconditionally, anywhere. `font-size`, `font-weight` and `font-stretch` are unaffected: they spell a hyphen where the shorthand needs a colon.
- No `font-family` whose value is anything other than a lone `var(--…)`.
- No camelCase inline `style` props in JSX.

**Styling rules that the gate cannot see, and that a reviewer must:**

- Every rule that sets `font-family: var(--face-X)` sets `font-stretch: var(--wdth-X)` beside it. The pairing is what makes the licensed-face swap a one-file edit; a lone `font-family` breaks it silently.
- Semantic tokens only, in components. Never a `--brand-*` or `--functional-*` token outside `tokens.css`.
- Layout does the spacing: sibling gaps come from a flex or grid container's `gap`, never per-element margins.
- Anything used by more than one screen belongs in `src/styles/base.css`; anything used by exactly one belongs in that component's `.module.css`.
- Light theme only. No `prefers-color-scheme` block, no `[data-theme]`.

**Product rules from the spec, each of which a reviewer should check by name:**

- **Colour is never the only signal.** A band always carries its text label (parent spec §9.3: teal on warm red measures 1.76:1, so any two bands are indistinguishable to a colour-blind viewer).
- **An incomplete check-in shows an em dash, never a number** (parent spec §6.2). Incomplete must never read as "at risk".
- **Never write after a failed read** (parent spec §8.1). Submit is blocked entirely while the read has failed, so a transient outage can never overwrite real pillars with an empty form.
- **No transition leaves the screen unchanged after a click.** That is the defect this slice exists to fix.
- **A disabled control says why it is disabled.** A dead button with no explanation is the same failure in a smaller box.

**Method rules:**

- **No agent performs a live database write, and no agent runs a command against production.** `npm run db:which` must print `tgc-client-health-staging` before any database command. If it prints anything else, stop and report.
- **`npm test` does not typecheck.** Vitest can be fully green while `tsc` fails. Run `npm run build` separately before believing anything is green.
- **A test that still passes when its subject is deleted is worth nothing.** For each new guard: delete the thing it guards, watch it go red, restore it, and say so in the report.
- **Do not write a sentence you have not verified.** This applies to code comments, commit messages, documentation and your report. If this plan asks you to write something you find to be untrue, **stop and report it** rather than writing it. Eleven such sentences reached the repo in step 2; every one was written by an agent that had not checked.
- **Every task ends by answering "would a person know this worked?" out loud** in its report. Not "the test passes" — what a person sees on screen, and what they would see if it had failed instead.
- Commit at the end of each task. Do not push; pushing is the owner's action.

---

## Before execution: staging has no active profile

Staging holds `Staging Test Client` and **no active profile**, so its policies are unexercised and `localhost:5173` cannot get past the access-pending screen. This is not agent work — it needs a human to click a link in a mailbox. The owner does it once, in a real terminal:

```bash
npm run dev
# open http://localhost:5173, enter josh@thegroundedco.com, click the emailed link
```

Then, to promote the profile the sign-in trigger created:

```sql
-- scripts/activate-staging-profile.sql, run with:
--   npm run db:which   (must print tgc-client-health-staging)
--   npx --yes supabase@latest db query --linked -f scripts/activate-staging-profile.sql
update public.profiles set role = 'admin', is_active = true
where email = 'josh@thegroundedco.com';
```

Supabase's built-in email is capped at **2 messages per hour**, so a mistyped address costs half an hour. Execution of the tasks below does not depend on this — every task is unit-tested without a database. It is a prerequisite only for the manual pass at the end.

---

## Deviations from the spec, decided before execution

Recorded here so a reviewer reads them as decisions rather than finding them as defects.

1. **§5.2 says "one query … the client row, this month's check-in and last month's". The client row is passed as a prop from the board instead, and the query reads only `checkins`.** The spec's stated reason is "fewer round trips and one failure mode rather than three" — one round trip and one failure mode is what this achieves, and it avoids an embedded select whose filter syntax is a second thing to get wrong. Cost if wrong: if a client is renamed or archived between the board's read and the card click, the check-in screen shows a stale name. The write is still adjudicated by RLS and its failure is still reported, so nothing incorrect is saved.

2. **§5.6's `saved` state "names the time and the person", but the person can only be named when it is you.** `profiles_select_own` restricts `profiles` SELECT to `(select auth.uid()) = id`, so embedding the author's email on a check-in submitted by someone else returns null. Step 3 therefore says "by you" when `submitted_by` matches the signed-in profile and "by another account manager" otherwise. **This is a real blocker for §6's board footer**, which is specified to name who submitted each check-in — that needs a widened `profiles` select policy, which is a Slice 2 permissions decision, not a step 4 detail. Task 8 records it in the spec's open items.

3. **The spec does not mention clearing a pillar, and the draft model requires it.** A radio group cannot be unset by clicking, so a mis-click would permanently make an incomplete check-in complete, with no way back. Each scored pillar therefore gets a quiet `Clear` control. Cost if wrong: one more control per row.

4. **§5.3's parity test needs a real database, so it is a script rather than part of `npm test`.** `npm run verify:score` reads the live generated-column expression out of the catalogue and evaluates it against every one of the 7,776 pillar combinations, comparing each to `totalScore()`'s answer. It cannot run in Vitest's node environment because there is no database there, and a test that silently skips is worse than a script that must be run. Task 8 also adds a no-database guard that fails if the migration's expression text changes, so drift is caught in CI even though parity itself is not.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `src/lib/pillars.ts` | The rubric as data: label, hint, and the anchors for 1 / 3 / 5, per pillar |
| `src/lib/pillars.test.ts` | Every pillar has a complete definition |
| `src/checkin/saveState.ts` | The save lifecycle as a pure reducer, plus the pure functions that decide the button's label, whether it is blocked, and which total is displayed |
| `src/checkin/saveState.test.ts` | Every transition, and the two properties: no click leaves the screen unchanged; a late response cannot claim success |
| `src/checkin/draftCache.ts` | The `localStorage` draft: key, validated read, tolerant write, clear, and the comparison that decides whether the draft or the stored row wins |
| `src/checkin/draftCache.test.ts` | Validation, storage that throws, and the draft-vs-row comparison |
| `src/checkin/PillarRow.tsx` | One pillar: label, hint, a 1–5 radio group, the three anchors, last month's value |
| `src/checkin/PillarRow.module.css` | That row's layout and the segmented scale |
| `src/checkin/useCheckin.ts` | The imperative shell: one read, form state, draft persistence, one write |
| `src/checkin/CheckIn.tsx` | The screen. Renders and dispatches; holds no logic a test cannot reach |
| `src/checkin/CheckIn.module.css` | The screen's layout |
| `scripts/score-parity.mjs` | Generates the parity SQL from the real `totalScore()` |
| `scripts/activate-staging-profile.sql` | The one-line promotion above, so it is not retyped from memory |
| `tests/generatedColumn.test.ts` | Fails if the migration's `total_score` expression changes |

**Modify:**

| File | Change |
|---|---|
| `src/lib/score.ts` | Add `MAX_PILLAR_SCORE`, `SCORE_VALUES`, `MAX_TOTAL`, `scoredCount` |
| `src/lib/score.test.ts` | Cover the four additions |
| `src/lib/month.ts` | Add `previousPeriod` and `formatSavedAt` |
| `src/lib/month.test.ts` | Cover both |
| `src/board/Board.tsx` | `selectedClient` state; the card becomes the click target |
| `src/board/Board.module.css` | The card overlay and its focus ring |
| `package.json` | `verify:score` script |
| `.gitignore` | The generated parity SQL |
| `README.md` | `verify:score`, and the staging activation |
| `docs/superpowers/specs/2026-08-21-phase-1-slice-1-design.md` | §10: the `profiles` policy blocker for §6's footer |

---

### Task 1: The rubric, and the scoring vocabulary it needs

**Files:**
- Modify: `src/lib/score.ts`
- Modify: `src/lib/score.test.ts`
- Create: `src/lib/pillars.ts`
- Create: `src/lib/pillars.test.ts`

**Interfaces:**
- Consumes: `PILLARS`, `Pillar` from `src/lib/score.ts` (already exist).
- Produces:
  - `MAX_PILLAR_SCORE: number` (value 5), `SCORE_VALUES: readonly number[]` (value `[1,2,3,4,5]`), `MAX_TOTAL: number` (value 25) and `scoredCount(pillars: Partial<Record<Pillar, number | null>>): number` from `src/lib/score.ts`. `SCORE_VALUES` is `readonly number[]` and not a tuple, because it is built with `Array.from` from `MAX_PILLAR_SCORE` rather than written out — deriving it is worth more than the tuple type, since a tuple would have to be hand-edited to stay in step.
  - The test file needs `Pillar` on its import from `./score`, for the cast in step 1.
  - `PillarDefinition`, `PILLAR_DEFINITIONS: Record<Pillar, PillarDefinition>`, `ANCHOR_VALUES: readonly [1,3,5]` from `src/lib/pillars.ts`.

- [ ] **Step 1: Write the failing tests for the score additions**

Append to `src/lib/score.test.ts`:

```ts
describe('the scoring vocabulary', () => {
  it('puts the maximum at 25, which is the denominator every screen prints', () => {
    // Asserted as a literal on purpose. Board.tsx and CheckIn.tsx both print
    // "of 25" beside a total; if the pillar count or the per-pillar maximum
    // ever changes, this fails instead of the two screens quietly lying.
    expect(MAX_TOTAL).toBe(25)
    expect(MAX_PILLAR_SCORE).toBe(5)
    expect(SCORE_VALUES).toEqual([1, 2, 3, 4, 5])
  })

  it('counts only pillars that hold a score', () => {
    expect(scoredCount({})).toBe(0)
    expect(scoredCount({ relationship: 1 })).toBe(1)
    expect(scoredCount({ relationship: 1, delivery: null })).toBe(1)
    expect(scoredCount({ relationship: 1, delivery: undefined })).toBe(1)
    expect(
      scoredCount({
        relationship: 1,
        delivery: 2,
        financial: 3,
        sentiment: 4,
        growth: 5,
      }),
    ).toBe(5)
  })

  it('ignores keys that are not pillars', () => {
    // The form's state is built from PILLARS, but a draft restored from
    // localStorage is arbitrary JSON. A stray key must not inflate the count
    // and make an incomplete check-in look submittable.
    //
    // Cast through `unknown` deliberately: the point of the test is to hand
    // scoredCount a shape the type system would refuse, which is exactly what
    // JSON.parse produces at runtime. If a narrower cast compiles, use it --
    // but do not change the assertion to fit the type.
    const strayKey = { relationship: 1, nonsense: 5 } as unknown as Partial<
      Record<Pillar, number>
    >
    expect(scoredCount(strayKey)).toBe(1)
  })
})
```

Add `MAX_PILLAR_SCORE, MAX_TOTAL, SCORE_VALUES, scoredCount` to the existing import from `./score`, and `describe` to the import from `vitest` if it is not already there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/score.test.ts`
Expected: FAIL — the four new names are not exported.

- [ ] **Step 3: Add them to `src/lib/score.ts`**

Insert after the existing `Pillar` type and before `totalScore`:

```ts
// The per-pillar ceiling, and the total it implies. Derived rather than written
// as 25, so the denominator on screen cannot disagree with the rubric.
export const MAX_PILLAR_SCORE = 5

// The values a pillar control offers, in order. Built from MAX_PILLAR_SCORE so
// the control and the ceiling cannot drift apart.
export const SCORE_VALUES = Array.from(
  { length: MAX_PILLAR_SCORE },
  (_, index) => index + 1,
) as readonly number[]

export const MAX_TOTAL = PILLARS.length * MAX_PILLAR_SCORE
```

And after `totalScore`:

```ts
// How many pillars hold a score. This is the number the button's label turns on
// -- fewer than five is a draft, five is a submission -- so it iterates PILLARS
// rather than the object's own keys: a draft restored from localStorage is
// arbitrary JSON, and a stray key must not be counted.
export function scoredCount(
  pillars: Partial<Record<Pillar, number | null>>,
): number {
  let count = 0
  for (const pillar of PILLARS) {
    const value = pillars[pillar]
    if (value !== null && value !== undefined) count += 1
  }
  return count
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/score.test.ts`
Expected: PASS.

`SCORE_VALUES` is typed `readonly number[]`, so `expect(SCORE_VALUES).toEqual([1,2,3,4,5])` compares values, not the tuple type. If the test as written fails on a type error rather than an assertion, report it — do not change the assertion to match a broken export.

- [ ] **Step 5: Write the failing test for the rubric**

Create `src/lib/pillars.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PILLARS } from './score'
import { ANCHOR_VALUES, PILLAR_DEFINITIONS } from './pillars'

describe('the pillar rubric', () => {
  it('defines every pillar, and only the pillars', () => {
    // Record<Pillar, …> makes a missing pillar a compile error, which `npm test`
    // does not run. This asserts it at runtime too, because the screen renders
    // by iterating PILLARS and a missing entry would throw there instead.
    expect(Object.keys(PILLAR_DEFINITIONS).sort()).toEqual([...PILLARS].sort())
  })

  it.each([...PILLARS])('gives %s a label, a hint and three anchors', (pillar) => {
    const definition = PILLAR_DEFINITIONS[pillar]
    expect(definition.label.trim()).not.toBe('')
    expect(definition.hint.trim()).not.toBe('')
    for (const value of ANCHOR_VALUES) {
      expect(definition.anchors[value].trim()).not.toBe('')
    }
  })

  it('anchors 1, 3 and 5 only', () => {
    // Two and four are deliberately unwritten: they read as "between these
    // two", which is how a five-point scale with three written anchors works.
    // Asserted so a later edit that adds a fourth anchor has to change this
    // line and think about it.
    expect(ANCHOR_VALUES).toEqual([1, 3, 5])
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/lib/pillars.test.ts`
Expected: FAIL — `./pillars` does not exist.

- [ ] **Step 7: Create `src/lib/pillars.ts`**

The wording is v1's rubric, transcribed verbatim from `index.html` of the predecessor artifact. Do not improve it — it is the wording the owner has been scoring against.

```ts
import type { Pillar } from './score'

// The rubric, as code rather than as a table. Slice 1 spec §9 records the
// reason `pillar_definitions` is deferred: the wording has changed zero times
// since v1 and the five pillars are settled, so a table would buy a
// deploy-free edit nobody has needed yet.
//
// Anchors are written for 1, 3 and 5 only. That is v1's rubric unchanged: 2 and
// 4 read as "between these two", which is how a five-point scale with three
// written anchors is meant to work.

export type AnchorValue = 1 | 3 | 5

export type PillarDefinition = {
  label: string
  hint: string
  anchors: Record<AnchorValue, string>
}

export const ANCHOR_VALUES: readonly AnchorValue[] = [1, 3, 5]

export const PILLAR_DEFINITIONS: Record<Pillar, PillarDefinition> = {
  relationship: {
    label: 'Relationship',
    hint: 'Reply speed, meeting attendance, engagement in reviews',
    anchors: {
      1: 'Slow or no replies; skips meetings without notice; disengaged in reviews.',
      3: 'Responds within a normal window; attends most meetings; engages when prompted.',
      5: 'Fast, proactive replies; full engagement; actively drives reviews and planning.',
    },
  },
  delivery: {
    label: 'Delivery',
    hint: 'Revision cycles, approval turnaround, on-time rate',
    anchors: {
      1: 'Excessive revision cycles; slow approvals; frequently late.',
      3: 'Normal number of revisions; approvals move at the expected pace; mostly on time.',
      5: 'Minimal revisions needed; fast approvals; consistently on time or early.',
    },
  },
  financial: {
    label: 'Financial',
    hint: 'Payment timeliness, scope-to-budget balance',
    anchors: {
      1: 'Late or overdue payments; scope regularly exceeds budget without resolution.',
      3: 'Payments generally on time; scope mostly tracks to budget.',
      5: 'Payments always on time; scope and budget well-aligned or growing profitably.',
    },
  },
  sentiment: {
    label: 'Sentiment',
    hint: 'Tone in calls/email, unprompted feedback, advocacy',
    anchors: {
      1: 'Frustrated or critical tone; complaints; no positive feedback.',
      3: 'Neutral, professional tone; no strong signal either way.',
      5: 'Warm tone; unprompted praise; refers business or advocates for TGC.',
    },
  },
  growth: {
    label: 'Growth',
    hint: 'Are we achieving their goals? Scope/spend trend',
    anchors: {
      1: 'Goals not being met; scope or spend shrinking or at risk.',
      3: 'Goals partially met; scope and spend roughly flat.',
      5: 'Goals clearly being met; scope and spend expanding.',
    },
  },
}
```

- [ ] **Step 8: Run the tests, then prove the guard is not vacuous**

Run: `npx vitest run src/lib/pillars.test.ts src/lib/score.test.ts`
Expected: PASS.

Now prove the first test can fail: delete the `growth` entry from `PILLAR_DEFINITIONS`, run again, confirm the "defines every pillar" test goes red, and restore it. Report both the red output and the restore.

- [ ] **Step 9: Typecheck and commit**

```bash
npm run build && npm test
git add src/lib/score.ts src/lib/score.test.ts src/lib/pillars.ts src/lib/pillars.test.ts
git commit -m "feat(checkin): the pillar rubric as data, and the scoring vocabulary"
```

---

### Task 2: The save state machine

**Files:**
- Create: `src/checkin/saveState.ts`
- Create: `src/checkin/saveState.test.ts`
- Modify: `src/lib/month.ts`
- Modify: `src/lib/month.test.ts`

**Interfaces:**
- Consumes: `PILLARS`, `scoredCount` from `src/lib/score.ts`.
- Produces, from `src/checkin/saveState.ts`:
  - `SaveState`, `SaveEvent`, `INITIAL_SAVE_STATE`
  - `saveReducer(state: SaveState, event: SaveEvent): SaveState`
  - `submitLabel(scored: number): string`
  - `SubmitBlock`, `submitBlock(args: { state: SaveState; readFailed: boolean; hasContent: boolean; storedSubmitted: boolean }): SubmitBlock`
  - `displayedTotal(args: { state: SaveState; localTotal: number | null; storedTotal: number | null }): number | null`
- Produces, from `src/lib/month.ts`: `previousPeriod(period: string): string`, `formatSavedAt(iso: string): string`.

- [ ] **Step 1: Write the failing tests for the two month helpers**

Append to `src/lib/month.test.ts`:

```ts
describe('previousPeriod', () => {
  it('steps back one month', () => {
    expect(previousPeriod('2026-08-01')).toBe('2026-07-01')
  })

  it('rolls the year over', () => {
    expect(previousPeriod('2026-01-01')).toBe('2025-12-01')
  })
})

describe('formatSavedAt', () => {
  it('renders a real timestamp as a date and a time', () => {
    // Asserted on the year rather than the full string: the format is the
    // runner's local zone and locale data, and pinning the exact output would
    // make this test fail on a machine in a different timezone rather than
    // when the function breaks.
    const text = formatSavedAt('2026-08-21T15:42:00.000Z')
    expect(text).toContain('2026')
    expect(text).not.toContain('Invalid')
    expect(text.trim()).not.toBe('')
  })

  it('hands back anything it cannot parse, rather than the words "Invalid Date"', () => {
    // A malformed timestamp reaching the screen should read as odd data, not as
    // a broken app. `new Date('nonsense').toLocaleString()` is the string
    // "Invalid Date", which looks like a crash to the person reading it.
    expect(formatSavedAt('nonsense')).toBe('nonsense')
    expect(formatSavedAt('')).toBe('')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/month.test.ts`
Expected: FAIL — `previousPeriod` and `formatSavedAt` are not exported.

- [ ] **Step 3: Add both to `src/lib/month.ts`**

```ts
// Named rather than written as addMonths(period, -1) at each call site: the
// check-in screen's whole "compare with last month" read depends on this being
// the same month everywhere, and a stray +1 in one place would silently compare
// against the wrong period.
export function previousPeriod(period: string): string {
  return addMonths(period, -1)
}

// The confirmation's timestamp. Local zone deliberately: the person reading it
// wants to know whether that was them, five minutes ago.
export function formatSavedAt(iso: string): string {
  const parsed = new Date(iso)
  // Number.isNaN on the time value, not a try/catch: the Date constructor does
  // not throw on nonsense, it produces a Date whose toLocaleString is the
  // literal string "Invalid Date". Printing that on a confirmation line would
  // read as a crash. Handing back the raw value reads as odd data, which is
  // what it is.
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/month.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for the reducer**

Create `src/checkin/saveState.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  INITIAL_SAVE_STATE,
  displayedTotal,
  saveReducer,
  submitBlock,
  submitLabel,
} from './saveState'
// SaveState only. `noUnusedLocals` is on, so importing SaveEvent here fails
// `tsc` -- the tests name their events inline rather than in a typed array.
import type { SaveState } from './saveState'

const CLEAN: SaveState = { kind: 'clean' }
const DIRTY: SaveState = { kind: 'dirty' }
const SAVING: SaveState = { kind: 'saving' }
const SAVED: SaveState = { kind: 'saved', at: '2026-08-21T15:42:00.000Z', by: 'you', complete: true }
const FAILED: SaveState = { kind: 'failed', error: 'network refused' }

const ALL_STATES: readonly SaveState[] = [CLEAN, DIRTY, SAVING, SAVED, FAILED]

describe('saveReducer', () => {
  it('starts clean', () => {
    expect(INITIAL_SAVE_STATE).toEqual({ kind: 'clean' })
  })

  it('a completed read returns to clean from anywhere', () => {
    for (const state of ALL_STATES) {
      expect(saveReducer(state, { type: 'loaded' })).toEqual({ kind: 'clean' })
    }
  })

  it('an edit makes the screen dirty', () => {
    expect(saveReducer(CLEAN, { type: 'edited' })).toEqual({ kind: 'dirty' })
    expect(saveReducer(SAVED, { type: 'edited' })).toEqual({ kind: 'dirty' })
    expect(saveReducer(FAILED, { type: 'edited' })).toEqual({ kind: 'dirty' })
  })

  it('refuses an edit while a write is in flight', () => {
    // The screen disables every input during a save, so this is unreachable by
    // clicking. The reducer refuses it anyway: if `saving` could be left by an
    // edit, the response arriving afterwards would have nothing to attach its
    // confirmation to, and `succeeded` below could no longer be trusted.
    expect(saveReducer(SAVING, { type: 'edited' })).toBe(SAVING)
  })

  it('a submission starts a save', () => {
    expect(saveReducer(DIRTY, { type: 'submitted' })).toEqual({ kind: 'saving' })
    expect(saveReducer(CLEAN, { type: 'submitted' })).toEqual({ kind: 'saving' })
    expect(saveReducer(FAILED, { type: 'submitted' })).toEqual({ kind: 'saving' })
  })

  it('names the time, the person and whether it counted as a submission', () => {
    const next = saveReducer(SAVING, {
      type: 'succeeded',
      at: '2026-08-21T15:42:00.000Z',
      by: 'you',
      complete: false,
    })
    expect(next).toEqual({
      kind: 'saved',
      at: '2026-08-21T15:42:00.000Z',
      by: 'you',
      complete: false,
    })
  })

  it('keeps the failure message, so retrying can be offered', () => {
    expect(saveReducer(SAVING, { type: 'failed', error: 'network refused' })).toEqual({
      kind: 'failed',
      error: 'network refused',
    })
  })

  it('ignores a response for a save that is no longer in flight', () => {
    // The scenario: a save is sent, the person goes back to the board and
    // returns (which remounts and re-reads, so the state is `clean`), and only
    // then does the original response land. Painting "Saved" over a freshly
    // loaded form would be a confirmation for a write the person can no longer
    // see, which is the same class of lie as no confirmation at all.
    for (const state of [CLEAN, DIRTY, SAVED, FAILED]) {
      expect(
        saveReducer(state, { type: 'succeeded', at: 'x', by: 'you', complete: true }),
      ).toBe(state)
      expect(saveReducer(state, { type: 'failed', error: 'late' })).toBe(state)
    }
  })

  it('never leaves a press with nothing to show for it', () => {
    // Spec §5.6: "No transition leaves the screen unchanged after a click."
    // Pressing the one control is a `submitted`, and it must move the state
    // from every state it can be pressed in -- otherwise the press does
    // nothing and the screen says nothing, which is the exact defect this
    // slice exists to fix.
    for (const state of [CLEAN, DIRTY, SAVED, FAILED]) {
      expect(
        saveReducer(state, { type: 'submitted' }),
        `${state.kind} + submitted left the save state unchanged`,
      ).not.toEqual(state)
    }
  })

  it('an edit always leaves the form unsaved, whether or not that is a change', () => {
    // The weaker half of the property above, stated honestly rather than
    // folded into it. `edited` moves clean, saved and failed to dirty -- a
    // visible change. From `dirty` it returns `dirty`, which is the SAME
    // state, and that is correct: the visible change was the pillar the
    // person just clicked, not the save state. Asserting `.not.toEqual` here
    // would be asserting something false about the reducer.
    for (const state of [CLEAN, SAVED, FAILED]) {
      expect(saveReducer(state, { type: 'edited' })).toEqual({ kind: 'dirty' })
    }
    expect(saveReducer(DIRTY, { type: 'edited' })).toEqual(DIRTY)
  })
})

describe('submitLabel', () => {
  it('reads Save draft below five pillars and Submit check-in at five', () => {
    expect(submitLabel(0)).toBe('Save draft')
    expect(submitLabel(4)).toBe('Save draft')
    expect(submitLabel(5)).toBe('Submit check-in')
  })
})

describe('submitBlock', () => {
  const ready = { state: DIRTY, readFailed: false, hasContent: true, storedSubmitted: false }

  it('lets an edited form with content through', () => {
    expect(submitBlock(ready)).toEqual({ blocked: false })
  })

  it('blocks every write while the read has failed', () => {
    // Parent spec §8.1, "never write after a failed read". This is the rule
    // that stops a transient outage replacing real pillars with an empty form,
    // so it is checked before anything else.
    const blocked = submitBlock({ ...ready, readFailed: true })
    expect(blocked.blocked).toBe(true)
    if (blocked.blocked) expect(blocked.reason).toMatch(/could not be read/i)
  })

  it('blocks a second press while the first is in flight', () => {
    expect(submitBlock({ ...ready, state: SAVING }).blocked).toBe(true)
  })

  it('blocks a save with nothing in it', () => {
    const blocked = submitBlock({ ...ready, hasContent: false })
    expect(blocked.blocked).toBe(true)
    if (blocked.blocked) expect(blocked.reason).toMatch(/at least one pillar/i)
  })

  it('blocks a repeat press that would write exactly what is already stored', () => {
    // This is `Score all 3s`'s defect, stated as a rule: a press that cannot
    // change anything must not look like a press that can. `clean` means the
    // form matches the database, and a stored row that is already submitted
    // has nothing left to gain.
    const blocked = submitBlock({ ...ready, state: CLEAN, storedSubmitted: true })
    expect(blocked.blocked).toBe(true)
    if (blocked.blocked) expect(blocked.reason).toMatch(/already submitted/i)
  })

  it('lets a loaded draft be submitted without editing it first', () => {
    // The other side of the rule above. Someone who scored four pillars
    // yesterday and the fifth is already there must be able to press submit
    // without touching a control to unlock it.
    expect(submitBlock({ ...ready, state: CLEAN, storedSubmitted: false })).toEqual({
      blocked: false,
    })
  })

  it('blocks a press immediately after a successful save', () => {
    const blocked = submitBlock({ ...ready, state: SAVED })
    expect(blocked.blocked).toBe(true)
    if (blocked.blocked) expect(blocked.reason).toMatch(/saved/i)
  })

  it('offers a retry after a failure', () => {
    expect(submitBlock({ ...ready, state: FAILED })).toEqual({ blocked: false })
  })

  it('always explains itself', () => {
    // A dead button with no explanation is the same failure as a silent save,
    // in a smaller box. Every blocking path must carry a sentence.
    const cases = [
      { ...ready, readFailed: true },
      { ...ready, state: SAVING },
      { ...ready, hasContent: false },
      { ...ready, state: SAVED },
      { ...ready, state: CLEAN, storedSubmitted: true },
    ]
    for (const input of cases) {
      const result = submitBlock(input)
      expect(result.blocked).toBe(true)
      if (result.blocked) expect(result.reason.trim()).not.toBe('')
    }
  })
})

describe('displayedTotal', () => {
  it('shows the local sum while the form differs from the database', () => {
    // §5.3: the number has to move as pillars are clicked, or the control gives
    // no feedback at all.
    for (const state of [DIRTY, SAVING, FAILED]) {
      expect(displayedTotal({ state, localTotal: 19, storedTotal: 12 })).toBe(19)
    }
  })

  it('shows the database column once the form matches it', () => {
    // §5.3: the total belongs to the database. Showing the stored value here is
    // what makes a disagreement between score.ts and the generated column
    // visible on screen instead of hidden behind local arithmetic.
    for (const state of [CLEAN, SAVED]) {
      expect(displayedTotal({ state, localTotal: 19, storedTotal: 12 })).toBe(12)
    }
  })

  it('carries null through, because incomplete has no number', () => {
    expect(displayedTotal({ state: DIRTY, localTotal: null, storedTotal: 12 })).toBeNull()
    expect(displayedTotal({ state: CLEAN, localTotal: 19, storedTotal: null })).toBeNull()
  })
})
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run src/checkin/saveState.test.ts`
Expected: FAIL — `./saveState` does not exist.

- [ ] **Step 7: Write `src/checkin/saveState.ts`**

```ts
import { PILLARS } from '../lib/score'

// The save path as a pure reducer. Slice 1 spec §5.6.
//
// Why a reducer and not a handful of booleans in the component: the defect this
// whole slice exists to fix is that a save which worked looked exactly like a
// save that failed. Nothing automated in the project could see that, because
// every reviewer verified a write by querying the database rather than by
// asking what a person would see. A reducer makes the answer to "what does the
// screen say now" a value a test can hold, so the next reviewer can check the
// confirmation without a browser.

export type SaveState =
  | { kind: 'clean' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string; by: string; complete: boolean }
  | { kind: 'failed'; error: string }

export type SaveEvent =
  | { type: 'loaded' }
  | { type: 'edited' }
  | { type: 'submitted' }
  | { type: 'succeeded'; at: string; by: string; complete: boolean }
  | { type: 'failed'; error: string }

export const INITIAL_SAVE_STATE: SaveState = { kind: 'clean' }

export function saveReducer(state: SaveState, event: SaveEvent): SaveState {
  switch (event.type) {
    case 'loaded':
      return { kind: 'clean' }

    case 'edited':
      // Refused while a write is in flight. The screen disables every input
      // during a save, so a person cannot reach this; the reducer refuses it
      // anyway, because leaving `saving` would strand the response that is
      // still coming and make the `succeeded` guard below meaningless.
      return state.kind === 'saving' ? state : { kind: 'dirty' }

    case 'submitted':
      return { kind: 'saving' }

    case 'succeeded':
      // Only a save that is actually in flight may report success. A response
      // arriving after the screen has moved on -- remounted, re-read, edited
      // again -- must not paint a confirmation over what is there now. A
      // confirmation for a write the person can no longer see is the same class
      // of lie as no confirmation at all.
      return state.kind === 'saving'
        ? { kind: 'saved', at: event.at, by: event.by, complete: event.complete }
        : state

    case 'failed':
      return state.kind === 'saving' ? { kind: 'failed', error: event.error } : state

    default: {
      // Exhaustiveness check: a new event stops this compiling instead of
      // silently falling through and returning the old state.
      const _exhaustive: never = event
      throw new Error(`Unhandled save event: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

// §5.4: one control, whose label reflects the state it is in. The label is the
// only place the draft/submitted distinction is visible before the press, and it
// is the deliberate opposite of `Score all 3s`, which wrote a constant whatever
// the state was.
export function submitLabel(scored: number): string {
  return scored === PILLARS.length ? 'Submit check-in' : 'Save draft'
}

export type SubmitBlock = { blocked: false } | { blocked: true; reason: string }

export function submitBlock(args: {
  state: SaveState
  readFailed: boolean
  hasContent: boolean
  storedSubmitted: boolean
}): SubmitBlock {
  // Checked first, and deliberately ahead of everything else: parent spec §8.1,
  // never write after a failed read. If the read failed, the form on screen is
  // not this month's check-in -- it is an empty form -- and saving it would
  // replace real pillars with nothing.
  if (args.readFailed) {
    return {
      blocked: true,
      reason:
        'This check-in could not be read, so saving is blocked. Saving now could ' +
        'replace real scores with an empty form.',
    }
  }

  if (args.state.kind === 'saving') {
    return { blocked: true, reason: 'Saving…' }
  }

  if (!args.hasContent) {
    return {
      blocked: true,
      reason: 'Score at least one pillar, or write a note, before saving.',
    }
  }

  if (args.state.kind === 'saved') {
    return { blocked: true, reason: 'Saved. Change something to save again.' }
  }

  // `clean` means the form matches the database. A stored row that is already
  // submitted therefore has nothing left to write, and a press that cannot
  // change anything must not look like a press that can -- that is `Score all
  // 3s`'s defect stated as a rule. A stored *draft* is the other case: it is
  // clean and unsubmitted, and pressing submit genuinely changes it.
  if (args.state.kind === 'clean' && args.storedSubmitted) {
    return {
      blocked: true,
      reason: 'This check-in is already submitted, and nothing has changed since it loaded.',
    }
  }

  return { blocked: false }
}

// §5.3: the total belongs to the database, and local arithmetic exists so the
// number moves as pillars are clicked. The moment the form matches what is
// stored, the stored number is what shows -- so a disagreement between
// score.ts and the generated column appears on screen rather than being hidden
// behind a local sum that always agrees with itself.
export function displayedTotal(args: {
  state: SaveState
  localTotal: number | null
  storedTotal: number | null
}): number | null {
  const formDiffers =
    args.state.kind === 'dirty' ||
    args.state.kind === 'saving' ||
    args.state.kind === 'failed'
  return formDiffers ? args.localTotal : args.storedTotal
}
```

- [ ] **Step 8: Run to verify pass**

Run: `npx vitest run src/checkin/saveState.test.ts src/lib/month.test.ts`
Expected: PASS.

- [ ] **Step 9: Prove three of the guards are not vacuous**

Each of these is a mutation to make, a red run to observe, and a restore. Report the failing test name for each.

1. Change `succeeded`'s guard to return the saved state unconditionally. Expected red: "ignores a response for a save that is no longer in flight".
2. Change `submitted`'s case to `return state`. Expected red: "a submission starts a save" and "never leaves a press with nothing to show for it".
3. Reorder `submitBlock` so the `readFailed` check comes after the `hasContent` check, then call it with `readFailed: true, hasContent: false`. This will NOT go red with the tests as written — the `hasContent` reason would be returned instead of the read-failure one, and no test pins the precedence. **Add a test that does**, then confirm it goes red under the reorder:

```ts
it('reports the failed read even when the form is also empty', () => {
  // Precedence, not just presence. An empty form and a failed read are the
  // same picture on screen; only the order of these checks decides whether
  // the person is told the safe thing or the trivial one.
  const blocked = submitBlock({
    state: CLEAN,
    readFailed: true,
    hasContent: false,
    storedSubmitted: false,
  })
  expect(blocked.blocked).toBe(true)
  if (blocked.blocked) expect(blocked.reason).toMatch(/could not be read/i)
})
```

- [ ] **Step 10: Typecheck and commit**

```bash
npm run build && npm test
git add src/checkin/saveState.ts src/checkin/saveState.test.ts src/lib/month.ts src/lib/month.test.ts
git commit -m "feat(checkin): the save path as a pure reducer, and its two month helpers"
```

---

### Task 3: The local draft cache

**Files:**
- Create: `src/checkin/draftCache.ts`
- Create: `src/checkin/draftCache.test.ts`

**Interfaces:**
- Consumes: `PILLARS`, `Pillar` and `MAX_PILLAR_SCORE` from `src/lib/score.ts` — and nothing else from it. In particular **not** `scoredCount`: `isDraftEmpty` counts the object's own keys rather than the pillars, because a draft with a stray key is still not empty. `npm run lint` fails on an unused import, so do not add one to match a longer list.
- Produces:
  - `PillarScores = Partial<Record<Pillar, number>>`
  - `Draft = { pillars: PillarScores; notes: string }`
  - `EMPTY_DRAFT: Draft`
  - `DRAFT_KEY_PREFIX: 'checkin-draft'`
  - `draftKey(clientId: number, period: string): string`
  - `StorageLike`
  - `readDraft(clientId: number, period: string, store?: StorageLike | null): Draft | null`
  - `writeDraft(clientId: number, period: string, draft: Draft, store?: StorageLike | null): boolean`
  - `clearDraft(clientId: number, period: string, store?: StorageLike | null): void`
  - `isDraftEmpty(draft: Draft): boolean`
  - `draftsDiffer(a: Draft, b: Draft): boolean`

- [ ] **Step 1: Write the failing tests**

Create `src/checkin/draftCache.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/checkin/draftCache.test.ts`
Expected: FAIL — `./draftCache` does not exist.

- [ ] **Step 3: Write `src/checkin/draftCache.ts`**

```ts
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
  const pillars: PillarScores = {}
  if (typeof source.pillars === 'object' && source.pillars !== null) {
    for (const [key, value] of Object.entries(source.pillars)) {
      if (isPillar(key) && validPillarValue(value)) pillars[key] = value
    }
  }

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
  try {
    if (isDraftEmpty(draft)) {
      // Removed rather than stored. A stored empty draft is indistinguishable
      // from a draft that says "everything is unscored", and readDraft would
      // have to guess which one it was looking at.
      store.removeItem(key)
      return true
    }
    store.setItem(key, JSON.stringify(draft))
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/checkin/draftCache.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove two guards are not vacuous**

1. Delete the `isDraftEmpty(draft) ? null : draft` guard at the end of `readDraft` and return `draft`. Expected red: "returns null for a draft that survives validation with nothing in it".
2. Replace `draftsDiffer`'s body with `return JSON.stringify(a) !== JSON.stringify(b)`. Expected red: "ignores key order" and "ignores surrounding whitespace in notes".

Restore both, and report the failing test names.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run build && npm test
git add src/checkin/draftCache.ts src/checkin/draftCache.test.ts
git commit -m "feat(checkin): the local draft cache, with untrusted input validated"
```

---

### Task 4: One pillar's row

**Files:**
- Create: `src/checkin/PillarRow.tsx`
- Create: `src/checkin/PillarRow.module.css`

**Interfaces:**
- Consumes: `PILLAR_DEFINITIONS`, `ANCHOR_VALUES` from `src/lib/pillars.ts`; `SCORE_VALUES`, `Pillar` from `src/lib/score.ts`.
- Produces: `PillarRow` with props `{ pillar: Pillar; value: number | undefined; lastValue: number | null; disabled: boolean; onChange: (value: number) => void; onClear: () => void }`.

There is no unit test for this task. Vitest runs in a `node` environment with no DOM, and adding a DOM test runner is a change to the toolchain that this step does not need. The gates on this task are the reviewer, the token test, `tsc`, and the owner's visual pass. Say so plainly in the report — do not claim coverage that does not exist.

- [ ] **Step 1: Write `src/checkin/PillarRow.tsx`**

```tsx
import { ANCHOR_VALUES, PILLAR_DEFINITIONS } from '../lib/pillars'
import { SCORE_VALUES } from '../lib/score'
import type { Pillar } from '../lib/score'
import styles from './PillarRow.module.css'

type Props = {
  pillar: Pillar
  value: number | undefined
  lastValue: number | null
  disabled: boolean
  onChange: (value: number) => void
  onClear: () => void
}

export function PillarRow({ pillar, value, lastValue, disabled, onChange, onClear }: Props) {
  const definition = PILLAR_DEFINITIONS[pillar]
  // Ids are derived from the pillar key so they are unique on a page that
  // renders five of these, and stable across renders.
  const labelId = `pillar-${pillar}-label`
  const hintId = `pillar-${pillar}-hint`

  return (
    // A plain section with role="radiogroup", not a fieldset. A fieldset would
    // give the disabled cascade for free, but <legend> ignores parts of normal
    // layout and the workarounds are exactly the kind of thing that looks fine
    // in review and wrong on the deployed page. The inputs share a `name`, so
    // arrow-key navigation and the "3 of 5" announcement come from the native
    // radios either way.
    <section className={styles.row}>
      <div className={styles.heading}>
        <h3 className="t-body" id={labelId}>
          {definition.label}
        </h3>
        <p className="t-caption" id={hintId}>
          {definition.hint}
        </p>
      </div>

      <div
        className={styles.scale}
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={hintId}
      >
        {SCORE_VALUES.map((score) => (
          <label className={styles.option} key={score}>
            <input
              className={styles.input}
              type="radio"
              name={`pillar-${pillar}`}
              value={score}
              checked={value === score}
              disabled={disabled}
              onChange={() => onChange(score)}
            />
            <span className={`${styles.face} numeric`}>{score}</span>
          </label>
        ))}

        {/* A radio group cannot be unset by clicking, so without this a
            mis-click permanently turns an incomplete check-in into a complete
            one -- and the draft-versus-submitted distinction the board counts
            on is exactly what that would falsify. Rendered only when there is
            something to clear, so it is never a control that does nothing. */}
        {value !== undefined && (
          <button
            className={`button button--quiet ${styles.clear}`}
            type="button"
            disabled={disabled}
            onClick={onClear}
          >
            Clear
          </button>
        )}
      </div>

      {/* The anchors, as a definition list because that is what they are: three
          scores and what each one means. Only 1, 3 and 5 are written; 2 and 4
          read as "between these two". */}
      <dl className={styles.anchors}>
        {ANCHOR_VALUES.map((anchor) => (
          <div className={styles.anchor} key={anchor}>
            <dt className={`t-label ${styles.anchorTerm} numeric`}>{anchor}</dt>
            <dd className="t-caption">{definition.anchors[anchor]}</dd>
          </div>
        ))}
      </dl>

      {/* Last month, per pillar. §5.2: a score compared is a judgment and a
          score alone is a guess. Absent rather than zero when there was no
          check-in last month -- printing a 0 would invent a bad month. */}
      <p className="t-caption">
        {lastValue === null ? (
          'No score last month'
        ) : (
          <>
            Last month: <span className="numeric">{lastValue}</span>
          </>
        )}
      </p>
    </section>
  )
}
```

- [ ] **Step 2: Write `src/checkin/PillarRow.module.css`**

Read `src/styles/tokens.css` before writing this, and use only semantic tokens. Every `font-family: var(--face-X)` gets `font-stretch: var(--wdth-X)` beside it.

```css
/* One pillar: its name and hint, the 1-5 scale, the three written anchors, and
   last month's value. Five of these stack on the check-in screen. */

.row {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--rule-hairline);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

.heading {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.scale {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

/* Positioned, so the absolutely-positioned input below resolves against this
   label rather than against whatever ancestor happens to be positioned. The
   input is invisible either way, but a focused element parked at the top of the
   page can make the browser scroll somewhere nobody asked to go. */
.option {
  position: relative;
  display: inline-flex;
  cursor: pointer;
}

/* The native radio is what carries the semantics, the keyboard behaviour and
   the checked state; it is moved out of sight rather than removed, because
   display:none would take it out of the tab order and out of the accessibility
   tree with it. The visible control is .face, which is the adjacent sibling the
   :checked selector below reaches -- so the input must stay immediately before
   it in the JSX. */
.input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* --space-7 is 3rem, so the tappable box is 48px. Sized for a thumb on
   purpose: this is the control the owner presses fifty-five times a month
   (eleven clients, five pillars), sometimes on a phone, and 48px clears the
   44px minimum that --space-6 at 32px would not. Five of them plus their gaps
   overflow the narrowest phones, which is what the flex-wrap on .scale is
   for -- wrapping to two rows is the intended behaviour there, not a defect. */
.face {
  display: grid;
  place-items: center;
  min-width: var(--space-7);
  height: var(--space-7);
  border: 1px solid var(--rule-hairline);
  border-radius: var(--radius-md);
  background: var(--surface-page);
  color: var(--text-primary);
  font-family: var(--face-body);
  font-stretch: var(--wdth-body);
  font-weight: var(--wght-header);
  font-size: var(--step-0);
  line-height: var(--leading-numeric);
}

.option:hover .face {
  border-color: var(--text-secondary);
}

/* The selected value is a fill, not a border weight: a 1px difference is not a
   state change anybody can see across five controls. */
.input:checked + .face {
  border-color: var(--action-face);
  background: var(--action-face);
  color: var(--action-text);
}

/* The ring has to be drawn here, because the input it belongs to is out of
   sight. base.css's global :focus-visible would draw it around a 1px box
   nobody can see, which is the same as having no focus indicator at all. */
.input:focus-visible + .face {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.input:disabled + .face {
  opacity: 0.45;
}

.option:has(.input:disabled) {
  cursor: not-allowed;
}

/* Smaller than a primary action and set apart from the scale, so it reads as an
   escape hatch rather than a sixth score. */
.clear {
  margin-inline-start: var(--space-2);
  padding: var(--space-1) var(--space-3);
}

.anchors {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--rule-hairline);
}

.anchor {
  display: grid;
  grid-template-columns: var(--space-5) 1fr;
  gap: var(--space-3);
  align-items: baseline;
}

.anchorTerm {
  text-align: end;
}
```

Note on `.clear`: `margin-inline-start` is a margin, and the global constraint says layout does the spacing. This one is deliberate and is the exception — the gap between the fifth radio and the Clear button has to be larger than the gap between two radios, and a flex container gives every gap the same size. If a reviewer prefers, the alternative is wrapping the five radios in their own flex container; either is acceptable, but say which one you chose and why.

- [ ] **Step 3: Verify the gates**

```bash
npm run build && npm test && npm run lint
```

Expected: PASS. If the token test fires on a comment in the CSS, **reword the comment**. Do not add the file to `EXEMPT_PATHS` and do not soften a rule.

- [ ] **Step 4: Commit**

```bash
git add src/checkin/PillarRow.tsx src/checkin/PillarRow.module.css
git commit -m "feat(checkin): one pillar's row, with its anchors and a clearable scale"
```

---

### Task 5: The read, the form state and the one write

**Files:**
- Create: `src/checkin/useCheckin.ts`

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabase.ts`; `describeError` from `src/lib/errorText.ts`; `previousPeriod` from `src/lib/month.ts`; `PILLARS`, `Pillar`, `scoredCount`, `totalScore` from `src/lib/score.ts`; everything from `./saveState` and `./draftCache`; `Profile` from `src/auth/useProfile.ts`; `Database` from `src/types/database.ts`.
- Produces: `CheckinRow` type and `useCheckin(clientId: number, period: string, profile: Profile): UseCheckin`, whose shape is written out in step 1 below and is what Task 6 renders from.

There is no unit test for this hook either, for the same reason as Task 4: no DOM environment, and no HTTP fake to drive `supabase` against. **Every decision in it that could be tested has already been extracted** into `saveState.ts` and `draftCache.ts`, which are. If while writing this you find a branch here that a reviewer could not check by reading, that is a signal the branch belongs in one of those two files — move it and say so.

- [ ] **Step 1: Write `src/checkin/useCheckin.ts`**

```ts
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import { previousPeriod } from '../lib/month'
import { PILLARS, scoredCount, totalScore } from '../lib/score'
import type { Pillar } from '../lib/score'
import type { Profile } from '../auth/useProfile'
import type { Database } from '../types/database'
import { INITIAL_SAVE_STATE, saveReducer } from './saveState'
import type { SaveState } from './saveState'
import {
  EMPTY_DRAFT,
  clearDraft,
  draftsDiffer,
  isDraftEmpty,
  readDraft,
  writeDraft,
} from './draftCache'
import type { Draft, PillarScores } from './draftCache'

export type CheckinRow = Database['public']['Tables']['checkins']['Row']

export type UseCheckin = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  stored: CheckinRow | null
  lastMonth: CheckinRow | null
  lastPeriod: string
  draft: Draft
  saveState: SaveState
  scored: number
  localTotal: number | null
  hasContent: boolean
  storedSubmitted: boolean
  storedByYou: boolean
  draftPersisted: boolean
  unsavedFromEarlierVisit: boolean
  setPillar: (pillar: Pillar, value: number | null) => void
  setNotes: (notes: string) => void
  reload: () => void
  submit: () => void
}

// The form's shape, from a stored row. Kept here rather than in draftCache
// because it is the only place a database row and a local draft meet.
function draftFromRow(row: CheckinRow | null): Draft {
  if (!row) return EMPTY_DRAFT
  const pillars: PillarScores = {}
  for (const pillar of PILLARS) {
    const value = row[pillar]
    if (value !== null) pillars[pillar] = value
  }
  return { pillars, notes: row.notes ?? '' }
}

export function useCheckin(
  clientId: number,
  period: string,
  profile: Profile,
): UseCheckin {
  const lastPeriod = previousPeriod(period)

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [stored, setStored] = useState<CheckinRow | null>(null)
  const [lastMonth, setLastMonth] = useState<CheckinRow | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [draftPersisted, setDraftPersisted] = useState(true)
  const [unsavedFromEarlierVisit, setUnsavedFromEarlierVisit] = useState(false)
  const [saveState, dispatch] = useReducer(saveReducer, INITIAL_SAVE_STATE)

  // Read inside submit() to refuse a second concurrent write. The reducer
  // cannot do this: a state update is not visible until the next render, so two
  // presses in the same tick would both see `clean` and both send a request.
  // The button is disabled during a save, which stops the ordinary case; this
  // stops the ordinary case's edges.
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    setStatus('loading')
    // One query for both months. §5.2: fewer round trips and one failure mode
    // rather than three. `.in` rather than two `.eq` calls, so a partial
    // failure -- this month readable, last month not -- is not a state this
    // screen has to have an answer for.
    try {
      const { data, error } = await supabase
        .from('checkins')
        .select('*')
        .eq('client_id', clientId)
        .in('period', [lastPeriod, period])

      if (error) {
        // describeError, not error.message: an empty message is falsy, and the
        // `loadError &&` guard on the screen would miss it and render a form
        // over a failed read. See src/lib/errorText.ts.
        setLoadError(describeError(error))
        setStatus('error')
        return
      }

      const thisMonth = data.find((row) => row.period === period) ?? null
      const previous = data.find((row) => row.period === lastPeriod) ?? null

      // Never write after a failed read: everything below runs only because
      // both of the above succeeded.
      setLoadError(null)
      setStored(thisMonth)
      setLastMonth(previous)

      // §5.5: if a saved row and a local draft disagree, the draft wins and the
      // screen says it has not been saved. The stored row is the fallback, not
      // the default -- somebody typed the draft, and nobody typed the fallback.
      const fromStorage = readDraft(clientId, period)
      const fromDatabase = draftFromRow(thisMonth)
      const differs = fromStorage !== null && draftsDiffer(fromStorage, fromDatabase)
      setDraft(differs && fromStorage ? fromStorage : fromDatabase)
      setUnsavedFromEarlierVisit(differs)

      setStatus('ready')
      // Resets the save state to clean, which is true: the form now matches
      // either the database or a draft the person has not been shown yet.
      dispatch({ type: 'loaded' })
    } catch (thrown) {
      // postgrest-js resolves most failures into `error` rather than rejecting,
      // so this is defensive -- and it is here because the failure it guards is
      // invisible. An unobserved rejection leaves `status` on 'loading' for
      // good, and the person sees a spinner with no message and no retry.
      setLoadError(describeError(thrown))
      setStatus('error')
    }
  }, [clientId, period, lastPeriod])

  useEffect(() => {
    void load()
  }, [load])

  // One place that both updates the form and persists it, so no edit path can
  // forget the second half. §5.5: every click and keystroke is written.
  const applyEdit = useCallback(
    (next: Draft) => {
      setDraft(next)
      setDraftPersisted(writeDraft(clientId, period, next))
      dispatch({ type: 'edited' })
      // Once the person has edited, "unsaved changes from an earlier visit" is
      // no longer the interesting fact -- "unsaved changes" is, and the save
      // state carries that. Leaving it up would keep pointing at a visit that
      // is no longer the reason anything is unsaved.
      setUnsavedFromEarlierVisit(false)
    },
    [clientId, period],
  )

  const setPillar = useCallback(
    (pillar: Pillar, value: number | null) => {
      const pillars: PillarScores = { ...draft.pillars }
      // Deleted, not set to null. An unscored pillar is an absent key
      // everywhere else in this code -- draftCache validates on that basis, and
      // scoredCount counts on it.
      if (value === null) delete pillars[pillar]
      else pillars[pillar] = value
      applyEdit({ ...draft, pillars })
    },
    [draft, applyEdit],
  )

  const setNotes = useCallback(
    (notes: string) => applyEdit({ ...draft, notes }),
    [draft, applyEdit],
  )

  const scored = scoredCount(draft.pillars)
  const localTotal = totalScore(draft.pillars)
  const hasContent = !isDraftEmpty(draft)
  const storedSubmitted = stored?.submitted_at != null
  const storedByYou = stored?.submitted_by === profile.id

  const submit = useCallback(() => {
    if (inFlight.current) return
    inFlight.current = true
    dispatch({ type: 'submitted' })

    void (async () => {
      const complete = scoredCount(draft.pillars) === PILLARS.length
      const now = new Date().toISOString()

      // Every pillar column is sent, including the unscored ones as null.
      // Sending only the scored ones would leave a cleared pillar at its old
      // value in the database, so the form and the row would disagree with no
      // sign of it anywhere -- and the total is generated from those columns,
      // so the number on the board would be the one nobody chose.
      const pillars = Object.fromEntries(
        PILLARS.map((pillar) => [pillar, draft.pillars[pillar] ?? null]),
      ) as Record<Pillar, number | null>

      try {
        const { data, error } = await supabase
          .from('checkins')
          .upsert(
            {
              client_id: clientId,
              period,
              ...pillars,
              notes: draft.notes.trim() === '' ? null : draft.notes,
              // Set on a complete five and explicitly cleared otherwise. The
              // board counts submissions as `submitted_at is not null`, so a
              // check-in edited back down to four pillars has to stop counting
              // -- leaving the old timestamp would report a submission that no
              // longer exists.
              submitted_at: complete ? now : null,
              submitted_by: complete ? profile.id : null,
            },
            { onConflict: 'client_id,period' },
          )
          // .select().single() rather than a second read: the row that comes
          // back carries total_score straight from the generated column, which
          // is what §5.3 asks the screen to display after a save, and
          // updated_at, which is the time the confirmation names. One round
          // trip, and no window in which the screen shows a total the database
          // does not hold.
          .select()
          .single()

        if (error) {
          dispatch({ type: 'failed', error: describeError(error) })
          return
        }

        setStored(data)
        // Cleared only now, on a confirmed save. §5.5.
        clearDraft(clientId, period)
        setUnsavedFromEarlierVisit(false)
        setDraftPersisted(true)
        dispatch({
          type: 'succeeded',
          at: data.updated_at,
          by: 'you',
          complete,
        })
      } catch (thrown) {
        dispatch({ type: 'failed', error: describeError(thrown) })
      } finally {
        // finally, not a line after the await: if this ever rejects past the
        // catch, a latched ref would refuse every future press for the life of
        // the screen and nothing would say why.
        inFlight.current = false
      }
    })()
  }, [clientId, period, draft, profile.id])

  return {
    status,
    loadError,
    stored,
    lastMonth,
    lastPeriod,
    draft,
    saveState,
    scored,
    localTotal,
    hasContent,
    storedSubmitted,
    storedByYou,
    draftPersisted,
    unsavedFromEarlierVisit,
    setPillar,
    setNotes,
    reload: () => void load(),
    submit,
  }
}
```

One thing to check while writing this, and to state the answer to in the report: **the post-save path must not dispatch `loaded`.** `loaded` returns the state to `clean`, which would erase the confirmation the person just earned in the same tick they earned it. The code above updates `stored` directly and dispatches `succeeded`. If you find yourself calling `load()` after a save, that is the bug.

- [ ] **Step 2: Verify the gates**

```bash
npm run build && npm test && npm run lint
```

Expected: PASS. `tsc` is the real gate here — in particular it should confirm that the upsert payload matches `TablesInsert<'checkins'>` and that `data` is a `CheckinRow` rather than an array.

- [ ] **Step 3: Commit**

```bash
git add src/checkin/useCheckin.ts
git commit -m "feat(checkin): one read, the form state, and one write that reports itself"
```

---

### Task 6: The check-in screen

**Files:**
- Create: `src/checkin/CheckIn.tsx`
- Create: `src/checkin/CheckIn.module.css`

**Interfaces:**
- Consumes: `useCheckin` from `./useCheckin`; `PillarRow` from `./PillarRow`; `submitLabel`, `submitBlock`, `displayedTotal` from `./saveState`; `PILLARS`, `MAX_TOTAL`, `bandFor`, `BAND_LABELS` from `src/lib/score.ts`; `bandClassName` from `src/styles/bandClass.ts`; `formatPeriod`, `formatSavedAt` from `src/lib/month.ts`; `Profile` from `src/auth/useProfile.ts`.
- Produces: `CheckIn` with props `{ client: { id: number; name: string }; period: string; profile: Profile; onBack: () => void }`.

No unit test, same reason as Tasks 4 and 5. This screen is the one the owner looks at, and the visual checklist at the end of this plan is its real gate.

- [ ] **Step 1: Write `src/checkin/CheckIn.tsx`**

```tsx
import { PILLARS, BAND_LABELS, MAX_TOTAL, bandFor } from '../lib/score'
import { formatPeriod, formatSavedAt } from '../lib/month'
import { bandClassName } from '../styles/bandClass'
import type { Profile } from '../auth/useProfile'
import { useCheckin } from './useCheckin'
import { PillarRow } from './PillarRow'
import { displayedTotal, submitBlock, submitLabel } from './saveState'
import styles from './CheckIn.module.css'

type Props = {
  client: { id: number; name: string }
  period: string
  profile: Profile
  onBack: () => void
}

export function CheckIn({ client, period, profile, onBack }: Props) {
  const checkin = useCheckin(client.id, period, profile)
  const {
    status,
    loadError,
    stored,
    lastMonth,
    lastPeriod,
    draft,
    saveState,
    scored,
    localTotal,
    hasContent,
    storedSubmitted,
    storedByYou,
    draftPersisted,
    unsavedFromEarlierVisit,
  } = checkin

  const readFailed = status === 'error'
  const label = submitLabel(scored)
  const block = submitBlock({
    state: saveState,
    readFailed,
    hasContent,
    storedSubmitted,
  })
  const total = displayedTotal({
    state: saveState,
    localTotal,
    storedTotal: stored?.total_score ?? null,
  })
  const saving = saveState.kind === 'saving'

  const back = (
    <nav className={styles.nav}>
      <button className="button button--quiet" type="button" onClick={onBack}>
        Board
      </button>
    </nav>
  )

  const masthead = (
    <div className="masthead">
      <p className="t-eyebrow">{client.name}</p>
      <h2 className="t-header">{formatPeriod(period)}</h2>
    </div>
  )

  // A failed read gets the whole screen. Rendering the form underneath an error
  // would put an empty set of controls in front of somebody whose real scores
  // are simply unread -- and the one thing they might then do is press save.
  if (readFailed) {
    return (
      <section className={styles.screen}>
        {back}
        {masthead}
        <h3 className="t-header">Cannot reach the database</h3>
        <p className="alert prose" role="alert">
          {loadError}
        </p>
        <p className="t-body prose">
          Nothing has been changed. This client&rsquo;s scores are still there; they just
          could not be read.
        </p>
        <button className="button" type="button" onClick={checkin.reload}>
          Try again
        </button>
      </section>
    )
  }

  if (status === 'loading') {
    return (
      <section className={styles.screen}>
        {back}
        {masthead}
        <p className="t-body">Loading…</p>
      </section>
    )
  }

  return (
    <section className={styles.screen}>
      {back}
      {masthead}

      <div className={styles.totals}>
        <div className={styles.total}>
          <p className="t-label">This month</p>
          <p className={styles.totalLine}>
            {/* An incomplete check-in shows an em dash, never a number. Parent
                spec §6.2: incomplete must not read as "at risk". The words
                beside it are what a screen reader gets, since an em dash on its
                own announces as nothing. */}
            <span className={`t-display ${styles.totalValue} numeric`}>
              {total === null ? '—' : total}
            </span>
            <span className="t-caption">
              {total === null ? `not scored · ${scored} of ${PILLARS.length} pillars` : `of ${MAX_TOTAL}`}
            </span>
          </p>
          <span className={bandClassName(bandFor(total))}>{BAND_LABELS[bandFor(total)]}</span>
        </div>

        {/* §5.2: last month alongside, because a score compared is a judgment
            and a score alone is a guess. */}
        <div className={styles.total}>
          <p className="t-label">{formatPeriod(lastPeriod)}</p>
          <p className={styles.totalLine}>
            <span className={`t-display ${styles.totalValue} numeric`}>
              {lastMonth?.total_score == null ? '—' : lastMonth.total_score}
            </span>
            <span className="t-caption">
              {lastMonth?.total_score == null ? 'not scored' : `of ${MAX_TOTAL}`}
            </span>
          </p>
          <span className={bandClassName(bandFor(lastMonth?.total_score ?? null))}>
            {BAND_LABELS[bandFor(lastMonth?.total_score ?? null)]}
          </span>
        </div>
      </div>

      {unsavedFromEarlierVisit && (
        <p className="alert prose" role="status">
          These scores are from an earlier visit on this device and have not been saved.
          Press {label} to keep them.
        </p>
      )}

      {!draftPersisted && (
        <p className="t-caption prose">
          This browser is not keeping a local copy, so anything you enter here is only
          safe once you press {label}.
        </p>
      )}

      <div className={styles.pillars}>
        {PILLARS.map((pillar) => (
          <PillarRow
            key={pillar}
            pillar={pillar}
            value={draft.pillars[pillar]}
            lastValue={lastMonth?.[pillar] ?? null}
            disabled={saving}
            onChange={(value) => checkin.setPillar(pillar, value)}
            onClear={() => checkin.setPillar(pillar, null)}
          />
        ))}
      </div>

      <div className={styles.notesBlock}>
        <label className="t-label" htmlFor="checkin-notes">
          Notes
        </label>
        <textarea
          className={`field ${styles.notes}`}
          id="checkin-notes"
          rows={4}
          value={draft.notes}
          disabled={saving}
          onChange={(event) => checkin.setNotes(event.target.value)}
        />
      </div>

      <div className={styles.saveBar}>
        <button
          className="button"
          type="button"
          disabled={block.blocked}
          aria-describedby="checkin-save-status"
          onClick={checkin.submit}
        >
          {label}
        </button>

        {/* role="status" so the confirmation is announced rather than only
            drawn. This line is the whole point of the slice: the board gave no
            feedback that a save succeeded, so a save that worked looked exactly
            like one that failed. */}
        <p className={styles.saveStatus} id="checkin-save-status" role="status">
          {saveState.kind === 'saved' && (
            <span className="t-body">
              {saveState.complete ? 'Check-in submitted' : 'Draft saved'}{' '}
              {formatSavedAt(saveState.at)} by {saveState.by}.
              {!saveState.complete && ` ${scored} of ${PILLARS.length} pillars scored.`}
            </span>
          )}

          {saveState.kind === 'failed' && (
            <span className="alert">
              Could not save: {saveState.error}. Nothing was lost — everything you entered
              is still on screen, and pressing {label} again costs nothing.
            </span>
          )}

          {saveState.kind === 'saving' && <span className="t-caption">Saving…</span>}

          {saveState.kind === 'dirty' && (
            <span className="t-caption">Unsaved changes.</span>
          )}

          {/* A disabled control that does not say why is the same failure as a
              silent save, in a smaller box. */}
          {saveState.kind === 'clean' && block.blocked && (
            <span className="t-caption">{block.reason}</span>
          )}

          {saveState.kind === 'clean' && !block.blocked && storedSubmitted && (
            <span className="t-caption">
              Submitted {formatSavedAt(stored?.submitted_at ?? '')}.
            </span>
          )}
        </p>
      </div>

      {/* Outside the status region: it describes what is stored, not what just
          happened, and re-announcing it on every keystroke would be noise. */}
      {storedSubmitted && stored?.submitted_at && (
        <p className="t-caption">
          Last submitted {formatSavedAt(stored.submitted_at)} by{' '}
          {storedByYou ? 'you' : 'another account manager'}.
        </p>
      )}
    </section>
  )
}
```

Two notes on this file, both of which a reviewer should check rather than take on trust:

- The `clean` + `storedSubmitted` combination appears twice in the status region, once via `block.blocked` and once not. Read `submitBlock` and confirm which of the two can actually render — `clean` with `storedSubmitted` is always blocked, so the second branch is unreachable. **If it is unreachable, delete it** rather than leaving dead JSX, and put the "Submitted …" sentence in the block-reason path or in the standalone line at the bottom. Do not leave both.
- `stored?.submitted_at ?? ''` passes an empty string to `formatSavedAt`, which returns it unchanged, so that branch would print "Submitted ." — another reason the branch above should go.

- [ ] **Step 2: Write `src/checkin/CheckIn.module.css`**

```css
/* The check-in screen: two totals, five pillar rows, notes, and one control
   that says what it will do and then says what it did. */

.screen {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  max-width: var(--measure-column);
}

.nav {
  display: flex;
}

.totals {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-5);
  padding: var(--space-4);
  border: 1px solid var(--rule-hairline);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

.total {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.totalLine {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

/* One step below the display size, and set flush: a single line of digits does
   not need the role's leading. */
.totalValue {
  font-size: var(--step-3);
  line-height: var(--leading-numeric);
}

.pillars {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.notesBlock {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.notes {
  resize: vertical;
  line-height: var(--leading-body);
}

/* The control and its status on one line where there is room, stacked where
   there is not -- the status must never be pushed off screen, because it is the
   confirmation. */
.saveBar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--rule-hairline);
}

/* A minimum so the line does not jump the button around as the message
   changes length, and a measure so a long failure message stays readable. */
.saveStatus {
  flex: 1 1 var(--measure-column);
  min-width: 0;
  max-width: var(--measure-prose);
}
```

`.screen` uses `--measure-column` (30rem), which is narrower than the check-in screen wants — the pillar rows carry three anchor sentences each. Before committing, look at it and choose: either widen with `max-width: var(--measure-prose)` (62ch), or add a token. **If you add a token it goes in `tokens.css` and nowhere else.** Say which you chose and why.

- [ ] **Step 3: Verify the gates**

```bash
npm run build && npm test && npm run lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/checkin/CheckIn.tsx src/checkin/CheckIn.module.css
git commit -m "feat(checkin): the check-in screen, with a confirmation that names the time"
```

---

### Task 7: The board opens it

**Files:**
- Modify: `src/board/Board.tsx`
- Modify: `src/board/Board.module.css`

**Interfaces:**
- Consumes: `CheckIn` from `src/checkin/CheckIn.tsx`.
- Produces: nothing new for later tasks.

Scope discipline: this task adds navigation and **nothing else**. `Score all 3s` stays — spec §3 puts its deletion in step 4, and the owner's confirmed "nothing visibly happened" baseline is what step 4 will be measured against. The card footer, the per-pillar bars and the progress line are all step 4.

- [ ] **Step 1: Add the selection state and the branch**

In `src/board/Board.tsx`, add to the imports:

```ts
import { CheckIn } from '../checkin/CheckIn'
```

Add beside the existing state:

```ts
// §5.1: state-based navigation, in the board container. No router, therefore no
// URL change, therefore a refresh returns here. A linkable check-in URL needs
// the GitHub Pages 404.html redirect trick, which is not worth buying until
// somebody wants to send a colleague a link to one check-in.
const [selected, setSelected] = useState<ClientRow | null>(null)
```

Insert this immediately before the `if (loadError)` block, so the check-in screen owns its own read and error states rather than inheriting the board's:

```tsx
if (selected) {
  return (
    <CheckIn
      client={selected}
      period={period}
      profile={profile}
      onBack={() => {
        setSelected(null)
        // Re-read on the way back, so a check-in that was just saved shows its
        // new total on the card. Without this the board would show the number
        // it read before the save, which is the same picture as a save that
        // did nothing -- the exact defect this slice exists to fix, moved one
        // screen along.
        void load()
      }}
    />
  )
}
```

Replace the `<h3>` inside `.cardHead` with:

```tsx
<h3 className="t-body">
  <button
    className={styles.cardOpen}
    type="button"
    onClick={() => setSelected(client)}
  >
    {client.name}
  </button>
</h3>
```

- [ ] **Step 2: Add the card overlay to `src/board/Board.module.css`**

Add `position: relative;` to the existing `.card` rule, and append:

```css
/* The whole card is the click target, and it is one real button rather than a
   handler on the <li>: one thing in the tab order, one thing announced, and
   Enter and Space work without a keydown handler. The overlay below is what
   widens the hit area from the client name to the card; the button itself stays
   in normal flow, so nothing above it moves. */
.cardOpen {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  text-align: start;
  cursor: pointer;
  /* Buttons do not inherit type, so the body role is named here rather than
     relying on the .t-body class on the <h3> around it. Face and width
     together, as everywhere. */
  font-family: var(--face-body);
  font-stretch: var(--wdth-body);
  font-weight: var(--wght-body);
  font-size: var(--step-0);
}

.cardOpen::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--radius-md);
}

.card:hover {
  border-color: var(--text-secondary);
}

/* The ring is moved to the overlay because the overlay is the click target: a
   ring around the client name would point at a few characters when the whole
   card is what responds. Removing the outline from the button is only safe
   because the rule below replaces it -- do not delete one without the other. */
.cardOpen:focus-visible {
  outline: none;
}

.cardOpen:focus-visible::after {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

/* Score all 3s has to stay clickable through the overlay. Positioned elements
   paint in document order, and .cardFoot comes after .cardHead, so this is
   enough -- no z-index needed. Deleted with the button in step 4. */
.cardFoot {
  position: relative;
}
```

`.cardFoot` already exists in this file. Add `position: relative;` to the existing rule rather than writing a second one.

- [ ] **Step 3: Verify the gates, then check the overlay by hand**

```bash
npm run build && npm test && npm run lint
```

Then run `npm run dev` and confirm three things by clicking, reporting each result:

1. Clicking anywhere on a card that is not the `Score all 3s` button opens the check-in screen.
2. Clicking `Score all 3s` does **not** open the check-in screen.
3. Tab reaches the card once, the ring is drawn around the whole card, and Enter opens it.

If (2) fails, the fix is `z-index` on `.cardFoot`, not removing the overlay. Report which was needed.

- [ ] **Step 4: Commit**

```bash
git add src/board/Board.tsx src/board/Board.module.css
git commit -m "feat(board): the card opens its check-in"
```

---

### Task 8: Prove the local total and the database column agree

**Files:**
- Create: `scripts/score-parity.mjs`
- Create: `scripts/activate-staging-profile.sql`
- Create: `tests/generatedColumn.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-21-phase-1-slice-1-design.md`

**Interfaces:** none consumed by later tasks.

This closes the deferred Slice 0 finding named in §5.3. Two halves, and the difference between them matters:

- `tests/generatedColumn.test.ts` runs in `npm test` with no database. It pins the migration's expression **as text**. It catches drift; it does not prove Postgres and JavaScript agree.
- `npm run verify:score` needs staging. It reads the **live** expression out of the catalogue and evaluates it against all 7,776 combinations. That is the parity proof.

Do not describe the first as proving parity. It does not.

- [ ] **Step 1: Write the failing text guard**

Create `tests/generatedColumn.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// What this test does and does not do, stated because it would be easy to
// mistake for more than it is. It pins the text of the generated column's
// expression, so an edit to the migration has to change this line too and
// think about it. It does NOT prove that Postgres evaluates that expression
// the same way score.ts does -- nothing without a database can. That is
// `npm run verify:score`, which reads the live expression out of the
// catalogue and checks all 7,776 combinations against totalScore().
const MIGRATION = 'supabase/migrations/20260821021840_create_clients_and_checkins.sql'

const EXPECTED = `total_score smallint generated always as (
    (relationship + delivery + financial + sentiment + growth)::smallint
  ) stored,`

describe('the total_score generated column', () => {
  it('still has the expression the parity check was written against', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    expect(sql).toContain(EXPECTED)
  })
})
```

- [ ] **Step 2: Run to verify it passes, then prove it can fail**

Run: `npx vitest run tests/generatedColumn.test.ts`
Expected: PASS.

Then change one operator in the migration to `-`, run again, confirm red, and restore it. Report the red output. **Do not leave the migration modified** — `git diff supabase/` must be empty before you commit.

- [ ] **Step 3: Write the parity script**

Create `scripts/score-parity.mjs`. It imports the real `totalScore` from the TypeScript source — Node 24.19 strips types on import, so there is no second copy of the arithmetic to drift.

```js
// Generates the SQL that proves score.ts and the total_score generated column
// agree. Slice 1 spec §5.3.
//
// The expected totals come from the real totalScore(), imported straight from
// the TypeScript source -- Node strips the types on import, so there is no
// second copy of the arithmetic here to drift out of step with the first.
//
// The SQL side does not hard-code the expression either: it reads the live one
// out of pg_attrdef and evaluates it with dynamic SQL. So this checks what is
// deployed, not a copy of what was intended. Nothing is inserted and no
// sequence advances -- the expression is evaluated over a VALUES list.
import { writeFileSync } from 'node:fs'

const { PILLARS, MAX_PILLAR_SCORE, totalScore } = await import('../src/lib/score.ts')

const OUT = 'scripts/.score-parity.generated.sql'
const CHUNK = 1000

// null as well as 1..5, because null propagation is the rule under test:
// "incomplete has no score" is enforced by the database through `+` returning
// null, and by totalScore() through an early return. Those are two different
// mechanisms reaching the same answer, which is exactly the kind of agreement
// worth checking rather than assuming.
const VALUES = [null, ...Array.from({ length: MAX_PILLAR_SCORE }, (_, i) => i + 1)]

function* combinations(depth = 0, partial = {}) {
  if (depth === PILLARS.length) {
    yield { ...partial }
    return
  }
  for (const value of VALUES) {
    yield* combinations(depth + 1, { ...partial, [PILLARS[depth]]: value })
  }
}

const rows = []
for (const combination of combinations()) {
  const cells = PILLARS.map((pillar) =>
    combination[pillar] === null ? 'null::smallint' : `${combination[pillar]}::smallint`,
  )
  const expected = totalScore(combination)
  cells.push(expected === null ? 'null::smallint' : `${expected}::smallint`)
  rows.push(`(${cells.join(',')})`)
}

const columns = [...PILLARS, 'expected'].join(', ')

const chunks = []
for (let start = 0; start < rows.length; start += CHUNK) {
  chunks.push(rows.slice(start, start + CHUNK))
}

const body = chunks
  .map(
    (chunk, index) => `
do $$
declare
  expression text;
  mismatches bigint;
begin
  -- The live expression, not a copy of it. If somebody alters the column, this
  -- picks up the alteration rather than checking yesterday's definition.
  select pg_get_expr(d.adbin, d.adrelid)
    into strict expression
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.checkins'::regclass
     and a.attname = 'total_score';

  execute format($fmt$
    select count(*) from (values %s) as v(${columns})
     where (%s) is distinct from expected
  $fmt$, $values$${chunk.join(',')}$values$, expression)
    into mismatches;

  if mismatches <> 0 then
    raise exception
      'score parity FAILED in chunk ${index + 1}: % of ${chunk.length} combinations disagree between score.ts and total_score',
      mismatches;
  end if;

  raise notice 'chunk ${index + 1}: ${chunk.length} combinations agree';
end $$;`,
  )
  .join('\n')

writeFileSync(
  OUT,
  `-- GENERATED by scripts/score-parity.mjs. Do not edit, and do not commit.
-- ${rows.length} pillar combinations, in ${chunks.length} chunks.
-- Every chunk raises an exception on the first disagreement, so a green run
-- means every combination agreed -- not that the file was empty.
${body}

do $$
begin
  raise notice 'score parity PASSED: all ${rows.length} combinations agree';
end $$;
`,
)

console.log(`wrote ${OUT}: ${rows.length} combinations in ${chunks.length} chunks`)
```

- [ ] **Step 4: Wire it up**

`package.json`, in `scripts`:

```json
"verify:score": "node scripts/score-parity.mjs && npm run db:which && npx --yes supabase@latest db query --linked -f scripts/.score-parity.generated.sql"
```

The order is deliberate: generate first, so a stale file from an earlier `score.ts` can never be the thing that passes; then `db:which`, so the query cannot reach production.

`.gitignore`, appended:

```
# Generated by scripts/score-parity.mjs on every `npm run verify:score`.
scripts/.score-parity.generated.sql
```

- [ ] **Step 5: Run the generator, and check the SQL by reading it**

```bash
node scripts/score-parity.mjs
head -40 scripts/.score-parity.generated.sql
grep -c 'do \$\$' scripts/.score-parity.generated.sql
```

Expected: `wrote scripts/.score-parity.generated.sql: 7776 combinations in 8 chunks`, and 9 `do $$` blocks (eight chunks plus the closing notice).

**Do not run `npm run verify:score` yourself** — it is a database command, and the standing rule is that agents do not run those. Confirm `npm run db:which` prints `tgc-client-health-staging` and leave the run to the owner. If the generated SQL turns out to be malformed when they run it, that is a fix round, not a failure of this task.

- [ ] **Step 6: The staging activation, written down once**

Create `scripts/activate-staging-profile.sql`:

```sql
-- Promotes the profile that staging's sign-in trigger created, so staging has
-- an active user and its policies are actually exercised. Staging had none
-- through all of step 2, which meant every policy on it was untested.
--
-- Run:
--   npm run db:which                     -- must print tgc-client-health-staging
--   npx --yes supabase@latest db query --linked -f scripts/activate-staging-profile.sql
--
-- The profile row only exists after a real sign-in at http://localhost:5173,
-- because profiles.id is a foreign key to auth.users(id). Supabase's built-in
-- email is capped at 2 messages an hour, so a mistyped address costs half an
-- hour.
update public.profiles
   set role = 'admin', is_active = true
 where email = 'josh@thegroundedco.com';
```

- [ ] **Step 7: Document both, and record the policy blocker**

In `README.md`, under the section that documents `verify:privileges`, add:

```markdown
### `npm run verify:score`

Proves the total on screen and the total in the database are the same number.
Generates every one of the 7,776 pillar combinations (1–5 and unscored, five
pillars), computes each expected total with the real `totalScore()` from
`src/lib/score.ts`, then reads the **live** `total_score` expression out of
Postgres's catalogue and evaluates it against all of them. Any disagreement
raises an exception naming the chunk.

Nothing is inserted and no sequence advances: the expression is evaluated over
a `VALUES` list, not over rows in a table.

`tests/generatedColumn.test.ts` is the cheap half of this and runs in
`npm test`. It pins the migration's expression as text, so drift is caught in
CI — it does **not** prove Postgres and JavaScript agree. Only the command
above does that, and only against a database.
```

And a short note on activating staging, pointing at `scripts/activate-staging-profile.sql`.

In `docs/superpowers/specs/2026-08-21-phase-1-slice-1-design.md`, append to §10:

```markdown
7. **§6's card footer cannot name who submitted a check-in, because of a policy
   we chose deliberately.** `profiles_select_own` restricts `profiles` SELECT to
   `(select auth.uid()) = id`, so embedding the author's email on a check-in
   somebody else submitted returns null — measured against the migration
   2026-08-21, not observed on a running query. Step 3's check-in screen works
   around it by saying "by you" or "by another account manager", which is honest
   but is not what §6 specifies for the board.

   Fix, when step 4 needs it: a second select policy letting any active user
   read every profile's `email` and `full_name`. That is a real widening — it
   makes the staff list readable by every active account manager — so it belongs
   with Slice 2's permissions work rather than being slipped in as a step 4
   detail. Until then the board footer names a time and not a person.
```

- [ ] **Step 8: Verify the gates and commit**

```bash
npm run build && npm test && npm run lint
git status --short   # scripts/.score-parity.generated.sql must NOT appear
git diff supabase/   # must be empty
git add scripts/score-parity.mjs scripts/activate-staging-profile.sql tests/generatedColumn.test.ts package.json .gitignore README.md docs/
git commit -m "test(score): prove score.ts and the total_score column agree, and record the policy blocker"
```

---

## The owner's visual pass

Nothing in this plan can see a screen. Step 2's most expensive lesson was that every automated gate was green while the band chip stretched across the whole card and read as a banner — the class resolved, the tokens resolved, the contrast passed, the label was present, and the shape was wrong. This list is the real gate, ordered cheapest-falsification-first, and it goes in the workspace as `josh-visual-checklist.md`.

1. **A card opens its check-in.** Click anywhere on a card except `Score all 3s`. Does the check-in screen appear? Does `Score all 3s` still do its own thing without navigating?
2. **`Board` comes back.** And the board still shows its clients rather than a spinner or an error.
3. **The five rows read as rows.** Label, hint, five numbered controls, three anchor sentences. Is the anchor text readable, or is the column too narrow?
4. **Clicking a number selects it visibly.** Filled, not a 1px border change. Can you tell at a glance which of the five is chosen?
5. **The total moves as you click.** And it shows an em dash — not a 0 and not a blank — until all five are scored.
6. **The button's label changes at five.** `Save draft` at four, `Submit check-in` at five.
7. **`Clear` puts a pillar back to unscored,** the total returns to an em dash, and the label returns to `Save draft`.
8. **Press it. Does the screen say something?** This is the whole slice. It should name the time, and say whether that was a draft or a submission.
9. **Reload the page.** Does the check-in still hold what you entered, and does the screen still say when it was submitted? A confirmation that does not survive a reload is the toast this project deliberately did not build.
10. **Go back to the board.** Does the card show the new total?
11. **Type in the notes, then go back to the board without saving, then return.** Is what you typed still there, with the screen saying it has not been saved?
12. **Turn off the wifi and press save.** Does it say what went wrong, keep everything on screen, and say retrying is safe? Turn it back on and press again.
13. **Tab through the whole screen.** Does every stop draw a visible ring — including the number controls, whose real input is hidden?
14. **On your phone.** Any sideways scroll? Do the five number controls stay tappable?

---

## Self-review

**Spec coverage.** §5.1 navigation → Task 7. §5.2 one read with both periods → Task 5; last month alongside → Tasks 4 and 6. §5.3 local total that moves, database total after a save, em dash for incomplete, and the parity test → Tasks 2, 6 and 8. §5.4 draft versus submitted, one control whose label reflects its state, `submitted_at` set only on a complete five → Tasks 2, 5 and 6. §5.5 `localStorage` under the specified key, cleared only on a confirmed save, draft wins and says so → Tasks 3, 5 and 6. §5.6 the state machine as a pure reducer, `saved` naming time and person, `failed` keeping inputs, no unchanged transition, submit blocked after a failed read → Task 2, rendered in Task 6. §8's testing table → Tasks 1, 2, 3 and 8 for the Vitest row; the visual pass above for the two manual rows.

**Not covered, deliberately.** §5.6's "names the person" is degraded to "you" or "another account manager", for the policy reason in Deviation 2 and recorded in the spec's open items by Task 8. §6's board rewrite is step 4 and is out of scope; `Score all 3s` stays.

**Type consistency, checked across tasks.** `Draft`, `PillarScores` and `StorageLike` are declared once in Task 3 and imported by Task 5. `SaveState` and `SaveEvent` are declared once in Task 2 and imported by Tasks 5 and 6. `submitBlock` takes the same four fields in Task 2's tests, Task 2's implementation and Task 6's call. `scoredCount`, `MAX_TOTAL`, `SCORE_VALUES` and `MAX_PILLAR_SCORE` are added in Task 1 and used in Tasks 2, 3, 4, 5, 6 and 8. `PillarRow`'s six props in Task 4 match the six passed in Task 6. `CheckIn`'s four props in Task 6 match the four passed in Task 7.

**One conflict found and resolved in advance.** Task 6's status region has two branches for `clean` + `storedSubmitted`, and `submitBlock` makes one of them unreachable. Rather than quietly writing the correct version, Task 6 asks the implementer to trace it, delete the dead branch, and say which. Dead JSX that looks live is exactly the kind of thing that survives a review by being plausible.

**One risk this plan does not remove.** Tasks 4, 5 and 6 have no unit tests, because Vitest runs in a `node` environment here and there is no DOM. That is stated in each task rather than papered over, and it is why the visual checklist is written as a gate rather than as a suggestion. Adding a DOM test runner is a toolchain change worth considering before step 4 rewrites the board — but not in the middle of this step.
