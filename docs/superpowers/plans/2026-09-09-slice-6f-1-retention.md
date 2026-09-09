# Slice 6f-1 — Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show NRR and GRR over a trailing-twelve window on the Revenue page, with the per-client contributions that explain them.

**Architecture:** One pure module (`retentionMath.ts`) holds the classification rule and the arithmetic; one read seam (`useRetention.ts`) fetches the roster and the revenue rows; one component (`Retention.tsx`) renders it. Same three-part shape as tenure and concentration before it.

**Tech Stack:** React 19, TypeScript, Vite, CSS Modules, Vitest + Testing Library + jsdom, Supabase JS, Postgres 17.6.

**Spec:** `docs/superpowers/specs/2026-09-09-slice-6f-1-retention-design.md`

## Global Constraints

- **Never write to a live database.** No task here runs `apply_migration`, `execute_sql`, `db push` or `verify:privileges`. This slice adds no migration at all.
- Money is **integer cents** everywhere, from the column to the component prop. A number of dollars never exists as a variable.
- **A missing row is not a zero** — except where §3 of the spec says it is (a churned client). That single exception is the substance of this slice; everywhere else, absent means unknown.
- **Retainer only.** `project_cents` is never read by retention math. Spec §2.
- `src/styles/tokens.css` is the only file permitted a colour literal or typeface name.
- Components may reference SEMANTIC tokens only, never the BRAND layer.
- Every type role a component names must be among `t-display`, `t-score`, `t-header`, `t-subhead`, `t-eyebrow`, `t-body`, `t-caption`, `t-label`. `tests/typeRoles.test.ts` enforces it.
- `npm test` does NOT typecheck. `npm run build` is the only thing that runs `tsc`. Both must be green before every commit.
- **`tests/revenueLiterals.test.ts` bans a literal percentage in the Revenue page's source.** This slice renders real percentages, so that guard must be taught about the new file — Task 4, Step 5. Do not weaken it.
- Comments are discursive and name the defect they prevent. Commit messages are lowercase, specific, and say *why* rather than *what*.
- Stage explicit paths. Never `git commit -a`.
- **Do NOT run `npx prettier`.** It is not a dependency and there is no config.

## File Structure

| File | Responsibility |
|---|---|
| `src/revenue/retentionMath.ts` | **Create.** Classification rule + NRR/GRR/movement arithmetic. Pure, no React, no Supabase. |
| `src/revenue/retentionMath.test.ts` | **Create.** One case per row of spec §3's table, plus the two mutations. |
| `src/revenue/useRetention.ts` | **Create.** Reads the roster and revenue rows. The only file that touches Supabase. |
| `src/revenue/useRetention.dom.test.ts` | **Create.** Read states, and the query-contract test (see the cast warning below). |
| `src/revenue/Retention.tsx` | **Create.** Renders the report. No arithmetic. |
| `src/revenue/Retention.dom.test.tsx` | **Create.** What the screen says, including the disclosure. |
| `src/shell/Revenue.tsx` | **Modify.** Mount Retention; delete the April 2027 paragraph. |
| `src/shell/Revenue.dom.test.tsx` | **Modify.** Add Retention to the three-heading test; assert the old paragraph is gone. |
| `tests/revenueLiterals.test.ts` | **Modify.** Teach the percentage guard about `Retention.tsx`. |
| `src/revenue/revenueMath.ts` | **Modify.** One comment on `rate()` saying it is growth, not retention, and belongs to 6d. |

**THE CAST TRAP, already hit once in this codebase.** `useRevenue` casts its response `as EligibleClient[]`, so a column missing from the `select` string is **invisible to `tsc`** — proven in slice 6c, where removing a column produced zero build errors. `useRetention` has the same shape. Its column list must be pinned by a test that inspects the query, not trusted to typechecking. Task 2, Step 5.

---

### Task 1: The classification rule and the arithmetic

This is the slice. Everything else renders what this returns.

**Files:**
- Create: `src/revenue/retentionMath.ts`
- Test: `src/revenue/retentionMath.test.ts`

**Interfaces:**
- Consumes: nothing. Pure module, no imports from this codebase.
- Produces:
  - `type RetentionClient = { id: number; name: string; started_on: string | null; ended_on: string | null }`
  - `type RetentionRow = { client_id: number; period: string; retainer_cents: number }`
  - `type ContributionKind = 'retained' | 'expanded' | 'contracted' | 'churned'`
  - `type Contribution = { clientId: number; name: string; baseCents: number; currentCents: number; deltaCents: number; kind: ContributionKind }`
  - `type RetentionReport = { basePeriod: string; currentPeriod: string; included: number; unentered: number; newBusiness: number; baseCents: number; currentCents: number; nrr: number | null; grr: number | null; expansionCents: number; contractionCents: number; churnedCents: number; contributions: Contribution[] }`
  - `function basePeriodFor(currentPeriod: string): string`
  - `function latestPeriod(rows: readonly RetentionRow[]): string | null`
  - `function retention(clients: readonly RetentionClient[], rows: readonly RetentionRow[], currentPeriod: string): RetentionReport`

- [ ] **Step 1: Write the failing tests**

