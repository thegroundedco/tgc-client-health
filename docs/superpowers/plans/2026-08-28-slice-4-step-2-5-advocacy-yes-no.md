# Slice 4 Step 2.5 — Advocacy Leaves the Overall, and Becomes Yes/No — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take Advocacy out of the overall score everywhere, and turn its four questions from 1–5 scales into yes/no booleans.

**Architecture:** Two owner rulings from 2026-08-28, both amended into the spec. The overall becomes the mean of the eighteen non-Advocacy answers, always — so the view's `case` collapses to one branch and `overallScore` loses its gate parameter. The four `adv_*` columns become `boolean`, and `adv_score` becomes `1 + the number of yeses`, which lands on exactly 1.00–5.00 and therefore needs no special case in anything that consumes a bucket score. The 90-day gate survives and still decides whether the four questions are asked.

**Tech Stack:** React 19 + TypeScript, Vite, CSS Modules, Supabase (postgrest-js), Postgres 17.6, Vitest + Testing Library, jsdom.

**Spec:** `docs/superpowers/specs/2026-08-27-phase-2-slice-4-scoring-model-design.md` — read §3.1's amendment, §3.2's amendment (the whole block above the superseded paragraph), §5.2, §5.3, §6 and §9.2. Commit `90c934b`.

**Branch:** `slice-4-scoring-model`, continuing from `90c934b`. **Nothing on this branch is pushed and `origin/main` is still `1ae2f97`. Do not push** — GitHub Pages deploys on push and production is unmigrated.

---

## Why this is happening now, and not later

The four `adv_*` columns exist on **staging only**, and hold **no data** — measured 2026-08-28: one `checkins` row on staging, all four Advocacy columns null; production has never had the six-bucket migration applied at all.

So today this is a type change against empty columns. After step 4 migrates production and one scoring round happens, the same change is a data migration on real answers, and "what does a 3 out of 5 become as a yes/no?" is a question with no good answer. **This step exists now specifically to avoid ever having to answer it.**

---

## Global Constraints

- **The overall score NEVER includes Advocacy.** Not in the view, not in `scoreV2`, not on any screen. A gate-open check-in with all four Advocacy answers blank still has a real overall score.
- **`required` and the overall's divisor are DIFFERENT NUMBERS.** `required` — what every on-screen count reads against, and what decides whether a check-in is complete enough to submit — is still 22 when the gate is open and 18 when shut. The overall's divisor is 18, always. Do not collapse them back into one.
- **A missing answer must never read as a low score.** Null, never a partial mean, never zero. For Advocacy this now has a second edge: **null and `false` are different**. Null is unanswered; `false` is answered No. Conflating them either invents an answer nobody gave or makes a complete check-in look incomplete.
- **`src/lib/scoreMath.ts` and `src/lib/buckets.ts` must keep ZERO runtime imports.** `tests/leafModules.test.ts` enforces it; `npm run verify:score` breaks otherwise.
- **No colour or typeface literals outside `src/styles/tokens.css`.** `tests/tokens.test.ts` walks every `.css`/`.ts`/`.tsx`/`.html`/`.svg`, comments included.
- **No per-element margins for spacing** — gaps come from flex/grid containers.
- **`@testing-library/jest-dom` is NOT installed.** Plain vitest matchers only: `toBe`, `toEqual`, `toContain`, `toHaveProperty`, `toBeNull`, `toHaveLength`, `toThrow`. Translate, never install.
- **`import type` for type-only imports** (`verbatimModuleSyntax` is on).
- **Never `git commit -a`.** Stage explicit paths.
- **Do not consolidate existing tests into broader new ones.** This happened twice in the previous step; once it silently lost two real cases and had to be sent back. If two tests seem to overlap, keep both and say so in your report.
- **Baseline before Task 1: 637 tests / 44 files, build clean, lint clean.** Confirm with `npm test -- --run` before starting.

---

## File Structure

**Created**
| File | Responsibility |
|---|---|
| `supabase/migrations/<ts>_advocacy_yes_no.sql` | Drops the view and `adv_score`, retypes the four columns to `boolean`, rebuilds both. |
| `src/checkin/YesNoRow.tsx` + `.module.css` + `.dom.test.tsx` | One yes/no question: prompt, Yes / No, Clear, last month. |

**Modified**
| File | Change |
|---|---|
| `src/lib/buckets.ts` | `Question` gains `kind: 'scale' \| 'yesno'`; Advocacy's four are `'yesno'`. Stays a LEAF. |
| `src/lib/scoreMath.ts` | Gains `yesNoScore`. Stays a LEAF. |
| `src/lib/scoreV2.ts` | `overallScore` loses its gate parameter; `bucketScore` dispatches on kind; `OVERALL_QUESTIONS` added. |
| `src/checkin/draftCache.ts` | Accepts booleans for `yesno` keys; version `v2` → `v3`; v2 drafts rejected and deleted. |
| `src/checkin/useCheckin.ts` | `setAnswer` takes `number \| boolean \| null`; overall no longer gate-dependent. |
| `src/checkin/CheckIn.tsx` | Renders `YesNoRow` for `yesno` questions, `QuestionRow` for `scale`. |
| `src/types/database.ts` | Regenerated. |
| `scripts/score-parity.mjs` | Advocacy arm enumerates 3 boolean states, not 6. 4,401 states. |
| `scripts/verify-scoring-view.sql` | New properties per spec §9.2's amendment. |
| Their tests | `buckets.test.ts`, `scoreMath.test.ts`, `scoreV2.test.ts`, `draftCache.test.ts`, `useCheckin.dom.test.ts`, `CheckIn.test.tsx`, `CheckIn.dom.test.tsx`, `tests/generatedColumn.test.ts` |

