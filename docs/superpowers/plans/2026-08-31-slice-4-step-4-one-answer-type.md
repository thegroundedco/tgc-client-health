# Slice 4 Step 4 — One Answer Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse every answer to a nullable `smallint` 1-5, give Finances and Advocacy a Yes/Unsure/No control, and let the scorer choose which month they are scoring.

**Architecture:** `Question.kind` stops selecting a scoring rule and selects only a control. Every bucket score becomes `meanOrNull` of its own questions; `yesNoScore` is deleted. The overall's question list stops being derived from how questions are rendered and becomes an explicit exclusion of one named bucket. One migration turns Advocacy's four booleans into smallints. The board gains a period in state, defaulting to last month.

**Tech Stack:** React 19 + TypeScript (`verbatimModuleSyntax`), Vite, CSS Modules, Vitest + Testing Library + jsdom, Supabase/Postgres 17.6.

**Spec:** `docs/superpowers/specs/2026-08-27-phase-2-slice-4-scoring-model-design.md` — read Amendment 3 (every block marked **2026-08-31 (step 4)**). §3.1, §3.2, §5.2, §5.3, §7, §9.1 and §10 decisions 6-8 are the binding text for this plan.

---

## Global Constraints

- **`npm run db:which` must print `tgc-client-health-staging` before ANY database write.** Never aim `db:push` at production. Production migrations are applied by the owner or by the controller through the SQL editor, never from a task.
- **`src/lib/scoreMath.ts` and `src/lib/buckets.ts` are LEAF modules with ZERO runtime imports.** `tests/leafModules.test.ts` guards exactly these two. Adding any import to either breaks `npm run verify:score`, and it will look like a Node bug. `gate.ts` and `scoreV2.ts` are NOT under this constraint.
- **`@testing-library/jest-dom` is NOT installed.** Use plain vitest matchers only: `toBe`, `toEqual`, `toContain`, `toHaveProperty`, `toBeNull`, `toHaveLength`, `toThrow`, `toBeTruthy`, `toBeUndefined`, and negations. `toBeInTheDocument` and friends do not exist here.
- **Scoped test runs use `npx vitest run <path>`.** `npm test -- --run <path>` matches nothing in this repo.
- **`verbatimModuleSyntax` is on:** type-only imports must use `import type`.
- **Never `git commit -a`.** Stage explicit paths. Run `git rev-parse --abbrev-ref HEAD` immediately before every commit and confirm it prints `slice-4-step-4-one-answer-type`.
- **The answer value mapping is Yes = 5, Unsure = 3, No = 1**, everywhere, with no exceptions and no second mapping defined anywhere else.
- **A missing answer must never read as a low score.** `null` and `undefined` mean unanswered and propagate to a null bucket score. `1` means answered No. Conflating them is the defect class this project has hit most often.
- The branch is `slice-4-step-4-one-answer-type`, cut from `main` at `11907f1`. **Never push** — GitHub Pages deploys on push to `main`, and the owner pushes.

---

## File Structure

| File | Responsibility after this change |
|---|---|
| `src/lib/buckets.ts` | LEAF. The rubric: 21 questions, six buckets, each question's `kind` (`scale` \| `choice`), the three `CHOICE_OPTIONS` and their values, and the explicit list of what the overall averages. |
| `src/lib/scoreMath.ts` | LEAF. `meanOrNull`, `meanTo2dp`, `bandFor`, the bands. `yesNoScore` is DELETED. |
| `src/lib/scoreV2.ts` | Rubric + arithmetic composed: `bucketScore` (now undispatched), `overallScore`, `requiredQuestions`, `answeredCount`. |
| `src/checkin/ChoiceRow.tsx` | NEW, replaces `YesNoRow.tsx`. Three labelled radios writing numbers. |
| `src/checkin/QuestionRow.tsx` | Unchanged behaviour; five numbered radios. |
| `src/checkin/CheckIn.tsx` | Dispatches row component on `kind`, renders the sticky legend, shows the period. |
| `src/checkin/useCheckin.ts` | Draft state and the upsert. Its `typeof` filter collapses to numbers only. |
| `src/checkin/draftCache.ts` | `localStorage` drafts, key version **v4**. |
| `src/board/Board.tsx` | Owns the one `period` in state and the month controls. |
| `src/board/cardSummary.ts` | Card footer and progress; its `typeof` filter collapses to numbers only. |
| `src/lib/month.ts` | Period arithmetic; gains `nextPeriod` and `isCurrentOrEarlier`. |
| `src/types/database.ts` | Hand-maintained Supabase row types; the four `adv_*` become `number \| null`. |
| `scripts/score-parity.mjs` | Exhaustive per-bucket sweep, now uniform over six values per question. |
| `supabase/migrations/*_advocacy_smallint.sql` | The one migration. |

**Deleted:** `src/checkin/YesNoRow.tsx`, `src/checkin/YesNoRow.module.css`, `src/checkin/YesNoRow.dom.test.tsx`, `yesNoScore` in `scoreMath.ts`, `isYesNo` and `YESNO_KEYS` in `buckets.ts`.

---

## A ruling to know before you start: the options run No, Unsure, Yes

`CHOICE_OPTIONS` is ordered **No, Unsure, Yes** — ascending by value, left to right, so every control on the check-in screen puts worse on the left and better on the right.

This REVERSES today's `YesNoRow`, which renders Yes then No. It is deliberate. A screen that mixes 14 rows reading 1→5 left-to-right with 7 rows reading best-to-worst invites exactly one error: clicking the leftmost box out of habit and recording the opposite of what you meant. The labels are words rather than bare numbers, so the transition costs a moment's attention once; the inconsistency would cost it every month forever.

**The owner has been told and may overrule.** If he does, flip the array literal in `buckets.ts` and update `ChoiceRow.dom.test.tsx`'s order assertion. Nothing else depends on the order.

---

## Task 1: The rubric and the arithmetic

The two leaves plus their composer. This task deliberately BREAKS THE BUILD for `src/checkin` and `src/board`, which still expect booleans — tasks 2 and 3 close it. Do not "fix" the consumers here.

**Files:**
- Modify: `src/lib/buckets.ts`
- Modify: `src/lib/scoreMath.ts`
- Modify: `src/lib/scoreV2.ts`
- Test: `src/lib/buckets.test.ts`, `src/lib/scoreMath.test.ts`, `src/lib/scoreV2.test.ts`
- Test: `tests/scoreParity.test.ts`, `tests/generatedColumn.test.ts` — **these two break the moment
  the rubric changes and must be fixed in this task.** `scoreParity.test.ts:79` asserts the sweep
  totals 3,321; `generatedColumn.test.ts` imports the deleted `yesNoScore` and branches on
  `kind === 'yesno'` in four separate tests. Neither is optional and neither can wait for Task 6.

**Interfaces:**
- Produces: `QuestionKind = 'scale' | 'choice'`; `CHOICE_OPTIONS: readonly { label: string; value: number }[]`; `OVERALL_EXCLUDED: Bucket`; `OVERALL_QUESTIONS` (17 keys); `Answers = Partial<Record<string, number | null>>`; `bucketScore(answers, bucket): number | null`.
- Removes: `isYesNo`, `YESNO_KEYS`, `yesNoScore`. Every caller of these is fixed in tasks 2 and 3.
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/buckets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  ALL_QUESTIONS,
  BUCKETS,
  BUCKET_DEFINITIONS,
  CHOICE_OPTIONS,
  OVERALL_EXCLUDED,
  OVERALL_QUESTIONS,
  questionsFor,
} from './buckets'

