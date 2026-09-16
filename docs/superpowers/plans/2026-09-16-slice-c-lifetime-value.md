# Slice C — What each client is worth · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Revenue page's "Retainer vs project" section with "What each client is worth" — a ranked list of clients by money actually billed, each with a comparable monthly-equivalent rate, under one sentence answering whether retainer or project clients are worth more.

**Architecture:** Three tasks. Task 1 reshapes the existing `mixMath` (adds months-billed and status per client, strips the tenure fields and the `asOf` parameter that only tenure needed) and deletes the `Mix` component it served. Task 2 adds `valueMath`, a new pure module holding the ranking, both controls' rules, the monthly equivalent and the verdict. Task 3 adds the `Value` component and wires it into the page. The pure-module-plus-thin-component split is this codebase's standing pattern.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest + Testing Library, CSS modules, oxlint.

**Spec:** `docs/superpowers/specs/2026-09-16-slice-c-lifetime-value-design.md`

## Global Constraints

- **Money is integer cents everywhere.** Render it only through `formatMoney(cents)` from `src/revenue/money.ts`. Never construct a currency string by hand.
- **A missing row is never a zero.** A client with no revenue entered does not appear in the ranking at all — not at zero, not at the bottom.
- **Nothing may round in favour of the hypothesis being tested.** `clientMix` counts an exact revenue tie as a **project** client, because a dead heat is not evidence for the boss's belief that retainers are stronger. This rule is inherited and must not be "fixed".
- **The median, not the mean**, for every group figure. Use the existing `medianOf`.
- **No percentage may be written as a literal** into any file that renders on the Revenue page. `tests/revenueLiterals.test.ts` enforces this over a named file list; Task 3 adds `Value.tsx` to it.
- **Synthetic client names in all tests and fixtures. This repository is public.** Use names already used in this repo's tests (Babaloo, Colorfil, Sno-Go) or invent obviously fake ones. Never a real client.
- **String/integer month arithmetic only.** Never `new Date('YYYY-MM-DD')` — it parses as UTC midnight and shifts the month in western timezones. Periods are `YYYY-MM-01` strings and compare correctly as strings.
- **Every test must be watched to fail before it is believed.** This slice's predecessor shipped six tests whose assertions could not fail. After writing a test and seeing it pass, break the code it covers, watch that specific test fail, and restore. Quote the failure in your report.

---

### Task 1: Reshape `mixMath` and delete the section it served

`clientMix` already computes, per client, the retainer/project split, the lifetime total, and which kind of engagement their money says they are. It needs two more fields and has four it will no longer serve. This task also removes the `Mix` component and its place on the page: the section is being replaced, and leaving it rendering while its own maths is reshaped around it produces a component whose caveat paragraph describes fields that no longer exist.

**After this task the Revenue page has one fewer section.** That is expected and temporary — Task 3 puts its replacement in the same position.

**Files:**
- Modify: `src/revenue/mixMath.ts`
- Modify: `src/revenue/mixMath.test.ts`
- Modify: `src/shell/Revenue.tsx` (remove the `<Mix>` element and its import)
- Delete: `src/revenue/Mix.tsx`
- Delete: `src/revenue/Mix.dom.test.tsx`

**Interfaces:**
- Consumes: `RevenueRow` from `./chartMath` (`{ client_id: number; period: string; retainer_cents: number; project_cents: number }`); `RetentionClient` from `./retentionMath` (carries `id`, `name`, `status`, `started_on`, `ended_on`).
- Produces, for Task 2:
  - `clientMix(clients: readonly RetentionClient[], rows: readonly RevenueRow[]): MixReport` — **two arguments, no `asOf`**
  - `ClientEngagement = { clientId: number; name: string; status: string; kind: EngagementKind; retainerCents: number; projectCents: number; totalCents: number; monthsBilled: number }`
  - `GroupSummary = { count: number; totalCents: number; medianTotalCents: number | null }`
  - `MixReport = { clients: ClientEngagement[]; retainer: GroupSummary; project: GroupSummary }`
  - `medianOf(values: readonly number[]): number | null` — unchanged, still exported
  - `EngagementKind = 'retainer' | 'project'` — unchanged

- [ ] **Step 1: Write the failing tests for the two new fields**

Add to `src/revenue/mixMath.test.ts`, inside the existing `describe('clientMix — which kind of client is this')` block. The existing fixtures in that file build rows and clients; follow their shape. These tests call `clientMix` with **two** arguments.

```ts
it('counts the months a client actually billed in', () => {
  const clients = [client(1, 'Babaloo')]
  const rows = [
    row(1, '2026-01-01', 400_000, 0),
    row(1, '2026-02-01', 400_000, 0),
    row(1, '2026-03-01', 400_000, 0),
  ]

  expect(clientMix(clients, rows).clients[0].monthsBilled).toBe(3)
})

// An entered zero is a month somebody CONFIRMED was empty. Counting it would
// report a lower rate for the client whose account manager was diligent about
// entering zeroes, which is the opposite of what the figure is for.
it('does not count a month entered as zero', () => {
  const clients = [client(1, 'Babaloo')]
  const rows = [
    row(1, '2026-01-01', 400_000, 0),
    row(1, '2026-02-01', 0, 0),
    row(1, '2026-03-01', 400_000, 0),
  ]

  expect(clientMix(clients, rows).clients[0].monthsBilled).toBe(2)
})

// Two rows for one client in one month must not count that month twice --
// otherwise the monthly equivalent halves for no reason a reader could see.
it('counts a month once however many rows it arrives in', () => {
  const clients = [client(1, 'Babaloo')]
  const rows = [
    row(1, '2026-01-01', 400_000, 0),
    row(1, '2026-01-01', 0, 100_000),
  ]

  expect(clientMix(clients, rows).clients[0].monthsBilled).toBe(1)
})

// valueMath filters the ranking by status and cannot reach the roster itself.
it('carries each client status through, for the ranking to filter on', () => {
  const clients = [client(1, 'Babaloo', 'churned')]
  const rows = [row(1, '2026-01-01', 400_000, 0)]

  expect(clientMix(clients, rows).clients[0].status).toBe('churned')
})
```