**Deliberately untouched:** `src/board/` (step 3 owns the board), `src/lib/gate.ts` and `tests/gateParity.test.ts` (the gate predicate is unchanged — only what it *controls* narrowed), `src/lib/score.ts` and `src/lib/pillars.ts` (retired in step 3).

---

## Task 1: The migration

**Files:** Create `supabase/migrations/<timestamp>_advocacy_yes_no.sql`; modify `src/types/database.ts` (regenerated).

**Interfaces:** Produces the boolean columns, the new `adv_score`, and the single-branch `overall_score`. Every later task depends on the regenerated types.

**A NEW migration file, not an edit to `20260827192720_six_bucket_scoring.sql`.** That one is already applied to staging and Supabase tracks applied migrations by name — editing it would leave the file and the database silently disagreeing, which is the exact class of failure this project has a `db:which` guard for. The old migration stays as the historical record of what was applied.

- [ ] **Step 1: Write the migration**

Generate the timestamp with `date -u +%Y%m%d%H%M%S`.

```sql
-- Advocacy becomes yes/no, and leaves the overall score. Spec §3.1, §3.2, §5.2,
-- §5.3, §6 (all amended 2026-08-28).
--
-- Safe as a plain type change because the columns are EMPTY: measured
-- 2026-08-28, staging holds one checkins row with all four adv_* null, and
-- production has never had 20260827192720 applied at all. There is no 1-5
-- Advocacy answer anywhere to translate, which is the whole reason this lands
-- before step 4 rather than after it.

-- The view and the generated column both depend on the four columns, so both
-- come down first. Dropping the view is not destructive -- it holds no data.
drop view if exists public.checkin_scores;
alter table public.checkins drop column if exists adv_score;

alter table public.checkins
  drop column adv_left_review,
  drop column adv_case_study,
  drop column adv_would_refer,
  drop column adv_reference_check;

-- boolean, not a smallint constrained to two values. The column then states what
-- it is, and nobody can later write a 3 into it. Null still means unanswered;
-- false means answered No, and the two must never be conflated.
alter table public.checkins
  add column adv_left_review boolean,
  add column adv_case_study boolean,
  add column adv_would_refer boolean,
  add column adv_reference_check boolean;

-- 1 + the number of yeses, which is exactly 1.00, 2.00, 3.00, 4.00, 5.00 for
-- zero through four yeses -- the same 1.00-5.00 range as the other five buckets,
-- so nothing that consumes a bucket score needs a special case for this one.
--
-- Null propagation is what makes §3.3 hold: `true::int` is 1, `false::int` is 0,
-- and `null::int` is null, so any unanswered question nulls the whole sum and
-- therefore the score. An unanswered Advocacy question can never read as a low
-- one.
alter table public.checkins
  add column adv_score numeric(3,2) generated always as (
    (1 + adv_left_review::int + adv_case_study::int
       + adv_would_refer::int + adv_reference_check::int)::numeric
  ) stored;

comment on column public.checkins.adv_score is
  'Advocacy: 1 + the number of yeses, so 1.00-5.00 like every other bucket. '
  'Null when any of the four is unanswered -- which is NOT the same as four Nos, '
  'which scores 1.00. This bucket does not feed overall_score (spec 3.2).';

-- The overall, rebuilt. The case expression is GONE: Advocacy is excluded
-- whether the gate is open or shut, so there is one branch, not two.
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
  -- Retained even though overall_score no longer consults it: the check-in
  -- screen and the board both need to know whether the gate is open, and
  -- computing it here keeps the database's answer comparable with the
  -- TypeScript gate's (tests/gateParity.test.ts reads the 90 out of this file).
  (c.started_on is not null and ch.period >= c.started_on + 90) as advocacy_applies,
  round(
    (ch.comm_constructive + ch.comm_timely + ch.comm_consistent
     + ch.growth_goals_defined + ch.growth_progress_trackable + ch.growth_hitting_goals
     + ch.fin_rack_rate + ch.fin_pays_on_time + ch.fin_rate_increased + ch.fin_on_terms
     + ch.rel_collaborative + ch.rel_respectful + ch.rel_fun + ch.rel_multi_threaded
     + ch.del_on_time + ch.del_quantity + ch.del_client_likes
     + ch.del_we_are_proud)::numeric / 18, 2) as overall_score
from public.checkins ch
join public.clients c on c.id = ch.client_id;

comment on view public.checkin_scores is
  'The overall score: the mean of the eighteen non-Advocacy answers, always. '
  'Advocacy is excluded whatever the gate says (spec 3.2, amended 2026-08-28). '
  'security_invoker: RLS is the callers own.';

revoke all on public.checkin_scores from anon, authenticated;
grant select on public.checkin_scores to authenticated;
```

- [ ] **Step 2: Confirm the target, then apply**

```bash
npm run db:which     # MUST print tgc-client-health-staging. Stop if it does not.
npm run db:push
```

- [ ] **Step 3: Prove the shape landed**

Write to a scratch file and run with `npx --yes supabase@latest db query --linked -f <file>`:

