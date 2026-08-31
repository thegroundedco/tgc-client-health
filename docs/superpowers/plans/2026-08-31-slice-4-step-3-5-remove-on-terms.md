# Slice 4 Step 3.5 — Remove "On terms" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the undefined `fin_on_terms` question from the rubric and drop its column, taking Finances to three questions and the overall's divisor to seventeen.

**Architecture:** Almost all of the TypeScript follows automatically, because `ALL_QUESTIONS`, `OVERALL_QUESTIONS` and `requiredQuestions()` all derive from `BUCKETS`/`BUCKET_DEFINITIONS` in `src/lib/buckets.ts`. Deleting one entry there moves 22→21, 18→17 and 22/18→21/17 everywhere they are computed. The hand work is the migration, the two verifiers, one piece of user-facing copy that restates the count as a literal, and the hardcoded numbers in tests.

**Tech Stack:** React 19 + TypeScript, Vite, CSS Modules, Supabase (postgrest-js), Postgres 17.6, Vitest + Testing Library, jsdom.

**Spec:** `docs/superpowers/specs/2026-08-27-phase-2-slice-4-scoring-model-design.md` — read §3.1's Finances entry (amended 2026-08-31), §5.2, §5.3, §6 and §9.1. Commit `ea95d22`.

**Branch:** `slice-4-scoring-model`, 13 commits ahead of `origin/main` and **not pushed**.

---

## The owner's rulings, which are not open questions

1. **The column is DROPPED, not renamed.** Josh instructed this on 2026-08-31 after being shown that it destroys the one real answer that existed. This deliberately departs from spec §5.4's rename-never-drop principle. Do not "correct" it to a rename.
2. **Ten clients were scored for August 2026 on 2026-08-31, and all of them answered `fin_on_terms`.** Those answers die with the column. Josh was told before he scored and accepted it.
3. Babaloo's August check-in moves Finances 3.25 → 3.33 and overall 3.56 → 3.59; its band stays Watch. Every other client's overall moves similarly and none crosses a band boundary — **but verify that on staging rather than trusting this sentence.**

## DATABASE SAFETY

`npm run db:which` must print `tgc-client-health-staging` before every database command. Production is `jizavsawtbkmvzllxhtk`; staging is `dexsdhtpfsswgiytxntl`. **This migration is applied to STAGING ONLY within this plan.** Josh applies it to production himself, and this is now the THIRD pending production migration — the checklist at `docs/superpowers/plans/2026-08-31-slice-4-step-3-production-checklist.md` must be updated to include it (Task 5).

**Production currently holds ten real August check-ins.** Dropping this column there deletes ten real answers. That is the ruling, but it is also why the production step is his and not ours.

---

## Global Constraints

- **The overall is the mean of the SEVENTEEN non-Advocacy answers**, always, in both gate states.
- **`required` and the overall's divisor stay DIFFERENT NUMBERS.** `required` becomes 21 gate-open / 17 gate-shut; the overall's divisor is 17 always. They were decoupled deliberately in step 2.5 — do not collapse them.
- **A missing answer must never read as a low score.** Null, never a partial mean, never zero. `false` is an answered No and is not null.
- **`src/lib/scoreMath.ts` and `src/lib/buckets.ts` must keep ZERO runtime imports.** `tests/leafModules.test.ts` enforces it; `npm run verify:score` breaks otherwise. **`src/lib/gate.ts` is NOT under this constraint** — it already imports `./month.ts`.
- **No colour or typeface literals outside `src/styles/tokens.css`**, comments included.
- **`@testing-library/jest-dom` is NOT installed.** Only `toBe`, `toEqual`, `toContain`, `toHaveProperty`, `toBeNull`, `toHaveLength`, `toThrow`, `toBeTruthy`; negations fine.
- **`import type` for type-only imports** (`verbatimModuleSyntax` is on).
- **Never `git commit -a`.** Stage explicit paths.
- **Do NOT consolidate existing tests.** This project has silently lost real test cases twice. Change counts in place; name every change in your report.
- **Scoped test runs use `npx vitest run <path>`.** `npm test -- --run <path>` matches nothing in this repo.
- **Baseline before Task 1: 682 tests / 43 files, build clean, lint clean, verify:score 0 mismatches across 4,401 states, verify:scoring-view clean.**