If the file's `client()` helper does not take a status, extend it to accept one as an optional third argument defaulting to `'active'` — matching the helper Task 2 defines — so the last test can produce a non-active client.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/revenue/mixMath.test.ts`
Expected: FAIL. The `monthsBilled` and `status` tests fail on `undefined`; every existing test in the file may also fail to compile because `clientMix` still requires a third argument.

- [ ] **Step 3: Add the two fields to `mixMath.ts`**

Replace the accumulation loop at the top of `clientMix`. The `Set` is what makes the third test pass — two rows in one month are one month.

```ts
  const money = new Map<
    number,
    { retainerCents: number; projectCents: number; months: Set<string> }
  >()
  for (const row of rows) {
    const found = money.get(row.client_id) ?? {
      retainerCents: 0,
      projectCents: 0,
      months: new Set<string>(),
    }
    found.retainerCents += row.retainer_cents
    found.projectCents += row.project_cents
    // A month counts as BILLED only if money changed hands in it. An entered
    // zero is a month somebody confirmed was empty, and dividing by it would
    // report a lower monthly rate for the client whose zeroes were diligently
    // entered than for the one whose were never typed at all.
    if (row.retainer_cents + row.project_cents > 0) found.months.add(row.period)
    money.set(row.client_id, found)
  }
```

Add both fields to the pushed entry, alongside the existing ones:

```ts
      status: client.status,
      monthsBilled: found.months.size,
```

And declare them on `ClientEngagement`:

```ts
  /** The client's lifecycle status, carried so the ranking can filter on it. */
  status: string
  /** Months in which this client billed anything. An entered zero is not one. */
  monthsBilled: number
```

- [ ] **Step 4: Strip the tenure fields and the `asOf` parameter**

All four exist only to caption the section being deleted.

In `mixMath.ts`:
- Remove `tenureDays` from `ClientEngagement`, and the line computing it.
- Remove `medianTenureDays` and `tenureKnown` from `GroupSummary`, and the `tenures` array and both entries in `summarise`.
- Remove `unknownStart` from `MixReport`, the `let unknownStart = 0` declaration, the `if (client.started_on === null) unknownStart += 1` line, and the field from the returned object.
- Remove the now-dead `const end = client.ended_on ?? asOf` line.
- Remove the `asOf: string` parameter from `clientMix`'s signature.
- Remove `import { daysBetween } from './tenureMath'`.

**Remove `asOf` rather than leaving it unused.** A parameter nothing reads invites a future caller to supply a date under the impression it changes an answer. `asOf` stays in use by `Tenure` and `Churn`, where a date still means something.

Update the module comment: it currently promises a comparison of how long clients last *and* what they pay. Rewrite it to say the module now answers only what they pay, that tenure moved out because most start dates are import floors rather than real beginnings, and that `Tenure` and `Churn` carry that question with the caveat it needs. Keep the quotation from the boss and keep the paragraph about the tie rule — both are still exactly why this code is shaped as it is.

- [ ] **Step 5: Delete the tenure tests from `mixMath.test.ts`**

Delete these four, by name:
- `measures tenure to today for a client still here`
- `measures tenure to the END for a client who left`
- `excludes a client with no start date from the tenure medians`
- `counts how many start dates are missing, so the reader can judge`

Keep `gives a group with no clients no medians rather than zero`, but drop any assertion in it about `medianTenureDays` — its point is that an empty group yields `null` rather than `0`, and `medianTotalCents` still carries that.

Update every remaining `clientMix(...)` call in the file to pass **two** arguments.

- [ ] **Step 6: Delete the component and unwire it**

```bash
rm src/revenue/Mix.tsx src/revenue/Mix.dom.test.tsx
```

In `src/shell/Revenue.tsx`, remove the `import { Mix } from '../revenue/Mix'` line and the whole trailing block, comment included:

```tsx
      {/* Last, and outside the range control's reach: it answers a question
          about relationships rather than about months. */}
      <Mix
        asOf={asOf}
        clients={revenue.clients}
        loadError={revenue.loadError}
        rows={revenue.rows}
        status={revenue.status}
      />
```

`asOf` is still used by `Tenure` and `Churn` further up the same file — do not remove its definition.

- [ ] **Step 7: Run the full check**

Run: `npx vitest run src/revenue/mixMath.test.ts`
Expected: PASS.

Run: `npm test && npm run lint && npm run build`
Expected: all three clean. **`npm run build` is not optional** — it is `tsc -b && vite build`, and it is the only step that catches a caller of the removed parameter. Tests passing while the build fails has happened in this repo before.

- [ ] **Step 8: Mutate, to prove the new tests can fail**

Change `if (row.retainer_cents + row.project_cents > 0)` to `if (true)`.
Run: `npx vitest run src/revenue/mixMath.test.ts`
Expected: FAIL on `does not count a month entered as zero`, reporting 3 where 2 was expected.
Restore, and confirm PASS. Quote the failure in your report.

- [ ] **Step 9: Commit**