```sql
select column_name, data_type
from information_schema.columns
where table_name = 'checkins' and column_name like 'adv\_%'
order by column_name;

-- Expect: adv_case_study, adv_left_review, adv_reference_check,
-- adv_would_refer all `boolean`, and adv_score `numeric`.

select
  -- four Nos is a real, low score, not an absence
  (select 1 + false::int + false::int + false::int + false::int) as four_nos,
  -- an unanswered question nulls it
  (select 1 + true::int + true::int + true::int + null::int) as one_blank;
-- Expect four_nos = 1, one_blank = null.
```

Expected: exactly that. **If `one_blank` is not null, stop** — null propagation is what §3.3 rests on.

- [ ] **Step 4: Regenerate types**

```bash
npx --yes supabase@latest gen types typescript --linked > src/types/database.ts
```

Confirm the four `adv_*` are now `boolean | null` in the `checkins` Row, and that `checkin_scores` still exposes `advocacy_applies` and `overall_score`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations src/types/database.ts
git commit -m "feat(db): Advocacy answers become boolean, and leave the overall score"
```

---

## Task 2: The rubric learns that a question has a kind

**Files:** Modify `src/lib/buckets.ts`, `src/lib/buckets.test.ts`.

**Interfaces:** Produces `Question.kind: 'scale' | 'yesno'`, `isYesNo(key): boolean`, `OVERALL_QUESTIONS: readonly string[]` (the eighteen). Consumed by Tasks 3, 4, 5, 6, 7.

**`buckets.ts` MUST stay a leaf — zero runtime imports.** `tests/leafModules.test.ts` fails the build otherwise and `npm run verify:score` stops working with an error that looks like a Node bug.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/buckets.test.ts`:

```ts
describe('question kinds', () => {
  it('marks every Advocacy question yes/no and every other question scale', () => {
    for (const bucket of BUCKETS) {
      for (const question of questionsFor(bucket)) {
        expect(question.kind).toBe(bucket === GATED_BUCKET ? 'yesno' : 'scale')
      }
    }
  })

  it('isYesNo agrees with the definitions, and is false for an unknown key', () => {
    expect(isYesNo('adv_left_review')).toBe(true)
    expect(isYesNo('comm_timely')).toBe(false)
    expect(isYesNo('not_a_question')).toBe(false)
  })

  // The eighteen that make the overall. Spec §3.2 as amended: Advocacy is
  // excluded whatever the gate says, so this list is fixed and does not take a
  // gate argument.
  it('OVERALL_QUESTIONS is the 18 non-Advocacy keys, in rubric order', () => {
    expect(OVERALL_QUESTIONS).toHaveLength(18)
    expect(OVERALL_QUESTIONS.some((k) => isYesNo(k))).toBe(false)
    expect([...OVERALL_QUESTIONS]).toEqual(
      ALL_QUESTIONS.filter((k) => !isYesNo(k)),
    )
  })

  it('the four yes/no keys are exactly the Advocacy bucket', () => {
    expect(ALL_QUESTIONS.filter(isYesNo)).toEqual(
      questionsFor(GATED_BUCKET).map((q) => q.key),
    )
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --run src/lib/buckets.test.ts`
Expected: FAIL — `kind` is not a property of `Question`.

- [ ] **Step 3: Widen `buckets.ts`**

```ts
export type QuestionKind = 'scale' | 'yesno'

export type Question = {
  // The column on public.checkins. Also the key in an Answers object.
  key: string
  prompt: string
  // How it is answered, and therefore what column type holds it. 'scale' is a
  // 1-5 smallint; 'yesno' is a boolean. Carried per question rather than per
  // bucket, even though today every yesno question happens to be in Advocacy:
  // the rubric is the one place that knows what a question IS, and a consumer
  // asking "is this bucket Advocacy?" to decide how to render a control would
  // be reading identity where it means to read type.
  kind: QuestionKind
}
```

Add `kind: 'scale'` to all eighteen non-Advocacy questions and `kind: 'yesno'` to Advocacy's four. Then:

```ts
export function isYesNo(key: string): boolean {
  return YESNO_KEYS.includes(key)
}

const YESNO_KEYS: readonly string[] = BUCKETS.flatMap((bucket) =>
  questionsFor(bucket)
    .filter((question) => question.kind === 'yesno')
    .map((question) => question.key),
)

// The eighteen the overall is the mean of. Spec §3.2 as amended: Advocacy is
// excluded whether the gate is open or shut, so unlike requiredQuestions() in
// scoreV2 this takes no gate argument and never varies. Keeping the two apart
// is the whole point -- they were one number before 2026-08-28 and are two now.
export const OVERALL_QUESTIONS: readonly string[] = BUCKETS.flatMap((bucket) =>
  questionsFor(bucket)
    .filter((question) => question.kind === 'scale')
    .map((question) => question.key),
)
```

Declaration order matters — `YESNO_KEYS` must be declared before `isYesNo` uses it at module scope, or hoisting bites.

- [ ] **Step 4: Run tests, then prove the leaf rule still holds**