## A trap already checked, so nobody re-checks it wrong

`scoreMath.test.ts:7` asserts `meanTo2dp(53, 22)` is `2.41`. **That 22 is arbitrary arithmetic, not the question count.** Leave it. Likewise `scoreMath.ts`'s comment about "the divisors this model uses (3, 4, 18 and 22)" describes reachable divisors — it needs updating to `(3, 4, 17 and 21)` as prose, but the tie-breaking argument it makes still holds and must not be deleted.

---

## Task 1: The rubric loses a question

**Files:** Modify `src/lib/buckets.ts`, `src/lib/buckets.test.ts`.

**Interfaces:**
- Produces: `ALL_QUESTIONS` with 21 entries; `OVERALL_QUESTIONS` with 17; Finances with three questions. Every other module derives from these and needs no edit for the counts.

- [ ] **Step 1: Update the tests first**

In `src/lib/buckets.test.ts`, change in place — do not add new cases for these, the existing ones are the right cases with the wrong numbers:

```ts
  it('holds 21 questions in total', () => {
    expect(ALL_QUESTIONS).toHaveLength(21)
  })
```
```ts
  it('OVERALL_QUESTIONS is the 17 non-Advocacy keys, in rubric order', () => {
    expect(OVERALL_QUESTIONS).toHaveLength(17)
  })
```

Add one genuinely new case, because the removal is the point:

```ts
  // The question the owner removed on 2026-08-31. It was never defined -- the
  // source doc carried the boss's own question mark -- and scoring one client's
  // undefined question against another's is not measurement.
  it('no longer carries the retired "On terms" question', () => {
    expect(ALL_QUESTIONS).not.toContain('fin_on_terms')
    expect(questionsFor('finances')).toHaveLength(3)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/buckets.test.ts`
Expected: FAIL — lengths are 22 and 18, and `fin_on_terms` is still present.

- [ ] **Step 3: Delete the entry**

In `src/lib/buckets.ts`, remove exactly this line from the `finances` bucket's `questions` array:

```ts
      { key: 'fin_on_terms', prompt: 'On terms.', kind: 'scale' },
```

Change nothing else. Do not touch the `relationship` or `delivery` **bucket** names — they are bucket names, not the retired pillar columns.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/buckets.test.ts tests/leafModules.test.ts`
Expected: PASS. `buckets.ts` must still have zero runtime imports.

The wider suite will now fail on hardcoded counts elsewhere. **That is expected — Task 4 sweeps them.** Do not fix them here.

- [ ] **Step 5: Commit**

```bash
git add src/lib/buckets.ts src/lib/buckets.test.ts
git commit -m "feat(score): the rubric drops the undefined On terms question"
```

---

## Task 2: The migration

**Files:** Create `supabase/migrations/<timestamp>_remove_on_terms.sql`; modify `src/types/database.ts` (regenerated).

**Interfaces:** Produces a `checkins` table with no `fin_on_terms`, `fin_score` over three questions, and `checkin_scores.overall_score` over seventeen.

Generate the timestamp with `date -u +%Y%m%d%H%M%S`.

- [ ] **Step 1: Write the migration**

The view and the generated column both depend on the column, so both come down first — the same shape as `20260828180543_advocacy_yes_no.sql`. Read that file for the register before writing this one.

```sql
-- "On terms" is removed. Spec §3.1 as amended 2026-08-31.
--
-- DROP, not rename. Spec §5.4's principle is rename-never-drop, and the five v1
-- pillars were renamed to legacy_* two commits ago on exactly that reasoning.
-- This departs from it BY RULING: the owner instructed the drop on 2026-08-31,
-- after being shown it destroys real answers -- Babaloo's August check-in held
-- fin_on_terms = 3, and by the time this reaches production ten clients will
-- each hold one. That is the decision, not an oversight. Do not "restore" the
-- rename.
--
-- The question was never defined. The source doc read "On they on terms
-- (3-month commitment?)" -- the boss's own question mark -- and the 2026-08-27
-- ruling left the prompt bare for the scorer to interpret. Scoring one client's
-- undefined question against another's is not measurement.
--
-- No preflight guard, deliberately. A second run fails loudly and immediately
-- on `drop column fin_on_terms` with "column does not exist", leaving no
-- partial state and nothing at risk -- unlike 20260828180543, whose second run
-- would have silently destroyed answers and therefore earned a guard.

