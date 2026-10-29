# Finances from Revenue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-fill "Paying rack rate" and "Rate vs last month" on the check-in screen from the revenue and package data the tool already holds, with the reason shown.

**Architecture:** A pure module computes each answer from a month, a package stint and revenue rows. A read hook fetches those rows (gated by capability). The check-in screen shows the reason under each question and fills blank answers once per visit through a single batched edit. The rate question is relabelled. No migration.

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library (`*.dom.test.ts(x)`, `// @vitest-environment jsdom`), Supabase JS.

**Spec:** `docs/superpowers/specs/2026-10-29-finances-from-revenue-design.md` — read it first.

## Global Constraints

- Rates: Foundation 1_000_000 cents (a TOTAL over the stint), Grow 500_000 cents per month. In `src/checkin/financeRates.ts` only.
- Rate tolerance: ±5% INCLUSIVE is No change. Values 1 / 3 / 5 as today.
- Labels: prompt `Rate vs last month.`; options `Decreased` / `No change` / `Increased`.
- Reason strings, exact (money via `formatMoney` from `src/revenue/money.ts`):
  - rate: `From revenue: ${this} this month vs ${last} last month.`
  - Grow: `From revenue: ${billed} billed vs ${rate} Grow rack rate.`
  - Foundation: `From revenue: ${total} billed since Foundation began vs ${rate} Foundation rate.`
- Reads are gated AT THE READ: revenue needs `view_revenue`; packages need `manage_clients` (RLS select-gates `client_packages` on it — see `src/clients/usePackages.ts`). Without packages, rack rate has no answer; rate still works.
- Pre-fill never replaces a STORED answer or one already in the form, happens at most once per client+month visit (clearing a filled answer must not refill it), and is applied as ONE edit for both questions.
- Every test file that reaches `src/lib/supabase` mocks it (tests/supabaseModuleScope.test.ts).
- Branch `finances-from-revenue`; `git branch --show-current` before every commit; explicit paths; never `git commit -a`; trailer `Co-Authored-By: Claude <model actually running> <noreply@anthropic.com>`.
- Done = task tests pass + full `npx vitest run` + `npx tsc -b` + `npm run lint` clean.

## Review Focus

1. **The person clears a pre-filled answer** — it must stay cleared (no refill on re-render). Task 4.
2. **Both answers pre-filled in the same tick** — neither may be lost (batched edit). Task 3/4.
3. **Revenue not yet entered for the month** — no answer, no caption, no error. Task 2/4.
4. **A Foundation client whose stint began mid-month** — that month counts (stint start compared by MONTH). Task 2.
5. **A viewer without view_revenue / manage_clients** — no read issued at all. Task 3.

---

### Task 1: Relabel the rate question

**Files:** Modify `src/lib/buckets.ts` (prompt + `RATE_OPTIONS` + comments that say "Break even" / "90 days"); Test `src/lib/buckets.test.ts`, `src/checkin/ChoiceRow.dom.test.tsx` (strings that pin the old words).

- [ ] **Step 1:** In the tests, change every expected `'Rate over the last 90 days.'` → `'Rate vs last month.'` and `'Break even'` → `'No change'` (buckets.test.ts ~106, ~136, ~158; ChoiceRow.dom.test.tsx ~99, ~110, ~124). Run `npx vitest run src/lib/buckets.test.ts src/checkin/ChoiceRow.dom.test.tsx` → FAIL.
- [ ] **Step 2:** In `buckets.ts`: prompt `'Rate vs last month.'`; `{ label: 'No change', value: 3 }`. Update the comments above `RATE_OPTIONS` and on the question: the owner renamed Break even to No change on 2026-10-29 and the comparison became this month vs last month (spec); values unchanged, so no stored answer moves.
- [ ] **Step 3:** Run → PASS; full suite, tsc, lint.
- [ ] **Step 4:** Commit `copy(checkin): the rate question is this month vs last, and its middle answer is No change`.

---

### Task 2: The rules, as a pure module

**Files:** Create `src/checkin/financeRates.ts`, `src/checkin/financeFromRevenue.ts`, `src/checkin/financeFromRevenue.test.ts`.

**Interfaces (Produces):**