```bash
npm test -- --run src/lib/buckets.test.ts tests/leafModules.test.ts
```
Expected: both PASS. If `leafModules` fails you added an import to a leaf — remove it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/buckets.ts src/lib/buckets.test.ts
git commit -m "feat(score): a question knows whether it is a scale or a yes/no"
```

---

## Task 3: The arithmetic

**Files:** Modify `src/lib/scoreMath.ts`, `src/lib/scoreMath.test.ts`, `src/lib/scoreV2.ts`, `src/lib/scoreV2.test.ts`.

**Interfaces:**
- Produces `yesNoScore(values: readonly (boolean | null | undefined)[]): number | null` in `scoreMath.ts`
- `Answers = Partial<Record<string, number | boolean | null>>`
- `overallScore(answers: Answers): number | null` — **the gate parameter is gone**
- `bucketScore(answers, bucket)` — dispatches on question kind
- `requiredQuestions(advocacyApplies)` — **unchanged**, still 22/18, still about completeness
- `answeredCount(answers, advocacyApplies)` — counts booleans as answered, including `false`

Consumed by Tasks 4, 6, 7.

- [ ] **Step 1: Write the failing tests**

`src/lib/scoreMath.test.ts`:

```ts
describe('yesNoScore', () => {
  // 1 + the number of yeses. Exactly the migration's generated expression, and
  // verify:score is what proves the two agree.
  it('is 1 for all No and 5 for all Yes, stepping by one', () => {
    expect(yesNoScore([false, false, false, false])).toBe(1)
    expect(yesNoScore([true, false, false, false])).toBe(2)
    expect(yesNoScore([true, true, false, false])).toBe(3)
    expect(yesNoScore([true, true, true, false])).toBe(4)
    expect(yesNoScore([true, true, true, true])).toBe(5)
  })

  // The distinction the whole model rests on: four Nos is a real, low score;
  // one blank is no score at all.
  it('is null if any answer is missing, which is NOT the same as No', () => {
    expect(yesNoScore([true, true, true, null])).toBeNull()
    expect(yesNoScore([true, true, true, undefined])).toBeNull()
    expect(yesNoScore([false, false, false, false])).toBe(1)
  })
})
```

`src/lib/scoreV2.test.ts`:

```ts
describe('overallScore', () => {
  // Spec §3.2 amended: Advocacy never counts. The signature has no gate
  // parameter at all, which is the point -- there is no way to ask for the old
  // 22-divisor behaviour by accident.
  it('is the mean of the 18, and ignores Advocacy entirely', () => {
    const eighteen = Object.fromEntries(OVERALL_QUESTIONS.map((k) => [k, 4]))
    expect(overallScore(eighteen)).toBe(4)
    // Adding every Advocacy answer, either way, must not move it.
    const withYes = { ...eighteen, adv_left_review: true, adv_case_study: true,
                      adv_would_refer: true, adv_reference_check: true }
    const withNo = { ...eighteen, adv_left_review: false, adv_case_study: false,
                     adv_would_refer: false, adv_reference_check: false }
    expect(overallScore(withYes)).toBe(4)
    expect(overallScore(withNo)).toBe(4)
  })

  // The regression that would signal a reversion to the old model.
  it('still has an overall when every Advocacy answer is blank', () => {
    const eighteen = Object.fromEntries(OVERALL_QUESTIONS.map((k) => [k, 3]))
    expect(overallScore(eighteen)).toBe(3)
  })

  it('is null when any one of the 18 is missing', () => {
    for (const key of OVERALL_QUESTIONS) {
      const answers = Object.fromEntries(OVERALL_QUESTIONS.map((k) => [k, 3]))
      delete answers[key]
      expect(overallScore(answers)).toBeNull()
    }
  })
})

describe('bucketScore', () => {
  it('uses the yes/no arithmetic for Advocacy and the mean for the rest', () => {
    expect(bucketScore({ adv_left_review: true, adv_case_study: true,
                         adv_would_refer: false, adv_reference_check: false },
                       'advocacy')).toBe(3)
    expect(bucketScore({ comm_constructive: 2, comm_timely: 4,
                         comm_consistent: 3 }, 'communication')).toBe(3)
  })

  it('is null for a bucket with any unanswered question, either kind', () => {
    expect(bucketScore({ adv_left_review: true }, 'advocacy')).toBeNull()
    expect(bucketScore({ comm_constructive: 2 }, 'communication')).toBeNull()
  })
})