Create `src/revenue/retentionMath.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  basePeriodFor,
  latestPeriod,
  retention,
  type RetentionClient,
  type RetentionRow,
} from './retentionMath'

const CURRENT = '2026-09-01'
const BASE = '2025-09-01'

function client(
  id: number,
  name: string,
  over: Partial<RetentionClient> = {},
): RetentionClient {
  return { id, name, started_on: '2020-01-01', ended_on: null, ...over }
}

function row(client_id: number, period: string, retainer_cents: number): RetentionRow {
  return { client_id, period, retainer_cents }
}

describe('basePeriodFor', () => {
  it('is the same month a year earlier', () => {
    expect(basePeriodFor('2026-09-01')).toBe('2025-09-01')
  })

  it('handles January without rolling the month', () => {
    // The obvious off-by-one: month arithmetic that borrows. January 2026's
    // base is January 2025, not December 2024.
    expect(basePeriodFor('2026-01-01')).toBe('2025-01-01')
  })
})

describe('latestPeriod', () => {
  it('is the most recent period with a row, not the calendar month', () => {
    // Spec section 3.3. Anchoring to today would compute the figure from
    // whatever had been typed by the 2nd of the month.
    expect(latestPeriod([row(1, '2026-07-01', 100), row(1, '2026-09-01', 100)])).toBe(
      '2026-09-01',
    )
  })

  it('is null when nothing has been entered at all', () => {
    expect(latestPeriod([])).toBe(null)
  })
})

describe('retention — the classification rule, spec section 3', () => {
  it('compares a client present in both months', () => {
    const report = retention(
      [client(1, 'Acme')],
      [row(1, BASE, 400000), row(1, CURRENT, 500000)],
      CURRENT,
    )

    expect(report.included).toBe(1)
    expect(report.contributions[0]).toEqual({
      clientId: 1,
      name: 'Acme',
      baseCents: 400000,
      currentCents: 500000,
      deltaCents: 100000,
      kind: 'expanded',
    })
  })

  it('counts a CHURNED client as zero, not as excluded', () => {
    // THE test of this slice. A client with a base figure, no current row, and
    // an end date on or before the current month has left -- and losing them is
    // exactly what retention measures. Excluding them instead makes NRR report
    // on the survivors alone, which is the flattering, meaningless number this
    // project keeps refusing to render.
    const report = retention(
      [client(1, 'Acme'), client(2, 'Delta', { ended_on: '2026-08-25' })],
      [row(1, BASE, 400000), row(1, CURRENT, 400000), row(2, BASE, 100000)],
      CURRENT,
    )

    expect(report.included).toBe(2)
    expect(report.unentered).toBe(0)
    const delta = report.contributions.find((entry) => entry.clientId === 2)
    expect(delta?.kind).toBe('churned')
    expect(delta?.currentCents).toBe(0)
    expect(report.nrr).toBeCloseTo(400000 / 500000)
  })

  it('EXCLUDES an active client with no current row, and counts them', () => {
    // The same absence as above with the opposite handling, and ended_on is the
    // only thing that separates them. Treating this as a zero would make a cell
    // nobody has typed read as a lost client.
    const report = retention(
      [client(1, 'Acme'), client(2, 'Delta')],
      [row(1, BASE, 400000), row(1, CURRENT, 400000), row(2, BASE, 100000)],
      CURRENT,
    )

    expect(report.included).toBe(1)
    expect(report.unentered).toBe(1)
    expect(report.nrr).toBe(1)
    expect(report.contributions.some((entry) => entry.clientId === 2)).toBe(false)
  })

  it('EXCLUDES new business, which is what makes this retention', () => {
    const report = retention(
      [client(1, 'Acme'), client(2, 'Delta', { started_on: '2026-03-01' })],
      [row(1, BASE, 400000), row(1, CURRENT, 400000), row(2, CURRENT, 900000)],
      CURRENT,
    )

    expect(report.newBusiness).toBe(1)
    expect(report.included).toBe(1)
    // Their 900000 must not reach the numerator: including it measures growth,
    // which is slice 6d's question, not this one.
    expect(report.currentCents).toBe(400000)
    expect(report.nrr).toBe(1)
  })

  it('counts a client who existed then but has no base row as unentered', () => {
    // The fifth row of spec section 3's table, and the one an implementer is
    // likeliest to skip because it looks like the new-business case. Delta
    // started in 2020, so they are not new -- their base month simply was never
    // typed, and an untyped month is unknown rather than zero.
    const report = retention(
      [client(1, 'Acme'), client(2, 'Delta', { started_on: '2020-01-01' })],
      [row(1, BASE, 400000), row(1, CURRENT, 400000), row(2, CURRENT, 900000)],
      CURRENT,
    )

    expect(report.unentered).toBe(1)
    expect(report.newBusiness).toBe(0)
    expect(report.included).toBe(1)
  })

  it('counts a client with no start date as unentered, never as new business', () => {
    // Spec section 3.1a. With no base row and no start date there is no way to
    // tell new from unrecorded, and "we do not know" belongs in the disclosed
    // figure rather than silently in new business.
    const report = retention(
      [client(1, 'Acme'), client(2, 'Delta', { started_on: null })],
      [row(1, BASE, 400000), row(1, CURRENT, 400000), row(2, CURRENT, 900000)],
      CURRENT,
    )

    expect(report.unentered).toBe(1)
    expect(report.newBusiness).toBe(0)
  })
})

describe('retention — the arithmetic, spec section 4', () => {
  it('GRR ignores growth and NRR does not', () => {
    // The worked example from the design conversation. Acme grew, East Bay cut
    // back, Harbor left. NRR reads flat; GRR reads a fifth of the book gone.
    const clients = [
      client(1, 'Acme'),
      client(2, 'Delta'),
      client(3, 'East Bay'),
      client(4, 'Harbor', { ended_on: '2026-06-30' }),
    ]
    const rows = [
      row(1, BASE, 500000),
      row(1, CURRENT, 700000),
      row(2, BASE, 300000),
      row(2, CURRENT, 300000),
      row(3, BASE, 200000),
      row(3, CURRENT, 100000),
      row(4, BASE, 100000),
    ]

    const report = retention(clients, rows, CURRENT)

    expect(report.baseCents).toBe(1100000)
    expect(report.currentCents).toBe(1100000)
    expect(report.nrr).toBe(1)
    // min(current, base) per client: 500000 + 300000 + 100000 + 0
    expect(report.grr).toBeCloseTo(900000 / 1100000)
  })

  it('never lets GRR exceed 1 however much a client grows', () => {
    const report = retention(
      [client(1, 'Acme')],
      [row(1, BASE, 100000), row(1, CURRENT, 900000)],
      CURRENT,
    )

    expect(report.nrr).toBe(9)
    expect(report.grr).toBe(1)
  })

  it('splits the movement into expansion, contraction and churn', () => {
    const clients = [
      client(1, 'Up'),
      client(2, 'Down'),
      client(3, 'Gone', { ended_on: '2026-01-31' }),
    ]
    const rows = [
      row(1, BASE, 100000),
      row(1, CURRENT, 150000),
      row(2, BASE, 100000),
      row(2, CURRENT, 60000),
      row(3, BASE, 100000),
    ]

    const report = retention(clients, rows, CURRENT)

    expect(report.expansionCents).toBe(50000)
    expect(report.contractionCents).toBe(-40000)
    expect(report.churnedCents).toBe(-100000)
  })

  it('reconciles: base plus the three movements equals current', () => {
    // The invariant that catches a client counted in the wrong bucket. Any
    // misclassification that still totals correctly is caught by the tests
    // above; anything that does not is caught here.
    const clients = [
      client(1, 'Up'),
      client(2, 'Down'),
      client(3, 'Gone', { ended_on: '2026-01-31' }),
      client(4, 'Flat'),
    ]
    const rows = [
      row(1, BASE, 100000),
      row(1, CURRENT, 150000),
      row(2, BASE, 100000),
      row(2, CURRENT, 60000),
      row(3, BASE, 100000),
      row(4, BASE, 70000),
      row(4, CURRENT, 70000),
    ]

    const report = retention(clients, rows, CURRENT)

    expect(
      report.baseCents +
        report.expansionCents +
        report.contractionCents +
        report.churnedCents,
    ).toBe(report.currentCents)
  })

  it('orders contributions by the size of their effect, largest first', () => {
    // Spec section 4: this ordering IS the answer to "why did it move", so the
    // biggest mover has to be the first thing read -- in either direction.
    const clients = [client(1, 'Small'), client(2, 'Big'), client(3, 'Medium')]
    const rows = [
      row(1, BASE, 100000),
      row(1, CURRENT, 110000),
      row(2, BASE, 100000),
      row(2, CURRENT, 20000),
      row(3, BASE, 100000),
      row(3, CURRENT, 130000),
    ]

    const report = retention(clients, rows, CURRENT)

    expect(report.contributions.map((entry) => entry.name)).toEqual([
      'Big',
      'Medium',
      'Small',
    ])
  })

  it('refuses both rates when the base month holds nothing', () => {
    // Spec section 4.1, matching share() and rate(): a state with no meaningful
    // answer renders no number rather than NaN% or 0%.
    const report = retention([client(1, 'Acme')], [row(1, CURRENT, 400000)], CURRENT)

    expect(report.nrr).toBe(null)
    expect(report.grr).toBe(null)
  })

  it('refuses both rates when every base figure is zero', () => {
    const report = retention(
      [client(1, 'Acme')],
      [row(1, BASE, 0), row(1, CURRENT, 400000)],
      CURRENT,
    )

    expect(report.nrr).toBe(null)
    expect(report.grr).toBe(null)
  })

  it('never reads project work', () => {
    // Spec section 2. RetentionRow has no project_cents field at all, so this
    // is a type-level guarantee -- asserted here so that widening the type
    // later has to break a test that says why.
    const report = retention(
      [client(1, 'Acme')],
      [row(1, BASE, 100000), row(1, CURRENT, 100000)],
      CURRENT,
    )

    expect(report.nrr).toBe(1)
    expect(Object.keys(row(1, BASE, 1))).toEqual(['client_id', 'period', 'retainer_cents'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/revenue/retentionMath.test.ts`