describe('one answer type', () => {
  it('offers exactly three choices, ascending, mapped to 1 / 3 / 5', () => {
    // The mapping IS the losslessness argument in spec §3.2: a four-question
    // bucket of 5s and 1s reproduces `1 + yeses` exactly. A different value
    // here silently rescales Advocacy's whole history.
    expect(CHOICE_OPTIONS.map((option) => option.value)).toEqual([1, 3, 5])
    expect(CHOICE_OPTIONS.map((option) => option.label)).toEqual(['No', 'Unsure', 'Yes'])
  })

  it('gives Finances and Advocacy the choice control and nothing else', () => {
    const choiceBuckets = BUCKETS.filter((bucket) =>
      questionsFor(bucket).some((question) => question.kind === 'choice'),
    )
    expect(choiceBuckets).toEqual(['finances', 'advocacy'])
  })

  it('never mixes kinds inside one bucket', () => {
    // score-parity.mjs no longer dispatches on kind, but CheckIn.tsx renders
    // per question, so a mixed bucket would render fine and read oddly. Pinned
    // because the rubric is the only place that could introduce one.
    for (const bucket of BUCKETS) {
      const kinds = new Set(questionsFor(bucket).map((question) => question.kind))
      expect(kinds.size).toBe(1)
    }
  })

  it('averages seventeen answers into the overall, excluding only Advocacy', () => {
    // The number that broke before. OVERALL_QUESTIONS used to be derived from
    // `kind === 'scale'`, so moving Finances to a choice control would have cut
    // the divisor to 14 with nothing failing. This is the guard.
    expect(OVERALL_QUESTIONS).toHaveLength(17)
    expect(ALL_QUESTIONS).toHaveLength(21)
    expect(OVERALL_EXCLUDED).toBe('advocacy')
    for (const question of questionsFor('finances')) {
      expect(OVERALL_QUESTIONS).toContain(question.key)
    }
    for (const question of questionsFor('advocacy')) {
      expect(OVERALL_QUESTIONS).not.toContain(question.key)
    }
  })

  it('keeps every question on one smallint scale', () => {
    // No question may declare a kind the scoring does not understand.
    for (const bucket of BUCKETS) {
      for (const question of questionsFor(bucket)) {
        expect(['scale', 'choice']).toContain(question.kind)
      }
    }
    expect(Object.keys(BUCKET_DEFINITIONS)).toHaveLength(6)
  })
})
```

Add to `src/lib/scoreV2.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CHOICE_OPTIONS, questionsFor } from './buckets'
import { bucketScore, overallScore, requiredQuestions } from './scoreV2'
import type { Answers } from './scoreV2'

const YES = 5
const UNSURE = 3
const NO = 1

function advocacy(yeses: number): Answers {
  const keys = questionsFor('advocacy').map((question) => question.key)
  const answers: Answers = {}
  keys.forEach((key, index) => {
    answers[key] = index < yeses ? YES : NO
  })
  return answers
}

describe('the mean replaces yesNoScore without changing a number', () => {
  // Spec §3.2's equivalence table, executed. If this drifts, every Advocacy bar
  // on the board silently rescales against twelve months of history.
  it.each([
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
  ])('scores %i yeses as %i, exactly as 1 + yeses did', (yeses, expected) => {
    expect(bucketScore(advocacy(yeses), 'advocacy')).toBe(expected)
  })

  it('gives a three-question choice bucket the full 1-5 range', () => {
    // The reason `1 + yeses` had to go: on three questions it caps at 4 and the
    // Finances bar could never fill.
    const keys = questionsFor('finances').map((question) => question.key)
    const all = (value: number): Answers =>
      Object.fromEntries(keys.map((key) => [key, value]))
    expect(bucketScore(all(NO), 'finances')).toBe(1)
    expect(bucketScore(all(YES), 'finances')).toBe(5)
    expect(bucketScore({ ...all(NO), [keys[0]]: YES }, 'finances')).toBe(2.33)
  })

  it('reads an Unsure as the middle, not as a No and not as unanswered', () => {
    const keys = questionsFor('finances').map((question) => question.key)
    const answers = Object.fromEntries(keys.map((key) => [key, UNSURE]))
    expect(bucketScore(answers, 'finances')).toBe(3)
  })

  it('still nulls a bucket when any of its answers is missing', () => {
    // The safety property, restated for a choice bucket: a No is 1 and scores;
    // a blank scores nothing at all.
    const keys = questionsFor('advocacy').map((question) => question.key)
    const answers: Answers = Object.fromEntries(keys.map((key) => [key, NO]))
    expect(bucketScore(answers, 'advocacy')).toBe(1)
    answers[keys[0]] = null
    expect(bucketScore(answers, 'advocacy')).toBeNull()
  })

  it('leaves Advocacy out of the overall in both gate states', () => {
    const answers: Answers = {}
    for (const key of requiredQuestions(true)) answers[key] = 3
    expect(overallScore(answers)).toBe(3)
    for (const question of questionsFor('advocacy')) {
      answers[question.key] = YES
    }
    // Four Yeses must not move the headline number by a hundredth.
    expect(overallScore(answers)).toBe(3)
  })

  it('counts 21 required answers gate-open and 17 gate-shut', () => {
    // required and the divisor are DIFFERENT numbers (spec §3.2). 21 != 17.
    expect(requiredQuestions(true)).toHaveLength(21)
    expect(requiredQuestions(false)).toHaveLength(17)
  })

  it('exports the choice values the control writes', () => {
    expect(CHOICE_OPTIONS.map((option) => option.value)).toEqual([NO, UNSURE, YES])
  })
})
```

In `src/lib/scoreMath.test.ts`, DELETE every `yesNoScore` describe block and its imports. Do not replace them — `bucketScore`'s tests above cover the behaviour that survives.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/buckets.test.ts src/lib/scoreV2.test.ts`
Expected: FAIL. `CHOICE_OPTIONS` and `OVERALL_EXCLUDED` are not exported; `bucketScore` on Advocacy returns null because the answers are numbers and `yesNoScore` rejects them.

- [ ] **Step 3: Change the rubric**

In `src/lib/buckets.ts`:

Replace the `QuestionKind` type and the `kind` comment on `Question`:

```ts
export type QuestionKind = 'scale' | 'choice'
```

```ts
  // Which CONTROL the check-in screen draws, and nothing more. Every answer,
  // whatever its kind, is a nullable smallint 1-5 in the same shape of column
  // and is scored by the same mean (spec §3.2, amended 2026-08-31). 'scale'
  // draws five numbered radios; 'choice' draws the three in CHOICE_OPTIONS.
  //
  // This USED to decide how a bucket was scored and, through a filter on it,
  // which questions the overall averaged. Both of those were wrong: the first
  // capped a three-question yes/no bucket at 4.00, and the second meant that
  // changing a question's control silently changed the headline divisor.
  kind: QuestionKind
```

Add below `BUCKET_DEFINITIONS`:

```ts
// The three answers a `choice` question offers, and the value each writes.
//
// Ascending, so that every control on the check-in screen runs worse-left to
// better-right -- the same direction as QuestionRow's 1 through 5. The old
// two-option row read Yes then No, against that direction; on a screen where 14
// rows run one way and 7 the other, the leftmost box is a trap.
//
// The values are the losslessness argument of spec §3.2, not a preference: a
// four-question bucket answered in 5s and 1s produces exactly what the retired
// `1 + yeses` produced, so no Advocacy score moves. Changing them rescales
// history.
export const CHOICE_OPTIONS = [
  { label: 'No', value: 1 },
  { label: 'Unsure', value: 3 },
  { label: 'Yes', value: 5 },
] as const

// The label a `choice` answer reads as, for the "last month" line. Undefined for
// a value no control can write -- a legacy 2 or 4 in a Finance column, which is
// real data (August 2026) and must not be rendered as though it were a choice.
export function choiceLabel(value: number): string | undefined {
  return CHOICE_OPTIONS.find((option) => option.value === value)?.label
}
```

Change the three Finances questions and the four Advocacy questions to `kind: 'choice'`. Leave every prompt exactly as written — the wording is the owner's.

DELETE `isYesNo` and `YESNO_KEYS` entirely.

Replace `OVERALL_QUESTIONS` with:

```ts
// The one bucket the headline number leaves out. Named apart from GATED_BUCKET
// even though both are Advocacy today, because they are two unrelated facts
// that coincide: the gate is about a client being too new to judge, and this is
// the owner's ruling that Advocacy must not move the number clients are
// compared on (spec §3.2). Deriving one from the other would mean that changing
// the gate silently changed the divisor.
export const OVERALL_EXCLUDED: Bucket = 'advocacy'

// The seventeen the overall is the mean of: every question except Advocacy's,
// whether the gate is open or shut. Unlike requiredQuestions() in scoreV2 this
// takes no gate argument and never varies.
//
// This filtered on `kind === 'scale'` until 2026-08-31, which gave the right
// answer for the wrong reason -- it excluded Advocacy BECAUSE Advocacy was
// answered with booleans. The moment Finances moved to the same control, that
// filter would have dropped Finances out of the headline score too: divisor 17
// to 14, every client's number moved, and nothing failing. buckets.test.ts pins
// the count at seventeen.
export const OVERALL_QUESTIONS: readonly string[] = BUCKETS.filter(
  (bucket) => bucket !== OVERALL_EXCLUDED,
).flatMap((bucket) => questionsFor(bucket).map((question) => question.key))
```

- [ ] **Step 4: Delete `yesNoScore`**

In `src/lib/scoreMath.ts`, delete the entire `yesNoScore` function and its comment block. Leave `meanTo2dp`'s comment about reachable divisors alone — its argument holds for any integer sum and is unaffected by the value set narrowing.

- [ ] **Step 5: Undispatch `bucketScore`**

In `src/lib/scoreV2.ts`:

```ts
import { BUCKETS, GATED_BUCKET, OVERALL_QUESTIONS, questionsFor, type Bucket } from './buckets'
import { meanOrNull } from './scoreMath'
```

```ts
export { OVERALL_QUESTIONS }
```

```ts
// A partial answer sheet. Every value is a number on the 1-5 scale; `null` and
// absence both mean unanswered. Partial because a draft is a check-in with
// questions still open, and because a draft restored from localStorage is
// arbitrary JSON -- every function here iterates the rubric rather than the
// object's own keys, so a stray key cannot be counted.
export type Answers = Partial<Record<string, number | null>>
```

```ts
// One mean, for every bucket. There is no dispatch on kind any more and that
// absence is the API doing its job: a `choice` bucket and a `scale` bucket are
// the same arithmetic over the same column type, and the only thing that ever
// differed was which control wrote the number.
export function bucketScore(answers: Answers, bucket: Bucket): number | null {
  return meanOrNull(
    questionsFor(bucket).map((question) => answers[question.key] as number | null | undefined),
  )
}
```

Leave `requiredQuestions`, `overallScore` and `answeredCount` alone — `answeredCount`'s `!== null && !== undefined` test is already correct for numbers, and its comment about a `false` being an answer needs one word changed: a **1** is an answer.

- [ ] **Step 6: Fix the two enumeration tests the rubric change breaks**

`scripts/score-parity.mjs` needs no edit yet and keeps working by accident: its `valuesFor` tests
`kind === 'yesno'`, which is now false everywhere, so every question already enumerates six values.
Task 6 removes that dead branch. What changes NOW is the arithmetic those tests assert.

In `tests/scoreParity.test.ts`, the total becomes **4,536**:

```ts
    // 3 x 6^3 (Communication, Growth, Finances) + 3 x 6^4 (Relationship,
    // Delivery, Advocacy) = 648 + 3,888 = 4,536. Asserted explicitly, not
    // echoed from the generator, so that a change to the rubric has to be
    // acknowledged here rather than silently absorbed.
    expect(total).toBe(4536)
```

In `tests/generatedColumn.test.ts`, delete the `yesNoScore` import and collapse all four
kind-dispatching tests to the uniform case. The properties they assert must all survive — only the
branch disappears:

```ts
  it('covers exactly 6^n states for every bucket', () => {
    // One value set for every question now: null, 1, 2, 3, 4, 5. The dispatch
    // this test used to carry is gone because the model's is.
    for (const bucket of BUCKETS) {
      const questions = questionsFor(bucket)
      expect(enumerateBucketStates(bucket).length, bucket).toBe(6 ** questions.length)
    }
  })

  it('includes the all-null and all-5s states for every bucket', () => {
    for (const bucket of BUCKETS) {
      const keys = questionsFor(bucket).map((question) => question.key)
      const states: Record<string, number | null>[] = enumerateBucketStates(bucket)
      const allNull = states.find((state) => keys.every((key) => state[key] === null))
      const allMax = states.find((state) => keys.every((key) => state[key] === 5))
      expect(allNull, bucket).toBeDefined()
      expect(allMax, bucket).toBeDefined()
      expect(meanOrNull(keys.map((key) => allNull![key])), bucket).toBeNull()
      expect(meanOrNull(keys.map((key) => allMax![key])), bucket).toBe(5)
    }
  })

  it('includes the all-1s state for every bucket, and it scores 1 -- not null', () => {
    // The safety property, and the reason the old test existed for yes/no
    // buckets specifically: four Nos is 1.00 and a single blank is nothing at
    // all. It is now true of every bucket, so it is asserted of every bucket.
    for (const bucket of BUCKETS) {
      const keys = questionsFor(bucket).map((question) => question.key)
      const states: Record<string, number | null>[] = enumerateBucketStates(bucket)
      const allMin = states.find((state) => keys.every((key) => state[key] === 1))
      expect(allMin, bucket).toBeDefined()
      expect(meanOrNull(keys.map((key) => allMin![key])), bucket).toBe(1)
    }
  })

  it("covers each question's full value set -- {null,1,2,3,4,5}", () => {
    for (const bucket of BUCKETS) {
      const states: Record<string, number | null>[] = enumerateBucketStates(bucket)
      for (const question of questionsFor(bucket)) {
        const seen = new Set(states.map((state) => state[question.key]))
        expect(seen.size, `${bucket}.${question.key}`).toBe(6)
      }
    }
  })
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/lib/buckets.test.ts src/lib/scoreV2.test.ts src/lib/scoreMath.test.ts tests/leafModules.test.ts tests/scoreParity.test.ts tests/generatedColumn.test.ts`
Expected: PASS, including the leaf-module guard — neither leaf gained an import.