drop view if exists public.checkin_scores;
alter table public.checkins drop column if exists fin_score;

alter table public.checkins drop column fin_on_terms;

-- Three questions now, not four.
alter table public.checkins
  add column fin_score numeric(3,2) generated always as (
    (fin_rack_rate + fin_pays_on_time + fin_rate_increased)::numeric / 3
  ) stored;

-- The overall, over seventeen. Advocacy is still excluded whatever the gate
-- says (spec §3.2, amended 2026-08-28), so there is still one branch, not two.
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
  round(
    (ch.comm_constructive + ch.comm_timely + ch.comm_consistent
     + ch.growth_goals_defined + ch.growth_progress_trackable + ch.growth_hitting_goals
     + ch.fin_rack_rate + ch.fin_pays_on_time + ch.fin_rate_increased
     + ch.rel_collaborative + ch.rel_respectful + ch.rel_fun + ch.rel_multi_threaded
     + ch.del_on_time + ch.del_quantity + ch.del_client_likes
     + ch.del_we_are_proud)::numeric / 17, 2) as overall_score
from public.checkins ch
join public.clients c on c.id = ch.client_id;

comment on view public.checkin_scores is
  'The overall score: the mean of the seventeen non-Advocacy answers, always. '
  'Advocacy is excluded whatever the gate says (spec 3.2). "On terms" was '
  'removed 2026-08-31 (spec 3.1). security_invoker: RLS is the callers own.';

revoke all on public.checkin_scores from anon, authenticated;
grant select on public.checkin_scores to authenticated;
```

**Count the columns in that sum before you run it.** It must be exactly seventeen, and `fin_on_terms` must not appear.

- [ ] **Step 2: Apply to staging and regenerate types**

```bash
npm run db:which                # MUST print tgc-client-health-staging
npm run db:push
npm run db:which && npx --yes supabase@latest gen types typescript --linked > src/types/database.ts
```

There is no `gen:types` script — do not invent one. Check the result with `git diff --stat src/types/database.ts` before staging it; if the file comes back empty the redirect clobbered it, so `git checkout` it and retry.

- [ ] **Step 3: Prove the arithmetic moved, on staging**

```sql
select id, fin_score, overall_score from public.checkin_scores order by id;
```
Record the output in your report. Then confirm the column is gone:
```sql
select count(*) from information_schema.columns
 where table_schema='public' and table_name='checkins' and column_name='fin_on_terms';
```
Expect 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/ src/types/database.ts
git commit -m "feat(db): drop fin_on_terms, and the overall reads seventeen"
```

---

## Task 3: The gated-out copy stops restating the count

**Files:** Modify `src/lib/gate.ts`, `src/lib/gate.test.ts`.

**Interfaces:** Consumes `OVERALL_QUESTIONS` from `src/lib/buckets.ts`. `advocacyGate`'s signature is unchanged.

**Why this is its own task.** `gate.ts` writes the number into user-facing prose twice:

> "...this check-in is scored out of the other 18 questions."

That is a person-visible claim about how their check-in is scored, and it is now wrong by one. A literal here is the same class of defect as a comment asserting a guard that is not there — it looks right and says something false. `gate.ts` already imports `./month.ts`, so it is not a zero-import leaf and may import the rubric.

- [ ] **Step 1: Write the failing test**

```ts
// The copy states how many questions the check-in is scored out of. Deriving it
// means the sentence cannot go stale the next time the rubric changes -- which
// it just did, twice in four days.
it('states the real non-Advocacy count, not a literal', () => {
  const shut = advocacyGate('2026-08-01', '2026-08-01')
  expect(shut.open).toBe(false)
  expect(shut.reason).toContain(`other ${OVERALL_QUESTIONS.length} questions`)
})

it('says the same for a client with no start date', () => {
  const none = advocacyGate(null, '2026-08-01')
  expect(none.open).toBe(false)
  expect(none.reason).toContain(`other ${OVERALL_QUESTIONS.length} questions`)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/gate.test.ts`