Expected: the file fails to resolve `./retentionMath` — "Failed to load url" or "no tests". That is the correct first failure.

- [ ] **Step 3: Write the implementation**

Create `src/revenue/retentionMath.ts`:

```ts
// Revenue retention: what happened to the money we already had. Pure, and
// separate from the components, so the rules below are testable without a DOM
// -- the same split as matrixMath.ts, tenureMath.ts and revenueMath.ts.
//
// Its own module rather than more of revenueMath.ts, which is already four
// unrelated exports: this is a distinct question with its own vocabulary, and
// a file that answers one question is one you can hold in your head.
//
// RETAINER ONLY. project_cents is not in RetentionRow and must not be added.
// Spec section 2: project work is real revenue that nobody expects to repeat,
// and a one-off project landing in a retention figure would report as
// retention something that is going to disappear next month by design.

export type RetentionClient = {
  id: number
  name: string
  started_on: string | null
  ended_on: string | null
}

export type RetentionRow = {
  client_id: number
  period: string
  retainer_cents: number
}

export type ContributionKind = 'retained' | 'expanded' | 'contracted' | 'churned'

export type Contribution = {
  clientId: number
  name: string
  baseCents: number
  currentCents: number
  deltaCents: number
  kind: ContributionKind
}

export type RetentionReport = {
  basePeriod: string
  currentPeriod: string
  // Clients the rates are computed FROM, and the two exclusions, kept apart
  // because they mean different things to a reader: one is a gap in the data
  // and the other is business won since.
  included: number
  unentered: number
  newBusiness: number
  baseCents: number
  currentCents: number
  nrr: number | null
  grr: number | null
  expansionCents: number
  contractionCents: number
  churnedCents: number
  contributions: Contribution[]
}

// The first of the month containing a date. Lifecycle boundaries are months,
// not days: a client who left on the 25th billed most of that month.
function monthOf(day: string): string {
  return `${day.slice(0, 7)}-01`
}

// Twelve months back, by string arithmetic on the year. Nothing here parses a
// Date: a bare YYYY-MM-DD parses as UTC midnight, whose local calendar day is
// the day before in any western zone -- the trap tenureMath.ts documents at
// length. Subtracting from the year leaves the month untouched, which is what
// makes January's base January and not December.
export function basePeriodFor(currentPeriod: string): string {
  const year = Number(currentPeriod.slice(0, 4))
  return `${year - 1}${currentPeriod.slice(4)}`
}

// The month the report is anchored to: the most recent one with any entry, not
// today. Spec section 3.3 -- on the 2nd of a month almost nothing is entered,
// and anchoring to the calendar would compute the figure from one or two
// clients every month for a week.
export function latestPeriod(rows: readonly RetentionRow[]): string | null {
  let latest: string | null = null
  for (const row of rows) {
    if (latest === null || row.period > latest) latest = row.period
  }
  return latest
}

export function retention(
  clients: readonly RetentionClient[],
  rows: readonly RetentionRow[],
  currentPeriod: string,
): RetentionReport {
  const basePeriod = basePeriodFor(currentPeriod)

  const baseByClient = new Map<number, number>()
  const currentByClient = new Map<number, number>()
  for (const row of rows) {
    if (row.period === basePeriod) baseByClient.set(row.client_id, row.retainer_cents)
    if (row.period === currentPeriod) currentByClient.set(row.client_id, row.retainer_cents)
  }

  const contributions: Contribution[] = []
  let unentered = 0
  let newBusiness = 0

  for (const client of clients) {
    const baseCents = baseByClient.get(client.id)

    if (baseCents === undefined) {
      // No base figure, so nothing to be retained against. Which exclusion it
      // is depends on whether we can say the client is NEW -- and with no start
      // date on file we cannot, so it goes to the honest bucket. Spec 3.1a.
      if (client.started_on !== null && monthOf(client.started_on) > basePeriod) {
        newBusiness += 1
      } else {
        unentered += 1
      }
      continue
    }

    const currentRow = currentByClient.get(client.id)
    let currentCents: number

    if (currentRow !== undefined) {
      currentCents = currentRow
    } else if (client.ended_on !== null && monthOf(client.ended_on) <= currentPeriod) {
      // CHURNED. The one place in this codebase where a missing row IS a zero,
      // and the exception is the whole point: a client who left bills nothing,
      // and losing them is what retention measures. Drop them instead and NRR
      // reports on the survivors alone.
      currentCents = 0
    } else {
      // Still active, nobody has typed this month. Unknown, not zero -- the
      // ordinary rule. Excluded from both sides so the rate stays a true
      // statement about the clients it does cover, and counted so the reader
      // knows how many it does not.
      unentered += 1
      continue
    }

    const deltaCents = currentCents - baseCents
    const kind: ContributionKind =
      currentRow === undefined
        ? 'churned'
        : deltaCents > 0
          ? 'expanded'
          : deltaCents < 0
            ? 'contracted'
            : 'retained'

    contributions.push({
      clientId: client.id,
      name: client.name,
      baseCents,
      currentCents,
      deltaCents,
      kind,
    })
  }

  // Largest effect first, in either direction: the question this ordering
  // answers is "why did it move", and the biggest mover is the answer.
  // Ties broken by name so the order is stable between renders.
  contributions.sort(
    (left, right) =>
      Math.abs(right.deltaCents) - Math.abs(left.deltaCents) ||
      left.name.localeCompare(right.name),
  )

  let baseCents = 0
  let currentCents = 0
  let capped = 0
  let expansionCents = 0
  let contractionCents = 0
  let churnedCents = 0

  for (const entry of contributions) {
    baseCents += entry.baseCents
    currentCents += entry.currentCents
    // The cap is the entire difference between the two rates: it makes growth
    // invisible, which is why GRR cannot exceed 1 and NRR can.
    capped += Math.min(entry.currentCents, entry.baseCents)

    if (entry.kind === 'churned') churnedCents += entry.deltaCents
    else if (entry.deltaCents > 0) expansionCents += entry.deltaCents
    else contractionCents += entry.deltaCents
  }

  // Null, not zero and not NaN: a base of nothing has no meaningful ratio, and
  // "0%" would read as a fact about the year. Same posture as share().
  const nrr = baseCents === 0 ? null : currentCents / baseCents
  const grr = baseCents === 0 ? null : capped / baseCents

  return {
    basePeriod,
    currentPeriod,
    included: contributions.length,
    unentered,
    newBusiness,
    baseCents,
    currentCents,
    nrr,
    grr,
    expansionCents,
    contractionCents,
    churnedCents,
    contributions,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/revenue/retentionMath.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Prove the churn rule is actually enforced**

The two mutations from spec §7. Each must fail a test; if either passes, the test is not doing its job and you must stop and say so.

Mutation A — treat a churned client as unentered. In `retention`, replace the `currentCents = 0` branch body with `unentered += 1; continue`.
Run: `npx vitest run src/revenue/retentionMath.test.ts`
Expected: FAIL on "counts a CHURNED client as zero, not as excluded".
Restore.

Mutation B — treat an unentered active client as a zero. Replace the final `else { unentered += 1; continue }` with `currentCents = 0`.
Run: `npx vitest run src/revenue/retentionMath.test.ts`
Expected: FAIL on "EXCLUDES an active client with no current row, and counts them".
Restore, and confirm the suite is green again.

- [ ] **Step 6: Full suite, lint, build, commit**

```bash
npm test && npm run lint && npm run build
git add src/revenue/retentionMath.ts src/revenue/retentionMath.test.ts
git commit -m "retention: the classification rule, and the two rates it totals to"
```

---

### Task 2: The read seam

**Files:**
- Create: `src/revenue/useRetention.ts`
- Test: `src/revenue/useRetention.dom.test.ts`

**Interfaces:**
- Consumes: `RetentionClient`, `RetentionRow` from Task 1.
- Produces: `type UseRetention = { status: 'loading' | 'ready' | 'error'; loadError: string | null; clients: RetentionClient[]; rows: RetentionRow[]; reload: () => void }` and `function useRetention(): UseRetention`.

- [ ] **Step 1: Write the failing tests**

Create `src/revenue/useRetention.dom.test.ts`:

```ts
// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

