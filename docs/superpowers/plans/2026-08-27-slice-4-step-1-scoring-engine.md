# Slice 4, Step 1 — The Scoring Engine and Its Database — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the six-bucket, 22-question scoring model in TypeScript and in Postgres, and prove
the two agree exhaustively — with no user interface, and without breaking the deployed site.

**Architecture:** The rubric becomes data in `src/lib/buckets.ts`; the arithmetic becomes pure
functions in `src/lib/score.ts`; the database gains 22 nullable answer columns, six generated bucket
averages and a `security_invoker` view that applies the 90-day Advocacy gate. Two verifiers check the
deployed database rather than a copy of it.

**Tech Stack:** TypeScript, Vitest (node environment — no DOM in this step), Supabase CLI, Postgres
17.6.

**Spec:** `docs/superpowers/specs/2026-08-27-phase-2-slice-4-scoring-model-design.md`

## Global Constraints

- **This step is ADDITIVE ONLY. Do not rename or drop any existing column.** Spec §5.4 renames the
  five pillar columns and `total_score` to `legacy_*`; that rename is NOT in this step. The deployed
  site at https://thegroundedco.github.io/tgc-client-health/ still reads `relationship`, `delivery`,
  `financial`, `sentiment`, `growth` and `total_score` through `src/checkin/useCheckin.ts` and
  `src/board/useBoard.ts`. Renaming them now breaks the live site the instant the migration is
  applied, because the database is migrated separately from — and ahead of — the app deploy. The
  rename is a later step, after nothing reads them. **This is a recorded deviation from spec §5.4's
  placement, not from its content.**
- **Never aim a database command at production in this step.** `npm run db:which` guards `db:push`
  and every `verify:*` script and exits 1 on production. Staging ref only.
- **Do not run `npx prettier` on this repo.** It is not a dependency, there is no config, and it
  reformats to double quotes and semicolons — the opposite of this codebase's style.
- **Every question is scored 1-5.** A bucket score is the mean of its questions. The overall score
  is the mean of every REQUIRED answer — 22 when Advocacy applies, 18 when it does not — and is
  **not** the mean of the six bucket scores (spec §3.2).
- **All means round to exactly 2 decimal places**, in both TypeScript and Postgres.
- **A missing required answer means no score** — null, never a partial mean, never zero (spec §3.3).
- **Bands: >= 3.6 healthy, >= 2.2 watch, below that at risk, null is not scored.** Unchanged
  thresholds, restated on the 1-5 scale (spec §10 decision 1).
- **Do not write a sentence you have not verified.** If a step in this plan asks you to write a
  comment or commit message asserting something you cannot confirm, stop and report it rather than
  writing it. This repository has a tally of nineteen false claims in prose and every one was written
  confidently.
- **Any module `scripts/*.mjs` imports must be a LEAF — it may import nothing itself.**
  `npm run verify:score` runs `node scripts/score-parity.mjs`, and plain Node cannot resolve this
  codebase's extensionless relative imports. Measured 2026-08-27: a value import of `'./dep'` fails
  `ERR_MODULE_NOT_FOUND` while `'./dep.ts'` resolves. Node strips TypeScript types on import, so a
  `.ts` file loads fine — but only if it has no relative imports of its own to resolve.
  `scripts/score-parity.mjs` works today *only* because `src/lib/score.ts` imports nothing, and
  `src/lib/pillars.ts` gets away with `import type { Pillar } from './score'` only because a
  type-only import is erased before Node ever sees it. **This is why Task 2 splits the arithmetic
  into `scoreMath.ts`:** the verifier needs the real implementation rather than a second copy that
  can drift, so the pieces it needs must be leaves.
- **A test that reads the filesystem cannot live under `src/`.** `tsconfig.app.json` has no node
  types, so it passes `npm test` and fails `npm run build`. Such tests go in `tests/`, importing
  `../src/...ts` with the extension.

---

### Task 1: The rubric as data — `src/lib/buckets.ts`

**Files:**
- Create: `src/lib/buckets.ts`
- Create: `src/lib/buckets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BUCKETS: readonly Bucket[]`, `type Bucket`, `type QuestionKey`,
  `BUCKET_DEFINITIONS: Record<Bucket, BucketDefinition>`, `GATED_BUCKET: Bucket`,
  `ALL_QUESTIONS: readonly QuestionKey[]`, `questionsFor(bucket: Bucket): readonly Question[]`.
  Task 2 consumes all of these. `QuestionKey` values are **exactly the database column names** added
  in Task 3 — there is no mapping layer between the rubric and the schema, deliberately, so a typo
  cannot silently write to the wrong column.

- [ ] **Step 1: Write the failing test**

Create `src/lib/buckets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  ALL_QUESTIONS,
  BUCKETS,
  BUCKET_DEFINITIONS,
  GATED_BUCKET,
  questionsFor,
} from './buckets'

describe('the six buckets', () => {
  it('is six of them, in the order the rubric was written', () => {
    expect(BUCKETS).toEqual([
      'communication',
      'growth',
      'finances',
      'relationship',
      'delivery',
      'advocacy',
    ])
  })

  it('puts the gated bucket last, because the screen renders in this order', () => {
    expect(BUCKETS[BUCKETS.length - 1]).toBe(GATED_BUCKET)
  })

  it('holds 22 questions in total', () => {
    expect(ALL_QUESTIONS).toHaveLength(22)
  })

  it('holds the question counts the rubric specifies', () => {
    const counts = BUCKETS.map((bucket) => questionsFor(bucket).length)
    expect(counts).toEqual([3, 3, 4, 4, 4, 4])
  })
})

describe('the single-letter initials the board labels its bars with', () => {
  it('gives every bucket one capital letter', () => {
    for (const bucket of BUCKETS) {
      expect(BUCKET_DEFINITIONS[bucket].initial, bucket).toMatch(/^[A-Z]$/)
    }
  })

  it('matches each initial to its own label, so a rename cannot orphan it', () => {
    for (const bucket of BUCKETS) {
      const definition = BUCKET_DEFINITIONS[bucket]
      expect(definition.initial, bucket).toBe(definition.label[0])
    }
  })

  it('keeps all six distinct, so no two bars label identically', () => {
    const initials = BUCKETS.map((bucket) => BUCKET_DEFINITIONS[bucket].initial)
    expect(new Set(initials).size).toBe(BUCKETS.length)
  })
})

describe('the question keys', () => {
  // These keys ARE the column names. A duplicate would mean two prompts writing
  // to one column, and the last write would silently win.
  it('are all distinct', () => {
    expect(new Set(ALL_QUESTIONS).size).toBe(ALL_QUESTIONS.length)
  })

  it('are shaped like the Postgres identifiers they are', () => {
    for (const key of ALL_QUESTIONS) {
      expect(key, key).toMatch(/^[a-z]+(_[a-z]+)+$/)
    }
  })

  it('lists every bucket\'s questions in ALL_QUESTIONS, in bucket order', () => {
    const gathered = BUCKETS.flatMap((bucket) =>
      questionsFor(bucket).map((question) => question.key),
    )
    expect(gathered).toEqual([...ALL_QUESTIONS])
  })

  it('gives every question a prompt that reads as a statement', () => {
    for (const bucket of BUCKETS) {
      for (const question of questionsFor(bucket)) {
        expect(question.prompt.length, question.key).toBeGreaterThan(0)
        expect(question.prompt.trim(), question.key).toBe(question.prompt)
      }
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/buckets.test.ts`
Expected: FAIL — `Failed to resolve import "./buckets"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/buckets.ts`:

```ts
// The rubric, as code rather than as a table -- the same ruling that deferred
// `pillar_definitions` in Slice 1. Spec §10 decision 5 records the cost: unlike
// the five pillars, which changed zero times in a year, this list is days old,
// and under the schema shape chosen in spec §5 a NEW question is a migration
// rather than an edit. If it moves twice more, revisit.
//
// Every `key` below is the literal column name on public.checkins. There is no
// mapping layer between the rubric and the schema on purpose: a mapping is one
// more place a typo can send an answer to the wrong column and still typecheck.

export const BUCKETS = [
  'communication',
  'growth',
  'finances',
  'relationship',
  'delivery',
  'advocacy',
] as const

export type Bucket = (typeof BUCKETS)[number]

// Advocacy is not scored inside a client's first 90 days. Named rather than
// written as the string at each call site, so the gate has one definition.
export const GATED_BUCKET: Bucket = 'advocacy'

export type Question = {
  // The column on public.checkins. Also the key in an Answers object.
  key: string
  prompt: string
}

export type BucketDefinition = {
  label: string
  // The one letter the board's card puts under that bucket's bar. Written out
  // rather than derived from label[0], because a derivation cannot complain
  // when two buckets collide -- buckets.test.ts asserts all six stay distinct
  // AND that each still matches its label, so a rename fails the build.
  initial: string
  questions: readonly Question[]
}

export const BUCKET_DEFINITIONS: Record<Bucket, BucketDefinition> = {
  communication: {
    label: 'Communication',
    initial: 'C',
    questions: [
      { key: 'comm_constructive', prompt: 'Provides constructive feedback.' },
      { key: 'comm_timely', prompt: 'Provides timely feedback.' },
      { key: 'comm_consistent', prompt: 'Provides consistent feedback.' },
    ],
  },
  growth: {
    label: 'Growth',
    initial: 'G',
    questions: [
      { key: 'growth_goals_defined', prompt: 'Short and long term goals are clearly defined.' },
      { key: 'growth_progress_trackable', prompt: 'We can track progress towards their goals.' },
      { key: 'growth_hitting_goals', prompt: 'We are hitting their goals.' },
    ],
  },
  finances: {
    label: 'Finances',
    initial: 'F',
    questions: [
      { key: 'fin_rack_rate', prompt: 'Paying rack rate.' },
      { key: 'fin_pays_on_time', prompt: 'Pays on time.' },
      { key: 'fin_rate_increased', prompt: 'Rate has increased over the last 90 days.' },
      { key: 'fin_on_terms', prompt: 'On terms -- a three-month commitment or longer.' },
    ],
  },
  relationship: {
    label: 'Relationship',
    initial: 'R',
    questions: [
      { key: 'rel_collaborative', prompt: 'They are collaborative.' },
      { key: 'rel_respectful', prompt: 'They are respectful.' },
      { key: 'rel_fun', prompt: 'They have fun with us.' },
      {
        key: 'rel_multi_threaded',
        prompt:
          'We are multi-threaded -- we work with their partners, and they work with ours.',
      },
    ],
  },
  delivery: {
    label: 'Delivery',
    initial: 'D',
    questions: [
      { key: 'del_on_time', prompt: 'We are delivering on time.' },
      { key: 'del_quantity', prompt: 'We are delivering a healthy quantity.' },
      { key: 'del_client_likes', prompt: 'The client likes our assets.' },
      { key: 'del_we_are_proud', prompt: 'We are proud of what we are delivering.' },
    ],
  },
  advocacy: {
    label: 'Advocacy',
    initial: 'A',
    questions: [
      { key: 'adv_left_review', prompt: 'They have left a review.' },
      { key: 'adv_case_study', prompt: 'We could use them for a case study.' },
      { key: 'adv_would_refer', prompt: 'They would refer us without being prompted.' },
      { key: 'adv_reference_check', prompt: 'We could send leads to them as a reference check.' },
    ],
  },
}

export function questionsFor(bucket: Bucket): readonly Question[] {
  return BUCKET_DEFINITIONS[bucket].questions
}

export const ALL_QUESTIONS: readonly string[] = BUCKETS.flatMap((bucket) =>
  questionsFor(bucket).map((question) => question.key),
)

export type QuestionKey = (typeof ALL_QUESTIONS)[number]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/buckets.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the whole suite and the build**

Run: `npm test -- --run && npm run build && npm run lint`
Expected: all green. The token test in `tests/tokens.test.ts` scans everything under `src/`
including comments — if it flags a named colour in the prose above, **reword the comment, never
weaken the rule** (a known false-positive class, parked item 1).

- [ ] **Step 6: Commit**

```bash
git add src/lib/buckets.ts src/lib/buckets.test.ts
git commit -m "feat(score): the six buckets and their 22 questions, as data

Question keys are the literal checkins column names Task 3 adds, with no
mapping layer, so a typo cannot typecheck its way into the wrong column."
```

---

### Task 2: The arithmetic — `src/lib/score.ts`

**Files:**
- Create: `src/lib/scoreMath.ts` — the arithmetic, importing nothing
- Create: `src/lib/scoreMath.test.ts`
- Create: `src/lib/scoreV2.ts` — the arithmetic composed with the rubric
- Create: `src/lib/scoreV2.test.ts`

**Why two files.** `scoreMath.ts` knows nothing about buckets or questions and imports nothing, so
`scripts/score-parity.mjs` can load it under plain Node alongside `buckets.ts` (also a leaf) and
reuse the real mean instead of keeping a second copy — see Global Constraints. `scoreV2.ts` composes
the two and is what the application imports. The split is not ceremony: it is the difference between
Task 4 verifying the shipped arithmetic and Task 4 verifying a copy of it.

**A note on the filename.** `src/lib/score.ts` already exists and the deployed board and check-in
screen import `PILLARS`, `totalScore`, `bandFor` and `MAX_TOTAL` from it. This step must not break
them (see Global Constraints), so the new arithmetic lands beside the old in `scoreV2.ts`. A later
step deletes `score.ts` and renames this one, once nothing imports the old module.

**Interfaces:**
- Consumes: `Bucket`, `BUCKETS`, `GATED_BUCKET`, `ALL_QUESTIONS`, `questionsFor` from Task 1.
- Produces, from `scoreMath.ts` (leaf): `meanTo2dp(sum: number, divisor: number): number`,
  `meanOrNull(values: readonly (number | null | undefined)[]): number | null`,
  `bandFor(overall: number | null): Band`, `type Band`, `BAND_LABELS`, `SCORE_VALUES`,
  `HEALTHY_AT`, `WATCH_AT`, `MIN_SCORE`, `MAX_SCORE`. Task 4 imports `meanOrNull` from here.
- Produces, from `scoreV2.ts`: `type Answers = Partial<Record<string, number | null>>`, `SCORE_VALUES`,
  `requiredQuestions(advocacyApplies: boolean): readonly string[]`,
  `bucketScore(answers: Answers, bucket: Bucket): number | null`,
  `overallScore(answers: Answers, advocacyApplies: boolean): number | null`,
  `answeredCount(answers: Answers, advocacyApplies: boolean): number`,
  `bandFor(overall: number | null): Band`, `type Band`, `BAND_LABELS`.
  Tasks 4 and 6 consume `bucketScore` and `overallScore`; the UI steps consume all of them.

- [ ] **Step 1: Write the failing test**

Create `src/lib/scoreV2.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ALL_QUESTIONS, questionsFor } from './buckets'
import {
  answeredCount,
  bandFor,
  bucketScore,
  overallScore,
  requiredQuestions,
  type Answers,
} from './scoreV2'

// Builds a complete answer sheet with every question set to `value`.
function allAt(value: number): Answers {
  return Object.fromEntries(ALL_QUESTIONS.map((key) => [key, value]))
}

describe('requiredQuestions', () => {
  it('is all 22 when Advocacy applies', () => {
    expect(requiredQuestions(true)).toHaveLength(22)
  })

  it('is 18 when it does not, and excludes every Advocacy question', () => {
    const required = requiredQuestions(false)
    expect(required).toHaveLength(18)
    for (const question of questionsFor('advocacy')) {
      expect(required).not.toContain(question.key)
    }
  })
})

