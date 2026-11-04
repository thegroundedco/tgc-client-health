# Productive Budget Hours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each client's fixed monthly Productive budget (budgeted vs worked hours) in the check-in's renamed "Finances and Hours" section, and fill a new `fin_hours_in_budget` answer from it. The answer counts in the score only where it applies.

**Architecture:**
- **Fetching.** A new edge function (`fetch-productive-hours`) is the only thing that holds the Productive token. It reads deals for a client's linked Productive projects and stores the month's fixed monthly budgets in Postgres.
- **Applicability.** Whether the hours question applies to a client's month is decided in SQL (`private.hours_applies`) from the stored rows. A trigger copies the result onto `checkins.fin_hours_applies`. `fin_score` and `checkin_scores` divide by 3 or 4 (17 or 18 overall) according to that column.
- **The scoring rule.** A pure TS module (`hoursFromBudgets`) gives the screen its lines, answer and note, and is the rule the AI routine follows. The screen mirrors the SQL applicability rule, and the score maths takes an `hoursApplies` flag.

**Tech Stack:** React 19 + TypeScript 6 + Vite 8, Vitest 4 (jsdom), Supabase Postgres + RLS, Supabase Edge Functions (Deno), Productive API v2, pg_cron + pg_net.

**Spec:** `docs/superpowers/specs/2026-11-04-productive-budget-hours-design.md`. Read it first. Section numbers below (§n) refer to it.

## Global Constraints

- **Work location:** in a worktree at `../tgc-client-health-productive-hours` on branch `productive-hours`, created from `main` (which holds the spec commit 0c7c06d). Before every commit, run `git branch --show-current` and confirm it prints `productive-hours`. Stage explicit paths only. Never use `git commit -a`.
- **The Productive token never appears** in `src/`, the client bundle, the repo, a test fixture, a log line or chat. It lives only in edge-function secrets `PRODUCTIVE_API_TOKEN` and `PRODUCTIVE_ORG_ID`. The repo is public.
- **No invented client names.** Babaloo, Colorfil, Sno-Go and Dixxon are real clients, and so is every name in Productive. Test fixtures use obviously fake names such as `Client A` / `Budget A`.
- **Copy, exactly as written:**
  - bucket label `Finances and Hours`
  - prompt `Hours within budget.`
  - options `Within 6h` (5), `6–8h under` (3), `8–10h under or 6–8h over` (2), `Over 10h under or 8h over` (1)
  - reason `From Productive: {worked}h worked vs {budgeted}h budgeted ({+/−diff}h).`
  - notes `{n} monthly budgets – tidy up in Productive`, `First part-month – score by hand`, `Month not finished – hours so far`, `Couldn't reach Productive – answer by hand or try again`
  - empty states `No fixed monthly budget`, `Not linked to Productive`
  - AI placeholder note `hours pending – month not finished`
- **Hours start month:** `HOURS_START_PERIOD = '2026-10-01'`. Before it, the question never applies.
- **Productive times are minutes.** All comparisons are in integer minutes. Hours are shown to 1 decimal place.
- **Bands (minutes, `diff = worked − budgeted`):**
  - `|diff| ≤ 360` → 5
  - `−480 ≤ diff < −360` → 3
  - `−600 ≤ diff < −480` or `360 < diff ≤ 480` → 2
  - `diff < −600` or `diff > 480` → 1
- **What counts as a fixed monthly budget:** `budgeted_time > 0`, `end_date` not null, and `date` and `end_date` in the same calendar month as the period. A null `worked_time` counts as 0.
- **Not by colour alone:** a flagged line carries the text `Outside ±6h`. Nick is colourblind.
- **Definer-function rules (repo convention):**
  - Every `security definer` function lives in `private`, has `set search_path = ''`, and has execute revoked from `public, anon, authenticated` unless a grant is stated.
  - Every new table: `revoke all … from anon, authenticated` before granting.
- **Build checks before claiming any task done:** `npm test`, `npm run lint`, `npm run build`. Also run `npm test` under Node 26 with `NODE_OPTIONS=--no-experimental-webstorage` and `.env.local` moved aside, which is what CI does.
- **Owner-gated steps:** anything that touches staging or production, Supabase secrets, the live routine, or `git push` stops and asks the owner first. They're marked **[OWNER]** below.

## Review Focus

1. **Exact band edges.** A diff of exactly ±360, −480, −600 or +480 minutes must land in the gentler band (5, 3, 2, 2). Floating-point hours can tip these over, so compare in minutes. Tests are in Task 2.
2. **Zero or missing numbers from Productive.** `budgeted_time` of 0 or null means not a fixed budget. A null `worked_time` means 0 worked, which is a −budget diff, not a crash or NaN. Tests are in Tasks 2 and 4.
3. **A link removed or added after a check-in is saved.** `fin_hours_applies` and `fin_score` must follow, with no person re-saving. Test is in Task 3 (`verify-hours.sql`).
4. **Today vs. month end.** On the last day of the month the answer is still blank ("Month not finished"). From the 1st of the next month it fills. "Today" is the viewer's local date via `currentPeriod()`. Tests are in Task 2.
5. **A viewer who can edit scores but can't see revenue.** No fetch is made. The hours question shows or hides according to the stored `fin_hours_applies`, never a guess. Test is in Task 5.