```ts
// financeRates.ts
export const FOUNDATION_RATE_CENTS = 1_000_000 // total over the Foundation stint
export const GROW_RATE_CENTS = 500_000 // per month
export const RATE_TOLERANCE = 0.05 // inclusive

// financeFromRevenue.ts
export type RevenueRow = { period: string; retainer_cents: number; project_cents: number }
export type Stint = { package_code: string; started_on: string }
export type FinanceAnswer = { value: 1 | 3 | 5; reason: string }
export type FinanceSuggestion = { fin_rack_rate?: FinanceAnswer; fin_rate_increased?: FinanceAnswer }
export function stintFor(stints: readonly Stint[], period: string): Stint | null
export function financeFromRevenue(period: string, stint: Stint | null, rows: readonly RevenueRow[]): FinanceSuggestion
```

- [ ] **Step 1: Failing tests** — `src/checkin/financeFromRevenue.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { financeFromRevenue, stintFor } from './financeFromRevenue'
import type { RevenueRow, Stint } from './financeFromRevenue'

const OCT = '2026-10-01'
const row = (period: string, dollars: number, projectDollars = 0): RevenueRow => ({
  period, retainer_cents: Math.round(dollars * 100), project_cents: Math.round(projectDollars * 100),
})
const GROW: Stint = { package_code: 'grow', started_on: '2026-02-01' }

describe('rate vs last month', () => {
  it.each([
    [10000, 10490, 3], // +4.9%
    [10000, 10500, 3], // +5% inclusive
    [10000, 10510, 5], // +5.1%
    [10000, 9500, 3], // -5% inclusive
    [10000, 9490, 1], // -5.1%
    [0, 4000, 5],
    [0, 0, 3],
  ])('%d last month, %d this month → %d', (last, now, expected) => {
    const s = financeFromRevenue(OCT, null, [row('2026-09-01', last), row(OCT, now)])
    expect(s.fin_rate_increased?.value).toBe(expected)
  })

  it('counts project fees in the total', () => {
    const s = financeFromRevenue(OCT, null, [row('2026-09-01', 4000), row(OCT, 4000, 6000)])
    expect(s.fin_rate_increased?.value).toBe(5)
  })

  it('says what it compared', () => {
    const s = financeFromRevenue(OCT, null, [row('2026-09-01', 15500), row(OCT, 14860)])
    expect(s.fin_rate_increased).toEqual({ value: 3, reason: 'From revenue: $14,860 this month vs $15,500 last month.' })
  })

  it.each([
    ['no row this month', [row('2026-09-01', 4000)]],
    ['no row last month', [row(OCT, 4000)]],
  ])('gives nothing with %s', (_why, rows) => {
    expect(financeFromRevenue(OCT, null, rows).fin_rate_increased).toBeUndefined()
  })
})

describe('rack rate, Grow', () => {
  it('is Yes at the rate', () => {
    expect(financeFromRevenue(OCT, GROW, [row(OCT, 5000)]).fin_rack_rate).toEqual({
      value: 5, reason: 'From revenue: $5,000 billed vs $5,000 Grow rack rate.',
    })
  })
  it('is No a cent below it', () => {
    expect(financeFromRevenue(OCT, GROW, [row(OCT, 4999.99)]).fin_rack_rate?.value).toBe(1)
  })
  it('gives nothing without this month', () => {
    expect(financeFromRevenue(OCT, GROW, [row('2026-09-01', 9000)]).fin_rack_rate).toBeUndefined()
  })
})

describe('rack rate, Foundation', () => {
  const F: Stint = { package_code: 'foundation', started_on: '2026-08-17' }
  it('is Yes once the stint has billed the total, counting the start month', () => {
    const s = financeFromRevenue(OCT, F, [row('2026-08-01', 3500), row('2026-09-01', 3000), row(OCT, 3500)])
    expect(s.fin_rack_rate).toEqual({
      value: 5, reason: 'From revenue: $10,000 billed since Foundation began vs $10,000 Foundation rate.',
    })
  })
  it('is Unsure while still paying in', () => {
    const s = financeFromRevenue(OCT, F, [row('2026-08-01', 3500), row('2026-09-01', 3000), row(OCT, 3499.99)])
    expect(s.fin_rack_rate?.value).toBe(3)
  })
  it('ignores months before the stint and after this month', () => {
    const s = financeFromRevenue(OCT, F, [row('2026-07-01', 50000), row(OCT, 3500), row('2026-11-01', 50000)])
    expect(s.fin_rack_rate?.value).toBe(3)
  })
  it('gives nothing without this month', () => {
    expect(financeFromRevenue(OCT, F, [row('2026-09-01', 20000)]).fin_rack_rate).toBeUndefined()
  })
})

it('gives no rack rate without a package', () => {
  expect(financeFromRevenue(OCT, null, [row(OCT, 9000)]).fin_rack_rate).toBeUndefined()
})

describe('stintFor', () => {
  const stints: Stint[] = [
    { package_code: 'foundation', started_on: '2026-02-01' },
    { package_code: 'grow', started_on: '2026-09-15' },
    { package_code: 'grow', started_on: '2026-11-01' },
  ]
  it('is the latest stint started on or before the month end', () => {
    expect(stintFor(stints, '2026-09-01')?.started_on).toBe('2026-09-15')
    expect(stintFor(stints, '2026-08-01')?.started_on).toBe('2026-02-01')
  })
  it('is null before any stint', () => {
    expect(stintFor(stints, '2026-01-01')).toBeNull()
  })
})
```