describe('bucketScore', () => {
  it('is the mean of the bucket\'s own questions', () => {
    const answers: Answers = {
      comm_constructive: 5,
      comm_timely: 4,
      comm_consistent: 3,
    }
    expect(bucketScore(answers, 'communication')).toBe(4)
  })

  it('rounds to two decimals', () => {
    const answers: Answers = {
      comm_constructive: 5,
      comm_timely: 4,
      comm_consistent: 4,
    }
    // 13 / 3 = 4.333...
    expect(bucketScore(answers, 'communication')).toBe(4.33)
  })

  it('is null when any of its questions is unanswered', () => {
    const answers: Answers = { comm_constructive: 5, comm_timely: 4 }
    expect(bucketScore(answers, 'communication')).toBeNull()
  })

  it('is null when a question is explicitly null, not just absent', () => {
    const answers: Answers = {
      comm_constructive: 5,
      comm_timely: 4,
      comm_consistent: null,
    }
    expect(bucketScore(answers, 'communication')).toBeNull()
  })

  it('scores Advocacy like any other bucket -- the gate is not its business', () => {
    const answers: Answers = {
      adv_left_review: 1,
      adv_case_study: 2,
      adv_would_refer: 3,
      adv_reference_check: 4,
    }
    expect(bucketScore(answers, 'advocacy')).toBe(2.5)
  })
})

describe('overallScore', () => {
  it('is the mean of all 22 answers when Advocacy applies', () => {
    expect(overallScore(allAt(3), true)).toBe(3)
  })

  it('is the mean of the 18 non-Advocacy answers when it does not', () => {
    expect(overallScore(allAt(3), false)).toBe(3)
  })

  it('ignores Advocacy answers entirely when the gate is closed', () => {
    const answers = { ...allAt(5), adv_left_review: 1, adv_case_study: 1 }
    expect(overallScore(answers, false)).toBe(5)
  })

  // This is the test that fails loudly if anyone reverts to averaging the six
  // bucket means. Spec §3.2 and §10 decision 2. Communication is all 5s (3
  // questions) and everything else is all 2s (19 questions).
  //   question-equal: (3*5 + 19*2) / 22 = 53 / 22 = 2.41
  //   bucket-equal:   (5 + 2 + 2 + 2 + 2 + 2) / 6 = 15 / 6 = 2.50
  it('weighs every question equally, not every bucket', () => {
    const answers: Answers = {
      ...allAt(2),
      comm_constructive: 5,
      comm_timely: 5,
      comm_consistent: 5,
    }
    expect(overallScore(answers, true)).toBe(2.41)
    expect(overallScore(answers, true)).not.toBe(2.5)
  })

  it('is null when one required answer is missing', () => {
    const answers = { ...allAt(4) }
    delete answers.del_on_time
    expect(overallScore(answers, true)).toBeNull()
  })

  it('is null when Advocacy applies and an Advocacy answer is missing', () => {
    const answers = { ...allAt(4) }
    delete answers.adv_would_refer
    expect(overallScore(answers, true)).toBeNull()
  })

  it('is NOT null when Advocacy is gated out and every Advocacy answer is missing', () => {
    const answers: Answers = {}
    for (const key of requiredQuestions(false)) answers[key] = 4
    expect(overallScore(answers, false)).toBe(4)
  })
})

describe('answeredCount', () => {
  it('counts only required questions, so a gated-out sheet cannot exceed 18', () => {
    expect(answeredCount(allAt(3), false)).toBe(18)
  })

  it('counts all 22 when the gate is open', () => {
    expect(answeredCount(allAt(3), true)).toBe(22)
  })

  it('ignores stray keys, because a restored draft is arbitrary JSON', () => {
    const answers = { ...allAt(3), not_a_question: 5 }
    expect(answeredCount(answers, true)).toBe(22)
  })
})