---

### Task 1: Rubric and score maths take hours applicability

**Files:**
- Modify: `src/lib/buckets.ts` (Finances definition ~148-166, `OVERALL_QUESTIONS` ~249)
- Modify: `src/lib/scoreV2.ts` (whole file, 80 lines)
- Modify: `src/lib/scoreMath.ts` (comment on `meanTo2dp` divisors only)
- Modify: every caller `tsc -b` flags (expected: `src/checkin/useCheckin.ts`, `src/board/cardSummary.ts`, tests)
- Test: `src/lib/buckets.test.ts`, `src/lib/scoreV2.test.ts`, `tests/divisorParity.test.ts`

**Interfaces:**
- Produces, in `buckets.ts`:
  - `HOURS_QUESTION = 'fin_hours_in_budget'`
  - `HOURS_START_PERIOD = '2026-10-01'`
  - `HOURS_OPTIONS: readonly ChoiceOption[]`
  - `questionsFor(bucket: Bucket, hoursApplies = true): readonly Question[]`, which leaves out `HOURS_QUESTION` when `hoursApplies` is false
  - `overallQuestions(hoursApplies: boolean): readonly string[]`, with 17 or 18 entries
  - `OVERALL_QUESTIONS` is removed (callers move to `overallQuestions`)
  - `ALL_QUESTIONS` now has 22 keys
- Produces, in `scoreV2.ts`:
  - `requiredQuestions(advocacyApplies: boolean, hoursApplies: boolean)`
  - `bucketScore(answers, bucket, hoursApplies: boolean)`
  - `overallScore(answers, hoursApplies: boolean)`
  - `answeredCount(answers, advocacyApplies, hoursApplies)`
  - `isComplete(answers, advocacyApplies, hoursApplies)`

- [ ] **Step 1: Write the failing tests**

In `src/lib/buckets.test.ts`:
```ts
it('labels the finances bucket "Finances and Hours" and keeps F', () => {
  expect(BUCKET_DEFINITIONS.finances.label).toBe('Finances and Hours')
  expect(BUCKET_DEFINITIONS.finances.initial).toBe('F')
})
it('asks the hours question last in Finances, with four options worse-left', () => {
  const q = questionsFor('finances').at(-1)
  expect(q?.key).toBe('fin_hours_in_budget')
  expect(q?.prompt).toBe('Hours within budget.')
  expect(q?.options?.map((o) => [o.label, o.value])).toEqual([
    ['Over 10h under or 8h over', 1], ['8–10h under or 6–8h over', 2], ['6–8h under', 3], ['Within 6h', 5],
  ])
})
it('drops the hours question when it does not apply', () => {
  expect(questionsFor('finances', false).map((q) => q.key)).not.toContain('fin_hours_in_budget')
  expect(overallQuestions(false)).toHaveLength(17)
  expect(overallQuestions(true)).toHaveLength(18)
})
```
Update the existing test that pins `relabelled` to `['fin_rate_increased']`, so that it equals `['fin_rate_increased', 'fin_hours_in_budget']`. Update the test that says the initial matches `label[0]`, if one exists: `F` still matches.

In `src/lib/scoreV2.test.ts`:
```ts
const fin3 = { fin_rack_rate: 5, fin_pays_on_time: 5, fin_rate_increased: 5 }
it('scores Finances over three when hours do not apply, ignoring a stray hours answer', () => {
  expect(bucketScore({ ...fin3, fin_hours_in_budget: 1 }, 'finances', false)).toBe(5)
})
it('scores Finances over four when hours apply', () => {
  expect(bucketScore({ ...fin3, fin_hours_in_budget: 1 }, 'finances', true)).toBe(4)
  expect(bucketScore(fin3, 'finances', true)).toBeNull()
})
it('requires 22/18 questions with hours, 21/17 without', () => {
  expect(requiredQuestions(true, true)).toHaveLength(22)
  expect(requiredQuestions(false, true)).toHaveLength(18)
  expect(requiredQuestions(true, false)).toHaveLength(21)
  expect(requiredQuestions(false, false)).toHaveLength(17)
})
```
In `tests/divisorParity.test.ts`, parametrise the existing three tests over `hoursApplies` in `[false, true]`. Expect divisors 17 and 18. Task 3 changes the view to a `case`, so Task 3 updates how this test reads the view. Leave a `// Task 3` marker here and keep it red only for the view-reading part.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/lib/buckets.test.ts src/lib/scoreV2.test.ts`
Expected: FAIL on the label, the missing question and the arity.

- [ ] **Step 3: Implement**

- `buckets.ts`:
  - Add the constants above.
  - Add the question to the end of `finances.questions` with `kind: 'choice'` and `options: HOURS_OPTIONS`.
  - Change the label.
  - Add the `hoursApplies` filter to `questionsFor`.
  - Replace `OVERALL_QUESTIONS` with `overallQuestions`.
  - Update the comments that state "seventeen" or "21". The comment on `kind` says choice draws "three labelled" radios; make it say the option count is the option set's.
- `scoreV2.ts`: thread `hoursApplies` through. `bucketScore` uses `questionsFor(bucket, hoursApplies)`.
- `scoreMath.ts`: update the `meanTo2dp` comment to list divisors 3, 4, 17, 18, 21 and 22. The no-tie argument holds for all of them: `sum*200 = d*(2k+1)` has no solution with d even, and none with 3 or 17 or 21 either. Re-check that, then state it.
- **Callers:**
  - `useCheckin.ts` takes a new `hoursApplies: boolean` parameter in its options and returns it. Task 5 supplies it; until then CheckIn passes `stored?.fin_hours_applies === true`.
  - `cardSummary.ts`'s `cardFooter` gains a `hoursApplies` argument. Task 7 wires the column; until then the board passes `false`.

- [ ] **Step 4: Run the tests and the build**

Run: `npm test && npm run build`
Expected: PASS, except the view-reading part of `divisorParity` marked for Task 3. The build must be clean.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # productive-hours
git add src/lib/buckets.ts src/lib/buckets.test.ts src/lib/scoreV2.ts src/lib/scoreV2.test.ts src/lib/scoreMath.ts tests/divisorParity.test.ts <each caller file tsc flagged>
git commit -m "feat(rubric): Finances and Hours, with an hours question that may not apply"
```