```bash
git add src/revenue/mixMath.ts src/revenue/mixMath.test.ts src/shell/Revenue.tsx
git add -A src/revenue/Mix.tsx src/revenue/Mix.dom.test.tsx
git commit -F - <<'MSG'
refactor(revenue): months billed per client, and tenure out of the mix

clientMix gains monthsBilled and status, and loses the four fields that only
ever captioned "Retainer vs project" -- including asOf, which existed to close
an active client's tenure at today. Removed rather than left unused, so no
future caller passes a date believing it changes an answer.

The section itself goes with them. Its replacement lands in the same position.
MSG
```

---

### Task 2: `valueMath` — the ranking, the rate, the controls, the verdict

Every rule in the spec, provable without rendering anything. This is the whole of the slice's logic.

**Files:**
- Create: `src/revenue/valueMath.ts`
- Create: `src/revenue/valueMath.test.ts`

**Interfaces:**
- Consumes, from Task 1: `clientMix(clients, rows)` (two arguments), `ClientEngagement`, `GroupSummary`, `MixReport`, `EngagementKind`, `medianOf` — all from `./mixMath`. `RevenueRow` from `./chartMath`, `RetentionClient` from `./retentionMath`.
- Produces, for Task 3:
  - `TOP_N = 10`
  - `ValueRow = ClientEngagement & { monthlyEquivalentCents: number | null }`
  - `Verdict = { winner: EngagementKind | null; retainerMedianCents: number | null; projectMedianCents: number | null; clientCount: number }`
  - `clientValue(clients: readonly RetentionClient[], rows: readonly RevenueRow[]): { rows: ValueRow[]; verdict: Verdict }`
  - `isActive(status: string): boolean`
  - `departedCount(rows: readonly ValueRow[]): number`
  - `visibleRows(rows: readonly ValueRow[], showDeparted: boolean, showAll: boolean): ValueRow[]`
  - `eligibleCount(rows: readonly ValueRow[], showDeparted: boolean): number`
  - `departedToggleLabel(departed: number, showDeparted: boolean): string`
  - `lengthToggleLabel(eligible: number, showAll: boolean): string`

- [ ] **Step 1: Write the failing tests**

Create `src/revenue/valueMath.test.ts`. Fixtures first — synthetic names only.