Expected: FAIL — the string still says 18 while `OVERALL_QUESTIONS.length` is 17.

- [ ] **Step 3: Derive it**

Add `import { OVERALL_QUESTIONS } from './buckets.ts'` and replace both literals with `${OVERALL_QUESTIONS.length}`. Leave every other word of both sentences exactly as it is — they were written deliberately and a browser has read them.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/gate.test.ts tests/gateParity.test.ts`
Expected: PASS. `gateParity` is unaffected — it reads the 90 out of the migration, not the question count.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gate.ts src/lib/gate.test.ts
git commit -m "fix(gate): the gated-out copy derives its count instead of restating it"
```

---

## Task 4: The verifiers, and the sweep

**Files:** Modify `scripts/score-parity.mjs`, `scripts/verify-scoring-view.sql`, `tests/scoreParity.test.ts`, `tests/generatedColumn.test.ts`, `src/board/cardSummary.test.ts`, `src/board/ClientCard.dom.test.tsx`, `src/checkin/CheckIn.test.tsx`, and any other file the suite reports.

**This task closes the window Task 1 opened.** It is the first task required to leave the full gate green.

- [ ] **Step 1: The state space**

Finances is now a three-question bucket, so the arithmetic in `scripts/score-parity.mjs`'s header comment becomes:

`3 × 6³ (Communication, Growth, Finances) + 2 × 6⁴ (Relationship, Delivery) + 3⁴ (Advocacy) = 648 + 2,592 + 81 = 3,321`

Update the comment and `tests/scoreParity.test.ts`'s `expect(total).toBe(4401)` → `3321`. The count must come from the real generated total, not a restated constant — it already does; keep it that way.

- [ ] **Step 2: `verify-scoring-view.sql`**

Three changes, and the third needs arithmetic:

1. `c_core` loses `fin_on_terms` and is now seventeen columns. The §2 null-propagation loop count in its comment moves from 44 to 42 (17 open + 4 open-adv + 17 closed + 4 closed-adv).
2. The all-3s assertion still expects exactly `3.00` — unchanged, since a mean of 3s is 3 whatever the divisor.
3. **§3's weighting vector must be recomputed.** With seventeen core answers at 2 and Communication's three at 5: `(15 + 28) / 17 = 43/17 = 2.53`. The named wrong answer, bucket-averaging, is `(5 + 2 + 2 + 2 + 2) / 5 = 13/5 = 2.60`, unchanged. **Verify both by hand before writing them**, and check they stay distinct from the other reversions the file guards against — a six-bucket mean including `adv_score` at all-true is `18/6 = 3.00`.

Also correct the stale illustrative number at the coalesce-masking comment if the divisor it names has moved.

- [ ] **Step 3: Sweep the hardcoded counts**

Run the full suite and fix what it reports. Known sites, from a survey on 2026-08-31:

- `src/board/cardSummary.test.ts` — "of 22"/"of 18" strings and the `eighteenAnswered()` helper's comment
- `src/board/ClientCard.dom.test.tsx:106` — `'Draft, 2 of 22 scored'`
- `src/checkin/CheckIn.test.tsx` — its `fin_on_terms` fixture
- `src/board/cardSummary.ts` — two comments naming 22
- `src/lib/scoreV2.ts` — the comment naming 22 and 18 as the two decoupled numbers
- `src/checkin/saveState.ts` — comments naming 18 and 22
- `src/checkin/QuestionRow.dom.test.tsx:220` — "22 groups on one screen"
- `src/lib/scoreMath.ts:44` — the divisor list `(3, 4, 18 and 22)` becomes `(3, 4, 17 and 21)`. **Keep the tie-breaking argument it makes** — it still holds; only the numbers change.

**Do NOT change `scoreMath.test.ts:7`'s `meanTo2dp(53, 22)`.** That 22 is an arbitrary divisor in an arithmetic test, not the question count.

- [ ] **Step 4: The full gate**

```bash
npx vitest run && npm run build && npm run lint
npm run db:which && npm run verify:score          # expect 0 mismatches across 3,321 states
npm run verify:scoring-view
```