import { supabase } from '../lib/supabase'
import { useRetention } from './useRetention'

const CLIENT = { id: 1, name: 'Acme', started_on: '2020-01-01', ended_on: null }
const ROW = { client_id: 1, period: '2026-09-01', retainer_cents: 400000 }

// Records what each table's chain was asked for. The chain used to discard its
// arguments elsewhere in this codebase, which left the filters that decide what
// a screen reads completely unexercised -- see useRevenue.dom.test.ts.
type Captured = { select: string[]; order: string[] }

function given(answers: Record<string, { data: unknown; error: unknown }>) {
  const captured: Record<string, Captured> = {}
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const answer = answers[table] ?? { data: [], error: null }
    const calls = (captured[table] ??= { select: [], order: [] })
    const chain = {
      select: (columns: string) => {
        calls.select.push(columns)
        return chain
      },
      order: (column: string) => {
        calls.order.push(column)
        return Promise.resolve(answer)
      },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer).then(resolve),
    }
    return chain as never
  })
  return captured
}

afterEach(() => vi.mocked(supabase.from).mockReset())

describe('useRetention', () => {
  it('reports both reads landing as ready', async () => {
    given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { result } = renderHook(() => useRetention())

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.clients).toEqual([CLIENT])
    expect(result.current.rows).toEqual([ROW])
  })

  it('reports a failed roster read as an error, not as an empty book', async () => {
    // A broken tool must not look like an empty one. An empty roster here would
    // render retention as "no clients", which reads as a fact about the agency.
    given({
      clients: { data: null, error: { message: 'permission denied' } },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { result } = renderHook(() => useRetention())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.loadError).toContain('permission denied')
  })

  it('reports a failed revenue read as an error rather than a year of no revenue', async () => {
    given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: null, error: { message: 'permission denied' } },
    })

    const { result } = renderHook(() => useRetention())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.rows).toEqual([])
  })

  it('asks for the columns the classification rule needs', async () => {
    // THE CAST IS WHY THIS TEST EXISTS. The hook casts its response, so a
    // column missing from the select is invisible to tsc -- proven in slice 6c,
    // where dropping a column produced ZERO build errors while the feature
    // silently stopped working. Without ended_on a churned client reads as
    // unentered and churn vanishes from the churn measure; without started_on
    // new business is counted as unentered.
    const captured = given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { result } = renderHook(() => useRetention())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    const roster = captured.clients?.select[0] ?? ''
    expect(roster).toContain('id')
    expect(roster).toContain('name')
    expect(roster).toContain('started_on')
    expect(roster).toContain('ended_on')

    const revenue = captured.client_month_revenue?.select[0] ?? ''
    expect(revenue).toContain('client_id')
    expect(revenue).toContain('period')
    expect(revenue).toContain('retainer_cents')
  })

  it('does not read project work', async () => {
    // Spec section 2, enforced at the query. Retention reads the retainer only,
    // and a column that is never fetched cannot accidentally reach the maths.
    const captured = given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { result } = renderHook(() => useRetention())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(captured.client_month_revenue?.select[0] ?? '').not.toContain('project_cents')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/revenue/useRetention.dom.test.ts`
Expected: fails to resolve `./useRetention`.

- [ ] **Step 3: Write the implementation**

Create `src/revenue/useRetention.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import type { RetentionClient, RetentionRow } from './retentionMath'

// The roster and the revenue history, read together. A seam in the same shape
// as useTenure and useRevenue: the screen's fetch has to be mockable.
//
// THE WHOLE TABLE, not two months, and the reason is spec section 3.3: the
// current month is the latest month holding entries, which cannot be known
// without looking at what months exist. At thirteen months and eleven clients
// that is about 143 rows and it stays small for years -- and it hands slice
// 6f-3 its series for free. If it ever outgrows one read the fix is a
// max(period) query first, not a fixed two-month filter.
//
// Its own column lists rather than another module's constants: a report should
// not silently start fetching a column because an editing screen added one.
// The same argument useTenure makes for itself.
const ROSTER_COLUMNS = 'id, name, started_on, ended_on'

// retainer_cents ONLY. Spec section 2: project work is real revenue nobody
// expects to repeat, so it is excluded from retention at the query, where it
// cannot later be picked up by accident.
const REVENUE_COLUMNS = 'client_id, period, retainer_cents'

export type UseRetention = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  clients: RetentionClient[]
  rows: RetentionRow[]
  reload: () => void
}

export function useRetention(): UseRetention {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clients, setClients] = useState<RetentionClient[]>([])
  const [rows, setRows] = useState<RetentionRow[]>([])

  const load = useCallback(async (isCancelled: () => boolean) => {
    setStatus('loading')

    try {
      const rosterQuery = supabase.from('clients').select(ROSTER_COLUMNS).order('name')
      const revenueQuery = supabase
        .from('client_month_revenue')
        .select(REVENUE_COLUMNS)
        .order('period')

      const [roster, revenue] = await Promise.all([rosterQuery, revenueQuery])

      if (isCancelled()) return

      // Either failure is an error, and neither falls through to an empty
      // array. An empty roster reads as "no clients"; an empty revenue array
      // reads as a year in which nobody billed anything, which on a retention
      // report is the most alarming possible lie.
      const failure = roster.error ?? revenue.error
      if (failure) {
        setLoadError(describeError(failure))
        setStatus('error')
        return
      }

      setClients((roster.data ?? []) as RetentionClient[])
      setRows((revenue.data ?? []) as RetentionRow[])
      setLoadError(null)
      setStatus('ready')
    } catch (thrown: unknown) {
      if (isCancelled()) return
      setLoadError(describeError(thrown))
      setStatus('error')
    }
  }, [])

  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load, nonce])

  return { status, loadError, clients, rows, reload }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/revenue/useRetention.dom.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the column guard works**