```ts
import { describe, expect, it } from 'vitest'
import type { RevenueRow } from './chartMath'
import type { RetentionClient } from './retentionMath'
import {
  TOP_N,
  clientValue,
  departedCount,
  departedToggleLabel,
  eligibleCount,
  isActive,
  lengthToggleLabel,
  visibleRows,
} from './valueMath'

function client(
  id: number,
  name: string,
  status = 'active',
): RetentionClient {
  return { id, name, status, started_on: '2025-01-01', ended_on: null }
}

function row(
  client_id: number,
  period: string,
  retainer_cents: number,
  project_cents: number,
): RevenueRow {
  return { client_id, period, retainer_cents, project_cents }
}

describe('the monthly equivalent', () => {
  // The boss's own figure, reached without the step that inflated it: a $30,000
  // project delivered in three months is $10,000 a month.
  it('turns a project fee into a rate you can hold beside a retainer', () => {
    const rows = [
      row(1, '2026-01-01', 0, 1_000_000),
      row(1, '2026-02-01', 0, 1_000_000),
      row(1, '2026-03-01', 0, 1_000_000),
    ]

    const { rows: ranked } = clientValue([client(1, 'Babaloo')], rows)
    expect(ranked[0].monthlyEquivalentCents).toBe(1_000_000)
  })

  it('is a retainer client's actual rate', () => {
    const rows = [
      row(1, '2026-01-01', 400_000, 0),
      row(1, '2026-02-01', 400_000, 0),
    ]

    const { rows: ranked } = clientValue([client(1, 'Colorfil')], rows)
    expect(ranked[0].monthlyEquivalentCents).toBe(400_000)
  })

  it('is the one month itself for a client billed once', () => {
    const { rows: ranked } = clientValue(
      [client(1, 'Sno-Go')],
      [row(1, '2026-01-01', 750_000, 0)],
    )
    expect(ranked[0].monthlyEquivalentCents).toBe(750_000)
  })

  // The figure reads no dates at all, so an unknown start date costs nothing.
  // Most of this roster arrived from the invoice ledger with a start date that
  // is a floor rather than a beginning, which is exactly why lifetime value
  // was chosen over anything tenure-derived.
  it('does not care that a client has no start date', () => {
    const noStart = { ...client(1, 'Babaloo'), started_on: null }
    const { rows: ranked } = clientValue([noStart], [row(1, '2026-01-01', 500_000, 0)])
    expect(ranked[0].monthlyEquivalentCents).toBe(500_000)
  })
})

describe('the ranking', () => {
  it('puts the most valuable client first', () => {
    const clients = [client(1, 'Babaloo'), client(2, 'Colorfil'), client(3, 'Sno-Go')]
    const rows = [
      row(1, '2026-01-01', 100_000, 0),
      row(2, '2026-01-01', 900_000, 0),
      row(3, '2026-01-01', 500_000, 0),
    ]

    const { rows: ranked } = clientValue(clients, rows)
    expect(ranked.map((entry) => entry.name)).toEqual(['Colorfil', 'Sno-Go', 'Babaloo'])
  })

  // Deterministic, so the list does not reshuffle between renders on equal money.
  it('breaks a tie on name rather than leaving it to chance', () => {
    const clients = [client(1, 'Sno-Go'), client(2, 'Babaloo')]
    const rows = [row(1, '2026-01-01', 500_000, 0), row(2, '2026-01-01', 500_000, 0)]

    const { rows: ranked } = clientValue(clients, rows)
    expect(ranked.map((entry) => entry.name)).toEqual(['Babaloo', 'Sno-Go'])
  })

  // A client listed at $0 says the agency bills them nothing, rather than that
  // nobody has typed it. The whole codebase keeps this rule.
  it('leaves out a client with nothing entered', () => {
    const clients = [client(1, 'Babaloo'), client(2, 'Colorfil')]
    const { rows: ranked } = clientValue(clients, [row(1, '2026-01-01', 500_000, 0)])

    expect(ranked.map((entry) => entry.name)).toEqual(['Babaloo'])
  })
})

describe('who is eligible, and how many are drawn', () => {
  const clients = [
    client(1, 'Babaloo'),
    client(2, 'Colorfil', 'churned'),
    client(3, 'Sno-Go', 'paused'),
  ]
  const rows = [
    row(1, '2026-01-01', 100_000, 0),
    row(2, '2026-01-01', 900_000, 0),
    row(3, '2026-01-01', 500_000, 0),
  ]

  // The clients board's allowlist, not "has no end date": a paused client is
  // not active.
  it('counts only an active status as active', () => {
    expect(isActive('active')).toBe(true)
    expect(isActive('paused')).toBe(false)
    expect(isActive('churned')).toBe(false)
  })

  it('shows only active clients by default', () => {
    const { rows: ranked } = clientValue(clients, rows)
    expect(visibleRows(ranked, false, true).map((entry) => entry.name)).toEqual(['Babaloo'])
  })

  // The consequence the spec accepts rather than engineers around: a departed
  // client can outrank every active one, and revealing them rearranges the top.
  it('ranks departed clients INTO the list, not after it', () => {
    const { rows: ranked } = clientValue(clients, rows)
    expect(visibleRows(ranked, true, true).map((entry) => entry.name)).toEqual([
      'Colorfil',
      'Sno-Go',
      'Babaloo',
    ])
  })

  it('draws only the top ten until asked for all', () => {
    const many = Array.from({ length: 14 }, (_, index) => client(index + 1, `Client ${index + 1}`))
    const manyRows = many.map((entry, index) =>
      row(entry.id, '2026-01-01', (index + 1) * 100_000, 0),
    )

    const { rows: ranked } = clientValue(many, manyRows)
    expect(visibleRows(ranked, false, false)).toHaveLength(TOP_N)
    expect(visibleRows(ranked, false, true)).toHaveLength(14)
  })

  it('counts the departed, so the control can say how many', () => {
    const { rows: ranked } = clientValue(clients, rows)
    expect(departedCount(ranked)).toBe(2)
  })

  it('counts who is eligible under the current filter', () => {
    const { rows: ranked } = clientValue(clients, rows)
    expect(eligibleCount(ranked, false)).toBe(1)
    expect(eligibleCount(ranked, true)).toBe(3)
  })

  // Both controls say what pressing them will DO, not what state they are in.
  it('labels both controls in both directions', () => {
    expect(departedToggleLabel(2, false)).toBe('Show 2 departed')
    expect(departedToggleLabel(2, true)).toBe('Hide 2 departed')
    expect(lengthToggleLabel(14, false)).toBe('Show all 14')
    expect(lengthToggleLabel(14, true)).toBe('Show top 10')
  })
})

describe('the verdict', () => {
  // THE TEST THIS SLICE IS MOST LIKELY TO GET WRONG. A verdict hard-coded to
  // "retainer" would pass every other test in this file. The boss's belief is
  // what is being TESTED, so the sentence must be able to contradict him.
  it('says retainer when retainer clients are worth more', () => {
    const clients = [client(1, 'Babaloo'), client(2, 'Colorfil')]
    const rows = [row(1, '2026-01-01', 900_000, 0), row(2, '2026-01-01', 0, 100_000)]

    expect(clientValue(clients, rows).verdict.winner).toBe('retainer')
  })

  it('says PROJECT when project clients are worth more', () => {
    const clients = [client(1, 'Babaloo'), client(2, 'Colorfil')]
    const rows = [row(1, '2026-01-01', 100_000, 0), row(2, '2026-01-01', 0, 900_000)]

    expect(clientValue(clients, rows).verdict.winner).toBe('project')
  })

  it('declares no winner when the two typical clients are worth the same', () => {
    const clients = [client(1, 'Babaloo'), client(2, 'Colorfil')]
    const rows = [row(1, '2026-01-01', 500_000, 0), row(2, '2026-01-01', 0, 500_000)]

    expect(clientValue(clients, rows).verdict.winner).toBeNull()
  })

  it('declares no winner when one kind has nobody in it', () => {
    const { verdict } = clientValue([client(1, 'Babaloo')], [row(1, '2026-01-01', 500_000, 0)])

    expect(verdict.winner).toBeNull()
    expect(verdict.projectMedianCents).toBeNull()
    expect(verdict.retainerMedianCents).toBe(500_000)
  })

  // The sentence names its own population because it does NOT follow the
  // list's filter -- a completed relationship is the only complete lifetime
  // value there is, and departed clients are most of this history.
  it('is drawn from every client ever billed, departed included', () => {
    const clients = [client(1, 'Babaloo'), client(2, 'Colorfil', 'churned')]
    const rows = [row(1, '2026-01-01', 100_000, 0), row(2, '2026-01-01', 0, 900_000)]

    expect(clientValue(clients, rows).verdict.clientCount).toBe(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/revenue/valueMath.test.ts`
Expected: FAIL — `Failed to resolve import "./valueMath"`.

- [ ] **Step 3: Write `valueMath.ts`**