Then break each verifier deliberately and confirm it fails: change `fin_score`'s divisor from 3 to 4 in a scratch copy of the migration applied to staging and confirm `verify:score` fails; add `fin_on_terms` back into the view's sum in a scratch view and confirm `verify:scoring-view` fails. **Restore both, re-run, and record both outcomes in your report.** A verifier nobody has watched fail is a verifier nobody has verified.

- [ ] **Step 5: Commit**

```bash
git add scripts/ tests/ src/
git commit -m "verify: 3,321 states, and the overall reads seventeen"
```

---

## Task 5: Update the production checklist

**Files:** Modify `docs/superpowers/plans/2026-08-31-slice-4-step-3-production-checklist.md`.

There are now **three** pending production migrations, not two, and the order matters. The checklist must say:

1. Deploy first, as it already says.
2. Confirm the live board renders.
3. Apply `<ts>_rename_legacy_pillars.sql`.
4. **Then apply `<ts>_remove_on_terms.sql`.**
5. Verify: `select count(*) from information_schema.columns where table_name='checkins' and column_name='fin_on_terms';` → 0, and `select client_id, overall_score from public.checkin_scores where period='2026-08-01' order by overall_score desc;` → ten rows, each scored out of seventeen.

It must also state plainly, near the top, that **step 4 deletes ten real answers** — one per client scored in the August round — and that this is the owner's own ruling of 2026-08-31, so he is not surprised by his own decision a week later.

- [ ] **Step 1: Make the edits, then commit**

```bash
git add docs/superpowers/plans/2026-08-31-slice-4-step-3-production-checklist.md
git commit -m "docs: the checklist gains the On terms migration, and its cost"
```

---

## Self-Review

**Spec coverage.** §3.1's amended Finances entry → Task 1. §5.2's seventeen smallints → Task 2. §5.3's `fin_score` over three → Task 2. §6's divisor of seventeen → Task 2. §9.1's 3,321 → Task 4. §9.2's seventeen null cases → Task 4. The user-facing consequence the spec does not mention → Task 3.

**Placeholders.** None. Task 4's sweep names its known sites and says to run the suite for the rest, which is a real instruction rather than "fix the tests".

**Type consistency.** Nothing changes shape. `ALL_QUESTIONS`, `OVERALL_QUESTIONS` and `requiredQuestions()` keep their types and change only in length, which is why Tasks 3, 4 and 5 are sweeps rather than rewrites.

**The broken window.** Task 1 opens it — the suite fails on hardcoded counts from the moment the rubric changes. Tasks 2 and 3 run only their own test files. **Task 4 closes it.** This is stated in Tasks 1 and 4.

**Whether any client's band moves — MEASURED, not left to a reviewer.** The ruling was made on Babaloo alone, but nine more were scored afterwards, so I computed all ten against production on 2026-08-31 before writing this plan. **No band changes.**

| Client | over 18 | over 17 | band |
|---|---|---|---|
| Colorfil | 5.00 | 5.00 | Healthy → Healthy |
| LoFli Balls | 5.00 | 5.00 | Healthy → Healthy |
| Gibs Grooming | 5.00 | 5.00 | Healthy → Healthy |
| Gait Happens | 4.72 | 4.71 | Healthy → Healthy |
| Juan Valdez | 4.61 | 4.71 | Healthy → Healthy |
| C.R. Plastics | 4.00 | 4.06 | Healthy → Healthy |
| Babaloo | 3.56 | 3.59 | Watch → Watch |
| Remi | 3.33 | 3.35 | Watch → Watch |
| Polar Divide | 3.22 | 3.24 | Watch → Watch |
| York | 3.00 | 3.00 | Watch → Watch |

Note the direction is not uniform: Gait Happens falls a hundredth while Juan Valdez rises a tenth, because removing a question moves a client's mean toward or away from their other answers depending on whether the removed answer was above or below them. Babaloo lands 0.01 under the Healthy threshold — the closest any client comes to moving — so **if a later change touches the divisor again, Babaloo is the one to check first.**

A reviewer should still re-run this comparison after Task 2, against staging, rather than trusting the table.