Remove `ended_on` from `ROSTER_COLUMNS`.
Run: `npm run build` — expected: **zero errors**, which is the point.
Run: `npx vitest run src/revenue/useRetention.dom.test.ts` — expected: FAIL on "asks for the columns the classification rule needs".
Restore, and confirm green.

- [ ] **Step 6: Full suite, lint, build, commit**

```bash
npm test && npm run lint && npm run build
git add src/revenue/useRetention.ts src/revenue/useRetention.dom.test.ts
git commit -m "retention: read the roster and the history, and pin the columns a cast cannot"
```

---

### Task 3: The component

**Files:**
- Create: `src/revenue/Retention.tsx`
- Test: `src/revenue/Retention.dom.test.tsx`

**Interfaces:**
- Consumes: `useRetention` (Task 2); `retention`, `latestPeriod`, `RetentionReport` (Task 1); `formatMoney` from `./money`; `formatPeriod` from `../lib/month`.
- Produces: `function Retention()`, taking no props — it owns its own read, as `Concentration` does.

- [ ] **Step 1: Write the failing tests**

Create `src/revenue/Retention.dom.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./useRetention', () => ({ useRetention: vi.fn() }))

import { Retention } from './Retention'
import { useRetention } from './useRetention'

const CLIENTS = [
  { id: 1, name: 'Acme', started_on: '2020-01-01', ended_on: null },
  { id: 2, name: 'Delta', started_on: '2020-01-01', ended_on: null },
]

const ROWS = [
  { client_id: 1, period: '2025-09-01', retainer_cents: 400000 },
  { client_id: 1, period: '2026-09-01', retainer_cents: 500000 },
  { client_id: 2, period: '2025-09-01', retainer_cents: 200000 },
  { client_id: 2, period: '2026-09-01', retainer_cents: 100000 },
]

function given(over: Partial<ReturnType<typeof useRetention>> = {}) {
  vi.mocked(useRetention).mockReturnValue({
    status: 'ready',
    loadError: null,
    clients: CLIENTS,
    rows: ROWS,
    reload: vi.fn(),
    ...over,
  })
  return render(<Retention />)
}

beforeEach(() => vi.mocked(useRetention).mockReset())
afterEach(() => {
  document.body.innerHTML = ''
})

describe('Retention', () => {
  it('names itself with the word a reader searches for', () => {
    given()

    expect(screen.getByRole('heading', { name: 'Retention' })).toBeTruthy()
  })

  it('leads with net and shows gross beside it', () => {
    // The owner's ruling: "Net is most important, but we still want visibility
    // into gross." Both present; NRR is the headline.
    given()

    // 600000 / 600000 = 100%; capped 400000 + 100000 = 500000 / 600000 = 83%
    expect(screen.getByTestId('retention-nrr').textContent).toContain('100%')
    expect(screen.getByTestId('retention-grr').textContent).toContain('83%')
  })

  it('names both months rather than implying them', () => {
    given()

    const text = document.body.textContent ?? ''
    expect(text).toContain('September 2026')
    expect(text).toContain('September 2025')
  })

  it('discloses how many clients the figure is based on', () => {
    // The disclosure travels WITH the number, not as a footnote. An unentered
    // client silently shrinking the denominator is the failure this prevents.
    given({
      clients: [...CLIENTS, { id: 3, name: 'East Bay', started_on: '2020-01-01', ended_on: null }],
    })

    expect(screen.getByTestId('retention-basis').textContent).toMatch(/2 of 3/)
    expect(screen.getByTestId('retention-basis').textContent).toMatch(/no entry/i)
  })

  it('lists the biggest mover first', () => {
    given()

    const names = screen
      .getAllByTestId('retention-contribution-name')
      .map((node) => node.textContent)
    // Acme +1000.00, Delta -1000.00 -- equal size, so name breaks the tie.
    expect(names).toEqual(['Acme', 'Delta'])
  })

  it('renders no rate at all when the base month is empty', () => {
    // Spec 4.1. No NaN%, no 0% -- a number nobody can stand behind is not shown.
    given({ rows: [{ client_id: 1, period: '2026-09-01', retainer_cents: 400000 }] })

    expect(screen.queryByTestId('retention-nrr')).toBeNull()
    expect(document.body.textContent).toMatch(/not enough history|no retention/i)
  })

  it('says it is loading rather than showing an empty report', () => {
    given({ status: 'loading' })

    expect(document.body.textContent).toMatch(/loading/i)
  })

  it('shows a failed read as an error, not as a year of no revenue', () => {
    given({ status: 'error', loadError: 'permission denied' })

    expect(screen.getByRole('alert').textContent).toContain('permission denied')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/revenue/Retention.dom.test.tsx`