- [ ] **Step 2:** Run → FAIL (module missing).

- [ ] **Step 3: Implement** `src/checkin/financeRates.ts` (the three constants above with a header comment citing the owner, 2026-10-29: Foundation $10,000 often paid in monthly instalments; Grow $5,000/month; Scale $2,500 minimum project payments, not modelled because nothing in the data marks a Scale project) and `src/checkin/financeFromRevenue.ts`:

```ts
import { lastDayOf, previousPeriod } from '../lib/month'
import { formatMoney } from '../revenue/money'
import { FOUNDATION_RATE_CENTS, GROW_RATE_CENTS, RATE_TOLERANCE } from './financeRates'

export type RevenueRow = { period: string; retainer_cents: number; project_cents: number }
export type Stint = { package_code: string; started_on: string }
export type FinanceAnswer = { value: 1 | 3 | 5; reason: string }
export type FinanceSuggestion = { fin_rack_rate?: FinanceAnswer; fin_rate_increased?: FinanceAnswer }

const total = (row: RevenueRow) => row.retainer_cents + row.project_cents
// A stint started mid-month counts that whole month: revenue is stored per month.
const monthOf = (date: string) => `${date.slice(0, 7)}-01`

export function stintFor(stints: readonly Stint[], period: string): Stint | null {
  const end = lastDayOf(period)
  const started = stints.filter((stint) => stint.started_on <= end)
  if (started.length === 0) return null
  return started.reduce((latest, stint) => (stint.started_on > latest.started_on ? stint : latest))
}

function rateChange(period: string, rows: readonly RevenueRow[]): FinanceAnswer | undefined {
  const now = rows.find((row) => row.period === period)
  const last = rows.find((row) => row.period === previousPeriod(period))
  if (!now || !last) return undefined
  const a = total(last)
  const b = total(now)
  let value: 1 | 3 | 5
  if (a === 0) value = b > 0 ? 5 : 3
  else {
    const change = (b - a) / a
    value = Math.abs(change) <= RATE_TOLERANCE ? 3 : change > 0 ? 5 : 1
  }
  return { value, reason: `From revenue: ${formatMoney(b)} this month vs ${formatMoney(a)} last month.` }
}

function rackRate(period: string, stint: Stint | null, rows: readonly RevenueRow[]): FinanceAnswer | undefined {
  if (!stint) return undefined
  const now = rows.find((row) => row.period === period)
  if (!now) return undefined
  if (stint.package_code === 'grow') {
    const billed = total(now)
    return {
      value: billed >= GROW_RATE_CENTS ? 5 : 1,
      reason: `From revenue: ${formatMoney(billed)} billed vs ${formatMoney(GROW_RATE_CENTS)} Grow rack rate.`,
    }
  }
  if (stint.package_code === 'foundation') {
    const from = monthOf(stint.started_on)
    const billed = rows
      .filter((row) => row.period >= from && row.period <= period)
      .reduce((sum, row) => sum + total(row), 0)
    return {
      value: billed >= FOUNDATION_RATE_CENTS ? 5 : 3,
      reason: `From revenue: ${formatMoney(billed)} billed since Foundation began vs ${formatMoney(FOUNDATION_RATE_CENTS)} Foundation rate.`,
    }
  }
  return undefined
}

// Spec 2026-10-29. Two of the three Finances questions, worked out from data the
// tool already holds; "Pays on time" stays a judgement. Nothing is returned for a
// question the data cannot answer -- missing revenue, no package -- so the
// screen leaves it for the person rather than guessing.
export function financeFromRevenue(
  period: string,
  stint: Stint | null,
  rows: readonly RevenueRow[],
): FinanceSuggestion {
  const suggestion: FinanceSuggestion = {}
  const rate = rateChange(period, rows)
  if (rate) suggestion.fin_rate_increased = rate
  const rack = rackRate(period, stint, rows)
  if (rack) suggestion.fin_rack_rate = rack
  return suggestion
}
```