```ts
import { clientMix } from './mixMath'
import type { ClientEngagement, EngagementKind, MixReport } from './mixMath'
import type { RevenueRow } from './chartMath'
import type { RetentionClient } from './retentionMath'

// What each client is worth, and what that says about the two kinds of client.
//
// The owner's boss described a lifetime-value formula at a whiteboard on
// 2026-09-11. The version that reached us -- through a transcript, not the
// photograph -- multiplied a project client's monthly equivalent back out
// across the whole relationship, including months in which nothing was billed.
// That quadruples a $30,000 client who stays a year, and it manufactures
// evidence AGAINST the hypothesis its own author holds, which is how we know
// it is a transcription error rather than a finding.
//
// What survives is the monthly equivalent itself, which is a RATE and not a
// lifetime: fee over months billed, so a three-month project and a monthly
// retainer can be held side by side. Lifetime value is money actually billed
// and nothing else.
//
// Pure, and separate from the component, so every rule above is provable
// without a DOM -- the same split as every other maths module here.

/** How many clients the ranking draws before a reader asks for the rest. */
export const TOP_N = 10

export type ValueRow = ClientEngagement & {
  /**
   * Total billed over months billed. Null only when no month was billed, which
   * cannot happen for a listed client -- `clientMix` drops those -- so the null
   * is a type-level honesty rather than a state the page renders.
   */
  monthlyEquivalentCents: number | null
}

export type Verdict = {
  /** Null for a dead heat, and null when either kind has nobody in it. */
  winner: EngagementKind | null
  /** Null when no client of that kind has billed anything. */
  retainerMedianCents: number | null
  projectMedianCents: number | null
  /** Every client the verdict was drawn from -- active and departed alike. */
  clientCount: number
}

export function monthlyEquivalent(totalCents: number, monthsBilled: number): number | null {
  if (monthsBilled <= 0) return null
  // Rounded to whole cents. formatMoney renders cents, and a fractional cent
  // would print a third decimal place on a page where every other figure is
  // exact.
  return Math.round(totalCents / monthsBilled)
}

/**
 * Which kind of client is worth more, and by how much.
 *
 * THE ANSWER MAY CONTRADICT THE MAN WHO ASKED FOR IT, and nothing here may
 * round in his favour. `clientMix` already counts an exact revenue tie as a
 * PROJECT client for the same reason; a tie between the two medians is
 * reported as no winner rather than resolved toward the belief being tested.
 */
export function verdictFrom(report: MixReport): Verdict {
  const retainer = report.retainer.medianTotalCents
  const project = report.project.medianTotalCents

  const winner =
    retainer === null || project === null
      ? null
      : retainer === project
        ? null
        : retainer > project
          ? 'retainer'
          : 'project'

  return {
    winner,
    retainerMedianCents: retainer,
    projectMedianCents: project,
    clientCount: report.clients.length,
  }
}

/** The clients board's allowlist, not "has no end date": a paused client is not active. */
export function isActive(status: string): boolean {
  return status === 'active'
}

export function departedCount(rows: readonly ValueRow[]): number {
  return rows.filter((entry) => !isActive(entry.status)).length
}

export function eligibleCount(rows: readonly ValueRow[], showDeparted: boolean): number {
  return showDeparted ? rows.length : rows.filter((entry) => isActive(entry.status)).length
}

/**
 * The rows to draw, filtered then cut.
 *
 * Departed clients are ranked INTO the list rather than appended after it, so
 * revealing them can displace an active client from the top ten. That is the
 * number being honest: a client of four years who left outranks most of a
 * current book, and pinning the ranking would show an order true of no set of
 * clients.
 */
export function visibleRows(
  rows: readonly ValueRow[],
  showDeparted: boolean,
  showAll: boolean,
): ValueRow[] {
  const eligible = showDeparted ? [...rows] : rows.filter((entry) => isActive(entry.status))
  return showAll ? eligible : eligible.slice(0, TOP_N)
}

// Named in both directions, so each control says what pressing it will do
// rather than what state it is in -- the board's toggleLabel does the same,
// and for the same reason.
export function departedToggleLabel(departed: number, showDeparted: boolean): string {
  return `${showDeparted ? 'Hide' : 'Show'} ${departed} departed`
}

export function lengthToggleLabel(eligible: number, showAll: boolean): string {
  return showAll ? `Show top ${TOP_N}` : `Show all ${eligible}`
}

/**
 * Every client ranked by what they have actually billed, and the verdict drawn
 * from all of them.
 *
 * The verdict does NOT follow the list's filter, and the component says so in
 * the sentence: a completed relationship is the only complete lifetime value
 * there is, so a verdict drawn from active clients alone would rest on the
 * weaker half of the evidence and drift upward every month.
 */
export function clientValue(
  clients: readonly RetentionClient[],
  rows: readonly RevenueRow[],
): { rows: ValueRow[]; verdict: Verdict } {
  const report = clientMix(clients, rows)

  const ranked = report.clients
    .map((entry) => ({
      ...entry,
      monthlyEquivalentCents: monthlyEquivalent(entry.totalCents, entry.monthsBilled),
    }))
    // Copied by `map` above, so this sorts a new array rather than the report's.
    // Ties break on name: equal money must not reshuffle between renders.
    .sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name))

  return { rows: ranked, verdict: verdictFrom(report) }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/revenue/valueMath.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Mutate the verdict, which is the assertion most likely to be vacuous**

Replace the whole `winner` expression in `verdictFrom` with `const winner = 'retainer'`.
Run: `npx vitest run src/revenue/valueMath.test.ts`
Expected: FAIL on `says PROJECT when project clients are worth more`, on `declares no winner when the two typical clients are worth the same`, and on `declares no winner when one kind has nobody in it`.

Then mutate the ranking: change `b.totalCents - a.totalCents` to `a.totalCents - b.totalCents`.
Expected: FAIL on `puts the most valuable client first`.

Then mutate the filter: change `visibleRows`'s `showDeparted ? ... : rows.filter(...)` to always return `[...rows]`.
Expected: FAIL on `shows only active clients by default`.

Restore each and confirm PASS. Quote all three failures in your report.

- [ ] **Step 6: Commit**

```bash
git add src/revenue/valueMath.ts src/revenue/valueMath.test.ts
git commit -F - <<'MSG'
feat(revenue): what each client is worth, as rules