Then run: `npx tsc -b --noEmit 2>&1 | head -40`
Expected: FAILURES, and only in `src/checkin/` and `src/board/`. That is the broken window tasks 2 and 3 close. **If any error names a file under `src/lib/` or `tests/`, stop and fix it before committing.**

- [ ] **Step 8: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print slice-4-step-4-one-answer-type
git add src/lib/buckets.ts src/lib/scoreMath.ts src/lib/scoreV2.ts \
        src/lib/buckets.test.ts src/lib/scoreMath.test.ts src/lib/scoreV2.test.ts \
        tests/scoreParity.test.ts tests/generatedColumn.test.ts
git commit -m "model: one answer type, one mean, and an explicit divisor

Every question is a smallint 1-5 and every bucket score is the mean of its
own questions. yesNoScore is deleted; for a four-question bucket, Yes=5 and
No=1 through a mean is identical to 1+yeses at all five reachable points, so
no Advocacy score moves.

OVERALL_QUESTIONS stops filtering on kind. It excluded Advocacy because
Advocacy was answered with booleans, which is not why Advocacy is excluded --
so moving Finances to the same control would have cut the divisor from 17 to
14 with nothing failing. It is now an explicit exclusion of one named bucket
and the count is pinned at seventeen.

The consumers do not build yet; tasks 2 and 3 close that."
```

---

## Task 2: Storage, state and the draft cache

Everything that carries an answer between the database and the screen. After this task the answer is a number end to end; only the controls still expect booleans.

**Files:**
- Modify: `src/types/database.ts`
- Modify: `src/checkin/draftCache.ts`
- Modify: `src/checkin/useCheckin.ts`
- Modify: `src/board/cardSummary.ts`
- Test: `src/checkin/draftCache.test.ts`, `src/checkin/useCheckin.dom.test.ts`, `src/board/cardSummary.test.ts`

**Interfaces:**
- Consumes from Task 1: `ALL_QUESTIONS`, `CHOICE_OPTIONS`, `Answers` (now `number | null` only). `isYesNo` NO LONGER EXISTS — remove every import of it.
- Produces: `QuestionScores = Partial<Record<string, number>>`; `setAnswer(key: string, value: number | null)`; `DRAFT_VERSION = 'v4'`.

- [ ] **Step 1: Write the failing tests**

Add to `src/checkin/draftCache.test.ts`:

```ts
it('refuses a v3 draft, whose Advocacy answers are booleans', () => {
  // The same failure v3 was created for, one type later. A v3 draft holds
  // `true` against adv_left_review; restoring that into a screen that expects
  // 5 would render an unanswered row over a draft the person believes is
  // saved. Bumping the version is what makes the old shape unreachable rather
  // than merely unlikely.
  const store = memoryStore()
  store.setItem(
    `${DRAFT_KEY_PREFIX}:v3:1:2026-08-01`,
    JSON.stringify({ answers: { adv_left_review: true }, notes: 'kept' }),
  )
  expect(readDraft(store, 1, '2026-08-01')).toBeNull()
})

it('rejects a boolean answer even under the current key', () => {
  const store = memoryStore()
  writeRaw(store, 1, '2026-08-01', { answers: { adv_left_review: true, comm_timely: 4 }, notes: '' })
  const draft = readDraft(store, 1, '2026-08-01')
  expect(draft?.answers.adv_left_review).toBeUndefined()
  expect(draft?.answers.comm_timely).toBe(4)
})

it('accepts every value the choice control writes', () => {
  const store = memoryStore()
  writeRaw(store, 1, '2026-08-01', {
    answers: { adv_left_review: 5, adv_case_study: 3, adv_would_refer: 1 },
    notes: '',
  })
  const draft = readDraft(store, 1, '2026-08-01')
  expect(draft?.answers).toEqual({ adv_left_review: 5, adv_case_study: 3, adv_would_refer: 1 })
})
```

`memoryStore` and `writeRaw` already exist in that file — reuse them; if `writeRaw` does not, write through `draftKey` directly as the neighbouring tests do.

Add to `src/board/cardSummary.test.ts`. It already has a helper that builds a blank row and imports
`ALL_QUESTIONS` — reuse whatever it is actually called rather than introducing `blankCheckin`:

```ts
it('counts a No as answered', () => {
  // A 1 is an answer. Counting it as missing would leave any client with
  // nothing yet to advocate permanently short of complete -- and that is
  // precisely the client most likely to answer No four times.
  const checkin = blankCheckin()
  for (const key of ALL_QUESTIONS) checkin[key] = 1
  expect(cardFooter(checkin, 'someone', true)).toBe('Draft, 21 of 21 scored')
})