(Check `previousPeriod` and `lastDayOf` exist in `src/lib/month.ts` — they do. Check `src/revenue/money.ts` does not import supabase — if it does, stop and report.)

- [ ] **Step 4:** Run → PASS; full suite, tsc, lint.
- [ ] **Step 5:** Commit `feat(checkin): work out rack rate and rate change from revenue`.

---

### Task 3: Read the data; one batched edit

**Files:** Create `src/checkin/useFinanceSuggestion.ts`, `src/checkin/useFinanceSuggestion.dom.test.ts`; Modify `src/checkin/useCheckin.ts` (add `setAnswers`), `src/checkin/useCheckin.dom.test.ts`.

**Interfaces:**
- `useFinanceSuggestion(clientId: number, period: string, canReadRevenue: boolean, canReadPackages: boolean): FinanceSuggestion | null` — null until ready, and stays null on a failed read or when `canReadRevenue` is false.
- `useCheckin` gains `setAnswers(values: Record<string, number>): void` — applies all entries in ONE `applyEdit`, only for keys currently absent from `draft.answers`; a no-op (no edit dispatched) if nothing would change.

- [ ] **Step 1: Failing tests**
  - `useCheckin.dom.test.ts`: after load with a blank stored row, `setAnswers({ fin_rack_rate: 1, fin_rate_increased: 3 })` leaves BOTH in `draft.answers` (would fail with two sequential setAnswer calls); with `fin_rack_rate` already answered 5 in the form, `setAnswers({ fin_rack_rate: 1 })` leaves 5 and dispatches no edit (saveState stays `clean`).
  - `useFinanceSuggestion.dom.test.ts` with a hoisted supabase fake recording which tables were queried:
    - with both capabilities: queries `client_month_revenue` filtered `.eq('client_id', id).lte('period', period)` and `client_packages` `.eq('client_id', id)`; returns the module's result for the rows (assert one concrete value, e.g. Grow $4,000 → `fin_rack_rate.value` 1).
    - `canReadRevenue` false → returns null and queries nothing.
    - `canReadPackages` false → no `client_packages` query; rate still computed; no `fin_rack_rate`.
    - a revenue read error → null.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement**
  - `useCheckin.ts`, beside `setAnswer`:

```ts
  // Several answers in ONE edit (spec 2026-10-29, finances from revenue). Two
  // setAnswer calls in the same tick would each start from the same `draft`
  // and the second would drop the first. Only fills keys the form does not
  // already hold, so it can never overwrite what a person chose.
  const setAnswers = useCallback(
    (values: Record<string, number>) => {
      const answers: QuestionScores = { ...draft.answers }
      let changed = false
      for (const [key, value] of Object.entries(values)) {
        if (answers[key] === undefined) {
          answers[key] = value
          changed = true
        }
      }
      if (changed) applyEdit({ ...draft, answers })
    },
    [draft, applyEdit],
  )
```

  and return it. (`QuestionScores` is the type `setAnswer` already uses; match its exact name.)
  - `useFinanceSuggestion.ts`: two awaited reads in one effect with an `isCancelled` flag as `useBoard` does; `.from('client_month_revenue').select('period, retainer_cents, project_cents').eq('client_id', clientId).lte('period', period)`; when `canReadPackages`, `.from('client_packages').select('package_code, started_on').eq('client_id', clientId)`; on any error or throw set null; otherwise `financeFromRevenue(period, stintFor(stints, period), rows)`. Header comment: gated at the read, not the render, as usePackages documents.
- [ ] **Step 4:** Run → PASS; full suite, tsc, lint.
- [ ] **Step 5:** Commit `feat(checkin): read revenue for the finance answers, and fill several answers in one edit`.