Lifetime value is money actually billed. The monthly equivalent is total over
months billed -- one rule for both kinds of client, which is what makes a
three-month project comparable to a monthly retainer, and which is the
whiteboard formula without the step that multiplied it back out across months
nobody was billed for.

The verdict can contradict the man who asked for it. A dead heat between the
two medians is reported as no winner rather than resolved toward the belief
being tested, for the same reason clientMix counts an exact revenue tie as
project work.
MSG
```

---

### Task 3: The `Value` section, and its place on the page

**Files:**
- Create: `src/revenue/Value.tsx`
- Create: `src/revenue/Value.dom.test.tsx`
- Modify: `src/revenue/Revenue.module.css`
- Modify: `src/shell/Revenue.tsx`
- Modify: `tests/revenueLiterals.test.ts`

**Interfaces:**
- Consumes, from Task 2: `clientValue`, `visibleRows`, `departedCount`, `eligibleCount`, `departedToggleLabel`, `lengthToggleLabel`, `TOP_N`, and the types `ValueRow` and `Verdict` — all from `./valueMath`. `formatMoney` from `./money`.
- Produces: `<Value clients rows status loadError />`, taking exactly the props `Mix` took minus `asOf`.

- [ ] **Step 1: Write the failing DOM test**

Create `src/revenue/Value.dom.test.tsx`. Follow the shape of the sibling DOM tests in this directory (`Concentration.dom.test.tsx` is the closest — a ranked list with rows).

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { RevenueRow } from './chartMath'
import type { RetentionClient } from './retentionMath'
import { Value } from './Value'

function client(id: number, name: string, status = 'active'): RetentionClient {
  return { id, name, status, started_on: '2025-01-01', ended_on: null }
}

function row(
  client_id: number,
  period: string,
  retainer_cents: number,
  project_cents: number,
): RevenueRow {
  return { client_id, period, retainer_cents, project_cents }
}

const CLIENTS = [
  client(1, 'Babaloo'),
  client(2, 'Colorfil'),
  client(3, 'Sno-Go', 'churned'),
]

const ROWS = [
  row(1, '2026-01-01', 400_000, 0),
  row(1, '2026-02-01', 400_000, 0),
  row(2, '2026-01-01', 0, 300_000),
  row(3, '2026-01-01', 5_000_000, 0),
]

function draw(over: Partial<React.ComponentProps<typeof Value>> = {}) {
  return render(
    <Value clients={CLIENTS} loadError={null} rows={ROWS} status="ready" {...over} />,
  )
}

describe('What each client is worth', () => {
  it('ranks the most valuable active client first', () => {
    draw()
    const names = screen.getAllByTestId('value-name').map((node) => node.textContent)
    expect(names).toEqual(['Babaloo', 'Colorfil'])
  })

  it('shows what a client has billed and what that is per month', () => {
    draw()
    const babaloo = screen.getByRole('listitem', { name: 'Babaloo' })
    expect(within(babaloo).getByTestId('value-total')).toHaveTextContent('$8,000')
    expect(within(babaloo).getByTestId('value-rate')).toHaveTextContent('$4,000')
  })

  it('leaves departed clients out until they are asked for', async () => {
    draw()
    expect(screen.queryByText('Sno-Go')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Show 1 departed' }))
    expect(screen.getByText('Sno-Go')).toBeInTheDocument()
  })

  // The consequence the spec accepts: a departed client outranks the book.
  it('ranks a revealed departed client into the list, not after it', async () => {
    draw()
    await userEvent.click(screen.getByRole('button', { name: 'Show 1 departed' }))

    const names = screen.getAllByTestId('value-name').map((node) => node.textContent)
    expect(names).toEqual(['Sno-Go', 'Babaloo', 'Colorfil'])
  })

  it('answers the question in a sentence, naming the clients it drew from', () => {
    draw()
    expect(screen.getByTestId('value-verdict')).toHaveTextContent(
      'Across all 3 clients ever billed',
    )
    expect(screen.getByTestId('value-verdict')).toHaveTextContent('Retainer clients are worth more')
  })

  // THE MUTANT THIS SLICE INVITES. The verdict is drawn from every client ever
  // billed; the list is filtered. A verdict recomputed from the visible rows
  // would pass every other test here.
  it('does not change the verdict when the list is filtered', async () => {
    draw()
    const before = screen.getByTestId('value-verdict').textContent

    await userEvent.click(screen.getByRole('button', { name: 'Show 1 departed' }))
    expect(screen.getByTestId('value-verdict')).toHaveTextContent(before ?? '')
  })

  it('says so when a read failed, rather than showing an empty ranking', () => {
    draw({ status: 'error', loadError: 'Could not reach the database.' })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the database.')
    expect(screen.queryByTestId('value-name')).not.toBeInTheDocument()
  })

  it('says nothing has been entered rather than ranking nobody', () => {
    draw({ rows: [] })
    expect(screen.getByText(/No revenue has been entered/)).toBeInTheDocument()
    expect(screen.queryByTestId('value-name')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/revenue/Value.dom.test.tsx`
Expected: FAIL — `Failed to resolve import "./Value"`.

- [ ] **Step 3: Write `Value.tsx`**