describe('requiredQuestions and answeredCount', () => {
  // UNCHANGED by the amendment. required is about COMPLETENESS -- how many
  // answers before a check-in may be submitted -- and is still 22 gate-open.
  // Only the overall's divisor moved. Keeping these two apart is the point.
  it('still requires 22 when the gate is open and 18 when it is shut', () => {
    expect(requiredQuestions(true)).toHaveLength(22)
    expect(requiredQuestions(false)).toHaveLength(18)
  })

  // false is an ANSWER. Counting it as unanswered would make a complete
  // check-in permanently unsubmittable for a client with nothing to advocate.
  it('counts a No as answered', () => {
    const answers = Object.fromEntries(requiredQuestions(true).map(
      (k) => [k, isYesNo(k) ? false : 3]))
    expect(answeredCount(answers, true)).toBe(22)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- --run src/lib/scoreMath.test.ts src/lib/scoreV2.test.ts`
Expected: FAIL — `yesNoScore` and `OVERALL_QUESTIONS` are not exported; `overallScore` still takes two arguments.

- [ ] **Step 3: Add `yesNoScore` to `scoreMath.ts`**

```ts
// 1 + the number of yeses. Mirrors the generated column's expression in
// 20260828*_advocacy_yes_no.sql exactly, and `npm run verify:score` is what
// proves they have not drifted.
//
// The offset of 1 is not decoration: it puts four Nos at 1.00 and four Yeses at
// 5.00, which is the same range the other five buckets produce from a mean of
// 1-5 answers. So a yes/no bucket needs no rescaling anywhere downstream -- the
// board's bar, the matrix's cell and bandFor() all work on it unchanged.
//
// Null if ANY answer is missing, exactly as meanOrNull. Note what this makes
// distinct: four Nos scores 1.00, and one blank scores nothing at all.
export function yesNoScore(
  values: readonly (boolean | null | undefined)[],
): number | null {
  let yeses = 0
  for (const value of values) {
    if (value === null || value === undefined) return null
    if (value) yeses += 1
  }
  return 1 + yeses
}
```

Remember: **no imports may be added to this file.**

- [ ] **Step 4: Rewrite the relevant parts of `scoreV2.ts`**

```ts
import { BUCKETS, GATED_BUCKET, OVERALL_QUESTIONS, isYesNo, questionsFor, type Bucket } from './buckets'
import { meanOrNull, yesNoScore } from './scoreMath'

// A partial answer sheet. Values are numbers for scale questions and booleans
// for yes/no ones; `null` and absence both mean unanswered. Partial because a
// draft is a check-in with questions still open, and because a draft restored
// from localStorage is arbitrary JSON -- every function here iterates the rubric
// rather than the object's own keys, so a stray key cannot be counted.
export type Answers = Partial<Record<string, number | boolean | null>>

// UNCHANGED by the 2026-08-28 amendment, and deliberately so. This is about
// COMPLETENESS -- how many answers a check-in needs before it may be submitted,
// and what every count on screen reads against. It is still 22 when the gate is
// open. What changed is the OVERALL's divisor, which is now always 18 and lives
// in OVERALL_QUESTIONS. These were one number until the amendment and are two
// now; collapsing them back would either make a gate-open check-in submittable
// four answers short, or make Advocacy count toward the headline number again.
export function requiredQuestions(advocacyApplies: boolean): readonly string[] {
  const buckets = advocacyApplies
    ? BUCKETS
    : BUCKETS.filter((bucket) => bucket !== GATED_BUCKET)
  return buckets.flatMap((bucket) => questionsFor(bucket).map((q) => q.key))
}

// Dispatches on the questions' kind rather than on the bucket's name: the rubric
// is what knows how a question is answered, and asking "is this Advocacy?" here
// would be reading identity where it means to read type.
export function bucketScore(answers: Answers, bucket: Bucket): number | null {
  const questions = questionsFor(bucket)
  if (questions.every((question) => question.kind === 'yesno')) {
    return yesNoScore(
      questions.map((question) => answers[question.key] as boolean | null | undefined),
    )
  }
  return meanOrNull(
    questions.map((question) => answers[question.key] as number | null | undefined),
  )
}

// The mean of the eighteen non-Advocacy answers. Always -- there is no gate
// parameter, and that absence is the API doing its job: there is no way to ask
// for the retired 22-divisor behaviour by accident. Spec §3.2, amended
// 2026-08-28. Reversing it means changing this function and the view's
// expression, and nothing else.
export function overallScore(answers: Answers): number | null {
  return meanOrNull(
    OVERALL_QUESTIONS.map((key) => answers[key] as number | null | undefined),
  )
}

// A `false` is an ANSWER. Counting it as unanswered would leave a check-in
// permanently one short for any client with nothing yet to advocate, which is
// precisely the client most likely to answer No four times.
export function answeredCount(answers: Answers, advocacyApplies: boolean): number {
  let count = 0
  for (const key of requiredQuestions(advocacyApplies)) {
    const value = answers[key]
    if (value !== null && value !== undefined) count += 1
  }
  return count
}
```

Re-export `OVERALL_QUESTIONS` and `isYesNo` from `scoreV2` if consumers find that more convenient, but **do not** re-export in a way that adds a runtime import to a leaf.

- [ ] **Step 5: Run the tests**

Run: `npm test -- --run src/lib/`
Expected: PASS. Other files will not compile yet — Tasks 4 and 6 own them.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scoreMath.ts src/lib/scoreMath.test.ts src/lib/scoreV2.ts src/lib/scoreV2.test.ts
git commit -m "feat(score): yes/no arithmetic, and the overall drops Advocacy"
```

---

## Task 4: The draft cache accepts booleans, and rejects v2

**Files:** Modify `src/checkin/draftCache.ts`, `src/checkin/draftCache.test.ts`.

**This is the same failure the v1→v2 bump already guards, one turn later.** A v2 draft holds a NUMBER against `adv_left_review`. Restored into this form it would put a 1–5 score where a boolean belongs — a value meaning one thing read as though it meant another. So the version goes to `v3`, a v2 key can never be read as a v3 one, and `readDraft` deletes any it passes. **The v1 discard must be kept as well** — a browser that has not opened this tool since before the six-bucket change still holds one.

- [ ] **Step 1: Write the failing tests**

```ts
describe('the version bump to v3', () => {
  it('carries v3 in the key', () => {
    expect(DRAFT_VERSION).toBe('v3')
    expect(draftKey(7, '2026-08-01')).toBe(`${DRAFT_KEY_PREFIX}:v3:7:2026-08-01`)
  })

  // The new instance of the old failure: a v2 draft holds a NUMBER against an
  // Advocacy key, and those columns are booleans now.
  it('ignores and deletes a v2 draft', () => {
    const v2Key = `${DRAFT_KEY_PREFIX}:v2:7:2026-08-01`
    const { store, map } = memoryStore({
      [v2Key]: JSON.stringify({ answers: { adv_left_review: 4, comm_timely: 3 }, notes: 'v2' }),
    })
    expect(readDraft(7, '2026-08-01', store)).toBeNull()
    expect(map.has(v2Key)).toBe(false)
  })

  // Still. A browser that has not opened this tool since before the six-bucket
  // change holds one of these, and it is two shapes out of date rather than one.
  it('still ignores and deletes a v1 draft', () => {
    const v1Key = `${DRAFT_KEY_PREFIX}:7:2026-08-01`
    const { store, map } = memoryStore({
      [v1Key]: JSON.stringify({ pillars: { relationship: 4 }, notes: 'v1' }),
    })
    expect(readDraft(7, '2026-08-01', store)).toBeNull()
    expect(map.has(v1Key)).toBe(false)
  })

  it('a throwing removeItem on either old key cannot break the read', () => {
    const store: StorageLike = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => { throw new Error('quota') },
    }
    expect(() => readDraft(7, '2026-08-01', store)).not.toThrow()
  })
})

describe('boolean answers', () => {
  it('round-trips true and false against the yes/no keys', () => {
    const { store } = memoryStore()
    const answers = { adv_left_review: true, adv_case_study: false, comm_timely: 3 }
    expect(writeDraft(7, '2026-08-01', { answers, notes: '' }, store)).toBe(true)
    expect(readDraft(7, '2026-08-01', store)?.answers).toEqual(answers)
  })

  // false is a real answer and must survive. An earlier draft of this module
  // would have treated it as empty.
  it('a draft of nothing but a single false is not empty', () => {
    const draft = { answers: { adv_left_review: false }, notes: '' }
    expect(isDraftEmpty(draft)).toBe(false)
    const { store } = memoryStore()
    expect(writeDraft(7, '2026-08-01', draft, store)).toBe(true)
    expect(readDraft(7, '2026-08-01', store)?.answers).toEqual({ adv_left_review: false })
  })

  // Type discipline per key, both ways round.
  it('drops a number against a yes/no key and a boolean against a scale key', () => {
    const { store } = memoryStore({
      [draftKey(7, '2026-08-01')]: JSON.stringify({
        answers: { adv_left_review: 4, comm_timely: true, comm_constructive: 3 },
        notes: '',
      }),
    })
    expect(readDraft(7, '2026-08-01', store)?.answers).toEqual({ comm_constructive: 3 })
  })
})

describe('draftsDiffer with booleans', () => {
  it('sees true against false', () => {
    expect(draftsDiffer(
      { answers: { adv_left_review: true }, notes: '' },
      { answers: { adv_left_review: false }, notes: '' },
    )).toBe(true)
  })

  // The one that would silently discard work: false is present, absent is not.
  it('sees false against unanswered', () => {
    expect(draftsDiffer(
      { answers: { adv_left_review: false }, notes: '' },
      { answers: {}, notes: '' },
    )).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- --run src/checkin/draftCache.test.ts`
Expected: FAIL — `DRAFT_VERSION` is still `'v2'`.

- [ ] **Step 3: Update `draftCache.ts`**

`QuestionScores` becomes `Partial<Record<string, number | boolean>>`. `DRAFT_VERSION` becomes `'v3'`. Add a `v2` legacy key beside the v1 one and delete both on read — keep the single try/catch shape and its comment. Then the validator dispatches on kind:

```ts
import { ALL_QUESTIONS, isYesNo } from '../lib/buckets'
import { MAX_SCORE, MIN_SCORE } from '../lib/scoreMath'

// Validated per key against the rubric's kind, not against "is it a number or a
// boolean". A 4 stored against adv_left_review is exactly the v2 shape this
// version bump exists to reject, and it must be dropped even if it somehow
// reaches a v3 key -- storage is untrusted, and a value that survives here
// reaches the upsert and comes back as a type error nobody can act on.
function validAnswer(key: string, value: unknown): value is number | boolean {
  if (isYesNo(key)) return typeof value === 'boolean'
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_SCORE &&
    value <= MAX_SCORE
  )
}
```

`normaliseAnswers` calls `validAnswer(key, value)`. **`isDraftEmpty` must not be fooled by `false`** — it already counts keys rather than truthiness (`Object.keys(draft.answers).length === 0`), so it is correct as written; add a test-backed comment saying so rather than changing it. Same for `draftsDiffer`, which compares `?? null` per key and therefore already distinguishes `false` from absent.

- [ ] **Step 4: Run the tests**

Run: `npm test -- --run src/checkin/draftCache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/checkin/draftCache.ts src/checkin/draftCache.test.ts
git commit -m "feat(checkin): the draft cache holds booleans, and rejects v2 drafts"
```

---

## Task 5: `YesNoRow`

**Files:** Create `src/checkin/YesNoRow.tsx`, `src/checkin/YesNoRow.module.css`, `src/checkin/YesNoRow.dom.test.tsx`.

**Interfaces:**

```ts
type Props = {
  question: Question
  value: boolean | undefined
  lastValue: boolean | null
  disabled: boolean
  onChange: (value: boolean) => void
  onClear: () => void
}
export function YesNoRow(props: Props): JSX.Element
```

Consumed by Task 6.

**Build it as a two-option radio group, not a checkbox.** A checkbox has two states and this control has three — Yes, No, and unanswered — and the whole model rests on unanswered being distinct from No. A checkbox cannot express that without a third visual state nobody would read correctly.

**Copy the structure of `QuestionRow.tsx` exactly**, including the two behaviours that are previous bug fixes: `flushSync` before moving focus on Clear (browsers anchor a radio group's tab order to its checked radio, so clearing without it strands focus on the value just cleared), and the visually-hidden native input immediately before its visible `.face` sibling (`display: none` would remove it from the tab order and the accessibility tree). Reuse `QuestionRow.module.css`'s `.scale`, `.options`, `.option`, `.input`, `.face`, `.clear` verbatim in the new module, adjusting only what the two-option width needs.

`name` must be `question-${question.key}`, as in `QuestionRow` — two questions sharing a name would merge into one group.

- [ ] **Step 1: Write the failing test**

Cover: two options labelled Yes and No; `checked` reflects `value` including when it is `false`; `onChange` fires with `true` and with `false`; Clear renders only when `value !== undefined` — **including when it is `false`**, which is the case a truthiness check would get wrong; Clear moves focus to the first radio; `disabled` disables both options and Clear; last month renders "Yes"/"No"/"No answer last month".

```tsx
// The case a truthiness check gets wrong. A cleared control and a control
// answered No are different states, and only one of them offers Clear.
it('offers Clear when the answer is No, not just when it is Yes', () => {
  renderRow({ value: false })
  expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeNull()
})

it('offers no Clear when the question is unanswered', () => {
  renderRow({ value: undefined })
  expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
})
```

- [ ] **Step 2: Run to verify it fails.** Run: `npm test -- --run src/checkin/YesNoRow.dom.test.tsx`. Expected: module not found.

- [ ] **Step 3: Write the component and its module CSS.**

- [ ] **Step 4: Run the test.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/checkin/YesNoRow.tsx src/checkin/YesNoRow.module.css src/checkin/YesNoRow.dom.test.tsx
git commit -m "feat(checkin): YesNoRow, a three-state control for the Advocacy questions"
```

---

## Task 6: Wire it through the screen

**Files:** Modify `src/checkin/useCheckin.ts`, `src/checkin/useCheckin.dom.test.ts`, `src/checkin/CheckIn.tsx`, `src/checkin/CheckIn.test.tsx`, `src/checkin/CheckIn.dom.test.tsx`.

**Changes:**
- `setAnswer(key: string, value: number | boolean | null)`; `null` still `delete`s the key.
- `localOverall = overallScore(draft.answers)` — **the gate argument is gone**.
- `required` and `scored` unchanged in meaning; still gate-dependent.
- The upsert spreads `ALL_QUESTIONS` as before; unanswered still `null`. A `false` must reach the database as `false`, not be coerced away — `draft.answers[key] ?? null` is correct because `false ?? null` is `false`, but **add a test proving it**, since `||` in that position would silently write `null` for every No.
- `CheckIn.tsx` renders `YesNoRow` when `question.kind === 'yesno'`, else `QuestionRow`.

- [ ] **Step 1: Write the failing tests**

```ts
// The coercion trap. `false ?? null` is false and `false || null` is null, and
// the two look identical at a glance. Getting it wrong writes null for every No
// and silently turns four answered Nos into an unanswered bucket.
it('sends a No to the database as false, not as null', async () => {
  const { result, upsert } = renderCheckin({
    client: { id: 1, name: 'Acme', started_on: '2026-01-01' }, period: '2026-08-01',
  })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  act(() => result.current.setAnswer('adv_left_review', false))
  act(() => result.current.submit())
  await waitFor(() => expect(upsert).toHaveBeenCalled())
  expect(upsert.mock.calls[0][0].adv_left_review).toBe(false)
})

// Spec §3.2 amended, through the hook.
it('has an overall from the 18 even with every Advocacy answer blank', async () => {
  const { result } = renderCheckin({
    client: { id: 1, name: 'Acme', started_on: '2026-01-01' }, period: '2026-08-01',
  })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.advocacyApplies).toBe(true)
  for (const key of OVERALL_QUESTIONS) act(() => result.current.setAnswer(key, 4))
  expect(result.current.localOverall).toBe(4)
  // ...and still 22 required, so it is not yet complete.
  expect(result.current.required).toBe(22)
  expect(result.current.scored).toBe(18)
})
```

And in `CheckIn.dom.test.tsx`:

```tsx
it('renders Yes/No controls for Advocacy and 1-5 for the rest', () => {
  renderScreen({ advocacyApplies: true, startedOn: '2026-01-01' })
  const advocacy = within(screen.getByTestId('bucket-advocacy'))
  expect(advocacy.getAllByRole('radio')).toHaveLength(8) // 4 questions x Yes/No
  const communication = within(screen.getByTestId('bucket-communication'))
  expect(communication.getAllByRole('radio')).toHaveLength(15) // 3 x 1-5
})
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Make the changes.**
- [ ] **Step 4: Run the full check-in suite.** Run: `npm test -- --run src/checkin/`
- [ ] **Step 5: Run the whole gate.** `npm test -- --run && npm run build && npm run lint` — all three clean.
- [ ] **Step 6: Commit**

```bash
git add src/checkin/
git commit -m "feat(checkin): Advocacy answers yes/no, and the overall reads only the 18"
```

---

## Task 7: The verifiers

**Files:** Modify `scripts/score-parity.mjs`, `scripts/verify-scoring-view.sql`, `tests/generatedColumn.test.ts`, `tests/scoreParity.test.ts`.

**`score-parity.mjs` runs under plain Node**, which cannot resolve this codebase's extensionless imports — it may import only `src/lib/scoreMath.ts` and `src/lib/buckets.ts`, both leaves, and only with the `.ts` extension.

- [ ] **Step 1: Update the generator**

Advocacy's arm enumerates three states per question (null, true, false) rather than six. **4,401 states**: 2 × 6³ (Communication, Growth) + 3 × 6⁴ (Finances, Relationship, Delivery) + 3⁴ (Advocacy) = 432 + 3,888 + 81.

Write that arithmetic into a comment, and assert the generated count in `tests/scoreParity.test.ts` so a miscount fails rather than silently shrinking the proof.

- [ ] **Step 2: Update `verify-scoring-view.sql`** per spec §9.2 as amended:
  - For each of the eighteen: nulling it nulls `overall_score`.
  - **For each of the four Advocacy answers: nulling it does NOT null `overall_score`, in either gate state.** These four are the cases that would catch a reversion to the 22-divisor.
  - All-3s on the eighteen gives exactly 3.00 regardless of gate state and regardless of Advocacy.
  - Four Nos gives `adv_score` 1.00; three Yeses and a null gives `adv_score` null.
  - The gate boundary at 89/90/91 days and a null `started_on`, unchanged.

- [ ] **Step 3: Run both, and prove each can fail**

```bash
npm run db:which          # staging
npm run verify:score      # expect 0 mismatches across 4,401 states
npm run verify:scoring-view
```

Then break each deliberately — change `yesNoScore`'s offset from 1 to 0 and confirm `verify:score` fails; add an Advocacy column back into the view's sum in a scratch copy and confirm `verify:scoring-view` fails. **Restore both and re-run.** Record both outcomes in the report. A verifier nobody has watched fail is a verifier nobody has verified.

- [ ] **Step 4: Commit**

```bash
git add scripts/ tests/
git commit -m "verify: 4,401 states, and the view must ignore Advocacy"
```

---

## Task 8: Prove it on staging

- [ ] **Step 1:** `npm run db:which` prints `tgc-client-health-staging`. **Stop if not.**
- [ ] **Step 2:** Run every gate: `npm test -- --run`, `npm run build`, `npm run lint`, `verify:score`, `verify:scoring-view`, `verify:capability`, `verify:lifecycle`, `verify:privileges`, `verify:invites`.
- [ ] **Step 3:** Drive the screen against staging (`npm run dev`) and record:
  1. Advocacy renders as **Yes / No**, not 1–5.
  2. Answering all four **No** gives an Advocacy bar of **1.00** — a real low score, not an em dash.
  3. Leaving **one** Advocacy question blank gives an Advocacy bar of **em dash** — and the overall still shows a number.
  4. The overall does **not** move when Advocacy answers change.
  5. With the gate open, the count reads **"of 22"** and Submit stays blocked until all 22 are answered, Advocacy included.
  6. Clearing an Advocacy answer that was **No** works — the Clear button is offered for a No, not only for a Yes.
- [ ] **Step 4:** Plant a v2 draft in the console and reload; confirm it is ignored and the key is gone.

```js
localStorage.setItem('checkin-draft:v2:1:2026-08-01', JSON.stringify({ answers: { adv_left_review: 4 }, notes: 'v2' }))
```

- [ ] **Step 5:** Write the ledger and commit it.

---

## Self-Review

**Spec coverage.** §3.1 amendment → Task 2. §3.2 amendment (yes/no arithmetic) → Tasks 2, 3. §3.2 amendment (Advocacy out of the overall) → Tasks 1, 3, 6. §3.3 null-never-low, and the new null-versus-false edge → Tasks 1, 3, 4, 5, 7. §4 the gate survives unchanged → no task; `gate.ts` and `gateParity.test.ts` are deliberately untouched. §5.2 → Task 1. §5.3 `adv_score` → Task 1. §6 the collapsed view → Task 1. §9.1 the shrunk sweep → Task 7. §9.2 amendment → Task 7. §9.3 what only a person can check → Task 8.

**Placeholders.** None in Tasks 1–4. Tasks 5 and 6 specify behaviour and interfaces with the risky cases written out as code, and lean on `QuestionRow`/`CheckIn` as the pattern to copy — deliberate, because those files exist and were reviewed clean today.

**Type consistency.** `Answers` widens to `number | boolean | null` in Task 3 and is consumed that way in 4 and 6. `QuestionScores` widens to `number | boolean` in Task 4. `overallScore` loses its second parameter in Task 3, and Task 6 is the only caller. `requiredQuestions` keeps its parameter throughout — that is the decoupling this plan exists to preserve, and a reviewer should check no task quietly removes it.

**The single highest-risk line in this plan** is `draft.answers[key] ?? null` in Task 6's upsert. `??` is correct and `||` is not, they differ only for `false`, and the failure is silent: every No would be written as unanswered. Task 6 Step 1 pins it with a test.