---

### Task 4: On the check-in screen

**Files:** Modify `src/checkin/ChoiceRow.tsx` (optional `hint?: string`), `src/checkin/CheckIn.tsx`; Test `src/checkin/ChoiceRow.dom.test.tsx`, `src/checkin/CheckIn.dom.test.tsx`, `src/checkin/CheckIn.test.tsx` (mock `./useFinanceSuggestion`).

- [ ] **Step 1: Failing tests**
  - ChoiceRow: with `hint="From revenue: …"` the text renders as a caption (`data-testid="answer-hint"`); without it, nothing.
  - CheckIn (mock useFinanceSuggestion to return `{ fin_rack_rate: { value: 1, reason: 'R1' }, fin_rate_increased: { value: 3, reason: 'R2' } }`, mock useCheckin as the file does):
    - ready, stored answers null, form empty → `setAnswers` called ONCE with `{ fin_rack_rate: 1, fin_rate_increased: 3 }`; both reasons render under their questions.
    - stored `fin_rack_rate` 5 → `setAnswers` called with `{ fin_rate_increased: 3 }` only.
    - re-render after the person clears (draft answer removed) → `setAnswers` NOT called again.
    - suggestion null → no call, no hints.
    - not ready (loading) → no call.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement**
  - ChoiceRow: add `hint?: string` to Props and destructure; render after the "Last month" caption: `{hint && <p className="t-caption" data-testid="answer-hint">{hint}</p>}`.
  - CheckIn.tsx:

```tsx
  const finance = useFinanceSuggestion(
    client.id,
    period,
    can(profile.role, 'view_revenue'),
    can(profile.role, 'manage_clients'),
  )

  // Spec 2026-10-29: fill the two finance answers from revenue once per visit,
  // and only where neither the database nor the form holds an answer. Once,
  // because a person who clears a filled answer has decided -- refilling it on
  // the next render would overrule them.
  const prefilled = useRef<string | null>(null)
  useEffect(() => {
    if (status !== 'ready' || finance === null) return
    const visit = `${client.id}:${period}`
    if (prefilled.current === visit) return
    prefilled.current = visit
    const values: Record<string, number> = {}
    for (const key of ['fin_rack_rate', 'fin_rate_increased'] as const) {
      const answer = finance[key]
      const storedValue = stored?.[key] ?? null
      if (answer && storedValue === null && draft.answers[key] === undefined) values[key] = answer.value
    }
    if (Object.keys(values).length > 0) checkin.setAnswers(values)
  }, [status, finance, client.id, period, stored, draft.answers, checkin])
```

  (Use the names CheckIn already destructures from `useCheckin` — `status`, `stored`, `draft`; import `useEffect`/`useRef` if absent.) Pass `hint={finance?.[question.key as 'fin_rack_rate' | 'fin_rate_increased']?.reason}` to the `ChoiceRow` — only for those two keys; other questions get `undefined`.
  - Both CheckIn test files: `vi.mock('./useFinanceSuggestion', () => ({ useFinanceSuggestion: () => null }))` by default, overridable per test.
- [ ] **Step 4:** Run → PASS; full suite, tsc, lint.
- [ ] **Step 5:** Commit `feat(checkin): pre-fill rack rate and rate change from revenue, with the reason`.

---

### Task 5: Prove it

- [ ] Mutations (each alone, owning tests must FAIL, revert with an Edit — never `git checkout`):
  `<= RATE_TOLERANCE` → `<`; drop `row.period >= from &&`; `storedValue === null &&` removed; `prefilled.current === visit` guard removed; `canReadRevenue` gate removed in the hook; `setAnswers` replaced by two `setAnswer` calls in CheckIn.
- [ ] CI's command: `mv .env.local .env.local.aside && npx vitest run --exclude '**/rls.test.ts'; mv .env.local.aside .env.local`; `npm run build`.
- [ ] (controller) Expected October values on production for the owner's look: Grow — York No ($4,000), Wolfgang No ($4,000), Steep Yes ($5,000); Foundation — Polar Divide Yes ($10,500), Remi Unsure ($5,000), Bitches 'n Bubbles Unsure ($3,625), LoFli Yes ($29,000); compute rate change from the table at the time. October check-ins already have stored Finance answers, so they will show reasons but not be refilled.