describe('bandFor', () => {
  it('reports not scored for null', () => {
    expect(bandFor(null)).toBe('incomplete')
  })

  it('is healthy at the threshold and above', () => {
    expect(bandFor(3.6)).toBe('healthy')
    expect(bandFor(5)).toBe('healthy')
  })

  it('is watch from its threshold up to just under healthy', () => {
    expect(bandFor(2.2)).toBe('watch')
    expect(bandFor(3.59)).toBe('watch')
  })

  it('is at risk below the watch threshold', () => {
    expect(bandFor(2.19)).toBe('at_risk')
    expect(bandFor(1)).toBe('at_risk')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/scoreMath.test.ts src/lib/scoreV2.test.ts`
Expected: FAIL — `Failed to resolve import "./scoreMath"` and `"./scoreV2"`.

- [ ] **Step 3: Write the implementation**

First create `src/lib/scoreMath.ts` — **this file must import nothing**:

```ts
// The arithmetic, with no knowledge of the rubric.
//
// This module imports NOTHING, deliberately. scripts/score-parity.mjs runs under
// plain Node, which cannot resolve this codebase's extensionless relative
// imports -- measured 2026-08-27: a value import of './dep' fails
// ERR_MODULE_NOT_FOUND while './dep.ts' resolves. Node strips TypeScript types
// on import, so a .ts file loads, but only if it has nothing of its own to
// resolve. Keeping the arithmetic here and the rubric in buckets.ts -- both
// leaves -- is what lets the verifier reuse the real implementation rather than
// keep a second copy of it that can drift.
//
// If you add an import to this file, `npm run verify:score` stops working, and
// it will look like a Node bug rather than what it is.

export type Band = 'healthy' | 'watch' | 'at_risk' | 'incomplete'

export const MIN_SCORE = 1
export const MAX_SCORE = 5

export const SCORE_VALUES = Array.from(
  { length: MAX_SCORE - MIN_SCORE + 1 },
  (_, index) => index + MIN_SCORE,
) as readonly number[]

// Restated on the 1-5 scale from Slice 1's 18 and 11 out of 25. Deliberately
// the exact arithmetic equivalents rather than round numbers: the bucket
// definitions changed this cycle, and moving the thresholds at the same time
// would make it impossible to tell whether a client's band moved because the
// client changed or because we did. Spec §10 decision 1.
export const HEALTHY_AT = 3.6
export const WATCH_AT = 2.2

export const BAND_LABELS: Record<Band, string> = {
  healthy: 'Healthy',
  watch: 'Watch',
  at_risk: 'At risk',
  incomplete: 'Not scored',
}

// Two decimals, matching what Postgres stores in numeric(3,2) and what the
// view's round(x, 2) produces. Computed from the integer sum and divisor rather
// than by rounding a float, so the two implementations cannot drift.
//
// No half-way case is reachable for the divisors this model uses (3, 4, 18 and
// 22): reaching one requires `sum * 100 / divisor` to be an odd half-integer,
// which for each of those divisors requires `sum` to be a multiple of the
// divisor -- and every such multiple yields an even numerator. So the rounding
// direction on a tie is never exercised, and the two implementations cannot
// disagree here regardless of which tie-breaking rule Postgres uses.
//
// Stated this way on purpose: an earlier draft asserted that Postgres rounds
// half away from zero. That is very likely true and it was never checked
// against a database, which makes it exactly the kind of confident unverified
// sentence this repository has a tally of. The conclusion does not need the
// premise, so the premise is gone rather than merely hedged.
export function meanTo2dp(sum: number, divisor: number): number {
  return Math.round((sum * 100) / divisor) / 100
}

// The mean of the given values, or null if ANY of them is missing. The null is
// the whole point: an incomplete set must never read as a low score, because a
// false "at risk" is as harmful as a false "healthy".
export function meanOrNull(
  values: readonly (number | null | undefined)[],
): number | null {
  let sum = 0
  for (const value of values) {
    if (value === null || value === undefined) return null
    sum += value
  }
  return meanTo2dp(sum, values.length)
}

export function bandFor(overall: number | null): Band {
  if (overall === null) return 'incomplete'
  if (overall >= HEALTHY_AT) return 'healthy'
  if (overall >= WATCH_AT) return 'watch'
  return 'at_risk'
}
```

Then create `src/lib/scoreV2.ts`, which composes it with the rubric:

```ts
import { BUCKETS, GATED_BUCKET, questionsFor, type Bucket } from './buckets'
import { meanOrNull } from './scoreMath'

export {
  BAND_LABELS,
  HEALTHY_AT,
  MAX_SCORE,
  MIN_SCORE,
  SCORE_VALUES,
  WATCH_AT,
  bandFor,
  type Band,
} from './scoreMath'

// A partial answer sheet. Partial because a draft is a check-in with questions
// still unanswered, and because a draft restored from localStorage is arbitrary
// JSON -- every function here iterates the rubric rather than the object's own
// keys, so a stray key cannot be counted.
export type Answers = Partial<Record<string, number | null>>

export function requiredQuestions(advocacyApplies: boolean): readonly string[] {
  const buckets = advocacyApplies
    ? BUCKETS
    : BUCKETS.filter((bucket) => bucket !== GATED_BUCKET)
  return buckets.flatMap((bucket) => questionsFor(bucket).map((q) => q.key))
}

export function bucketScore(answers: Answers, bucket: Bucket): number | null {
  return meanOrNull(questionsFor(bucket).map((question) => answers[question.key]))
}

// The mean of every REQUIRED answer -- not the mean of the six bucket scores.
// Spec §3.2: every question weighs the same, so a four-question bucket moves
// this number by a third more than a three-question bucket does. Reversing that
// ruling means changing this function and the view's expression, and nothing
// else -- the bucket columns exist either way for the matrix and the bars.
export function overallScore(
  answers: Answers,
  advocacyApplies: boolean,
): number | null {
  return meanOrNull(requiredQuestions(advocacyApplies).map((key) => answers[key]))
}

export function answeredCount(
  answers: Answers,
  advocacyApplies: boolean,
): number {
  let count = 0
  for (const key of requiredQuestions(advocacyApplies)) {
    const value = answers[key]
    if (value !== null && value !== undefined) count += 1
  }
  return count
}
```

Also create `src/lib/scoreMath.test.ts`, which pins the leaf directly:

```ts
import { describe, expect, it } from 'vitest'
import { meanOrNull, meanTo2dp } from './scoreMath'

describe('meanTo2dp', () => {
  it('rounds to two decimals', () => {
    expect(meanTo2dp(13, 3)).toBe(4.33)
    expect(meanTo2dp(53, 22)).toBe(2.41)
  })

  it('is exact when the division is', () => {
    expect(meanTo2dp(12, 4)).toBe(3)
  })
})

describe('meanOrNull', () => {
  it('is the mean of the values', () => {
    expect(meanOrNull([5, 4, 3])).toBe(4)
  })

  it('is null when any value is missing', () => {
    expect(meanOrNull([5, 4, null])).toBeNull()
    expect(meanOrNull([5, 4, undefined])).toBeNull()
  })
})
```

Finally create `tests/leafModules.test.ts` — the guard that keeps `verify:score` working. **It reads
the filesystem, so it must live in `tests/` and import with the `.ts` extension**; under `src/` it
would pass `npm test` and fail `npm run build`, because `tsconfig.app.json` has no node types.

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Same convention as tests/tokens.test.ts: resolve from the file, not the
// process CWD, so the guard holds however vitest is invoked.
const ROOT = join(import.meta.dirname, '..')

// scripts/score-parity.mjs is run by plain `node`, which cannot resolve this
// codebase's extensionless relative imports. Any module it reaches must
// therefore be a leaf. Adding an import to either file below breaks
// `npm run verify:score` with an ERR_MODULE_NOT_FOUND that looks like a Node
// bug rather than what it is -- so it is caught here instead.
const LEAVES = ['src/lib/scoreMath.ts', 'src/lib/buckets.ts']

describe('the modules scripts/score-parity.mjs loads under plain node', () => {
  for (const path of LEAVES) {
    it(`${path} has no runtime imports`, () => {
      const source = readFileSync(join(ROOT, path), 'utf8')
      const runtimeImports = source
        .split('\n')
        .filter((line) => /^\s*import\s/.test(line))
        // `import type` is erased before Node sees it, so it is harmless.
        .filter((line) => !/^\s*import\s+type\s/.test(line))
      expect(runtimeImports, `${path} must stay a leaf`).toEqual([])
    })
  }
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/scoreMath.test.ts src/lib/scoreV2.test.ts tests/leafModules.test.ts`
Expected: PASS — 4 tests in scoreMath, 21 in scoreV2, 2 in leafModules.

- [ ] **Step 5: Run the whole suite, build and lint**

Run: `npm test -- --run && npm run build && npm run lint`
Expected: all green. Nothing imports `scoreV2` yet, so the existing screens are untouched.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scoreMath.ts src/lib/scoreMath.test.ts src/lib/scoreV2.ts src/lib/scoreV2.test.ts tests/leafModules.test.ts
git commit -m "feat(score): bucket means, the gated overall, and the 1-5 bands

Lands beside score.ts rather than replacing it: the deployed board and check-in
screen still import PILLARS and totalScore, and this step must not break them.

The overall is the mean of every required answer, not of the six bucket means.
A test pins a vector where the two readings disagree (2.41 against 2.50) so a
silent revert to bucket-averaging fails rather than drifts."
```

---

### Task 3: The migration — 22 answers, six bucket averages, the gate view

**Files:**
- Create: `supabase/migrations/<generated>_six_bucket_scoring.sql`
- Modify: `src/types/database.ts` (regenerated, never hand-edited)

**Interfaces:**
- Consumes: the question keys from Task 1 as column names.
- Produces: `public.checkins` gains 22 nullable `smallint` answer columns and six generated
  `numeric(3,2)` bucket columns (`comm_score`, `growth_score`, `fin_score`, `rel_score`, `del_score`,
  `adv_score`); `public.clients` gains `started_on date`; and `public.checkin_scores` is a view
  exposing `id, client_id, period, <six bucket scores>, advocacy_applies boolean,
  overall_score numeric`. Tasks 4, 5 and 6 read all of it.

- [ ] **Step 1: Create the migration file**

Run: `npx --yes supabase@latest migration new six_bucket_scoring`

This generates the timestamped filename. **Do not invent the timestamp** — the CLI's ordering is
what guarantees this migration applies after `20260825203500_allowed_emails_created_by_default.sql`.

- [ ] **Step 2: Write the migration**

Write into the generated file:

```sql
-- Slice 4 step 1. The six-bucket, 22-question scoring model.
--
-- ADDITIVE ONLY. The five pillar columns and total_score are untouched and the
-- deployed site keeps reading them, because the database is migrated separately
-- from -- and ahead of -- the app deploy. Spec §5.4 renames them to legacy_*;
-- that rename is a LATER step, after nothing reads them. Applying it here would
-- break the live site the instant this ran.

-- The engagement start date. Nothing in the schema could stand in for it:
-- created_at records when the row was typed into this tool, not when the work
-- began. Nullable because the real dates do not exist yet and a not-null column
-- would require inventing them. A null start date closes the Advocacy gate.
alter table public.clients add column started_on date;

comment on column public.clients.started_on is
  'When the engagement began. Drives the 90-day Advocacy gate. Null means the '
  'gate stays closed: the tool never infers tenure it cannot prove.';

-- The 22 answers. Nullable because a draft is a check-in with questions still
-- unanswered; `check between 1 and 5` rather than an enum because that is how
-- status and end_reason_code are already stored on these tables.
alter table public.checkins
  add column comm_constructive smallint check (comm_constructive between 1 and 5),
  add column comm_timely smallint check (comm_timely between 1 and 5),
  add column comm_consistent smallint check (comm_consistent between 1 and 5),
  add column growth_goals_defined smallint check (growth_goals_defined between 1 and 5),
  add column growth_progress_trackable smallint check (growth_progress_trackable between 1 and 5),
  add column growth_hitting_goals smallint check (growth_hitting_goals between 1 and 5),
  add column fin_rack_rate smallint check (fin_rack_rate between 1 and 5),
  add column fin_pays_on_time smallint check (fin_pays_on_time between 1 and 5),
  add column fin_rate_increased smallint check (fin_rate_increased between 1 and 5),
  add column fin_on_terms smallint check (fin_on_terms between 1 and 5),
  add column rel_collaborative smallint check (rel_collaborative between 1 and 5),
  add column rel_respectful smallint check (rel_respectful between 1 and 5),
  add column rel_fun smallint check (rel_fun between 1 and 5),
  add column rel_multi_threaded smallint check (rel_multi_threaded between 1 and 5),
  add column del_on_time smallint check (del_on_time between 1 and 5),
  add column del_quantity smallint check (del_quantity between 1 and 5),
  add column del_client_likes smallint check (del_client_likes between 1 and 5),
  add column del_we_are_proud smallint check (del_we_are_proud between 1 and 5),
  add column adv_left_review smallint check (adv_left_review between 1 and 5),
  add column adv_case_study smallint check (adv_case_study between 1 and 5),
  add column adv_would_refer smallint check (adv_would_refer between 1 and 5),
  add column adv_reference_check smallint check (adv_reference_check between 1 and 5);

-- The six bucket averages, generated so they cannot drift from the answers they
-- summarise -- the same reason total_score is generated. Null propagation
-- through `+` is what enforces "an incomplete bucket has no score" in the
-- database rather than only in TypeScript.
--
-- The explicit ::numeric cast is load-bearing. Without it Postgres does integer
-- division on the smallint sum and (5 + 4 + 4) / 3 is 4, not 4.33.
--
-- numeric(3,2) holds 0.00 to 9.99, so the 1.00-5.00 range fits, and storing
-- into that scale is what rounds each mean to two decimals.
alter table public.checkins
  add column comm_score numeric(3,2) generated always as (
    (comm_constructive + comm_timely + comm_consistent)::numeric / 3
  ) stored,
  add column growth_score numeric(3,2) generated always as (
    (growth_goals_defined + growth_progress_trackable + growth_hitting_goals)::numeric / 3
  ) stored,
  add column fin_score numeric(3,2) generated always as (
    (fin_rack_rate + fin_pays_on_time + fin_rate_increased + fin_on_terms)::numeric / 4
  ) stored,
  add column rel_score numeric(3,2) generated always as (
    (rel_collaborative + rel_respectful + rel_fun + rel_multi_threaded)::numeric / 4
  ) stored,
  add column del_score numeric(3,2) generated always as (
    (del_on_time + del_quantity + del_client_likes + del_we_are_proud)::numeric / 4
  ) stored,
  add column adv_score numeric(3,2) generated always as (
    (adv_left_review + adv_case_study + adv_would_refer + adv_reference_check)::numeric / 4
  ) stored;

comment on column public.checkins.adv_score is
  'Null for two different reasons -- unanswered, and not applicable inside the '
  'first 90 days. public.checkin_scores.advocacy_applies is what tells them apart.';

-- The overall score cannot be a generated column, for two independent reasons
-- either of which alone is decisive: Postgres forbids a generated column
-- referencing another generated column, and a generation expression cannot
-- reference another table -- and the gate needs clients.started_on.
--
-- security_invoker is NOT decoration. Without it this view executes with its
-- owner's privileges, every RLS policy on checkins and clients is bypassed, and
-- any signed-in account reads every client's scores. Requires Postgres 15+;
-- production is 17.6, measured 2026-08-27. verify-scoring-view.sql asserts an
-- inactive account reads zero rows through it, because this is the db:which
-- failure class: a guard whose absence looks exactly like its presence.
create view public.checkin_scores with (security_invoker = true) as
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
  (c.started_on is not null and ch.period >= c.started_on + 90) as advocacy_applies,
  case
    when c.started_on is not null and ch.period >= c.started_on + 90
      then round(
        (ch.comm_constructive + ch.comm_timely + ch.comm_consistent
         + ch.growth_goals_defined + ch.growth_progress_trackable + ch.growth_hitting_goals
         + ch.fin_rack_rate + ch.fin_pays_on_time + ch.fin_rate_increased + ch.fin_on_terms
         + ch.rel_collaborative + ch.rel_respectful + ch.rel_fun + ch.rel_multi_threaded
         + ch.del_on_time + ch.del_quantity + ch.del_client_likes + ch.del_we_are_proud
         + ch.adv_left_review + ch.adv_case_study + ch.adv_would_refer
         + ch.adv_reference_check)::numeric / 22, 2)
    else round(
      (ch.comm_constructive + ch.comm_timely + ch.comm_consistent
       + ch.growth_goals_defined + ch.growth_progress_trackable + ch.growth_hitting_goals
       + ch.fin_rack_rate + ch.fin_pays_on_time + ch.fin_rate_increased + ch.fin_on_terms
       + ch.rel_collaborative + ch.rel_respectful + ch.rel_fun + ch.rel_multi_threaded
       + ch.del_on_time + ch.del_quantity + ch.del_client_likes
       + ch.del_we_are_proud)::numeric / 18, 2)
  end as overall_score
from public.checkins ch
join public.clients c on c.id = ch.client_id;

comment on view public.checkin_scores is
  'The gated overall score. Reads the answer columns, not the generated bucket '
  'columns, so a future change to how a bucket is derived cannot silently move '
  'the headline number. security_invoker: RLS is the callers own.';

-- Step 1 of the standing convention: revoke BEFORE any grant, because revoking
-- a table-level privilege also revokes it on every column.
revoke all on public.checkin_scores from anon, authenticated;
grant select on public.checkin_scores to authenticated;
```

- [ ] **Step 3: Confirm the target is staging, then apply**

Run: `npm run db:which`
Expected: exit 0, naming `tgc-client-health-staging`. **If it names production or exits 1, STOP.**

Run: `npm run db:push`

- [ ] **Step 4: Verify the migration applied and the view answers**

Run:
```bash
npx --yes supabase@latest db query --linked <<'SQL'
select count(*) as answer_columns
from information_schema.columns
where table_schema = 'public' and table_name = 'checkins'
  and column_name in (
    'comm_constructive','comm_timely','comm_consistent',
    'growth_goals_defined','growth_progress_trackable','growth_hitting_goals',
    'fin_rack_rate','fin_pays_on_time','fin_rate_increased','fin_on_terms',
    'rel_collaborative','rel_respectful','rel_fun','rel_multi_threaded',
    'del_on_time','del_quantity','del_client_likes','del_we_are_proud',
    'adv_left_review','adv_case_study','adv_would_refer','adv_reference_check');
SQL
```
Expected: `answer_columns` = 22.

**Remember the two measured traps:** `supabase db query` returns only the LAST statement's rows, so
run one statement at a time; and a success `NOTICE` is invisible through it, so evidence of a pass is
exit 0 plus the echoed row.

- [ ] **Step 5: Regenerate the types**

Run: `npx --yes supabase@latest gen types typescript --linked > src/types/database.ts`

**There is no `npm run types:generate` script** — an earlier draft of this plan named one and it does
not exist. The command above is the one documented at `README.md:411`. It is NOT guarded by
`db:which`, so confirm the link is staging before running it.

**Never hand-edit `src/types/database.ts`.** Confirm the diff contains `started_on`, the 22 answer
columns, the six `_score` columns, and a `checkin_scores` entry under `Views`.

- [ ] **Step 6: Run the suite, build and lint**

Run: `npm test -- --run && npm run build && npm run lint`
Expected: all green. The regenerated types are additive, so nothing that compiled before stops.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations src/types/database.ts
git commit -m "feat(db): 22 answers, six generated bucket means, and the gate view

Additive only -- the pillar columns and total_score are untouched, so the
deployed site keeps working while the database runs ahead of it. Spec §5.4's
legacy_* rename waits until nothing reads them.

The overall cannot be generated (no generated column may reference another, and
none may reach another table), so it lands in a security_invoker view. Without
that option the view would bypass every RLS policy on checkins and clients."
```

---

### Task 4: Rebuild the score verifier — `scripts/score-parity.mjs`

**Files:**
- Modify: `scripts/score-parity.mjs`
- Modify: `tests/generatedColumn.test.ts`

**Interfaces:**
- Consumes: `bucketScore` from Task 2, the bucket columns from Task 3.
- Produces: `scripts/.score-parity.generated.sql` (gitignored), run by `npm run verify:score`.

**Why this task exists and what it must preserve.** The existing verifier enumerates all 7,776 states
of five pillars over six values (1-5 plus null), computes each in TypeScript, then reads the live
expression out of `pg_attrdef` and evaluates it with dynamic SQL — so it checks what is *deployed*,
not a copy of it. Extended naively to 22 questions that is 6^22 states and the check is dead.

It survives because **each bucket's generated expression references only its own questions**, so the
space decomposes per bucket: 6^3 = 216 states for each of the two three-question buckets, and
6^4 = 1,296 for each of the four four-question buckets. 432 + 5,184 = **5,616 states, fewer than the
7,776 checked today, and still exhaustive** — every reachable input to every deployed bucket
expression. Preserving this property is why spec §5 chose 22 columns over a normalised answers table
or a jsonb blob; neither leaves a per-bucket expression in the catalogue to read and evaluate.

- [ ] **Step 1: Read the existing generator before changing it**

Run: `cat scripts/score-parity.mjs`

Note in particular how it reads the expression (`from pg_attrdef d ... and a.attname = 'total_score'`)
and how it chunks statements. The rewrite keeps both mechanisms and changes only what is enumerated.

- [ ] **Step 2: Write the failing test**

Add to `tests/generatedColumn.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BUCKETS, questionsFor } from '../src/lib/buckets.ts'
import { bucketScore } from '../src/lib/scoreV2.ts'
import { enumerateBucketStates } from '../scripts/score-parity.mjs'
// scoreV2 is safe to import HERE -- vitest resolves extensionless imports.
// Only scripts/*.mjs, run by plain node, is bound by the leaf rule.

describe('the per-bucket enumeration the verifier rests on', () => {
  it('covers exactly 6^n states for an n-question bucket', () => {
    for (const bucket of BUCKETS) {
      const n = questionsFor(bucket).length
      expect(enumerateBucketStates(bucket).length, bucket).toBe(6 ** n)
    }
  })

  it('totals 5,616 states across all six buckets -- fewer than the 7,776 checked before', () => {
    const total = BUCKETS.reduce(
      (sum, bucket) => sum + enumerateBucketStates(bucket).length,
      0,
    )
    expect(total).toBe(5616)
  })

  it('includes the all-null state and the all-5s state for every bucket', () => {
    for (const bucket of BUCKETS) {
      const keys = questionsFor(bucket).map((q) => q.key)
      const states = enumerateBucketStates(bucket)
      const allNull = states.find((s) => keys.every((k) => s[k] === null))
      const allFive = states.find((s) => keys.every((k) => s[k] === 5))
      expect(allNull, bucket).toBeDefined()
      expect(allFive, bucket).toBeDefined()
      expect(bucketScore(allNull, bucket), bucket).toBeNull()
      expect(bucketScore(allFive, bucket), bucket).toBe(5)
    }
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/generatedColumn.test.ts`
Expected: FAIL — `enumerateBucketStates` is not exported.

- [ ] **Step 4: Rewrite the generator**

Replace the enumeration in `scripts/score-parity.mjs` with a per-bucket one, keeping the existing
`pg_attrdef` lookup and chunking. Export the enumerator so the test above can reach it:

```js
// Both imports are LEAF modules -- neither has a relative import of its own --
// because plain Node cannot resolve this codebase's extensionless imports. See
// Global Constraints. Importing scoreV2.ts here would fail
// ERR_MODULE_NOT_FOUND, because scoreV2.ts imports './buckets'.
import { BUCKETS, questionsFor } from '../src/lib/buckets.ts'
import { meanOrNull } from '../src/lib/scoreMath.ts'

// The expected bucket mean, composed here from the same meanOrNull the
// application uses. Not a reimplementation: the arithmetic under test is the
// shipped one.
function expectedBucketScore(state, bucket) {
  return meanOrNull(questionsFor(bucket).map((question) => state[question.key]))
}

export const OUT = 'scripts/.score-parity.generated.sql'

// The six values a question can hold: unanswered, or 1 through 5.
const VALUES = [null, 1, 2, 3, 4, 5]

// Every combination of values across one bucket's own questions. This is the
// whole reason the check survives 22 questions: a bucket's generated expression
// references only its own columns, so the space is 6^n per bucket rather than
// 6^22 across the table.
export function enumerateBucketStates(bucket) {
  const keys = questionsFor(bucket).map((question) => question.key)
  let states = [{}]
  for (const key of keys) {
    states = states.flatMap((state) =>
      VALUES.map((value) => ({ ...state, [key]: value })),
    )
  }
  return states
}
```

Then emit, per bucket, a block that reads that bucket's live expression out of `pg_attrdef` and
evaluates it against every enumerated state:

```js
const BUCKET_SCORE_COLUMN = {
  communication: 'comm_score',
  growth: 'growth_score',
  finances: 'fin_score',
  relationship: 'rel_score',
  delivery: 'del_score',
  advocacy: 'adv_score',
}

function bucketCheckSql(bucket) {
  const column = BUCKET_SCORE_COLUMN[bucket]
  const keys = questionsFor(bucket).map((question) => question.key)
  const states = enumerateBucketStates(bucket)

  const rows = states
    .map((state) => {
      const expected = expectedBucketScore(state, bucket)
      const values = keys.map((key) => (state[key] === null ? 'null::smallint' : `${state[key]}::smallint`))
      values.push(expected === null ? 'null::numeric' : `${expected}::numeric`)
      return `(${values.join(', ')})`
    })
    .join(',\n    ')

  const columnList = [...keys, 'expected'].join(', ')

  return `
do $parity$
declare
  v_expr text;
  v_bad bigint;
begin
  select pg_get_expr(d.adbin, d.adrelid)
    into v_expr
    from pg_attrdef d
    join pg_attribute a
      on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.checkins'::regclass
     and a.attname = '${column}';

  if v_expr is null then
    raise exception 'score parity COULD NOT VERIFY: no generated expression on ${column}';
  end if;

  execute format(
    'select count(*) from (values %s) as t(${columnList}) where round((%s)::numeric, 2) is distinct from t.expected',
    $rows$${rows}$rows$,
    v_expr
  ) into v_bad;

  if v_bad > 0 then
    raise exception 'score parity FAILED for ${column}: % of ${states.length} states disagree between scoreV2.ts and the deployed expression', v_bad;
  end if;

  raise notice 'score parity ok for ${column}: ${states.length} states';
end
$parity$;
`
}
```

**Three things in that block are load-bearing and none are obvious.**

1. **`round((%s)::numeric, 2)` is required, and omitting it makes every state fail.**
   `pg_get_expr` returns the generation expression *without* the column's `numeric(3,2)` type — the
   rounding to two decimals happens when Postgres *stores* into that type, not inside the
   expression. So the raw expression yields `4.3333333333333333` where `bucketScore` yields `4.33`.
   Rounding here reproduces what storage does.
2. **The `values` alias names must be the real column names** (`t(comm_constructive, ...)`), because
   the expression read from the catalogue refers to them by name. That is what lets a live
   expression be evaluated against synthetic rows with nothing inserted.
3. **`is distinct from`, not `<>`.** Half of these states are null on both sides, and `null <> null`
   is null, not true — so `<>` would silently pass every null case, which is exactly the half that
   encodes "an incomplete bucket has no score".

**The failure message names the bucket.** The current script says "score parity FAILED in chunk N";
with six expressions under test, a chunk number alone does not identify which one disagreed.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/generatedColumn.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the verifier against staging**

Run: `npm run db:which` — confirm staging, then `npm run verify:score`

Expected: exit 0 and an echoed row. **It needs no data and inserts nothing**, so unlike
`verify:privileges` it is safe to run repeatedly.

- [ ] **Step 7: Prove the verifier can actually fail**

Temporarily change one expected value in the generator (for example, make `comm_score`'s expectation
`5` unconditionally), regenerate, and run it again. Expected: non-zero exit naming `comm_score`.
**Then revert the change.** A verifier that has never been seen to fail is not evidence — this
repository has a `db:which` guard that printed a warning and exited 0 for weeks.

- [ ] **Step 8: Commit**

```bash
git add scripts/score-parity.mjs tests/generatedColumn.test.ts
git commit -m "test(score): verify all six bucket expressions, exhaustively

Decomposes per bucket -- 2 x 6^3 + 4 x 6^4 = 5,616 states, fewer than the 7,776
checked before and still complete, because a bucket's generated expression
references only its own questions.

Confirmed it can fail: a deliberately wrong expectation for comm_score exits
non-zero and names the bucket."
```

---

### Task 5: Verify the view — `scripts/verify-scoring-view.sql`

**Files:**
- Create: `scripts/verify-scoring-view.sql`
- Modify: `package.json` (add `verify:scoring-view`)

**Interfaces:**
- Consumes: `public.checkin_scores` from Task 3.
- Produces: `npm run verify:scoring-view`.

**Why the view needs its own check.** `overall_score` sums 22 or 18 nullable answers, so it cannot be
enumerated exhaustively the way the bucket expressions can. Three things are checked instead: that
nulling any one required answer nulls the overall, and only when it should; that the gate flips at
its boundary; and that the view does not leak rows past RLS.

- [ ] **Step 1: Write the SQL**

Create `scripts/verify-scoring-view.sql`. Follow the house conventions in
`scripts/verify-privileges.sql`: numbered sections, `raise exception` on a violation, a final
echoing `select` on a pass, and **COULD NOT VERIFY as an outcome distinct from a pass** when the data
a section needs does not exist.

```sql
-- Slice 4 step 1. Pins public.checkin_scores: the gate, null propagation, the
-- arithmetic, and the RLS boundary.
--
-- Safe to re-run. Every fixture it creates is deleted in the same transaction.
-- Aim it at STAGING -- it inserts real rows and advances clients_id_seq.

-- No psql meta-commands: `supabase db query` sends SQL over a connection, not
-- through psql, and no other script in scripts/*.sql uses one. The `do` block
-- raises on any violation, which aborts the transaction and rolls back the
-- fixtures below -- so a failed run leaves nothing behind either.

do $verify$
declare
  -- The 18 answers that are always required, and the 4 that are gated.
  c_core text[] := array[
    'comm_constructive','comm_timely','comm_consistent',
    'growth_goals_defined','growth_progress_trackable','growth_hitting_goals',
    'fin_rack_rate','fin_pays_on_time','fin_rate_increased','fin_on_terms',
    'rel_collaborative','rel_respectful','rel_fun','rel_multi_threaded',
    'del_on_time','del_quantity','del_client_likes','del_we_are_proud'];
  c_adv text[] := array[
    'adv_left_review','adv_case_study','adv_would_refer','adv_reference_check'];
  c_all text[] := c_core || c_adv;

  -- The period is FIXED and started_on is what varies. period is always the
  -- first of a month, so moving the period cannot express a one-day boundary:
  -- date_trunc('month', start + 89) collapses to 59 days after the start, and
  -- an assertion on it would pass while proving nothing about 89 vs 90.
  c_period date := date '2026-04-01';
  c_at_89 date := date '2026-01-02';  -- + 90 = 2026-04-02, a day past period
  c_at_90 date := date '2026-01-01';  -- + 90 = 2026-04-01, exactly period
  c_at_91 date := date '2025-12-31';  -- + 90 = 2026-03-31, a day before

  v_start date := c_at_90;
  v_client bigint;
  v_open bigint;      -- the check-in under test once the gate is open
  v_closed bigint;    -- a second check-in kept gated shut, for the §2 loop
  v_col text;
  v_applies boolean;
  v_overall numeric;
  v_count bigint;
  v_set text;
begin
  -- Fixture. The name is deliberately unusable as a real client.
  insert into public.clients (name, started_on)
  values ('__verify_scoring_view__', v_start)
  returning id into v_client;

  v_set := (select string_agg(format('%I = 3', col), ', ') from unnest(c_all) as col);

  -- ============================================================ §1 the gate
  -- One check-in at a fixed period; started_on moves across the boundary.
  insert into public.checkins (client_id, period)
  values (v_client, c_period)
  returning id into v_open;

  update public.clients set started_on = c_at_89 where id = v_client;
  select advocacy_applies into v_applies
    from public.checkin_scores where id = v_open;
  if v_applies is not false then
    raise exception '§1 FAILED: gate open at 89 days (got %)', v_applies;
  end if;

  update public.clients set started_on = c_at_90 where id = v_client;
  select advocacy_applies into v_applies
    from public.checkin_scores where id = v_open;
  if v_applies is not true then
    raise exception '§1 FAILED: gate shut at exactly 90 days (got %)', v_applies;
  end if;

  update public.clients set started_on = c_at_91 where id = v_client;
  select advocacy_applies into v_applies
    from public.checkin_scores where id = v_open;
  if v_applies is not true then
    raise exception '§1 FAILED: gate shut at 91 days (got %)', v_applies;
  end if;

  -- A null start date must never open the gate.
  update public.clients set started_on = null where id = v_client;
  select advocacy_applies into v_applies
    from public.checkin_scores where id = v_open;
  if v_applies is not false then
    raise exception '§1 FAILED: null started_on opened the gate (got %)', v_applies;
  end if;

  -- Settle on the open state for §2 and §3, and add the gated-shut check-in the
  -- §2 loop needs. Its period is well before the start date, so it stays shut.
  update public.clients set started_on = c_at_90 where id = v_client;
  insert into public.checkins (client_id, period)
  values (v_client, date '2025-06-01')
  returning id into v_closed;

  select advocacy_applies into v_applies
    from public.checkin_scores where id = v_closed;
  if v_applies is not false then
    raise exception '§1 FAILED: the gated-shut fixture is open (got %)', v_applies;
  end if;

  raise notice '§1 ok: shut at 89d, open at exactly 90d and at 91d, shut on a null start date';

  -- ================================================ §2 null propagation, 44
  -- Fill both check-ins completely, then null one answer at a time.
  execute format('update public.checkins set %s where id in ($1, $2)', v_set)
    using v_open, v_closed;

  -- Gate OPEN: nulling any of the 22 must null the overall.
  foreach v_col in array c_all loop
    execute format('update public.checkins set %I = null where id = $1', v_col) using v_open;
    select overall_score into v_overall from public.checkin_scores where id = v_open;
    if v_overall is not null then
      raise exception '§2 FAILED: gate open, % nulled, overall still % ', v_col, v_overall;
    end if;
    execute format('update public.checkins set %I = 3 where id = $1', v_col) using v_open;
  end loop;

  -- Gate CLOSED: the 18 core answers null it; the 4 Advocacy answers must not.
  foreach v_col in array c_core loop
    execute format('update public.checkins set %I = null where id = $1', v_col) using v_closed;
    select overall_score into v_overall from public.checkin_scores where id = v_closed;
    if v_overall is not null then
      raise exception '§2 FAILED: gate closed, core % nulled, overall still %', v_col, v_overall;
    end if;
    execute format('update public.checkins set %I = 3 where id = $1', v_col) using v_closed;
  end loop;

  foreach v_col in array c_adv loop
    execute format('update public.checkins set %I = null where id = $1', v_col) using v_closed;
    select overall_score into v_overall from public.checkin_scores where id = v_closed;
    if v_overall is null then
      raise exception '§2 FAILED: gate closed, Advocacy % nulled the overall', v_col;
    end if;
    execute format('update public.checkins set %I = 3 where id = $1', v_col) using v_closed;
  end loop;

  raise notice '§2 ok: 44 null cases, Advocacy required only when the gate is open';

  -- ======================================================== §3 arithmetic
  -- All 3s is exactly 3.00 in both gate states.
  select overall_score into v_overall from public.checkin_scores where id = v_open;
  if v_overall is distinct from 3.00 then
    raise exception '§3 FAILED: all-3s gate open gave %, expected 3.00', v_overall;
  end if;
  select overall_score into v_overall from public.checkin_scores where id = v_closed;
  if v_overall is distinct from 3.00 then
    raise exception '§3 FAILED: all-3s gate closed gave %, expected 3.00', v_overall;
  end if;

  -- The vector where the two weightings disagree (spec §3.2). Communication all
  -- 5s, the other 19 questions all 2s:
  --   question-equal (correct): (3*5 + 19*2) / 22 = 53 / 22 = 2.41
  --   bucket-equal   (wrong):   (5 + 2 + 2 + 2 + 2 + 2) / 6 = 2.50
  execute format(
    'update public.checkins set %s where id = $1',
    (select string_agg(format('%I = 2', col), ', ') from unnest(c_all) as col)
  ) using v_open;
  update public.checkins
     set comm_constructive = 5, comm_timely = 5, comm_consistent = 5
   where id = v_open;

  select overall_score into v_overall from public.checkin_scores where id = v_open;
  if v_overall is distinct from 2.41 then
    raise exception
      '§3 FAILED: weighting vector gave %, expected 2.41. 2.50 means the overall '
      'reverted to averaging the six bucket means instead of the 22 answers.',
      v_overall;
  end if;

  raise notice '§3 ok: 3.00 in both gate states, and 2.41 not 2.50 on the weighting vector';

  -- ============================================================== §4 RLS
  -- WHY THIS SECTION EXISTS: without `with (security_invoker = true)` the view
  -- runs as its owner, every RLS policy on checkins and clients is bypassed,
  -- and any signed-in account reads every client's scores. From the application
  -- the two are indistinguishable. This is the db:which failure class -- a
  -- guard whose absence looks exactly like its presence.
  if not exists (select 1 from public.profiles where is_active = false) then
    raise notice '§4 COULD NOT VERIFY: no inactive profile on this project. NOT A PASS.';
  else
    declare
      v_inactive uuid;
    begin
      select id into v_inactive from public.profiles where is_active = false limit 1;
      set local role authenticated;
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_inactive, 'role', 'authenticated')::text, true);

      select count(*) into v_count from public.checkin_scores;

      reset role;
      if v_count <> 0 then
        raise exception
          '§4 FAILED: an inactive account read % rows through checkin_scores. '
          'The view is almost certainly missing security_invoker.', v_count;
      end if;
      raise notice '§4 ok: an inactive account reads zero rows through the view';
    end;
  end if;

  -- Fixtures go, including the check-ins, which cascade from the client.
  delete from public.clients where id = v_client;
  raise notice 'verify:scoring-view PASSED';
end
$verify$;

-- A NOTICE is invisible through `supabase db query` (measured), so the evidence
-- of a pass is exit 0 plus this echoed row.
select 'verify:scoring-view completed' as result;
```

**Two traps this script is written around.** `supabase db query` returns only the LAST statement's
rows, which is why the whole check is one `do` block followed by one `select`. And `is distinct from`
is used throughout rather than `<>`, because half the assertions compare nulls and `null <> null` is
null rather than true — `<>` would pass the entire null-propagation section vacuously.

- [ ] **Step 2: Wire up the script**

Add to `package.json` scripts, matching the guarded shape of its siblings exactly:

```json
"verify:scoring-view": "npm run db:which && npx --yes supabase@latest db query --linked -f scripts/verify-scoring-view.sql"
```

- [ ] **Step 3: Run it against staging**

Run: `npm run db:which` — confirm staging, then `npm run verify:scoring-view`
Expected: exit 0 and echoed rows. §4 may report COULD NOT VERIFY if staging holds no inactive
profile; that is not a pass, and Step 5 resolves it.

- [ ] **Step 4: Prove it can fail**

Recreate the view locally without `with (security_invoker = true)`, re-run, and confirm §4 raises.
**Then restore the view.** This is the single most important assertion in the step and it must be
seen to fire.

- [ ] **Step 5: Resolve any COULD NOT VERIFY**

If §4 could not run, create an inactive profile on staging so it can. Do not leave the section
unexercised and do not read COULD NOT VERIFY as a pass — Slice 2 carried an unexercised §10f for
three steps precisely this way.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-scoring-view.sql package.json
git commit -m "test(db): pin the gate, null propagation and the view's RLS

44 null cases (22 answers x 2 gate states), the gate boundary at 89/90/91 days
and a null start date, and the 2.41-not-2.50 vector that catches a revert to
bucket-averaging.

§4 asserts an inactive account reads zero rows through the view. Confirmed it
fires: recreating the view without security_invoker raises. That failure is
invisible from the application, which is why it is asserted here."
```

---

### Task 6: Prove the whole step on staging

**Files:** none — this task produces evidence, not code.

- [ ] **Step 1: Confirm the target**

Run: `npm run db:which`
Expected: exit 0, `tgc-client-health-staging`.

- [ ] **Step 2: Run every gate**

```bash
npm test -- --run && npm run build && npm run lint
npm run verify:score
npm run verify:scoring-view
npm run verify:privileges
npm run verify:capability
npm run verify:lifecycle
```

`verify:privileges` and `verify:capability` are included because Task 3 added a view and changed
grants — the point is to confirm this step broke nothing that already passed.

- [ ] **Step 3: Confirm the deployed site still works**

The live site reads the untouched pillar columns. Load
https://thegroundedco.github.io/tgc-client-health/, sign in, open a check-in and confirm the board
still renders. **This is the assertion that the additive-only constraint held.** No test can make it:
the deployed bundle predates this branch, and the database is what changed underneath it.

- [ ] **Step 4: Write the ledger**

Create `.superpowers/sdd/2026-08-27-slice-4-step-1-scoring-engine/progress.md` (gitignored, so it
lives only on this machine) recording per task: what was done, what was measured, and any deviation
from this plan. **Every number in it must come from a command run in the same breath as the sentence
containing it** — this repository's false-claim tally stands at nineteen, and the last two were
numbers typed in the gap between running a gate and writing the summary.

- [ ] **Step 5: Answer the standing question out loud**

For this step the answer is unusual and must be recorded as such: **would a person know this worked?
No — and deliberately so.** This step ships no user interface. Nothing on screen changes. Its
evidence is entirely `verify:score`, `verify:scoring-view` and the fact that the deployed site is
unaffected. The first time a person can see the new model is Step 2, the check-in screen.

- [ ] **Step 6: Do not push**

`main` deploys GitHub Pages on push, and this branch is not ready to merge. Leave the commits local
and report the branch state to the owner.

---

## What this step deliberately leaves undone

- **The `legacy_*` rename** (spec §5.4). Waits until no code reads the pillar columns.
- **`src/lib/score.ts` and `pillars.ts`** still exist and are still imported by the deployed screens.
  They are deleted in the step that replaces their last consumer.
- **`started_on` has no UI.** The field on `AddClientForm` / `EditClientForm` is Step 3. Until then
  the column is null for every client, so the Advocacy gate is closed everywhere — which is the
  intended rollout: Advocacy lights up per client as the owner fills the dates in.
- **Every screen.** The check-in screen is Step 2; the board and the clients admin are Step 3;
  production is Step 4.
