# Slice 6i — 2025 Backfill Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and test the tooling that classifies two years of ledger data in one pass and produces a reconciliation report the owner can rule on — stopping before any row is written.

**Architecture:** The retainer/project recurrence rule becomes a pure, tested module (`scripts/revenue-classify.mjs`) that reads runs of consecutive billing months across the whole span. `planImport` grows a value-level overwrite diff so a reclassification of an existing row is visible as *from → to* rather than as a count. A pipeline outside the repo feeds both years through these and prints the report. No schema change, no migration, no write.

**Tech Stack:** Plain `.mjs` modules with JSDoc types (not part of the app's TypeScript program), Vitest for tests, Node for the pipeline scripts.

**Spec:** `docs/superpowers/specs/2026-09-14-slice-6i-2025-backfill-design.md`

## Global Constraints

- **`public.client_month_revenue` has NO DELETE POLICY, deliberately.** A row written in error can be edited but never removed. Every judgement in this plan is one-way.
- **This repository is public.** Real client names, ledger figures and departure rosters live in `~/Downloads/tgc-import-2026/` and must not enter the repo. Every test fixture uses synthetic names.
- **This plan writes nothing to any database.** It ends at a printed report. Staging and production writes are a separate plan, gated on the owner's rulings.
- **The anchor is the latest month holding an entry, never the calendar.** The rule `latestPeriod` has enforced since 6f-1 and `rangeMath` since 6h.
- **Ledger lines are classified by as-entered name**, the same key `overrides` already uses.
- Commands: `npm test`, `npm run lint`, `npm run build`.

> **Already done, no task needed:** spec §2's reader. `~/Downloads/tgc-import-2026/extract-2025-original.mjs` is built and verified — it parses the downloaded 2025 tab into the Data-tab shape, ties every month × entity to the sheet's own subtotals, and reproduces the earlier Jan–Jul extract exactly. Its output is `data-2025.csv`, which Task 4 reads. Do not rebuild it.

---

### Task 1: The recurrence rule, in code

The rule that decides whether a client's money is retainer or project work has never existed in code — it was applied by hand into a 26-entry map. This task is the whole reason the slice is more than a data load.

**Files:**
- Create: `scripts/revenue-classify.mjs`
- Test: `tests/revenueClassify.test.ts`

**Interfaces:**
- Consumes: nothing. Pure module, no imports.
- Produces: `classifyRuns({ lines, anchor, overrides, minRun }) -> { kinds, runs, decisions }` where
  - `lines: { period: string, name: string, cents: number }[]` — one entry per ledger line item; `period` is `YYYY-MM-01`, `name` is the as-entered line-item name, `cents` is a non-negative integer.
  - `anchor: string` — `YYYY-MM-01`, the latest month holding any entry across the span.
  - `overrides: Record<string, 'retainer' | 'project' | 'exclude'>` — the owner's direct calls, which outrank the computed kind.
  - `minRun: number` — defaults to `3`.
  - `kinds: Record<string, 'retainer' | 'project' | 'exclude'>`
  - `runs: Record<string, { from: string, to: string, length: number }>` — the longest run found, for the report to quote.
  - `decisions: { name: string, kind: string, why: 'override' | 'run' | 'anchor' | 'short' }[]`, sorted by name.

- [ ] **Step 1: Write the failing test**

Create `tests/revenueClassify.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain .mjs script with JSDoc types, not part of the app's
// TypeScript program. Same arrangement as revenue-import-plan.mjs: the decisions
// live in a module that can be tested, and the script around it only does I/O.
import { classifyRuns } from '../scripts/revenue-classify.mjs'

// The owner's rule, in his words: "a bare client name is a RETAINER only if it
// recurs in consecutive months -- three or more, or still running at the anchor
// -- otherwise project work", with his direct calls outranking the rule.
//
// It was applied BY HAND for the 2026 import and frozen into a map of names.
// That works for one year and fails for two, because a run of consecutive months
// does not stop at New Year. Synthetic names throughout: this repo is public.

const ANCHOR = '2026-09-01'

function line(name: string, period: string, cents = 500_000) {
  return { name, period, cents }
}

describe('classifyRuns — the recurrence rule', () => {
  it('calls three consecutive months a retainer', () => {
    const out = classifyRuns({
      lines: [line('Alpha', '2025-02-01'), line('Alpha', '2025-03-01'), line('Alpha', '2025-04-01')],
      anchor: ANCHOR,
    })
    expect(out.kinds.Alpha).toBe('retainer')
    expect(out.runs.Alpha).toEqual({ from: '2025-02-01', to: '2025-04-01', length: 3 })
  })

  it('calls two consecutive months project work', () => {
    const out = classifyRuns({
      lines: [line('Beta', '2025-02-01'), line('Beta', '2025-03-01')],
      anchor: ANCHOR,
    })
    expect(out.kinds.Beta).toBe('project')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/revenueClassify.test.ts`
Expected: FAIL — cannot find module `../scripts/revenue-classify.mjs`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/revenue-classify.mjs`:

```js
// Decides whether a ledger line is retainer or project work, by reading runs of
// consecutive billing months across the WHOLE span it is given.
//
// WHY THIS EXISTS. Until slice 6i this rule lived in the owner's head and in a
// hand-built map of names. That is workable for one year and wrong for two: a
// client billing November, December, January, February is two short project runs
// when each year is classified alone, and one four-month retainer when the years
// are read together. Only the second reading is true, and no map keyed by name
// can express it.
//
// Separated from the script that reads files for the same reason
// revenue-import-plan.mjs is: this decision moves real money between two columns
// of a table with no delete policy, and an untested contract is not a contract.

// The month after this one. String arithmetic on the year and month numbers,
// never a parsed Date: `new Date('2025-03-01')` is UTC midnight, which in any
// western zone is the last day of February.
function nextMonth(period) {
  const year = Number(period.slice(0, 4))
  const month = Number(period.slice(5, 7))
  const total = year * 12 + month // already the 0-based index of the NEXT month
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

/**
 * @param {{ lines: { period: string, name: string, cents: number }[],
 *           anchor: string,
 *           overrides?: Record<string, 'retainer'|'project'|'exclude'>,
 *           minRun?: number }} input
 */
export function classifyRuns({ lines, anchor, overrides = {}, minRun = 3 }) {
  // A BILLING month is one with money in it. A line of exactly zero is a real
  // thing in this ledger -- the owner's rule writes "billed nothing" as an
  // explicit 0 -- and it is not a month of work, so it breaks a run rather than
  // continuing one. Counting it would turn a client who left in March into a
  // retainer on the strength of months they were not billed for.
  const monthsByName = new Map()
  for (const { name, period, cents } of lines) {
    if (cents <= 0) continue
    if (!monthsByName.has(name)) monthsByName.set(name, new Set())
    monthsByName.get(name).add(period)
  }

  const kinds = {}
  const runs = {}
  const decisions = []

  for (const [name, monthSet] of monthsByName) {
    const months = [...monthSet].sort()
    let best = { from: months[0], to: months[0], length: 1 }
    let start = months[0]
    let length = 1
    for (let i = 1; i < months.length; i++) {
      if (months[i] === nextMonth(months[i - 1])) length += 1
      else { start = months[i]; length = 1 }
      if (length > best.length) best = { from: start, to: months[i], length }
    }
    runs[name] = best

    // "Still running at the anchor" is a SEPARATE test from the run length, and
    // it has to be: a client who signed two months ago and is still billing is a
    // retainer nobody would call project work, and the length rule alone cannot
    // see them until their third invoice.
    const openAtAnchor = monthSet.has(anchor)
    const override = overrides[name]
    const kind = override ?? (best.length >= minRun ? 'retainer' : openAtAnchor ? 'retainer' : 'project')
    const why = override ? 'override' : best.length >= minRun ? 'run' : openAtAnchor ? 'anchor' : 'short'

    kinds[name] = kind
    decisions.push({ name, kind, why })
  }

  // Names the owner excluded or classified that never appear in the lines: kept,
  // so an exclusion survives a re-import rather than quietly lapsing when a name
  // drops out of the sheet.
  for (const [name, kind] of Object.entries(overrides)) {
    if (kinds[name] !== undefined) continue
    kinds[name] = kind
    decisions.push({ name, kind, why: 'override' })
  }

  decisions.sort((left, right) => left.name.localeCompare(right.name))
  return { kinds, runs, decisions }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/revenueClassify.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Add the tests that carry the real weight**

Append to `tests/revenueClassify.test.ts`, inside the same `describe`:

```ts
  it('joins a run across New Year, which is the whole reason this is computed', () => {
    const out = classifyRuns({
      lines: [
        line('Gamma', '2025-11-01'), line('Gamma', '2025-12-01'),
        line('Gamma', '2026-01-01'), line('Gamma', '2026-02-01'),
      ],
      anchor: ANCHOR,
    })
    expect(out.kinds.Gamma).toBe('retainer')
    expect(out.runs.Gamma).toEqual({ from: '2025-11-01', to: '2026-02-01', length: 4 })
  })

  it('does not add two separate short runs together', () => {
    const out = classifyRuns({
      lines: [
        line('Delta', '2025-01-01'), line('Delta', '2025-02-01'),
        line('Delta', '2025-09-01'), line('Delta', '2025-10-01'),
      ],
      anchor: ANCHOR,
    })
    expect(out.kinds.Delta).toBe('project')
    expect(out.runs.Delta.length).toBe(2)
  })

  it('calls a short run still open at the anchor a retainer', () => {
    const out = classifyRuns({
      lines: [line('Epsilon', '2026-08-01'), line('Epsilon', '2026-09-01')],
      anchor: ANCHOR,
    })
    expect(out.kinds.Epsilon).toBe('retainer')
    expect(out.decisions.find((d: { name: string }) => d.name === 'Epsilon')?.why).toBe('anchor')
  })

  it('breaks a run on an explicit zero, which is a month billed nothing', () => {
    const out = classifyRuns({
      lines: [
        line('Zeta', '2025-01-01'), line('Zeta', '2025-02-01', 0), line('Zeta', '2025-03-01'),
      ],
      anchor: ANCHOR,
    })
    expect(out.kinds.Zeta).toBe('project')
    expect(out.runs.Zeta.length).toBe(1)
  })

  it('breaks a run on a month absent from the ledger entirely', () => {
    const out = classifyRuns({
      lines: [line('Eta', '2025-01-01'), line('Eta', '2025-03-01'), line('Eta', '2025-04-01')],
      anchor: ANCHOR,
    })
    expect(out.kinds.Eta).toBe('project')
  })

  it("lets the owner's direct call outrank a computed retainer", () => {
    const out = classifyRuns({
      lines: [line('Theta', '2025-02-01'), line('Theta', '2025-03-01'), line('Theta', '2025-04-01')],
      anchor: ANCHOR,
      overrides: { Theta: 'project' },
    })
    expect(out.kinds.Theta).toBe('project')
    expect(out.decisions.find((d: { name: string }) => d.name === 'Theta')?.why).toBe('override')
  })

  it('keeps an exclusion whose name has dropped out of the ledger', () => {
    const out = classifyRuns({
      lines: [line('Iota', '2025-02-01')],
      anchor: ANCHOR,
      overrides: { Kappa: 'exclude' },
    })
    expect(out.kinds.Kappa).toBe('exclude')
  })

  it('crosses a December boundary without an off-by-one in the month arithmetic', () => {
    const out = classifyRuns({
      lines: [line('Lambda', '2025-12-01'), line('Lambda', '2026-01-01')],
      anchor: ANCHOR,
    })
    expect(out.runs.Lambda).toEqual({ from: '2025-12-01', to: '2026-01-01', length: 2 })
  })
})

// The threshold is a RULE, not a constant to be tuned. These two assert that the
// tests above would notice if it moved: "two consecutive months is project work"
// fails the moment minRun becomes 2, which is the mutation this module is most
// likely to suffer at the hands of someone making a number look nicer.
describe('classifyRuns — the threshold is load-bearing', () => {
  it('a two-month run is project at the default threshold and retainer at two', () => {
    const lines = [line('Mu', '2025-02-01'), line('Mu', '2025-03-01')]
    expect(classifyRuns({ lines, anchor: ANCHOR }).kinds.Mu).toBe('project')
    expect(classifyRuns({ lines, anchor: ANCHOR, minRun: 2 }).kinds.Mu).toBe('retainer')
  })
})
```

- [ ] **Step 6: Run the full suite and the linter**

Run: `npm test && npm run lint`
Expected: PASS. The new file adds 10 tests; nothing existing changes.

- [ ] **Step 7: Commit**

```bash
git add scripts/revenue-classify.mjs tests/revenueClassify.test.ts
git commit -m "feat(import): the recurrence rule, in code for the first time

A bare client name is a retainer only if it recurs three or more
consecutive months, or is still running at the anchor. Until now that
rule lived in the owner's head and in a hand-built map of names, which
works for one year and fails for two: a client billing November through
February is two short project runs when the years are read separately
and one four-month retainer when they are read together.

An explicit zero breaks a run. It is a month billed nothing, not a month
of work, and counting it would turn a client who left in March into a
retainer on the strength of months nobody billed them for."
```

---

### Task 2: The overwrite diff carries values, not just names

Recomputing the rule across the span can move money between two columns of rows already in production. `planImport` already reports *that* a client-month would be rewritten; it cannot say what it becomes.

**Files:**
- Modify: `scripts/revenue-import-plan.mjs:192-200` (the `overwrites` block) and `:322-372` (`reportOf`)
- Test: `tests/revenueImport.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `planImport` return value gains `unchangedOverwrites: number`, and each `overwrites` entry becomes
  `{ clientName: string, period: string, from: { retainerCents: number, projectCents: number } | null, to: { retainerCents: number, projectCents: number } }`.
  `from` is `null` when the caller supplied an `existing` row without cents — the old two-field shape — which means "would be rewritten, prior values not supplied".

- [ ] **Step 1: Write the failing test**

Append to `tests/revenueImport.test.ts`:

```ts
describe('planImport — what an overwrite would actually change', () => {
  it('reports the values a reclassified row moves between, not just its name', () => {
    const plan = planImport({
      cells: [cell('Acme', '2026-07-01', '0', '4,000')],
      roster: ROSTER,
      existing: [{ client_id: 1, period: '2026-07-01', retainer_cents: 400_000, project_cents: 0 }],
    })
    expect(plan.overwrites).toEqual([
      {
        clientName: 'Acme',
        period: '2026-07-01',
        from: { retainerCents: 400_000, projectCents: 0 },
        to: { retainerCents: 0, projectCents: 400_000 },
      },
    ])
    expect(plan.unchangedOverwrites).toBe(0)
  })

  it('counts a rewrite that changes nothing rather than listing it', () => {
    const plan = planImport({
      cells: [cell('Acme', '2026-07-01', '4,000', '0')],
      roster: ROSTER,
      existing: [{ client_id: 1, period: '2026-07-01', retainer_cents: 400_000, project_cents: 0 }],
    })
    expect(plan.overwrites).toEqual([])
    expect(plan.unchangedOverwrites).toBe(1)
  })

  it('still flags a rewrite when the caller supplied no prior values', () => {
    const plan = planImport({
      cells: [cell('Acme', '2026-07-01', '4,000', '0')],
      roster: ROSTER,
      existing: [{ client_id: 1, period: '2026-07-01' }],
    })
    expect(plan.overwrites).toEqual([
      { clientName: 'Acme', period: '2026-07-01', from: null, to: { retainerCents: 400_000, projectCents: 0 } },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/revenueImport.test.ts`
Expected: FAIL — `overwrites` entries are `{ clientName, period }` with no `from`/`to`, and `unchangedOverwrites` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `scripts/revenue-import-plan.mjs`, replace the `already`/`overwrites` block (currently at `:197-200`):

```js
  // Client-months that ALREADY have a row. The import upserts on purpose -- it
  // has to survive being re-run after the sheet is corrected -- so the
  // protection is not refusal, it is that the owner sees what changes before
  // running it.
  //
  // VALUES, not names. Slice 6i recomputes the retainer/project rule across two
  // years at once, which can move money between the two columns of a row already
  // in production. A list of client-months cannot show that; "retainer $5,000 ->
  // $0, project $0 -> $5,000" can. A rewrite that changes nothing is COUNTED
  // rather than listed, so that a re-run's hundreds of no-op upserts cannot bury
  // the one row that really moves.
  const already = new Map(existing.map((row) => [`${row.client_id}|${row.period}`, row]))
  const overwrites = []
  let unchangedOverwrites = 0
  for (const write of planned) {
    if (write.clientId === null) continue
    const prior = already.get(`${write.clientId}|${write.period}`)
    if (prior === undefined) continue

    const to = { retainerCents: write.retainerCents, projectCents: write.projectCents }
    // A caller may pass the old two-field shape. Then the prior values are not
    // unknown-because-zero, they are simply not supplied, and saying "$0 -> $0"
    // would assert something nobody checked.
    if (prior.retainer_cents === undefined || prior.project_cents === undefined) {
      overwrites.push({ clientName: write.clientName, period: write.period, from: null, to })
      continue
    }

    const from = { retainerCents: prior.retainer_cents, projectCents: prior.project_cents }
    if (from.retainerCents === to.retainerCents && from.projectCents === to.projectCents) {
      unchangedOverwrites += 1
      continue
    }
    overwrites.push({ clientName: write.clientName, period: write.period, from, to })
  }
```

Add `unchangedOverwrites` to the returned object, beside `overwrites`:

```js
  return {
    overwrites,
    unchangedOverwrites,
    writes: problems.length > 0 ? [] : planned,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/revenueImport.test.ts`
Expected: PASS, including all 34 pre-existing tests.

- [ ] **Step 5: Teach the report to print it**

In `scripts/revenue-import-plan.mjs`, replace the `overwrites` section of `reportOf`:

```js
  if (plan.overwrites.length > 0) {
    lines.push('', `Existing rows that would CHANGE (${plan.overwrites.length}):`)
    for (const row of plan.overwrites) {
      if (row.from === null) {
        lines.push(`  - ${row.clientName} ${row.period}  (prior values not supplied)`)
        continue
      }
      const parts = []
      if (row.from.retainerCents !== row.to.retainerCents) {
        parts.push(`retainer ${formatMoney(row.from.retainerCents)} -> ${formatMoney(row.to.retainerCents)}`)
      }
      if (row.from.projectCents !== row.to.projectCents) {
        parts.push(`project ${formatMoney(row.from.projectCents)} -> ${formatMoney(row.to.projectCents)}`)
      }
      lines.push(`  - ${row.clientName} ${row.period}  ${parts.join('   ')}`)
    }
  }

  if (plan.unchangedOverwrites > 0) {
    lines.push('', `Existing rows rewritten with identical values: ${plan.unchangedOverwrites}`)
  }
```

- [ ] **Step 6: Test the report text**

Append to `tests/revenueImport.test.ts`:

```ts
describe('reportOf — the diff on the page', () => {
  it('names the columns that move and the amounts they move between', () => {
    const plan = planImport({
      cells: [cell('Acme', '2026-07-01', '0', '4,000')],
      roster: ROSTER,
      existing: [{ client_id: 1, period: '2026-07-01', retainer_cents: 400_000, project_cents: 0 }],
    })
    const report = reportOf(plan)
    expect(report).toContain('Existing rows that would CHANGE (1)')
    expect(report).toContain('retainer $4,000 -> $0')
    expect(report).toContain('project $0 -> $4,000')
  })

  it('does not print a CHANGE section when every rewrite is identical', () => {
    const plan = planImport({
      cells: [cell('Acme', '2026-07-01', '4,000', '0')],
      roster: ROSTER,
      existing: [{ client_id: 1, period: '2026-07-01', retainer_cents: 400_000, project_cents: 0 }],
    })
    const report = reportOf(plan)
    expect(report).not.toContain('would CHANGE')
    expect(report).toContain('Existing rows rewritten with identical values: 1')
  })
})
```

Run: `npx vitest run tests/revenueImport.test.ts`
Expected: PASS.

Note: `formatMoney` renders whole dollars without cents for round amounts — if these two assertions fail on the exact string, read `src/revenue/money.ts` and match its real output rather than changing `money.ts`.

- [ ] **Step 7: Run the full suite, the linter and the build**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS. The build matters here: `npm test` passing is not a clean build, and this project has shipped a commit message claiming otherwise.

- [ ] **Step 8: Commit**

```bash
git add scripts/revenue-import-plan.mjs tests/revenueImport.test.ts
git commit -m "feat(import): an overwrite says what it changes, not just where

Slice 6i recomputes the retainer/project rule across two years at once,
which can move money between the two columns of a row already in
production. The old report listed a client and a month, which cannot
show that. It now reads retainer \$5,000 -> \$0, project \$0 -> \$5,000.

A rewrite that changes nothing is counted rather than listed. A re-run
upserts every row it already wrote, and hundreds of no-op lines are
exactly where the one row that really moves would go unnoticed.

Every run of the importer so far passed existing: [], so this protection
has never once been exercised. It is load-bearing from here."
```

---

### Task 3: A snapshot of the rows as they stand

The diff needs the current rows, and nothing in the toolchain reads them — the roster snapshots hold clients, not revenue.

**Files:**
- Create: `scripts/snapshot-revenue-rows.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: a single JSON value, shaped as `planImport`'s `existing` parameter: `{ client_id, period, retainer_cents, project_cents }[]`.

- [ ] **Step 1: Write the file**

Create `scripts/snapshot-revenue-rows.sql`:

```sql
-- The revenue rows as they currently stand, shaped for planImport's `existing`
-- parameter, so a re-import can report what it would CHANGE rather than only
-- where it would write.
--
-- Read-only. No transaction, nothing to roll back.
--
-- PRODUCTION AND STAGING NEED SEPARATE SNAPSHOTS AND THEY ARE NOT
-- INTERCHANGEABLE. Staging carries test fixtures that production does not, so a
-- diff generated against staging is not a preview of production's -- it is a
-- different answer that looks like the same one.
--
-- Save the single returned value as roster-style JSON beside the roster
-- snapshots: revenue-rows-staging.json or revenue-rows-production.json.
select coalesce(
  json_agg(
    json_build_object(
      'client_id', client_id,
      'period', to_char(period, 'YYYY-MM-DD'),
      'retainer_cents', retainer_cents,
      'project_cents', project_cents
    )
    order by client_id, period
  ),
  '[]'::json
) as rows
from public.client_month_revenue;
```

- [ ] **Step 2: Verify it parses and returns the right shape against staging**

Run: `npm run db:which` first and confirm it reports **staging**. Then run the file through the SQL editor or `npx --yes supabase@latest db query --linked -f scripts/snapshot-revenue-rows.sql`.

Expected: a single `rows` value, a JSON array whose first element has exactly the four keys `client_id`, `period`, `retainer_cents`, `project_cents`, with `period` as `YYYY-MM-01`.

Do **not** run this against production from here — the sandbox refuses production queries, read as well as write. The owner runs it himself and returns the result.

- [ ] **Step 3: Commit**

```bash
git add scripts/snapshot-revenue-rows.sql
git commit -m "feat(import): snapshot the revenue rows a diff has to compare against

The roster snapshots hold clients, not revenue, so nothing in the
toolchain could read the rows an import would overwrite. Read-only, and
deliberately separate per environment: staging carries fixtures
production does not, so a staging diff is not a preview of production's."
```

---

### Task 4: The pipeline, and the report the owner rules on

This task's output is **not in the repo** — it names real clients. It lives in `~/Downloads/tgc-import-2026/`, alongside the 2026 pipeline it is modelled on.

**Files:**
- Create: `~/Downloads/tgc-import-2026/build-2025.mjs`
- Read: `~/Downloads/tgc-import-2026/data-2025.csv`, `data.csv`, `names.json`, `rename.json`, `overrides-refined.json`, `rollup-2025.json`, `roster-production.json`
- Reference: `~/Downloads/tgc-import-2026/build-sql.mjs` — the 2026 pipeline, whose structure this follows

**Interfaces:**
- Consumes: `classifyRuns` from Task 1; `planImport`/`reportOf` from Task 2; `planCells`/`parseCsv` from `scripts/revenue-import-read.mjs`.
- Produces: a printed report only. **No SQL, no writes.** SQL emission is the next plan.

- [ ] **Step 1: Build the classification input from both years**

The classifier needs one flat list of ledger lines across both years. `parseCsv` is already exported from `scripts/revenue-import-read.mjs`; use it rather than re-parsing.

```js
import { readFileSync } from 'node:fs'
import { parseCsv, planCells } from '/Users/josh/Downloads/CLAUDE/tgc-client-health/scripts/revenue-import-read.mjs'
import { classifyRuns } from '/Users/josh/Downloads/CLAUDE/tgc-client-health/scripts/revenue-classify.mjs'
import { planImport, reportOf } from '/Users/josh/Downloads/CLAUDE/tgc-client-health/scripts/revenue-import-plan.mjs'

const S = '/Users/josh/Downloads/tgc-import-2026'
const json = (f) => JSON.parse(readFileSync(`${S}/${f}`, 'utf8'))

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 }
const money = (s) => {
  const t = String(s).replace(/[$,]/g, '').trim()
  return t === '' || t === '-' ? 0 : Math.round(Number(t) * 100)
}

// One flat list of ledger lines across BOTH years. The classifier reads runs of
// consecutive months, and a run does not stop at New Year -- feeding it one year
// at a time is the bug this whole module exists to prevent.
function linesOf(file, year) {
  // parseCsv returns a plain ARRAY OF ROWS -- arrays of strings -- with the
  // header at index 0. It does not return a {rows, columns} object.
  const rows = parseCsv(readFileSync(`${S}/${file}`, 'utf8'))
  const at = Object.fromEntries(rows[0].map((name, i) => [name, i]))
  return rows
    .slice(1)
    .filter((r) => (r[at['Entity']] ?? '') === 'TGC')
    .map((r) => ({
      name: r[at['Client (as entered)']] ?? '',
      period: `${year}-${String(MONTHS[r[at['Month']]] ?? 0).padStart(2, '0')}-01`,
      cents: money(r[at['Invoice Amount']] ?? ''),
    }))
    .filter((l) => l.name !== '' && !l.period.endsWith('-00-01'))
}

const lines = [...linesOf('data-2025.csv', 2025), ...linesOf('data.csv', 2026)]
const anchor = lines.map((l) => l.period).sort().at(-1)
```

- [ ] **Step 2: Classify, then feed the computed kinds in as `overrides`**

`planCells` already resolves a line's kind with `overrides[asEntered] ?? defaultKind`. Passing the computed map as `overrides` means **`planCells` does not change at all** and its tests stay green. The owner's explicit calls are merged last so they still win.

```js
const explicit = json('overrides-refined.json')   // exceptions and exclusions only
const { kinds, runs, decisions } = classifyRuns({ lines, anchor, overrides: explicit })

const common = {
  entity: 'TGC',
  alsoInclude: ['Juan Valdez'],
  rename: json('rename.json'),
  overrides: kinds,            // computed, with the owner's calls already folded in
}
const NAMES = json('names.json')
const map = (cells) => cells.map((c) => ({ ...c, clientName: NAMES[c.clientName] ?? c.clientName }))

const read25 = planCells({ csv: readFileSync(`${S}/data-2025.csv`, 'utf8'), year: 2025, ...common })
const read26 = planCells({ csv: readFileSync(`${S}/data.csv`, 'utf8'), year: 2026, ...common })
for (const r of [read25, read26]) {
  if (r.problems.length) { console.log(r.problems.join('\n')); process.exit(1) }
}
const cells = [...map(read25.cells), ...map(read26.cells)]
```

- [ ] **Step 3: Propose the lifecycles, and separate the two kinds of proposal**

```js
const first = new Map(), last = new Map()
for (const c of cells) {
  if (!first.has(c.clientName) || c.period < first.get(c.clientName)) first.set(c.clientName, c.period)
  if (!last.has(c.clientName) || c.period > last.get(c.clientName)) last.set(c.clientName, c.period)
}

const roster = json('roster-production.json')
const norm = (n) => n.trim().replace(/\s+/g, ' ').toLowerCase()
const known = new Map(roster.map((c) => [norm(c.name), c]))

// Clients to CREATE, each with a proposed end date at their last invoice month.
// Proposed, not decided: the owner confirms or corrects every one before a row
// is written. A null ended_on was considered and refused -- retention would file
// them "unentered" and drop them from both sides, which makes every departure
// invisible to the measure built to catch departures.
const toCreate = []
// Start dates to MOVE BACK. These are floors, not starts: a client billing in
// January 2025 may have begun in 2023. The report says so rather than letting a
// better floor pass as a fact.
const toMoveStart = []

for (const [name, firstMonth] of [...first].sort()) {
  const match = known.get(norm(name))
  if (match === undefined) {
    toCreate.push({ name, started_on: firstMonth, proposed_ended_on: last.get(name) })
    continue
  }
  if (match.started_on !== null && match.started_on > firstMonth) {
    toMoveStart.push({ name, from: match.started_on, to: firstMonth })
  }
}
```

- [ ] **Step 4: Print the report, problems first**

```js
const plan = planImport({
  cells,
  roster: [...roster, ...toCreate.map((c, i) => ({ id: 900 + i, name: c.name, started_on: c.started_on, ended_on: c.proposed_ended_on }))],
  existing: json('revenue-rows-production.json'),   // from Task 3; [] until the owner supplies it
})

console.log(reportOf(plan))

console.log(`\nClassified across ${lines.length} ledger lines, anchor ${anchor}.`)
console.log(`Retainer: ${Object.values(kinds).filter((k) => k === 'retainer').length}   ` +
            `Project: ${Object.values(kinds).filter((k) => k === 'project').length}   ` +
            `Excluded: ${Object.values(kinds).filter((k) => k === 'exclude').length}`)

console.log(`\nClients to CREATE (${toCreate.length}) — proposed end date is their LAST INVOICE MONTH, confirm each:`)
for (const c of toCreate) console.log(`  - ${c.name}   ${c.started_on.slice(0, 7)} -> ${c.proposed_ended_on.slice(0, 7)}`)

console.log(`\nStart dates to MOVE BACK (${toMoveStart.length}) — still a floor, not a start:`)
for (const m of toMoveStart) console.log(`  - ${m.name}   ${m.from} -> ${m.to}`)

// The four that need his eye first: a December 2025 last invoice reads as "left
// at the year boundary" and as "nobody has typed January" equally well, and the
// classification rule exists precisely to separate those two.
const december = toCreate.filter((c) => c.proposed_ended_on === '2025-12-01')
console.log(`\nLAST INVOICE IN DECEMBER 2025 (${december.length}) — left, or simply not entered? Your call:`)
for (const c of december) console.log(`  - ${c.name}`)

console.log(`\nMONTHS WITH NO INVOICE BEFORE A CLIENT'S START (leading zeros make rate() refuse to compute):`)
const leading = cells.filter((c) => Number(c.retainer) === 0 && Number(c.project) === 0 && c.period < (first.get(c.clientName) ?? '9999'))
console.log(`  ${leading.length}`)
```

- [ ] **Step 5: Run it and read the output yourself before showing anyone**

Run: `node ~/Downloads/tgc-import-2026/build-2025.mjs`

Check, in this order:
1. `problems` is empty. If not, stop — nothing downstream is meaningful.
2. Monthly totals for 2025 tie to the extract's own verification (`node extract-2025-original.mjs` prints them).
3. `Clients to CREATE` is 29 and `Start dates to MOVE BACK` is a subset of the 11 that span both years.
4. The CHANGE list. **This is the number nobody can predict** — a hand-applied rule and a computed one can disagree anywhere, and the 2026 map was built by hand. A long list is a finding, not a failure; read a few entries and check the run each cites.

- [ ] **Step 6: Do NOT commit this file to the repo**

It names real clients. Confirm it is outside the repo:

```bash
git -C /Users/josh/Downloads/CLAUDE/tgc-client-health status --porcelain
```

Expected: clean, or showing only repo files from Tasks 1–3. Then add a line to `~/Downloads/tgc-import-2026/RESUME.md` recording what `build-2025.mjs` does and that the report has not yet been ruled on.

---

## Where this plan stops

At a printed report. The owner rules on it — the 29 end dates, the start-date moves, and every row in the CHANGE list — and his corrections go back into the JSON files as data, never into the code.

**The next plan** covers: emitting the SQL, the staging dry-run with `commit` swapped for `rollback`, the verification queries (no revenue row after any `ended_on`, none before any `started_on`, totals matching the report), and the production script the owner runs himself. It is written after the rulings exist, because a plan that guesses them would be planning the wrong writes.

**Also deferred to that plan**, from spec §8: re-reading Retention's first real output against `final-preview.mjs`, looking at twenty-one months of bars rendered rather than asserted, and deciding whether the board's default view is usable once twenty-nine departed clients land on the roster.