---

### Task 2: The hours rule

**Files:**
- Create: `src/checkin/hoursFromBudgets.ts`
- Test: `src/checkin/hoursFromBudgets.test.ts`

**Interfaces:**
- Consumes: `HOURS_START_PERIOD` (Task 1), `lastDayOf` and `addMonths` from `src/lib/month.ts`
- Produces:
```ts
export type BudgetRow = {
  productive_deal_id: string; name: string; starts_on: string; ends_on: string
  budgeted_minutes: number; worked_minutes: number
}
export type HoursLine = {
  dealId: string; name: string
  budgetedHours: number; workedHours: number; diffHours: number   // 1dp
  flagged: boolean                                                // |diff| > 360 min
}
export type HoursAnswer = { value: 1 | 2 | 3 | 5; reason: string }
export type HoursResult =
  | { applies: false; reason: 'before_start' | 'not_linked' | 'no_budget'; message: string | null }
  | { applies: true; lines: HoursLine[]; answer: HoursAnswer | null; note: string | null }
export function hoursScore(diffMinutes: number): 1 | 2 | 3 | 5
export function hoursFromBudgets(input: {
  period: string; today: string  // today = YYYY-MM-DD, viewer's local date
  linked: boolean; fetched: boolean; budgets: readonly BudgetRow[]
}): HoursResult
```
`message` is `'Not linked to Productive'`, `'No fixed monthly budget'`, or `null` for `before_start`.

**Order of the rule:**
1. `period < HOURS_START_PERIOD` → `before_start`.
2. Not `linked` → `not_linked`.
3. Not `fetched` → applies, no lines, the note `Couldn't reach Productive – answer by hand or try again`.
4. `fetched` with zero budgets → `no_budget`.
5. More than one budget → lines, no answer, note `${n} monthly budgets – tidy up in Productive`.
6. One budget with `starts_on` not ending `-01` → line, no answer, note `First part-month – score by hand`.
7. `today < addMonths(period, 1)` → line, no answer, note `Month not finished – hours so far`.
8. Otherwise → line, plus the answer `hoursScore(diff)` with the reason from Global Constraints.

This mirrors `private.hours_applies` in Task 3 exactly. Rules 1–4 decide `applies`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('hoursScore', () => {
  it.each([
    [0, 5], [360, 5], [-360, 5],
    [-361, 3], [-480, 3],
    [-481, 2], [-600, 2], [361, 2], [480, 2],
    [-601, 1], [481, 1], [-3600, 1],
  ])('diff %i min scores %i', (diff, score) => expect(hoursScore(diff)).toBe(score))
})

const budget = (o: Partial<BudgetRow> = {}): BudgetRow => ({
  productive_deal_id: 'd1', name: 'Budget A', starts_on: '2026-10-01', ends_on: '2026-10-31',
  budgeted_minutes: 1500, worked_minutes: 2568, ...o,
})
const base = { period: '2026-10-01', today: '2026-11-04', linked: true, fetched: true }