```tsx
import { useState } from 'react'
import { formatMoney } from './money'
import {
  clientValue,
  departedCount,
  departedToggleLabel,
  eligibleCount,
  lengthToggleLabel,
  visibleRows,
} from './valueMath'
import type { ValueRow, Verdict } from './valueMath'
import type { RevenueRow } from './chartMath'
import type { RetentionClient } from './retentionMath'
import styles from './Revenue.module.css'

// What each client is worth, replacing "Retainer vs project" -- which answered
// the same question with two medians side by side and which the owner reported
// he could not read.
//
// It measures EVERY month entered, not the page's selected range: what a
// relationship was worth is not a property of three months. Said out loud
// below, because this section sits under a range control that does not govern
// it.
//
// Tenure is deliberately absent. Most of this roster arrived through the 2026
// import with a start date set to the first invoice month -- a floor on the
// relationship rather than its beginning -- so every tenure figure needed a
// paragraph of caveat before it could be believed. Lifetime value is money
// that was actually billed and needs none. Tenure and Churn carry that
// question, with the caveat, where it belongs.

function VerdictLine({ verdict }: { verdict: Verdict }) {
  const { clientCount, projectMedianCents, retainerMedianCents, winner } = verdict

  // Only one kind of client has billed anything. A comparison drawn from one
  // group is not a comparison.
  if (retainerMedianCents === null || projectMedianCents === null) {
    return (
      <p className="t-body prose" data-testid="value-verdict">
        Only one kind of client has billed anything so far, so there is nothing to compare.
      </p>
    )
  }

  const population = `Across all ${clientCount} clients ever billed`

  // A DEAD HEAT IS NOT EVIDENCE FOR THE BELIEF BEING TESTED, so it is reported
  // as a dead heat rather than resolved toward the hypothesis.
  if (winner === null) {
    return (
      <p className="t-body prose" data-testid="value-verdict">
        {population}, retainer and project clients are worth about the same:{' '}
        {formatMoney(retainerMedianCents)} for the typical client of either kind.
      </p>
    )
  }

  const winnerMedian = winner === 'retainer' ? retainerMedianCents : projectMedianCents
  const loserMedian = winner === 'retainer' ? projectMedianCents : retainerMedianCents
  const loser = winner === 'retainer' ? 'project' : 'retainer'

  return (
    <p className="t-body prose" data-testid="value-verdict">
      {population}, {winner} clients are worth more: the typical one has billed{' '}
      {formatMoney(winnerMedian)}, against {formatMoney(loserMedian)} for the typical {loser}{' '}
      client.
    </p>
  )
}

function Row({ entry }: { entry: ValueRow }) {
  return (
    <li aria-label={entry.name} className={styles.row}>
      <span className={styles.who}>
        <span className="t-body" data-testid="value-name">
          {entry.name}
        </span>
        {/* Words, not a colour: the primary reader of this tool is colourblind. */}
        <span className={`t-caption ${styles.marker}`}>{entry.kind}</span>
      </span>
      <span className={`t-body ${styles.measure}`} data-testid="value-total">
        {formatMoney(entry.totalCents)}
      </span>
      {/* Null only when no month was billed, which cannot happen for a listed
          client -- clientMix drops those before they reach here. */}
      {entry.monthlyEquivalentCents !== null && (
        <span className={`t-caption ${styles.detail}`} data-testid="value-rate">
          {formatMoney(entry.monthlyEquivalentCents)} a month
        </span>
      )}
    </li>
  )
}

export function Value({
  clients,
  loadError,
  rows,
  status,
}: {
  clients: readonly RetentionClient[]
  loadError: string | null
  rows: readonly RevenueRow[]
  status: 'loading' | 'ready' | 'error'
}) {
  const [showDeparted, setShowDeparted] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const result = status === 'ready' ? clientValue(clients, rows) : null

  return (
    <section className={styles.section}>
      <h3 className="t-subhead">What each client is worth</h3>

      {status === 'loading' && <p className="t-body">Loading…</p>}

      {/* A failed read must never fall through to an empty ranking: a list with
          nothing in it reads as every client billing nothing at once. */}
      {status === 'error' && (
        <p className="alert prose" role="alert">
          {loadError}
        </p>
      )}

      {result !== null && result.rows.length === 0 && (
        <p className="t-body prose">
          No revenue has been entered, so there is nothing to rank.
        </p>
      )}

      {result !== null && result.rows.length > 0 && (
        <ValueReady
          result={result}
          setShowAll={setShowAll}
          setShowDeparted={setShowDeparted}
          showAll={showAll}
          showDeparted={showDeparted}
        />
      )}
    </section>
  )
}

function ValueReady({
  result,
  setShowAll,
  setShowDeparted,
  showAll,
  showDeparted,
}: {
  result: { rows: ValueRow[]; verdict: Verdict }
  setShowAll: (update: (shown: boolean) => boolean) => void
  setShowDeparted: (update: (shown: boolean) => boolean) => void
  showAll: boolean
  showDeparted: boolean
}) {
  const departed = departedCount(result.rows)
  const eligible = eligibleCount(result.rows, showDeparted)
  const visible = visibleRows(result.rows, showDeparted, showAll)

  return (
    <>
      <VerdictLine verdict={result.verdict} />

      <p className={`t-caption ${styles.summary}`}>
        Every month entered, not the range selected above: what a relationship was worth is not a
        property of three months.
      </p>

      <ul aria-label="What each client is worth" className={styles.list} role="list">
        {visible.map((entry) => (
          <Row entry={entry} key={entry.clientId} />
        ))}
      </ul>

      <div className={styles.buttonRow}>
        {/* Each control is drawn only when it has something to do. A control
            that reveals nothing is worse than no control: it implies something
            is hidden. */}
        {eligible > visible.length || showAll ? (
          <button
            aria-expanded={showAll}
            className="button button--quiet"
            onClick={() => setShowAll((shown) => !shown)}
            type="button"
          >
            {lengthToggleLabel(eligible, showAll)}
          </button>
        ) : null}

        {departed > 0 && (
          <button
            aria-expanded={showDeparted}
            className="button button--quiet"
            onClick={() => setShowDeparted((shown) => !shown)}
            type="button"
          >
            {departedToggleLabel(departed, showDeparted)}
          </button>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/revenue/Value.dom.test.tsx`