it('ignores a stray boolean left in a row', () => {
  const checkin = blankCheckin()
  checkin.adv_left_review = true as unknown as number
  expect(cardFooter(checkin, 'someone', true)).toBe('Not started')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/checkin/draftCache.test.ts src/board/cardSummary.test.ts`
Expected: FAIL — a v3 key still reads, and `validAnswer` still accepts booleans for `adv_*`.

- [ ] **Step 3: Retype the database rows**

In `src/types/database.ts`, change all TWELVE occurrences — four columns across the `Row`, `Insert` and `Update` shapes — of `adv_case_study`, `adv_left_review`, `adv_reference_check`, `adv_would_refer` from `boolean | null` to `number | null`. Leave `advocacy_applies: boolean | null` on the view alone; it is a computed flag, not an answer.

Add above the `checkins` Row:

```ts
// Hand-maintained. The four adv_* columns became smallint on 2026-08-31 (spec
// §5.2); they are `number | null` here for the same reason every other answer
// is. `advocacy_applies` on checkin_scores stays boolean -- it is the gate's
// verdict, not somebody's answer.
```

- [ ] **Step 4: Bump the draft cache to v4**

In `src/checkin/draftCache.ts`:

```ts
import { ALL_QUESTIONS } from '../lib/buckets'
```

Set `DRAFT_VERSION` to `'v4'`, add a `v3DraftKey` alongside the existing `legacyDraftKey` and `v2DraftKey`, and remove the matching v3 entry in the same place those are removed on read.

```ts
export type QuestionScores = Partial<Record<string, number>>
```

```ts
// A v3 draft holds booleans against the four adv_* keys; a v4 draft holds 5, 3
// or 1. Restoring the old shape would render an answered question as blank over
// a draft the person believes is saved -- the same failure v2 to v3 was for.
// Version segments make the old shape unreachable rather than merely unlikely.
function validAnswer(key: string, value: unknown): value is number {
  if (!isQuestion(key)) return false
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5
}
```

Keep `isQuestion` as it is. Update the two comments that explain the boolean reasoning to describe the number reasoning; do not delete them.

- [ ] **Step 5: Collapse the hook's filter**

In `src/checkin/useCheckin.ts`, drop `isYesNo` from the import, change `setAnswer`'s signature to `(key: string, value: number | null) => void` in both the type and the implementation, and replace the per-kind branch in `draftFromRow` with:

```ts
    // "a number", not "a truthy value" and not "not undefined". The row also
    // carries client_id, the submitted fields, six generated bucket scores and
    // six legacy_* columns; iterating ALL_QUESTIONS rather than the row's own
    // keys is what keeps those out. A 1 is an answer and must survive, which a
    // truthiness check would silently drop.
    if (typeof value === 'number') answers[key] = value
```

- [ ] **Step 6: Collapse the card's filter**

In `src/board/cardSummary.ts`, change the `CardCheckin` index signature to `[key: string]: number | string | null | undefined`, update the comment block above it to say the answers are all smallint now, and change the filter in `cardFooter` to:

```ts
    if (typeof value === 'number') answers[key] = value
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/checkin/draftCache.test.ts src/board/cardSummary.test.ts src/checkin/useCheckin.dom.test.ts`
Expected: PASS. Existing tests in those files that write booleans must be updated to write 5 / 3 / 1 — update them, do not delete them.

- [ ] **Step 8: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add src/types/database.ts src/checkin/draftCache.ts src/checkin/useCheckin.ts \
        src/board/cardSummary.ts src/checkin/draftCache.test.ts \
        src/checkin/useCheckin.dom.test.ts src/board/cardSummary.test.ts
git commit -m "state: an answer is a number from the row to the screen

The four adv_* columns retype to number, the draft cache goes to v4 so a v3
draft's booleans can never be restored into a screen that expects 5/3/1, and
both typeof filters collapse to numbers. A 1 is an answer; the tests that
prove it survives are updated rather than removed."
```

---

## Task 3: The controls

**Files:**
- Create: `src/checkin/ChoiceRow.tsx`, `src/checkin/ChoiceRow.module.css`, `src/checkin/ChoiceRow.dom.test.tsx`
- Delete: `src/checkin/YesNoRow.tsx`, `src/checkin/YesNoRow.module.css`, `src/checkin/YesNoRow.dom.test.tsx`
- Modify: `src/checkin/CheckIn.tsx`, `src/checkin/CheckIn.module.css`
- Test: `src/checkin/CheckIn.test.tsx`, `src/checkin/CheckIn.dom.test.tsx`

**Interfaces:**
- Consumes: `CHOICE_OPTIONS`, `choiceLabel` from Task 1; `setAnswer(key, number | null)` from Task 2.
- Produces: `ChoiceRow` with props `{ question: Question; value: number | undefined; lastValue: number | null; disabled: boolean; onChange: (value: number) => void; onClear: () => void }`.

- [ ] **Step 1: Write the failing tests**

Create `src/checkin/ChoiceRow.dom.test.tsx` by copying `YesNoRow.dom.test.tsx` wholesale and changing booleans to numbers. It already tests the two things that matter most and they must both survive:

```tsx
it('renders the options worse-left to better-right', () => {
  // Every control on this screen runs the same direction. A row that ran
  // best-first would make the leftmost box mean the opposite of its neighbour
  // fourteen rows up.
  render(<ChoiceRow {...props()} />)
  const labels = screen.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value)
  expect(labels).toEqual(['1', '3', '5'])
})

it('shows a No as answered, and offers Clear for it', () => {
  // === value, never truthiness: 1 is an answer. A truthy check would leave No
  // unchecked and hide Clear from anyone who answered it, stranding them with
  // no way back to unanswered.
  render(<ChoiceRow {...props({ value: 1 })} />)
  const no = screen.getByRole('radio', { name: 'No' }) as HTMLInputElement
  expect(no.checked).toBe(true)
  expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy()
})

it('keeps focus in the row after Clear', () => {
  // The flushSync ordering the owner reported against QuestionRow. Without it
  // the group stays anchored to the radio about to be unchecked and the next
  // Tab stops on the answer just cleared.
  render(<ChoiceRow {...props({ value: 5 })} />)
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'No' }))
})

it('reads last month by its label, not its number', () => {
  render(<ChoiceRow {...props({ lastValue: 3 })} />)
  expect(screen.getByText(/Unsure/)).toBeTruthy()
})

it('shows a legacy value that no control can write as a bare number', () => {
  // August 2026's Finance answers contain 2s and 4s. Rendering one as a choice
  // label would invent an answer nobody gave; rendering nothing would hide real
  // history.
  render(<ChoiceRow {...props({ lastValue: 4 })} />)
  expect(screen.getByText(/4/)).toBeTruthy()
})
```

Add to `src/checkin/CheckIn.dom.test.tsx`:

```tsx
it('draws the choice control for Finances as well as Advocacy', () => {
  renderCheckIn()
  const rackRate = screen.getByRole('radiogroup', { name: /Paying rack rate/ })
  expect(within(rackRate).getAllByRole('radio')).toHaveLength(3)
})

it('still states both anchors on one legend', () => {
  // The owner asked for anchored ends on 2026-08-31 and they were already
  // there -- he had not seen them, because they scroll away above question
  // fourteen. The fix is placement, and placement is CSS: CSS Modules are
  // stubbed under jsdom, so getComputedStyle would report nothing here and a
  // test asserting `position: sticky` would pass or fail for reasons unrelated
  // to the stylesheet. What IS testable is that the copy survives the change,
  // which is what a careless "fix" to the legend would break.
  renderCheckIn()
  const legend = screen.getByTestId('scale-legend')
  expect(legend.textContent).toContain('strongly disagree')
  expect(legend.textContent).toContain('strongly agree')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/checkin/ChoiceRow.dom.test.tsx src/checkin/CheckIn.dom.test.tsx`
Expected: FAIL — `ChoiceRow` does not exist.

- [ ] **Step 3: Create `ChoiceRow`**

`git mv src/checkin/YesNoRow.tsx src/checkin/ChoiceRow.tsx` and `git mv src/checkin/YesNoRow.module.css src/checkin/ChoiceRow.module.css`, then edit rather than rewrite — the `flushSync` block and its comment are load-bearing and were written against a real reported defect. Keep them verbatim, changing only the identifiers.

```tsx
import { useRef } from 'react'
import { flushSync } from 'react-dom'
import { CHOICE_OPTIONS, choiceLabel } from '../lib/buckets'
import type { Question } from '../lib/buckets'
import styles from './ChoiceRow.module.css'

type Props = {
  question: Question
  value: number | undefined
  lastValue: number | null
  disabled: boolean
  onChange: (value: number) => void
  onClear: () => void
}
```

Replace the local `OPTIONS` constant with `CHOICE_OPTIONS` — the rubric owns the mapping and a second copy here is exactly how the two drift. Key the labels on `option.value`, set `value={option.value}`, and give the ref to `CHOICE_OPTIONS[0]` (No) rather than to the truthy option:

```tsx
                ref={option.value === CHOICE_OPTIONS[0].value ? firstRadio : undefined}
```

Render the last-month line through `choiceLabel`, falling back to the raw number:

```tsx
              Last month: <span>{choiceLabel(lastValue) ?? lastValue}</span>
```

Delete `YesNoRow.dom.test.tsx` once `ChoiceRow.dom.test.tsx` passes.

- [ ] **Step 4: Wire it up and pin the legend**

In `src/checkin/CheckIn.tsx`: import `ChoiceRow`, change the dispatch to `question.kind === 'choice'`, and cast the two values to `number` instead of `boolean`:

```tsx
                    value={draft.answers[question.key] as number | undefined}
                    lastValue={
                      (lastMonth?.[question.key as keyof CheckinRow] as number | null) ?? null
                    }
```

In `src/checkin/CheckIn.module.css`, make `.legend` sticky:

```css
.legend {
  /* §7's one legend, pinned. It said the right thing in the wrong place: it
     rendered once above the first bucket and scrolled away long before question
     fourteen, so the owner asked in August 2026 for anchors that were already
     there. Sticky rather than fixed, so it scrolls out with the section it
     belongs to rather than floating over the whole app. */
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--surface);
}
```

Use whatever background token the surrounding sheet already uses — a transparent sticky element lets the questions scroll through it. Check `CheckIn.module.css`'s existing custom properties and match one; **do not invent a token**; `tests/tokens.test.ts` exists and will catch one that does not resolve.

**This is the one change in the plan that no test can confirm.** jsdom does not apply CSS Modules, so stickiness is verifiable only by scrolling the running app. Add it to the owner's checklist in Task 7 rather than claiming it is covered.

- [ ] **Step 5: Run the tests and close the window**

Run: `npx vitest run src/checkin/`
Expected: PASS.

Run: `npm run build`
Expected: **PASS.** This is the step that closes Task 1's broken window; the whole tree must compile here. If anything still references `YesNoRow`, `isYesNo` or `yesNoScore`, that is what to fix.

Run: `npm test`
Expected: PASS, whole suite.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add -A src/checkin
git commit -m "checkin: a three-way control, and a legend that stays put

YesNoRow becomes ChoiceRow: three options rather than two, ascending so the
row runs the same direction as the fourteen scale rows above it, and reading
its value from the rubric's CHOICE_OPTIONS rather than a second copy. Finances
gets the same control.

The scale legend already read 1 strongly disagree / 5 strongly agree; it
scrolled away above question fourteen, which is why it was asked for. It is
sticky now. The tree builds again."
```

---

## Task 4: Choosing the month

**Files:**
- Modify: `src/lib/month.ts`
- Modify: `src/board/Board.tsx`, `src/board/Board.module.css`
- Modify: `src/checkin/CheckIn.tsx`, `src/checkin/CheckIn.module.css`
- Test: `src/lib/month.test.ts`, `src/board/Board.test.tsx` (it EXISTS — extend it, do not create a
  new file). It already renders through a `renderBoard()`-shaped helper at roughly line 107, already
  asserts the month heading at `getByRole('heading', { level: 2 })` (line 170), and already opens a
  card with `getByRole('button', { name: new RegExp(client.name) })` (line 138). Reuse all three.

**Interfaces:**
- Produces: `nextPeriod(period): string`; `defaultPeriod(): string`; `canAdvance(period): boolean`.
- The board passes `period` to `CheckIn` as it already does; only its source changes.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/month.test.ts`:

```ts
it('defaults to last month, because a month is scored after it closes', () => {
  // The owner's actual workflow: August is scored during September. Defaulting
  // to the current month meant the board showed nothing but em dashes for the
  // first three weeks of every month, and the month he wanted became
  // unreachable the moment the calendar turned.
  expect(defaultPeriod()).toBe(previousPeriod(currentPeriod()))
})

it('will not advance past the current month', () => {
  // You cannot score a month that has not started.
  expect(canAdvance(previousPeriod(currentPeriod()))).toBe(true)
  expect(canAdvance(currentPeriod())).toBe(false)
})

it('rolls the year in both directions', () => {
  expect(nextPeriod('2026-12-01')).toBe('2027-01-01')
  expect(previousPeriod('2027-01-01')).toBe('2026-12-01')
})

it('goes back without limit', () => {
  // No floor: the query simply returns nothing for a month before the client
  // existed, and a floor would need a per-client answer the board does not have.
  expect(previousPeriod('2020-01-01')).toBe('2019-12-01')
})
```

Add to `src/board/Board.test.tsx`, reusing its existing render helper:

```tsx
it('opens on last month and can walk back', () => {
  renderBoard()
  expect(screen.getByRole('heading', { name: formatPeriod(defaultPeriod()) })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /previous month/i }))
  expect(
    screen.getByRole('heading', { name: formatPeriod(previousPeriod(defaultPeriod())) }),
  ).toBeTruthy()
})

it('disables next on the current month', () => {
  renderBoard()
  fireEvent.click(screen.getByRole('button', { name: /next month/i }))
  const next = screen.getByRole('button', { name: /next month/i }) as HTMLButtonElement
  expect(next.disabled).toBe(true)
})

it('opens the check-in on the month the board is showing', () => {
  // One period, never two. A card reading "Draft, 8 of 21" for one month while
  // opening a check-in for another is what makes a person stop trusting the
  // number.
  renderBoard()
  fireEvent.click(screen.getByRole('button', { name: /previous month/i }))
  const shown = previousPeriod(defaultPeriod())
  fireEvent.click(screen.getByRole('button', { name: /Colorfil/ }))
  expect(screen.getByText(formatPeriod(shown))).toBeTruthy()
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/month.test.ts src/board/Board.test.tsx`
Expected: FAIL — `nextPeriod`, `defaultPeriod` and `canAdvance` do not exist.

- [ ] **Step 3: Extend `month.ts`**

```ts
// Named rather than written as addMonths(period, 1) at each call site, for the
// same reason previousPeriod is.
export function nextPeriod(period: string): string {
  return addMonths(period, 1)
}

// Last month, not this one. A month is judged after it closes: the owner scores
// August during September. Defaulting to the current month meant the board read
// as em dashes for the first three weeks of every month and the month he
// actually wanted was unreachable. Spec §7, and §10 decision 8 records that he
// chose this over "most recent unsubmitted" and what it costs.
export function defaultPeriod(): string {
  return previousPeriod(currentPeriod())
}

// Forward stops at the current month; back has no floor. Comparing the strings
// is sound because a period is always YYYY-MM-01 and those sort as dates do.
export function canAdvance(period: string): boolean {
  return period < currentPeriod()
}
```

- [ ] **Step 4: Give the board the control**

In `src/board/Board.tsx`, replace `const period = currentPeriod()` with:

```tsx
  // One period for the whole board, and for the check-in it opens. The two must
  // never disagree: a card summarising one month while its check-in edits
  // another is the kind of quiet mismatch that makes a person stop trusting the
  // number. Not persisted, like every other view state here -- a reload lands on
  // last month, which is where the work is.
  const [period, setPeriod] = useState(defaultPeriod())
```

In the `periodBar`, put the controls around the heading that is already there:

```tsx
      <div className={styles.periodBar}>
        <div className={styles.periodNav}>
          <button
            className="button button--quiet"
            type="button"
            onClick={() => setPeriod(previousPeriod(period))}
          >
            {/* An accessible name that says what it does, not "<". The visible
                glyph is decoration and is hidden from the accessibility tree. */}
            <span aria-hidden="true">&larr;</span>
            <span className="visually-hidden">Previous month</span>
          </button>
          <h2 className="t-header">{formatPeriod(period)}</h2>
          <button
            className="button button--quiet"
            type="button"
            disabled={!canAdvance(period)}
            onClick={() => setPeriod(nextPeriod(period))}
          >
            <span aria-hidden="true">&rarr;</span>
            <span className="visually-hidden">Next month</span>
          </button>
        </div>
```

Check whether `visually-hidden` exists in `src/styles/base.css`. If it does not, add it there rather than to `Board.module.css` — it is a global utility and the next screen will want it.

Add `.periodNav` to `Board.module.css` as a flex row with the heading centred between the buttons.

- [ ] **Step 5: Show the month on the check-in screen**

In `src/checkin/CheckIn.tsx`, render `formatPeriod(period)` in the header beside the client name, as a caption. The screen already receives `period` as a prop; it just never showed it.

```tsx
        {/* Which month this is. Backdating is the normal case -- August is
            scored during September -- so the month being scored has to be
            visible at the moment of scoring, not remembered from the board. */}
        <p className="t-caption">{formatPeriod(period)}</p>
```

Do NOT add prev/next controls here. The board owns the period; a second control that could disagree with it is the mismatch this task exists to prevent. Going back to the board to change months is one click, and it is the click that keeps the two in step.

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run src/lib/month.test.ts src/board/ src/checkin/CheckIn.dom.test.tsx`
Expected: PASS.

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add src/lib/month.ts src/lib/month.test.ts src/board src/checkin/CheckIn.tsx \
        src/checkin/CheckIn.module.css src/styles/base.css
git commit -m "board: choose the month, defaulting to the one that just closed

Board.tsx computed currentPeriod() and offered no way to change it, so the
tool could only score a month that had not finished. The board now owns one
period in state, defaulting to last month, forward-capped at the current one
and uncapped going back; the check-in inherits it and displays it.

One period, not two: a second control on the check-in screen could disagree
with the board, which is the mismatch this exists to prevent. The gate needed
nothing -- advocacyGate already takes the period, so backdating shuts Advocacy
correctly for a client whose 90th day fell after the month being scored."
```

---

## Task 5: The migration

**Files:**
- Create: `supabase/migrations/<YYYYMMDDHHMMSS>_advocacy_smallint.sql`

Generate the timestamp with `date -u +%Y%m%d%H%M%S`. **Do not apply it here** — Task 6 applies it to staging after the verifier is ready.

**Interfaces:**
- Consumes: nothing.
- Produces: `checkins.adv_*` as `smallint`, `adv_score` as a mean over four, and `public.checkin_scores` rebuilt with `security_invoker`.

- [ ] **Step 1: Write the migration**

```sql
-- Advocacy's four answers become smallint, so an Unsure has somewhere to live.
--
-- Spec §3.1 and §5.2, amended 2026-08-31. Yes = 5, Unsure = 3, No = 1. The
-- conversion is lossless -- the columns hold only true, false and null today --
-- and it moves no score: for a four-question bucket, the mean of 5s and 1s is
-- identical to the retired `1 + yeses` at all five of its reachable points.
--
-- Both dependants come down first. adv_score is generated FROM these columns
-- and checkin_scores SELECTS adv_score, so neither survives an ALTER TYPE.

begin;

drop view if exists public.checkin_scores;

alter table public.checkins drop column if exists adv_score;

-- `case ... when true` rather than `::int * 4 + 1`, so that a null stays null by
-- the ordinary rule that an unmatched CASE yields null, rather than by relying
-- on cast semantics. Null is unanswered and must not become 1.
alter table public.checkins
  alter column adv_left_review type smallint
    using (case adv_left_review when true then 5 when false then 1 end),
  alter column adv_case_study type smallint
    using (case adv_case_study when true then 5 when false then 1 end),
  alter column adv_would_refer type smallint
    using (case adv_would_refer when true then 5 when false then 1 end),
  alter column adv_reference_check type smallint
    using (case adv_reference_check when true then 5 when false then 1 end);

-- The same constraint every other answer carries, named the same way, so the
-- four are indistinguishable from the seventeen in the catalogue.
alter table public.checkins
  add constraint checkins_adv_left_review_check
    check (adv_left_review >= 1 and adv_left_review <= 5),
  add constraint checkins_adv_case_study_check
    check (adv_case_study >= 1 and adv_case_study <= 5),
  add constraint checkins_adv_would_refer_check
    check (adv_would_refer >= 1 and adv_would_refer <= 5),
  add constraint checkins_adv_reference_check_check
    check (adv_reference_check >= 1 and adv_reference_check <= 5);

-- Identical in shape to the other five bucket columns now. The ::numeric cast is
-- required: without it Postgres does integer division and 5 + 5 + 5 + 3 becomes
-- 4 instead of 4.50.
alter table public.checkins
  add column adv_score numeric(3,2) generated always as (
    ((adv_left_review + adv_case_study
      + adv_would_refer + adv_reference_check)::numeric / 4)
  ) stored;

comment on column public.checkins.adv_score is
  'Mean of the four Advocacy answers, 1.00-5.00. Null if any is unanswered. Excluded from checkin_scores.overall_score by ruling (spec 3.2).';

-- Rebuilt exactly as it was. overall_score does not reference adv_* at all --
-- Advocacy is out of the headline number -- so its expression is unchanged and
-- still divides by seventeen.
create view public.checkin_scores
with (security_invoker = true) as
select
  ch.id,
  ch.client_id,
  ch.period,
  ch.comm_score,
  ch.growth_score,
  ch.fin_score,
  ch.rel_score,
  ch.del_score,
  ch.adv_score,
  (c.started_on is not null and ch.period >= (c.started_on + 90)) as advocacy_applies,
  round(
    (ch.comm_constructive + ch.comm_timely + ch.comm_consistent
     + ch.growth_goals_defined + ch.growth_progress_trackable + ch.growth_hitting_goals
     + ch.fin_rack_rate + ch.fin_pays_on_time + ch.fin_rate_increased
     + ch.rel_collaborative + ch.rel_respectful + ch.rel_fun + ch.rel_multi_threaded
     + ch.del_on_time + ch.del_quantity + ch.del_client_likes + ch.del_we_are_proud
    )::numeric / 17::numeric, 2) as overall_score
from public.checkins ch
join public.clients c on c.id = ch.client_id;

commit;
```

**`security_invoker = true` is not optional and is the single most dangerous line to lose.** Without it the view runs with the owner's privileges and every signed-in account can read every client's scores, with nothing failing and no error anywhere.

- [ ] **Step 2: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add supabase/migrations/
git commit -m "migration: Advocacy's four answers become smallint

true -> 5, false -> 1, null stays null. Lossless, and no score moves: the
mean of 5s and 1s over four questions is identical to 1 + yeses.

Both dependants come down and go back up -- adv_score is generated from these
columns and checkin_scores selects it. The view is recreated verbatim, with
security_invoker, and overall_score is untouched because Advocacy was never
in it."
```

---

## Task 6: The verifier, and every gate green

**Files:**
- Modify: `scripts/score-parity.mjs`
- Modify: `scripts/verify-scoring-view.sql`

`tests/generatedColumn.test.ts` and `tests/scoreParity.test.ts` were already corrected in Task 1 —
they broke there, not here. This task removes the now-dead dispatch from the generator and updates
the SQL verifier.

**Interfaces:**
- Consumes: `BUCKETS`, `questionsFor` from `buckets.ts` and `meanOrNull` from `scoreMath.ts` — both LEAVES, imported with the `.ts` extension. `yesNoScore` no longer exists; remove its import.

- [ ] **Step 1: Make the sweep uniform**

In `scripts/score-parity.mjs`:

```js
import { BUCKETS, questionsFor } from '../src/lib/buckets.ts'
import { meanOrNull } from '../src/lib/scoreMath.ts'
```

Delete `YESNO_VALUES` and `valuesFor`. `expectedBucketScore` loses its dispatch:

```js
// The expected bucket score, composed from the same meanOrNull the application
// uses -- a recomposition of scoreV2.ts's bucketScore(), which cannot be
// imported directly because it imports './buckets' extensionlessly. There is no
// dispatch on kind any more: every bucket is one mean over one column type.
function expectedBucketScore(state, bucket) {
  return meanOrNull(questionsFor(bucket).map((question) => state[question.key]))
}
```

`enumerateBucketStates` uses `SCALE_VALUES` for every question, and `bucketCheckSql` emits `smallint` for every value.

Rewrite the header comment's arithmetic:

```js
// Every question is a smallint 1-5 (spec §3.2, amended 2026-08-31), so the
// sweep is uniform: 6 values per question, 3 x 6^3 + 3 x 6^4 = 648 + 3,888 =
// 4,536 states.
//
// That is MORE than the 3,321 the boolean version checked, and deliberately.
// Enumerating only the values the new controls can write -- null, 5, 3, 1 --
// would be smaller and would be a verifier that checks the UI's habits rather
// than the database's contract. The columns accept any smallint 1 to 5, and
// August 2026's Finance answers contain 2s and 4s that no current control can
// produce. This enumerates what the column can hold.
```

- [ ] **Step 2: Prove the count**

Run: `node scripts/score-parity.mjs && grep -c '^    (' scripts/.score-parity.generated.sql`
Expected: the generated VALUES rows total **4,536** across the six blocks. If the number differs, the enumeration is wrong — do not adjust the comment to match the code.

- [ ] **Step 3: Update the view verifier**

In `scripts/verify-scoring-view.sql`, change every literal written into an `adv_*` column from `true`/`false` to `5`/`1`. The properties it asserts are unchanged and all must still hold:

- nulling any ONE of the seventeen non-Advocacy answers nulls `overall_score` — seventeen cases;
- nulling any of the four Advocacy answers does NOT null `overall_score`, in both gate states — four cases, and these are the ones that would catch a silent reversion to a 21-divisor;
- all-3s gives exactly 3.00 regardless of gate state;
- the gate boundaries at 89, 90 and 91 days, and a null `started_on`.

Add one case that only exists after this change:

```sql
-- An Unsure is the middle, and it is NOT unanswered. A 3 in every Advocacy
-- column must give adv_score 3.00 and leave overall_score non-null.
```

- [ ] **Step 4: Apply to staging and run every gate**

```bash
npm run db:which     # MUST print tgc-client-health-staging. Stop if it does not.
npm run db:push
```

Then, in order, and all six must pass:

```bash
npm run build
npm test
npm run verify:score          # expect 0 of 4,536 mismatches
npm run verify:scoring-view
npm run verify:privileges     # security_invoker; a failure here is the dangerous one
npm run verify:lifecycle
```

- [ ] **Step 5: Confirm staging's Advocacy scores did not move**

Before the migration, record staging's Advocacy bucket scores. After it, compare:

```sql
select client_id, period, adv_score from public.checkins
where adv_score is not null order by client_id, period;
```

Every value must be **identical**. This is the empirical half of §3.2's proof; the table in the spec is the analytic half. A single moved value means the mapping is wrong and the migration must be reverted before it reaches production.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add scripts/score-parity.mjs scripts/verify-scoring-view.sql
git commit -m "verify: one uniform sweep, 4,536 states

The parity check loses its per-bucket dispatch along with the model's. It
enumerates six values for every question rather than four for the choice ones,
which makes it larger on purpose: the columns accept any smallint 1-5 and
August's Finance answers contain 2s and 4s no control can now write. A sweep
restricted to what the UI writes would stop verifying what is in the table."
```

---

## Task 7: The owner's production checklist

**Files:**
- Create: `docs/superpowers/plans/2026-08-31-slice-4-step-4-production-checklist.md`

Not an implementer's task in the sense the others are — it produces the document the owner works from. Write it only after Task 6's gates are green, so every number in it is measured rather than predicted.

- [ ] **Step 1: Write the checklist**

It must contain, in this order:

1. **What he will see, stated before he sees it.** No score changes anywhere. Finances and Advocacy draw three buttons instead of five and two. The board opens on the previous month.
2. **The order, and why it is forced.** Deploy first, confirm the board renders, then the migration. The live site selects `adv_*` as booleans through `database.ts`; migrating first would not break the board (the view is unchanged and the board reads `adv_score`, not the answers) but WOULD break the check-in screen's Advocacy rows for anyone who opened one between the migration and the deploy. Deploy first regardless — it costs nothing and removes the window.
3. **The push, from Terminal.app.** `git push` cannot reach the keychain from inside Claude Code — "Device not configured" — and the `!` prefix fails identically. He pushes; that push is what deploys.
4. **The migration, pasted into the production SQL editor.** Its CONTENTS, not its filename — that mistake cost two rounds on 2026-08-31. Confirm the editor header reads `tgc-client-health-production` first. Note that **`db push` is not a safe route to production**: its migration history was recorded under regenerated timestamps and does not match the repo's filenames, so the CLI would try to replay applied migrations.
5. **Verification queries with expected answers**, including the one that matters most:

```sql
select c.name, ch.adv_score
from public.checkins ch join public.clients c on c.id = ch.client_id
where ch.period = '2026-08-01' and ch.adv_score is not null
order by c.name;
```

Expect **Babaloo 5.00, C.R. Plastics 1.00, Colorfil 1.00, Gait Happens 4.00, Gibs Grooming 1.00, Juan Valdez 4.00, York 1.00** — the same seven values as before the migration. Any difference means the conversion mapping is wrong.

```sql
select count(*) from information_schema.columns
 where table_schema='public' and table_name='checkins'
   and column_name like 'adv\_%' and data_type <> 'smallint';
```

Expect **1** — `adv_score` is `numeric`, and the four answers are `smallint`.

```sql
select relname, reloptions from pg_class where relname = 'checkin_scores';
```

Expect `{security_invoker=true}`. **If this is empty, stop and re-run the view creation** — the view is readable by every signed-in account until it is fixed.

6. **Reload the board**, confirm it opens on the previous month and every score is unchanged.
7. **Two things only a person can check**, because no test in this repo can:
   - Open a check-in and scroll to the bottom bucket. **The 1 / 5 legend must still be on screen.**
     jsdom does not apply CSS Modules, so stickiness is unverifiable in the suite — if it scrolls
     away, the change did not take and the owner is back where he started.
   - Answer a Finances question **No** and confirm the row still offers Clear. A truthiness check
     anywhere in the chain hides Clear from exactly the person who answered No, stranding them with
     no way back to unanswered. The unit tests cover the components; this covers the wiring.

- [ ] **Step 2: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add docs/superpowers/plans/
git commit -m "docs: the owner's checklist for step 4"
```

---

## What is left after this

- **Slice 5, the Overview homepage** from the owner's whiteboard sketch: the OVERVIEW / CLIENTS / REVENUE nav lifted into `App.tsx`'s shell, six stat lines in two columns, and the client-by-bucket matrix with the six initials C G F R D A. Needs Clients/People routing lifted out of `Board.tsx` first.
- **Revenue retention still has no data answer.** A single editable retainer field cannot produce it, because editing destroys the value you would compare against. Options are owed to the owner when that page is built.
- **§11 item 6, new:** an Unsure and a middling 3 are indistinguishable in the column by design. Nothing needs to tell them apart today; if a future screen does, that distinction is not in the data and recovering it is a migration.