Expected: fails to resolve `./Retention`.

- [ ] **Step 3: Write the component**

Create `src/revenue/Retention.tsx`:

```tsx
import { formatPeriod } from '../lib/month'
import { formatMoney } from './money'
import { latestPeriod, retention } from './retentionMath'
import type { RetentionClient, RetentionRow } from './retentionMath'
import { useRetention } from './useRetention'
import styles from './Revenue.module.css'

// Whole percentages. The underlying ratio is exact; the display is rounded
// once, here, and never summed afterwards -- Concentration learned that lesson
// the hard way when independently rounded rows added up to 101.
function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

// What happened to the money we already had. NRR leads and GRR sits beside it,
// which is the owner's ruling verbatim: "Net is most important, but we still
// want visibility into gross."
export function Retention() {
  const read = useRetention()

  return (
    <section className={styles.section}>
      <h3 className="t-subhead">Retention</h3>

      {read.status === 'loading' && <p className="t-body">Loading…</p>}

      {read.status === 'error' && (
        <p className="alert prose" role="alert">
          {read.loadError}
        </p>
      )}

      {read.status === 'ready' && <RetentionReady clients={read.clients} rows={read.rows} />}
    </section>
  )
}

function RetentionReady({
  clients,
  rows,
}: {
  clients: readonly RetentionClient[]
  rows: readonly RetentionRow[]
}) {
  // Ordered deliberately: latestPeriod returns null for an empty table, and
  // retention() cannot be called with it. Computing the report first and
  // checking afterwards would be a type error at best and a crash at worst.
  const period = latestPeriod(rows)
  if (period === null) {
    return (
      <p className="t-body prose">
        No retention yet: no revenue has been entered, so there is no history to measure across.
      </p>
    )
  }

  const report = retention(clients, rows, period)

  // Both rates are null together -- they share a denominator. Rendering a
  // percentage here would be inventing one, which is the whole thing spec
  // section 9 refuses.
  if (report.nrr === null || report.grr === null) {
    return (
      <p className="t-body prose">
        Not enough history for a retention rate yet: {formatPeriod(report.basePeriod)} has no
        entered revenue to measure {formatPeriod(report.currentPeriod)} against.
      </p>
    )
  }

  const considered = report.included + report.unentered + report.newBusiness

  return (
    <>
      <p className="t-caption" data-testid="retention-window">
        {formatPeriod(report.currentPeriod)} against {formatPeriod(report.basePeriod)}
      </p>

      <p className="t-score" data-testid="retention-nrr">
        {formatRate(report.nrr)} net
      </p>
      <p className={`t-body ${styles.measure}`} data-testid="retention-grr">
        {formatRate(report.grr)} gross
      </p>

      {/* The three movements that produce those two rates. Churn is kept apart
          from contraction because "a client shrank" and "a client left" are
          different events that a single number would blend. */}
      <p className={`t-caption ${styles.summary}`} data-testid="retention-movement">
        {formatMoney(report.expansionCents)} expansion ·{' '}
        {formatMoney(Math.abs(report.contractionCents))} contraction ·{' '}
        {formatMoney(Math.abs(report.churnedCents))} churn
      </p>

      {/* The disclosure travels WITH the number, not as a footnote. An
          unentered client silently shrinking the denominator is exactly the
          kind of quiet wrongness this page exists to avoid. */}
      <p className={`t-caption ${styles.summary}`} data-testid="retention-basis">
        Based on {report.included} of {considered} clients
        {report.unentered > 0 &&
          ` · ${report.unentered} had no entry for ${formatPeriod(report.basePeriod)}`}
        {report.newBusiness > 0 && ` · ${report.newBusiness} started since`}
      </p>

      {/* role="list" because base.css removes markers globally, and WebKit drops
          a list's semantics when its markers are removed -- so in Safari with
          VoiceOver this would announce as unrelated paragraphs. Tenure and the
          admin screens do the same. */}
      <ul aria-label="Retention contributions" className={styles.list} role="list">
        {report.contributions.map((entry) => (
          <li className={styles.row} key={entry.clientId}>
            <span className={styles.who}>
              <span className="t-body" data-testid="retention-contribution-name">
                {entry.name}
              </span>
              {entry.kind === 'churned' && (
                <span className={`t-caption ${styles.marker}`}>Left</span>
              )}
            </span>
            <span className={`t-body ${styles.measure}`}>
              {formatMoney(entry.baseCents)} → {formatMoney(entry.currentCents)}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/revenue/Retention.dom.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full suite, lint, build, commit**

```bash
npm test && npm run lint && npm run build
git add src/revenue/Retention.tsx src/revenue/Retention.dom.test.tsx
git commit -m "retention: net first, gross beside it, and the clients that moved"
```

---

### Task 4: Mount it, and retire the apology

**Files:**
- Modify: `src/shell/Revenue.tsx`
- Modify: `src/shell/Revenue.dom.test.tsx`
- Modify: `tests/revenueLiterals.test.ts`
- Modify: `src/revenue/revenueMath.ts` (comment only)

**Interfaces:**
- Consumes: `Retention` from Task 3.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

In `src/shell/Revenue.dom.test.tsx`, add `Retention` to the existing three-heading test so it asserts four, and add:

```tsx
  it('no longer says retention is waiting for a data model', () => {
    // The page apologised for retention from slice 6b until this slice shipped
    // it. That paragraph named a date derived from the entry screen's six-month
    // reach, and it has been wrong since the backfill landed -- the third time
    // a sentence on this page went stale because the data moved underneath it.
    given()

    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/not here yet/i)
    expect(text).not.toMatch(/April 2027/i)
  })