Expected: PASS.

- [ ] **Step 5: Replace the Mix styles with the one rule this section adds**

In `src/revenue/Revenue.module.css`, delete the `.mixGroups`, `.mixGroup` and `.mixGroup p` rules (around line 658) — nothing renders them now.

`.list`, `.row`, `.who`, `.measure`, `.marker`, `.detail`, `.summary` and `.buttonRow` already exist and are what `Value.tsx` uses. Check `.row`'s grid: it was written for Concentration's three children (`.who`, `.measure`, a bar track). `Value`'s row has three too — `.who`, `.measure`, `.detail` — so it should sit in the same columns. **Open the page and look before deciding it does** (Step 8); if the rate lands in the bar-track column and looks wrong, add a `Value`-specific rule rather than changing `.row`, which Concentration depends on.

- [ ] **Step 6: Wire it into the page**

In `src/shell/Revenue.tsx`, add `import { Value } from '../revenue/Value'` beside the other revenue imports, and put the section back where `Mix` was — last, after the `Tenure`/`Churn` block:

```tsx
      {/* Last, and outside the range control's reach: it answers a question
          about relationships rather than about months. */}
      <Value
        clients={revenue.clients}
        loadError={revenue.loadError}
        rows={revenue.rows}
        status={revenue.status}
      />
```

- [ ] **Step 7: Add the new file to the percentage-literal guard**

In `tests/revenueLiterals.test.ts`, add to `GUARDED_FILES`:

```ts
  join(ROOT, 'src', 'revenue', 'Value.tsx'),
```

`Mix.tsx` was never in this list, which is the gap being closed rather than a line being moved. Add a sentence to the comment above the list recording that `Value.tsx` joined on arrival rather than after a reviewer found it missing, the way `Tenure.tsx`, `Retention.tsx` and `Concentration.tsx` each did.

- [ ] **Step 8: Run everything, then look at it**

Run: `npm test && npm run lint && npm run build`
Expected: all three clean.

Then: `npm run dev`, open `http://localhost:5173/tgc-client-health/`, go to Revenue and scroll to the bottom section. **jsdom computes no layout, so no test above can see a misaligned column** — this repository has shipped that exact defect before, and the owner caught it in a screenshot within a minute. Confirm the three columns line up, both controls appear and do what their labels say, and the verdict sentence does not move when the departed control is pressed.

- [ ] **Step 9: Mutate the two behaviours the DOM tests exist for**

Make the verdict follow the filter: in `ValueReady`, change `<VerdictLine verdict={result.verdict} />` to compute a verdict from `visible` instead. Confirm `does not change the verdict when the list is filtered` FAILS. Restore.

Drop the rate: remove the `data-testid="value-rate"` span from `Row`. Confirm `shows what a client has billed and what that is per month` FAILS. Restore.

Quote both failures in your report.

- [ ] **Step 10: Commit**

```bash
git add src/revenue/Value.tsx src/revenue/Value.dom.test.tsx src/revenue/Revenue.module.css src/shell/Revenue.tsx tests/revenueLiterals.test.ts
git commit -F - <<'MSG'
feat(revenue): what each client is worth, on the page

A ranked list of clients by money actually billed, each with the monthly rate
that makes a project client comparable to a retainer one, under one sentence
answering whether retainer or project clients are worth more.

The sentence is drawn from every client ever billed and names its population,
because it does not follow the list's filter: pressing a control meant to
reveal more rows must not change the answer to the question the section exists
to ask.
MSG
```

---

## Self-review

**Spec coverage.** §1's two numbers → Task 1 Step 3 (`monthsBilled`) and Task 2 Step 3 (`monthlyEquivalent`, `clientValue`). §2.1's verdict, its population and its ability to contradict → Task 2 Step 3 (`verdictFrom`) and Task 3 Step 3 (`VerdictLine`). §2.2's ranking and derived kind → Task 2 Step 3. §3's active definition, both controls and the rank-into behaviour → Task 2 Step 3 (`isActive`, `visibleRows`, both labels). §3's no-revenue rule → inherited from `clientMix`, asserted in Task 2 Step 1. §4's tenure removal → Task 1 Steps 4 and 5. §5's file layout and §5.1's cleanup including the `asOf` signature change → Task 1 Steps 4 and 6, Task 3 Steps 5 and 6. §7's test list → all three tasks, with the verdict-flip and verdict-does-not-follow-the-filter cases called out as the likely vacuous ones.

**Placeholders.** None: every code step carries the code, every test step the test, every run step the command and the expected result.

**Type consistency.** `ClientEngagement` gains `status` and `monthsBilled` in Task 1 and is consumed under those exact names in Task 2. `clientValue` returns `{ rows, verdict }` in Task 2 and is destructured as such in Task 3. `Value`'s props are the four `Mix` had minus `asOf`, matching what `Revenue.tsx` passes in Task 3 Step 6. `TOP_N` is defined once and read by `visibleRows`, `lengthToggleLabel` and the Task 2 test.

**One thing left deliberately open.** Task 3 Step 5 does not promise the existing `.row` grid fits this section's three children; it says to look, and to add a `Value`-specific rule rather than edit the shared one if it does not. Anything positional in this repo needs eyes on it, and a plan that asserted the layout works would be asserting something no test in it can check.