describe('hoursFromBudgets', () => {
  it('does not apply before October 2026', () =>
    expect(hoursFromBudgets({ ...base, period: '2026-09-01', budgets: [budget()] })).toEqual(
      { applies: false, reason: 'before_start', message: null }))
  it('does not apply when unlinked', () =>
    expect(hoursFromBudgets({ ...base, linked: false, budgets: [] })).toMatchObject(
      { applies: false, reason: 'not_linked', message: 'Not linked to Productive' }))
  it('does not apply when fetched with no fixed budget', () =>
    expect(hoursFromBudgets({ ...base, budgets: [] })).toMatchObject(
      { applies: false, reason: 'no_budget', message: 'No fixed monthly budget' }))
  it('applies with no answer when Productive was not reached', () =>
    expect(hoursFromBudgets({ ...base, fetched: false, budgets: [] })).toEqual({
      applies: true, lines: [], answer: null,
      note: "Couldn't reach Productive – answer by hand or try again" }))
  it('scores one finished full-month budget with its reason', () => {
    const r = hoursFromBudgets({ ...base, budgets: [budget()] })
    expect(r).toMatchObject({ applies: true, answer: {
      value: 1, reason: 'From Productive: 42.8h worked vs 25h budgeted (+17.8h).' }, note: null })
    expect(r.applies && r.lines[0]).toMatchObject({ budgetedHours: 25, workedHours: 42.8, diffHours: 17.8, flagged: true })
  })
  it('shows a minus sign for under', () =>
    expect(hoursFromBudgets({ ...base, budgets: [budget({ worked_minutes: 720 })] }))
      .toMatchObject({ answer: { value: 1, reason: 'From Productive: 12h worked vs 25h budgeted (−13h).' } }))
  it('leaves two budgets blank and lists both', () => {
    const r = hoursFromBudgets({ ...base, budgets: [budget(), budget({ productive_deal_id: 'd2', name: 'Budget B' })] })
    expect(r).toMatchObject({ applies: true, answer: null, note: '2 monthly budgets – tidy up in Productive' })
    expect(r.applies && r.lines).toHaveLength(2)
  })
  it('leaves a first part-month blank', () =>
    expect(hoursFromBudgets({ ...base, budgets: [budget({ starts_on: '2026-10-13' })] }))
      .toMatchObject({ applies: true, answer: null, note: 'First part-month – score by hand' }))
  it('leaves the month blank on its last day and fills it on the 1st', () => {
    expect(hoursFromBudgets({ ...base, today: '2026-10-31', budgets: [budget()] }))
      .toMatchObject({ answer: null, note: 'Month not finished – hours so far' })
    expect(hoursFromBudgets({ ...base, today: '2026-11-01', budgets: [budget()] }))
      .toMatchObject({ answer: { value: 1 } })
  })
  it('does not flag a line exactly 6h out', () =>
    expect(hoursFromBudgets({ ...base, budgets: [budget({ worked_minutes: 1860 })] }))
      .toMatchObject({ lines: [{ flagged: false }], answer: { value: 5 } }))
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/checkin/hoursFromBudgets.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement `hoursFromBudgets.ts`**

Pure, with no Supabase import. Use `Math.round(minutes / 6) / 10` for 1dp hours. Format the reason without a trailing `.0` (`25h`, not `25.0h`). Prefix the diff with `+` when over and `−` (U+2212) when under. Sort lines by `name`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run src/checkin/hoursFromBudgets.test.ts`
Expected: PASS. Then mutate each band edge in `hoursScore` (`<` ↔ `≤`) and confirm a test fails each time.

- [ ] **Step 5: Commit**

```bash
git add src/checkin/hoursFromBudgets.ts src/checkin/hoursFromBudgets.test.ts
git commit -m "feat(checkin): the hours-within-budget rule"
```

---

### Task 3: Schema: links, budgets, applicability, scores

**Files:**
- Create: `supabase/migrations/20261104120000_productive_hours.sql`
- Create: `scripts/verify-hours.sql`, and `"verify:hours"` in `package.json` (same shape as `verify:ai-runs`)
- Modify: `scripts/score-parity.mjs`, `scripts/verify-privileges.sql`, `scripts/verify-scoring-view.sql`, `src/types/database.ts` (regenerate)
- Test: `tests/hoursMigration.test.ts`, `tests/generatedColumn.test.ts`, `tests/scoreParity.test.ts`, `tests/divisorParity.test.ts`

**Interfaces:**
- Produces these tables:
  - `public.client_productive_projects(client_id bigint, productive_project_id text, created_at timestamptz default now())`
    - PK `(client_id, productive_project_id)`, `unique (productive_project_id)`, FK to `clients` `on delete restrict`
    - RLS: select if `has_capability('view_revenue') or has_capability('manage_clients')`; insert and delete with `manage_clients`; no update
  - `public.client_month_budgets(client_id bigint, period date, productive_deal_id text, productive_project_id text, name text, starts_on date, ends_on date, budgeted_minutes integer check (> 0), worked_minutes integer check (>= 0))`
    - PK `(client_id, period, productive_deal_id)`, `check (period = date_trunc('month', period)::date)`
    - RLS: select with `view_revenue`; no app writes
  - `public.client_month_hours_fetch(client_id bigint, period date, fetched_at timestamptz not null)`
    - PK `(client_id, period)`
    - RLS: select with `view_revenue`; no app writes
- Produces these functions:
  - `public.record_month_budgets(p_client_id bigint, p_period date, p_budgets jsonb) returns void`
    - security invoker; execute granted to `service_role` only
    - In one transaction: deletes the (client, period) budget rows, inserts `p_budgets`, and upserts the fetch row with `now()`
  - `private.hours_applies(p_client_id bigint, p_period date) returns boolean`
    - definer, stable
    - `p_period >= '2026-10-01' and exists(link) and (not exists(fetch) or exists(budget))`
  - `private.set_fin_hours_applies()`: definer, a BEFORE INSERT OR UPDATE trigger on `checkins` that sets `new.fin_hours_applies`
  - `private.refresh_fin_hours_applies()`: definer, an AFTER trigger on `client_productive_projects` (insert/delete) and `client_month_hours_fetch` (insert/update)
    - Runs `update public.checkins set fin_hours_applies = private.hours_applies(client_id, period) where client_id = <affected> and period >= '2026-10-01' and fin_hours_applies is distinct from private.hours_applies(client_id, period)`
  - `public.can_view_revenue() returns boolean`: invoker; wraps `private.has_capability('view_revenue')`, modelled on `can_run_ai_suggestions`; for the edge function
- Produces these columns on `checkins`:
  - `fin_hours_in_budget smallint check (fin_hours_in_budget in (1,2,3,5))`
  - `fin_hours_applies boolean not null default false`
  - `fin_score` rebuilt as `case when fin_hours_applies then (fin_rack_rate+fin_pays_on_time+fin_rate_increased+fin_hours_in_budget)::numeric/4 else (fin_rack_rate+fin_pays_on_time+fin_rate_increased)::numeric/3 end`
  - `checkin_scores.overall_score`: the same `case` over the 17/18 sums, `round(…, 2)`, with the comment updated
- The rebuild order, which follows `20260831162941_remove_on_terms.sql`: drop the view, drop `fin_score`, add the columns, add `fin_score`, recreate the view with the same columns, re-grant. Then create the trigger. Then a backfill `update checkins set fin_hours_applies = private.hours_applies(client_id, period) where period >= '2026-10-01'`; it matches nothing on day one, because no links exist yet.

- [ ] **Step 1: Write the failing source tests**

Write `tests/hoursMigration.test.ts`. Following `tests/retainersMigration.test.ts`, strip comments and slice to one statement before asserting. It needs these tests:
- `it('revokes then grants on each of the three tables, and enables RLS on each')`
- `it('lets authenticated insert and delete links only with manage_clients, and never update')`
- `it('gives authenticated no insert, update or delete on budgets or fetch rows')`
- `it('grants execute on record_month_budgets to service_role only')`
- `it('makes hours_applies and both trigger functions security definer in private with an empty search_path, execute revoked from public, anon, authenticated')`
- `it('starts hours on 2026-10-01 in hours_applies and in the refresh')`, which asserts the literal equals `HOURS_START_PERIOD` imported from `src/lib/buckets.ts`
- `it('constrains fin_hours_in_budget to 1, 2, 3, 5')`
- `it('divides fin_score by 4 only when fin_hours_applies')`
- `it('divides the overall by 18 only when fin_hours_applies')`

Also:
- Update `tests/generatedColumn.test.ts` and `scripts/score-parity.mjs` to enumerate Finances over both `fin_hours_applies` states. With hours, the value set for `fin_hours_in_budget` is `{null,1,2,3,5}`. Without hours, a stray value must not move the score.
- Update `tests/divisorParity.test.ts` to read both `case` branches.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/hoursMigration.test.ts tests/generatedColumn.test.ts tests/scoreParity.test.ts tests/divisorParity.test.ts`
Expected: FAIL, because the migration doesn't exist.

- [ ] **Step 3: Write the migration**

Write it as specified under Interfaces. Header comment: spec path, and why `fin_hours_applies` is a stored column (generated columns and the board read the row, and the trigger keeps it derived from data rather than the browser).

- [ ] **Step 4: Write `scripts/verify-hours.sql`**

Follow `scripts/verify-ai-runs.sql`. The whole script runs inside `begin … rollback`, using a scratch client. Each check raises a named exception on failure:
- An unlinked client's October check-in has `fin_hours_applies = false`, and its `fin_score` equals the 3-question mean.
- Inserting a link flips the existing check-in to `true` (not fetched), and `fin_score` becomes null until `fin_hours_in_budget` is set.
- `record_month_budgets` with `'[]'` flips it back to `false` (no budget). With one budget it flips it to `true`.
- Deleting the link flips it to `false`.
- A September check-in stays `false` throughout.
- `authenticated` without `view_revenue` sees zero budget rows, and gets a privilege error on insert.
- `overall_score` from `checkin_scores` equals `round(sum/18, 2)` with hours, and `round(sum/17, 2)` without.

- [ ] **Step 5: Run the tests**

Run: `npm test && npm run build`
Expected: PASS. Mutation check: change `/ 4` to `/ 3`, and `2026-10-01` to `2026-09-01` in the migration. Confirm a test fails each time, then revert.

- [ ] **Step 6: [OWNER] Apply to staging and verify**

Ask the owner before running anything. Then:
- `npm run db:which`, and confirm it's staging.
- `npm run db:push`, `npm run verify:hours`, `npm run verify:score`, `npm run verify:scoring-view`, `npm run verify:privileges`.
- Expected: every script finishes with no exception.
- Regenerate `src/types/database.ts` from staging, then run `npm run build`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261104120000_productive_hours.sql scripts/verify-hours.sql scripts/score-parity.mjs scripts/verify-privileges.sql scripts/verify-scoring-view.sql package.json src/types/database.ts tests/hoursMigration.test.ts tests/generatedColumn.test.ts tests/scoreParity.test.ts tests/divisorParity.test.ts
git commit -m "feat(db): Productive links, monthly budgets, and hours applicability in the Finances score"
```

---

### Task 4: Edge function `fetch-productive-hours`

**Files:**
- Create: `supabase/functions/fetch-productive-hours/index.ts` (thin, untyped by `tsc`, like `run-ai-suggestions/index.ts`)
- Create: `supabase/functions/fetch-productive-hours/logic.ts`
- Test: `tests/fetchProductiveHoursLogic.test.ts`

**Interfaces:**
- Consumes: `record_month_budgets`, `can_view_revenue`, `client_productive_projects` (Task 3)
- Produces: `POST /functions/v1/fetch-productive-hours`
  - User mode: bearer JWT, body `{ clientId: number, period: 'YYYY-MM-01' }` → `200 { fetched: true }`
  - Schedule mode: header `x-hours-cron-secret` equal to secret `HOURS_CRON_SECRET`, body `{ period }` → fetches every linked client → `200 { fetched: n, failed: [clientId…] }`
  - Errors:
    - 401: no or invalid JWT, or wrong cron secret
    - 403: the caller lacks `view_revenue`
    - 400: bad body
    - 502: Productive error, with the message redacted of the token
    - 500: not configured
  - A client with no links → `200 { fetched: false }`, and nothing is written. That leaves "not linked" to the link table, not the fetch table.
- Produces, in `logic.ts`:
```ts
export function isPeriod(value: unknown): value is string
export function dealsUrl(projectIds: readonly string[], period: string, page: number): string
  // https://api.productive.io/api/v2/deals?filter[type]=2&filter[project_id]=<ids comma-joined>
  //   &filter[date][gt_eq]=<period>&filter[date][lt_eq]=<lastDayOf(period)>&include=project&page[size]=200&page[number]=<page>
export function budgetsFromDeals(json: unknown, period: string): BudgetRow[]  // BudgetRow as Task 2; drops non-fixed-monthly
export function isFixedMonthly(attrs: { budgeted_time: number | null; date: string; end_date: string | null }, period: string): boolean
export function redact(message: string, secrets: readonly string[]): string
```
`logic.ts` may not import from `src/`, because Supabase bundles only the function folder. Duplicate `lastDayOf` locally and test it.

- [ ] **Step 1: Write the failing tests**

- `isFixedMonthly` cases:
  - `(1800, '2026-10-01', '2026-10-31')` → true
  - `(null, …)` → false
  - `(0, …)` → false
  - `(1800, '2026-10-01', null)` → false
  - `(1800, '2026-09-21', '2026-10-31')` → false
  - `(1800, '2026-10-13', '2026-10-31')` → true (a part-month is still monthly)
  - `(5400, '2026-10-01', '2026-12-31')` → false
- `budgetsFromDeals`, using a fake JSON:API page with two fixed deals, one open-hour deal and one multi-month deal (names `Budget A`…). It returns two rows with minutes copied, and a `worked_time: null` deal gives `worked_minutes: 0`.
- `dealsUrl`: the exact string for `(['1','2'], '2026-10-01', 1)`.
- `redact`: replaces every secret occurrence with `[redacted]`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/fetchProductiveHoursLogic.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement `logic.ts`, then `index.ts`**

- `index.ts` follows `run-ai-suggestions/index.ts`: CORS, a single catch-all with `redact`, and the auth steps in order.
- Productive headers: `X-Auth-Token`, `X-Organization-Id`, `Content-Type: application/vnd.api+json`.
- Page until `meta.total_pages`.
- Write through `record_month_budgets` with the service-role client.
- In schedule mode, keep going past a client's failure and list it in `failed`.

- [ ] **Step 4: Run the tests and the build**

Run: `npm test && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/fetch-productive-hours/index.ts supabase/functions/fetch-productive-hours/logic.ts tests/fetchProductiveHoursLogic.test.ts
git commit -m "feat(fn): fetch-productive-hours reads fixed monthly budgets into the database"
```

- [ ] **Step 6: [OWNER] Secrets and staging deploy**

The owner sets `PRODUCTIVE_API_TOKEN`, `PRODUCTIVE_ORG_ID` and `HOURS_CRON_SECRET` in the staging dashboard. Never in chat. Then deploy the function to staging. Call it once in user mode for a linked test client with period `2026-10-01`, and confirm budget rows appear and match the hours Productive shows.

---

### Task 5: The check-in: hours box, fill and hidden question

**Files:**
- Create: `src/checkin/useMonthHours.ts`, `src/checkin/HoursBox.tsx`, `src/checkin/HoursBox.module.css`
- Modify: `src/checkin/CheckIn.tsx` (fill effect ~124-140, refresh effect ~158-170, finances section ~452), `src/checkin/useCheckin.ts` (`hoursApplies` source)
- Test: `src/checkin/useMonthHours.dom.test.ts`, `src/checkin/HoursBox.dom.test.tsx`, `src/checkin/CheckIn.dom.test.tsx`

**Interfaces:**
- Consumes: `hoursFromBudgets` and `HoursResult` (Task 2), the tables (Task 3), the function (Task 4), `currentPeriod`/`periodFor`
- Produces:
  - `useMonthHours(clientId: number, period: string, canRead: boolean, version = 0): HoursResult | null`
    - When `canRead` is false: issues no request and no query, and returns null.
    - Otherwise:
      1. Invokes the function with `{ clientId, period }`. A failure is remembered, not thrown.
      2. Reads the links count, `client_month_budgets` and `client_month_hours_fetch` for the client and period.
      3. Returns `hoursFromBudgets({ period, today: <local YYYY-MM-DD>, linked, fetched, budgets })`.
    - If the invoke failed and no fetch row exists, `fetched` is false.
    - Tagged by version, like `useFinanceSuggestion`.
  - `<HoursBox result={HoursResult} onRetry={() => void} />`
    - One row per line: name, `{b}h budgeted`, `{w}h worked`, the signed diff, and the text `Outside ±6h` when flagged.
    - Then the note, if there is one.
    - When not applicable, shows `message`; shows nothing for `before_start`.
    - A `Try again` button only for the "Couldn't reach Productive" note. It bumps the version.
- **Where `hoursApplies` comes from**, given to `useCheckin`: `hours !== null ? hours.applies : stored?.fin_hours_applies === true`

- [ ] **Step 1: Write the failing tests**

- `useMonthHours`:
  - `it('issues no invoke and no query without view_revenue')`, using spies on `supabase.functions.invoke` and `supabase.from`. Both must have zero calls.
  - `it('treats a failed invoke with no fetch row as not fetched')`
  - `it('keeps an older fetch when today's invoke fails')`, which returns the stored budgets' result.
- `HoursBox`:
  - Renders `Outside ±6h` for a flagged line, and not for an unflagged one.
  - Renders the two-budget note.
  - Renders `No fixed monthly budget`.
  - Renders `Try again` only for the unreachable note.
- `CheckIn` (existing dom test harness, mocked hooks):
  - `it('fills Hours within budget once, only when blank in the database and the form')`, mirroring the finance prefill tests.
  - `it('does not overwrite a stored hours answer')`
  - `it('hides the hours question and counts 17/21 when hours do not apply')`
  - `it('shows the hours question from the stored row for an editor without view_revenue')`, which is Review Focus 5.
  - `it('labels the section "Finances and Hours"')`

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/checkin`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

- **The fill.** The prefill effect gains `fin_hours_in_budget` from `hours?.applies && hours.answer`. It has the same once-per-visit, blank-in-both and `edit_scores` guards.
- **The refresh effect** (after a payment save) does not touch hours. A Try again bumps `hoursVersion`, and the once-per-visit fill applies only if the answer is still blank.
- **The question.** The finances section renders `questionsFor('finances', hoursApplies)`, with `<HoursBox>` beside `<PaymentsBox>`. When hours don't apply, no question row is drawn.
- **Layout.** Use the existing PaymentsBox styles as the model. Position relative to the section by percentage or flow, never by fixed pixels. The owner checks the layout by eye.

- [ ] **Step 4: Run the tests, lint and the build**

Run: `npm test && npm run lint && npm run build`
Expected: PASS. Mutate the `canRead` guard and the `storedValue === null` guard, and confirm a test fails each time.

- [ ] **Step 5: Commit**

```bash
git add src/checkin/useMonthHours.ts src/checkin/useMonthHours.dom.test.ts src/checkin/HoursBox.tsx src/checkin/HoursBox.module.css src/checkin/HoursBox.dom.test.tsx src/checkin/CheckIn.tsx src/checkin/CheckIn.dom.test.tsx src/checkin/useCheckin.ts
git commit -m "feat(checkin): Productive hours in Finances and Hours, filled from the budget"
```

---

### Task 6: Clients admin: link Productive projects

**Files:**
- Create: `src/clients/useProductiveLinks.ts`
- Modify: `src/clients/EditClientForm.tsx`, `src/clients/ClientsAdmin.tsx` (pass the capability)
- Test: `src/clients/useProductiveLinks.dom.test.ts`, `src/clients/ClientsAdmin.dom.test.tsx`

**Interfaces:**
- Produces: `useProductiveLinks(clientId: number, canManage: boolean): { status: 'off' | 'loading' | 'ready' | 'error'; projectIds: string[]; add(id: string): Promise<string | null>; remove(id: string): Promise<string | null> }`
  - `add` and `remove` return an error message or null.
  - `add` rejects a non-numeric id with `Productive project IDs are numbers — copy it from the project's URL.`
  - A unique-violation (the project is already linked to another client) maps to `That project is already linked to another client.`

- [ ] **Step 1: Write the failing tests**

- Hook:
  - `off` without `manage_clients`, with no query made.
  - `add('abc')` returns the numbers message with no insert.
  - The unique-violation code `23505` maps to the "already linked" message.
- Admin:
  - The edit form shows a "Productive projects" field listing linked IDs, each with a Remove button.
  - Adding an ID calls `add`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/clients`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

Model the hook on `useRetainer.ts`. In the form, put the field after the retainer. Its label is `Productive projects`, with the hint `The number in the project's Productive URL`.

- [ ] **Step 4: Run the tests and the build**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/clients/useProductiveLinks.ts src/clients/useProductiveLinks.dom.test.ts src/clients/EditClientForm.tsx src/clients/ClientsAdmin.tsx src/clients/ClientsAdmin.dom.test.tsx
git commit -m "feat(clients): link a client to its Productive projects"
```

---

### Task 7: Board and AI keys

**Files:**
- Modify: `src/board/cardSummary.ts` (`CHECKIN_COLUMNS`, `CardCheckin`, `cardFooter` call), `src/board/useBoard.ts` or `Board.tsx` at the `cardFooter` call site, `src/checkin/aiSuggestion.ts` (`FINANCE_KEYS`)
- Test: `src/board/cardSummary.test.ts`, `src/checkin/aiSuggestion.test.ts`, `src/board/runAiBoardParity.test.ts` (if it pins the key count)

**Interfaces:**
- Consumes: the `fin_hours_applies` column (Task 3) and the `cardFooter(checkin, viewerId, advocacyApplies, hoursApplies)` signature (Task 1)
- Produces:
  - `CHECKIN_COLUMNS` includes `fin_hours_applies`
  - `FINANCE_KEYS = ['fin_rack_rate', 'fin_rate_increased', 'fin_hours_in_budget']`
  - `AI_ANSWER_KEYS` keeps 19 keys

- [ ] **Step 1: Write the failing tests**

- `cardFooter` reads `Draft, 10 of 22 scored` when the row's `fin_hours_applies` is true and Advocacy is open, and `of 21` when it's false.
- `AI_ANSWER_KEYS` excludes `fin_hours_in_budget` and has length 19.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/board src/checkin/aiSuggestion.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

The board passes `checkin?.fin_hours_applies === true`, replacing Task 1's placeholder `false`. Add the key to `FINANCE_KEYS`.

- [ ] **Step 4: Run the tests and the build**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/board/cardSummary.ts src/board/cardSummary.test.ts <board call-site file> src/checkin/aiSuggestion.ts src/checkin/aiSuggestion.test.ts
git commit -m "feat(board): count the hours question where it applies; AI leaves it to the rule"
```

---

### Task 8: Schedule, routine and rollout

**Files:**
- Create: `supabase/migrations/20261104130000_schedule_productive_hours.sql`
- Modify: `../tgc-client-health-ai-runs/.superpowers/sdd/2026-10-30-ai-suggestion-runs/routine-prompt-v2.md` (local copy)
- Test: `tests/hoursScheduleMigration.test.ts`

**Interfaces:**
- Produces: the pg_cron job `fetch-productive-hours-monthly` at `0 12 1 * *`, two hours before the routine's `0 14 1 * 1`.
  - It calls the function through `net.http_post`, with the URL and `HOURS_CRON_SECRET` read from Vault secrets `productive_hours_fn_url` and `productive_hours_cron_secret`. Never literals.
  - The body is `{ "period": <first of the previous month> }`, computed in SQL.

- [ ] **Step 1: Write the failing test**

`tests/hoursScheduleMigration.test.ts`:
- The schedule string is `0 12 1 * *`.
- The URL and secret come from `vault.decrypted_secrets`.
- There is no `http` literal and no secret-looking literal in the file.
- The period expression is `date_trunc('month', now() - interval '1 month')::date`.

- [ ] **Step 2: Run it, see it fail, write the migration, and see it pass**

Run: `npx vitest run tests/hoursScheduleMigration.test.ts`
Expected: FAIL, then PASS. Before writing the migration, confirm on staging that `pg_cron` and `pg_net` are enabled. If they aren't, the migration enables them.

- [ ] **Step 3: Update the local routine prompt copy**

Add an "Hours within budget" paragraph next to the Finance one:
- Read `checkins.fin_hours_applies` after writing the row. When it's false, leave `fin_hours_in_budget` null.
- When it's true, apply `src/checkin/hoursFromBudgets.ts` to `client_month_budgets` and `client_month_hours_fetch`, and write its answer.
- When the rule gives no answer because the month isn't finished, write 3 with the note `hours pending – month not finished`.
- For two budgets, a part-month or unreachable, leave it null and say why in the note.
- A manually scored row the routine may not overwrite keeps its hours answer.

- [ ] **Step 4: Run the full checks**

Run: `npm test && npm run lint && npm run build`. Then, under Node 26: `mv .env.local /tmp/env.bak; NODE_OPTIONS=--no-experimental-webstorage npx vitest run; mv /tmp/env.bak .env.local`.
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261104130000_schedule_productive_hours.sql tests/hoursScheduleMigration.test.ts
git commit -m "feat(db): fetch last month's Productive hours before the AI routine runs"
```

- [ ] **Step 6: [OWNER] Whole-branch review**

Run superpowers:requesting-code-review over the whole branch on the strongest model, before any rollout.

- [ ] **Step 7: [OWNER] Rollout**

Each step needs the owner's go-ahead:
1. Staging: push the schedule migration, set the Vault secrets, and seed links for 2–3 clients. The owner tries October on staging, checks the layout by eye, and confirms the lines match Productive.
2. Propose a production link list from the Productive project names, as a table of client to project IDs. The owner confirms or edits it.
3. Production:
   - Set the function secrets and Vault secrets.
   - Run `apply_migration` for both migrations.
   - Run `verify:hours`, `verify:score`, `verify:scoring-view` and `verify:privileges` against production.
   - Deploy the function.
   - Insert the confirmed links.
   - Run the function in user mode for October.
4. Update the live routine prompt on `trig_01BA2jJY2nCCd1MozSm17pS3` to match the local copy.
5. Push `productive-hours` to `main`. Then check that the live bundle's hash changed, because a push is not a deploy.
6. Expect October cards for linked clients to show "Not scored" until the hours answer is filled, by the screen or by a routine re-run. That's the intended effect of the question applying.