```

`Revenue.dom.test.tsx` mocks `useRevenue` already; add the same treatment for `useRetention` so this file does not reach a real Supabase client:

```tsx
vi.mock('../revenue/useRetention', () => ({ useRetention: vi.fn() }))
```
and default it in `beforeEach` to `{ status: 'ready', loadError: null, clients: [], rows: [], reload: vi.fn() }`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/shell/Revenue.dom.test.tsx`
Expected: FAIL — no heading named `Retention`, and the April 2027 text still present.

- [ ] **Step 3: Mount it and delete the paragraph**

In `src/shell/Revenue.tsx`: import `Retention`, render `<Retention />` after `<Concentration ... />`, and **delete** the closing `<p className="t-body prose">Revenue retention is not here yet…</p>` along with the comment block above it.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/shell/Revenue.dom.test.tsx`
Expected: PASS.

- [ ] **Step 5: Teach the percentage guard about the new file**

`tests/revenueLiterals.test.ts` bans a literal percentage in the Revenue page's sources, because a fabricated rate is exactly what §9 refused. Retention renders REAL percentages from `retentionMath`, so `Retention.tsx` must be added to the list of files the guard reads — the guard's point is that a percentage must be computed, not typed, and that still holds.

Add `src/revenue/Retention.tsx` to the guarded files, keeping the non-vacuity length assertion each file already has. Then prove it: insert `<p className="t-body">Retention is running at 91.2% this year.</p>` into `Retention.tsx`, run `npx vitest run tests/revenueLiterals.test.ts`, confirm it FAILS, restore, confirm it passes.

- [ ] **Step 6: Correct `rate()`'s comment**

In `src/revenue/revenueMath.ts`, add to `rate()`'s leading comment that it computes revenue GROWTH across a window — last period over first — which is slice 6d's question, and that it is **not** retention: NRR and GRR live in `retentionMath.ts`. Nothing calls `rate()` yet and it is not to be deleted as dead code.

- [ ] **Step 7: Full suite, lint, build, commit**

```bash
npm test && npm run lint && npm run build
git add src/shell/Revenue.tsx src/shell/Revenue.dom.test.tsx tests/revenueLiterals.test.ts src/revenue/revenueMath.ts
git commit -m "retention: mount it, and retire the apology it replaces"
```

---

## After the tasks

**This slice adds no migration and touches no database.** It reads columns that already exist.

**It renders nothing useful until revenue is entered.** With an empty `client_month_revenue` the page correctly shows its not-enough-history state. The owner's thirteen-month backfill is what turns it on; until then, Task 3's empty-state test is the only proof it behaves.

**Not in this slice, and specified as deferred in the design:** 6f-2's controls (window length, client exclusions, each carrying its caveat) and 6f-3's retention-over-time, which is data-blocked until twenty-four months exist.
