# Slice 4 Step 2 — The Check-In Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five-pillar check-in screen with the six-bucket, 22-question screen the scoring engine from step 1 already supports, and add the `started_on` field that the 90-day Advocacy gate reads.

**Architecture:** Step 1 built the rubric (`src/lib/buckets.ts`), the arithmetic (`src/lib/scoreMath.ts`, `src/lib/scoreV2.ts`), the 22 answer columns, the six generated bucket columns and the `public.checkin_scores` view. Nothing in the UI reads any of it yet. This step wires the UI to it: one new leaf module for the gate, a rewritten local draft cache, a lighter question row replacing `PillarRow`, a save-state layer counting against a variable required-answer count instead of a constant five, and a rewritten `useCheckin` that reads answers from `checkins` and the overall from the view. The screen composes six labelled sections, one shared 1–5 legend, and a disabled-but-visible Advocacy section when the gate is shut.

**Tech Stack:** React 19 + TypeScript, Vite, CSS Modules, Supabase (postgrest-js), Vitest + Testing Library, jsdom.

**Spec:** `docs/superpowers/specs/2026-08-27-phase-2-slice-4-scoring-model-design.md` — §3.3 (incompleteness), §4 (the gate), §4.4 (completeness varies), §5.1 (`started_on`), §6 (the view), §7 (the check-in screen).

**Branch:** `slice-4-scoring-model`, continuing from `99b0bf5`. Nothing on this branch is pushed, and `origin/main` is still `1ae2f97`. **Do not push.** GitHub Pages deploys on push and production is unmigrated.

---

## Global Constraints

- **Node/date arithmetic is UTC-only.** A period and a start date are both `YYYY-MM-DD` strings. Compare them as strings — that is a correct date comparison in this format and it is what Postgres's `>=` does. Never round-trip a date through a local-zone `Date`.
- **Leaf modules stay leaves.** `src/lib/scoreMath.ts` and `src/lib/buckets.ts` must have zero runtime imports; `tests/leafModules.test.ts` enforces it. Importing *from* them is fine. Adding an import *to* them breaks `npm run verify:score`.
- **No colour or typeface literals anywhere outside `src/styles/tokens.css`.** `tests/tokens.test.ts` walks every `.css`/`.ts`/`.tsx`/`.html`/`.svg` in the repo. Use `var(--…)` tokens only. This includes comments: do not write an example of the banned syntax.
- **No spacing via per-element margins.** Every gap in this codebase comes from a flex/grid container. Follow that.
- **A missing answer must never read as a low score** (§3.3). Null, never a partial mean, never zero.
- **Every on-screen count is against the required number for that client and period** — 18 gated out, 22 gated in — never a hardcoded 22 (§4.4).
- **Copy must not say "after 90 days".** The gate opens on the first check-in month beginning on or after day 90, not on day 90 itself. Copy that says otherwise is wrong.
- **`import type` for type-only imports.** The codebase uses `verbatimModuleSyntax`; a value import of a type fails lint.
- **`@testing-library/jest-dom` IS NOT INSTALLED.** Only `@testing-library/react` and `user-event` are, and there is no vitest setup file registering custom matchers. The DOM test snippets in Tasks 4, 6 and 7 below were written using jest-dom matchers by mistake — **translate them, do not install the package.** Existing DOM tests in this repo assert with plain vitest matchers only (`toContain`, `toBe`, `toMatch`, `toHaveProperty`, `toEqual`, `toHaveLength`). Translate as follows, and keep the assertion exactly as strong:

  | Snippet says | Write instead |
  |---|---|
  | `expect(el).toBeInTheDocument()` | `expect(el).not.toBeNull()` — or rely on `getBy*`, which already throws when absent |
  | `expect(el).toHaveTextContent(s)` | `expect(el.textContent).toContain(s)` |
  | `expect(el).toHaveValue(v)` | `expect((el as HTMLInputElement).value).toBe(v)` |
  | `expect(el).toHaveAttribute(a, v)` | `expect(el.getAttribute(a)).toBe(v)` |
  | `expect(el).toBeDisabled()` | `expect((el as HTMLInputElement).disabled).toBe(true)` |
  | `expect(el).toBeEnabled()` | `expect((el as HTMLInputElement).disabled).toBe(false)` |

  A weakened translation is a defect — `expect(el).not.toBeNull()` in place of a text assertion tests nothing about the text.
- **Commit after every task.** Stage explicit paths — never `git commit -a`.
- **Test baseline before you start: 566 tests / 41 files, all passing.** Run `npm test -- --run` to confirm before Task 1 and after every task.

---

## File Structure

**Created**
| File | Responsibility |
|---|---|
| `src/lib/gate.ts` | The 90-day Advocacy gate: is it open, when does it open, and what does a shut gate say. Mirrors the view's SQL predicate. |
| `src/lib/gate.test.ts` | Unit tests for the gate, including the 89/90/91-day boundary. |
| `tests/gateParity.test.ts` | Drift guard: the TS gate's constant against the literal in the migration's view. |
| `src/checkin/QuestionRow.tsx` | One question: prompt, 1–5 radios, Clear, last month. Replaces `PillarRow`. |
| `src/checkin/QuestionRow.module.css` | Its styles. `PillarRow.module.css` minus the anchor list. |
| `src/checkin/QuestionRow.dom.test.tsx` | Its DOM tests. |

**Modified**
| File | Change |
|---|---|
| `src/clients/clientForm.ts` | `started_on` through the column literal, row type, draft, payloads. |
| `src/clients/AddClientForm.tsx` | A start-date field. |
| `src/clients/EditClientForm.tsx` | A start-date field, unconditional, beside name and owner. |
| `src/clients/ClientsAdmin.tsx` | The start date on each row. |
| `src/clients/clientForm.test.ts` | Cover the above. |
| `src/clients/ClientsAdmin.dom.test.tsx` | Cover the above. |
| `src/checkin/draftCache.ts` | 22 answers instead of 5 pillars; a versioned key; old drafts discarded. |
| `src/checkin/draftCache.test.ts` | Rewritten against the new shape. |
| `src/checkin/saveState.ts` | Counts against a passed-in `required`, not `PILLARS.length`. Overall replaces total. |
| `src/checkin/saveState.test.ts` | Rewritten against the new signatures. |
| `src/checkin/useCheckin.ts` | 22 answers, the gate, the view read, the 22-column upsert. |
| `src/checkin/CheckIn.tsx` | Six sections, one legend, the gate panel, the overall out of 5. |
| `src/checkin/CheckIn.module.css` | Bucket sections, the legend, the gate note. |
| `src/checkin/CheckIn.test.tsx`, `CheckIn.dom.test.tsx` | Rewritten against the new screen. |
| `src/board/useBoard.ts` | `started_on` in the client select and in `BoardClient`. |

**Deleted**
| File | Why |
|---|---|
| `src/checkin/PillarRow.tsx`, `PillarRow.module.css`, `PillarRow.dom.test.tsx` | Replaced by `QuestionRow`. |

**Deliberately untouched**
- `src/lib/pillars.ts`, `src/lib/score.ts` — still read by `src/board/ClientCard.tsx`. They retire in step 3 with the board, alongside the `legacy_*` rename.
- `src/board/cardSummary.ts` — the board still reads the old pillar columns. Step 3.
- The migration. Step 2 adds no SQL.

---

## Known intermediate state, recorded rather than fixed

Between this step and step 3, a check-in saved through the new screen writes the 22 answer columns and leaves the retired pillar columns null. `checkins.total_score` is generated from those retired columns, so it will be null, and the board card — which still reads `total_score` — will show that check-in as "Not scored".

This is inherent to splitting the screen from the board, it exists on staging only (production is unmigrated and deploys in step 4), and it resolves the moment step 3 points the board at `checkin_scores`. Do not try to fix it here by writing both column sets: the old columns are being retired, and populating them would make the `legacy_*` rename in step 3 harder, not easier.

## The broken window: Tasks 3 through 7

**Between Task 3 and Task 7 the repository does not build, and `npm test -- --run` does not pass. This is expected. Do not try to fix it.**

The check-in screen is rewritten from the bottom up, so its layers disagree with each other until the top one lands:

- **After Task 3**, `useCheckin.ts` still reads `draft.pillars`, which `Draft` no longer has. TypeScript types are erased before vitest runs, so this is not a test failure — it is `undefined` at runtime in any test that exercises the real hook. `npm run build` fails.
- **After Task 4**, `CheckIn.tsx` imports `./PillarRow`, which no longer exists. That *is* a module-resolution failure, so **`CheckIn.test.tsx` and `CheckIn.dom.test.tsx` fail from Task 4 until Task 7 rewrites them.**

**So Tasks 3, 4, 5 and 6 run only the test files their own step lists name.** Do not run the full suite inside the window and do not run `npm run build`; both are expected to fail and neither tells you anything about the task you are on. Tasks 1 and 2 are outside the window and do run the full suite and the build.

**Task 7 Step 6 is the gate that closes the window** — the first full-suite-plus-build run since Task 2, and the one that must come back green.

---

## Task 1: `started_on` on the clients admin

The gate reads `clients.started_on` and every one of the eleven rows is currently null, so the gate is shut for every client until this ships. It is first for that reason: the owner can enter the dates while the rest of the step is built, and the check-in screen is then developed against a gate that actually opens.

Spec §5.1: "an unconditional date field beside the name and owner — no new screen, no dashboard SQL". No validation tying it to `ended_on`: the spec explicitly defers that rather than widening `clients_lifecycle_coherent`.

**Files:**
- Modify: `src/clients/clientForm.ts`
- Modify: `src/clients/AddClientForm.tsx`
- Modify: `src/clients/EditClientForm.tsx`
- Modify: `src/clients/ClientsAdmin.tsx`
- Test: `src/clients/clientForm.test.ts`, `src/clients/ClientsAdmin.dom.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `AdminClient.started_on: string | null`, `ClientDraft.startedOn: string`. Nothing later in this plan consumes them — the check-in screen gets `started_on` from the board (Task 6), not from here.

- [ ] **Step 1: Write the failing tests**

Append to `src/clients/clientForm.test.ts`:

```ts
describe('started_on', () => {
  it('is in the column literal, so the select fetches it', () => {
    expect(CLIENT_COLUMNS).toContain('started_on')
  })

  it('reaches the draft as a string, and a null row reaches it as empty', () => {
    expect(draftFromRow({ ...ROW, started_on: '2026-01-15' }).startedOn).toBe('2026-01-15')
    expect(draftFromRow({ ...ROW, started_on: null }).startedOn).toBe('')
  })

  // Null rather than an empty string, matching every other optional column on
  // this table. An empty string is not a date and the column would refuse it.
  it('is sent as null when the field is blank, and as the date when it is not', () => {
    expect(insertPayload({ ...EMPTY_DRAFT, name: 'Acme', startedOn: '' }).started_on).toBeNull()
    expect(insertPayload({ ...EMPTY_DRAFT, name: 'Acme', startedOn: '2026-01-15' }).started_on)
      .toBe('2026-01-15')
    expect(updatePayload({ ...EMPTY_DRAFT, name: 'Acme', startedOn: '' }).started_on).toBeNull()
    expect(updatePayload({ ...EMPTY_DRAFT, name: 'Acme', startedOn: '2026-01-15' }).started_on)
      .toBe('2026-01-15')
  })

  // The gate is the only thing that reads this column, and a shut gate is not a
  // refusal to save -- it is a bucket that is not scored yet. A client with no
  // start date is a normal, saveable row.
  it('is never required, whatever the status', () => {
    for (const status of CLIENT_STATUSES) {
      const draft = {
        ...EMPTY_DRAFT,
        name: 'Acme',
        status,
        startedOn: '',
        endedOn: '2026-02-01',
        endReasonCode: 'price',
      }
      expect(formProblems(draft).some((p) => p.field === 'startedOn')).toBe(false)
    }
  })
})
```

`ROW` is whatever complete `AdminClient` fixture that file already uses; if it has none, add one above the describe:

```ts
const ROW: AdminClient = {
  id: 1,
  name: 'Acme',
  owner_id: null,
  status: 'active',
  started_on: null,
  ended_on: null,
  end_reason_code: null,
  end_reason_note: null,
  updated_at: '2026-08-01T10:00:00Z',
}
```

Note `formProblems`'s `FormProblem['field']` union does not include `'startedOn'`; the test above deliberately compiles against the widened union, so widen it in Step 3 even though no problem is ever pushed with it. That keeps the field addressable if a future rule needs it and makes the "never required" assertion mean something rather than compare against an impossible value.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run src/clients/clientForm.test.ts`
Expected: FAIL — `started_on` missing from `CLIENT_COLUMNS`, `startedOn` not a property of `ClientDraft`, type errors on the `AdminClient` fixture.

- [ ] **Step 3: Widen `clientForm.ts`**

In `src/clients/clientForm.ts`, make these five edits.

`CLIENT_COLUMNS` — add the column:

```ts
export const CLIENT_COLUMNS =
  'id, name, owner_id, status, started_on, ended_on, end_reason_code, end_reason_note, updated_at'
```

`AdminClient` — add the field, after `status`:

```ts
  // Read by the 90-day Advocacy gate (spec §4), which lives on the check-in
  // screen rather than here. This screen is only where it is entered: the gate
  // is shut for every client whose start date is null, so an empty column here
  // is why a whole bucket is unscored two screens away.
  started_on: string | null
```

`ClientDraft` and `EMPTY_DRAFT` — add `startedOn`, after `status`:

```ts
  startedOn: string
```
```ts
  startedOn: '',
```

`draftFromRow` — add the translation, after `status`:

```ts
    startedOn: row.started_on ?? '',
```

`FormProblem` — widen the union:

```ts
export type FormProblem = {
  field: 'name' | 'status' | 'startedOn' | 'endedOn' | 'endReasonCode'
  text: string
}
```

`insertPayload` — add the key, and update its comment. The existing comment says the lifecycle columns are "absent rather than null so a future edit that wants to send one has to add the key and notice this comment". This is that edit:

```ts
// Status is fixed at 'active' and the two end-reason columns and the end date
// are absent entirely, not sent as nulls. Spec §7: "the form does not offer a
// churned status on creation, because a client who has already left is not
// something anybody needs to add."
//
// started_on is the exception, and it is sent explicitly. It is not a lifecycle
// column -- clients_lifecycle_coherent constrains ended_on and the two reason
// columns only, and says nothing about a start date -- and a client being added
// is exactly the moment somebody knows when the engagement began. Sent as null
// rather than omitted when blank, because the value being absent is itself the
// thing the gate reads.
export function insertPayload(draft: ClientDraft) {
  return {
    name: draft.name.trim(),
    owner_id: draft.ownerId,
    status: 'active',
    started_on: draft.startedOn === '' ? null : draft.startedOn,
  }
}
```

`updatePayload` — add the same key beside the others:

```ts
    started_on: draft.startedOn === '' ? null : draft.startedOn,
```

Add nothing to `formProblems`. The spec defers the coherence rule, so this screen does not invent one.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run src/clients/clientForm.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing DOM test**

Append to `src/clients/ClientsAdmin.dom.test.tsx`, following whatever render helper and `useClients` mock that file already uses:

```tsx
it('offers a start date on the add form and sends it', async () => {
  const { addClient } = renderAdmin()
  await userEvent.type(screen.getByLabelText('Name'), 'Acme')
  await userEvent.type(screen.getByLabelText('Start date'), '2026-01-15')
  await userEvent.click(screen.getByRole('button', { name: 'Add client' }))
  expect(addClient).toHaveBeenCalledWith(
    expect.objectContaining({ startedOn: '2026-01-15' }),
  )
})

it('offers a start date on the edit form, whatever the status', async () => {
  renderAdmin({ clients: [{ ...ROW, status: 'active', started_on: '2026-01-15' }] })
  await userEvent.click(screen.getByRole('button', { name: 'Edit Acme' }))
  expect(screen.getByLabelText('Client start date')).toHaveValue('2026-01-15')
})

// The list is where the owner checks eleven dates at a glance without opening
// eleven forms, and "no start date" has to be visible rather than blank --
// a blank reads as a rendering gap, and it is the reason a whole bucket is
// unscored.
it('says on the row when a client has no start date', () => {
  renderAdmin({ clients: [{ ...ROW, started_on: null }] })
  expect(screen.getByTestId('client-started')).toHaveTextContent(
    'No start date — Advocacy is not scored',
  )
})

it('shows the start date on the row when there is one', () => {
  renderAdmin({ clients: [{ ...ROW, started_on: '2026-01-15' }] })
  expect(screen.getByTestId('client-started')).toHaveTextContent('Started 2026-01-15')
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- --run src/clients/ClientsAdmin.dom.test.tsx`
Expected: FAIL — no element labelled "Start date", no `client-started` testid.

- [ ] **Step 7: Add the fields and the row line**

In `src/clients/AddClientForm.tsx`, after the Owner field block:

```tsx
      <div className={styles.fieldBlock}>
        <label className="t-label" htmlFor="add-client-started">
          Start date
        </label>
        <input
          className="field"
          disabled={saving}
          id="add-client-started"
          onChange={(event) => edit({ ...draft, startedOn: event.target.value })}
          type="date"
          value={draft.startedOn}
        />
        {/* Optional, and the consequence of leaving it blank is stated here
            rather than discovered two screens away on a check-in whose
            Advocacy section is shut with no explanation the person who added
            the client would recognise. */}
        <p className="t-caption prose">
          Optional. Advocacy is not scored until a client has a start date.
        </p>
      </div>
```

In `src/clients/EditClientForm.tsx`, after the Client owner field block and **before** the Status block — unconditional, so it is beside name and owner rather than inside the churned branch:

```tsx
      <div className={styles.fieldBlock}>
        {/* "Client start date", not "Start date": the add form uses "Start
            date" and both forms can be on screen at once, so an identical
            label would announce as two indistinguishable date fields and make
            getByLabelText('Start date') ambiguous. Matches the existing
            "Client name" / "Name" and "Client owner" / "Owner" asymmetry. */}
        <label className="t-label" htmlFor="edit-client-started">
          Client start date
        </label>
        <input
          className="field"
          disabled={saving}
          id="edit-client-started"
          onChange={(event) => edit({ ...draft, startedOn: event.target.value })}
          type="date"
          value={draft.startedOn}
        />
        <p className="t-caption prose">
          Advocacy is not scored until a client has a start date, and then only
          from the first check-in month beginning 90 days after it.
        </p>
      </div>
```

In `src/clients/ClientsAdmin.tsx`, after the `ownerText` line and before the churned block:

```tsx
              <p className="t-caption" data-testid="client-started">
                {client.started_on === null
                  ? 'No start date — Advocacy is not scored'
                  : `Started ${client.started_on}`}
              </p>
```

The raw `YYYY-MM-DD` is deliberate. `formatSavedAt` is for timestamps and would parse this as UTC midnight and print the day before in a western zone — the exact class of bug the gate is sensitive to.

- [ ] **Step 8: Run the full suite**

Run: `npm test -- --run`
Expected: PASS, count above the 566 baseline.

- [ ] **Step 9: Build and lint**

Run: `npm run build && npm run lint`
Expected: both clean. The build is what proves `CLIENT_COLUMNS` names a real column — supabase-js infers the row type from that literal.

- [ ] **Step 10: Commit**

```bash
git add src/clients/clientForm.ts src/clients/AddClientForm.tsx src/clients/EditClientForm.tsx src/clients/ClientsAdmin.tsx src/clients/clientForm.test.ts src/clients/ClientsAdmin.dom.test.tsx
git commit -m "feat(clients): enter a client's start date, which the Advocacy gate reads"
```

---

## Task 2: The 90-day gate, in TypeScript

`public.checkin_scores.advocacy_applies` answers this for a check-in that exists. The screen needs the answer for one that does not yet — a fresh month with no row — so the predicate has to exist in TypeScript too. Two copies of one rule is a drift risk, and the parity test in Step 5 is the whole mitigation, the same bargain `tests/clientFormDrift.test.ts` strikes for the status lists.

The view's predicate, verbatim from `supabase/migrations/20260827192720_six_bucket_scoring.sql`:

```sql
(c.started_on is not null and ch.period >= c.started_on + 90)
```

**Files:**
- Create: `src/lib/gate.ts`
- Test: `src/lib/gate.test.ts`, `tests/gateParity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `GATE_DAYS: number` (90)
  - `advocacyApplies(startedOn: string | null, period: string): boolean`
  - `advocacyOpensAt(startedOn: string): string` — the first period on or after day 90, as `YYYY-MM-DD`
  - `type AdvocacyGate = { open: true } | { open: false; reason: string }`
  - `advocacyGate(startedOn: string | null, period: string): AdvocacyGate`

  Tasks 5, 6 and 7 all consume `advocacyApplies`; Task 7 consumes `advocacyGate`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/gate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { GATE_DAYS, advocacyApplies, advocacyGate, advocacyOpensAt } from './gate'

describe('advocacyApplies', () => {
  it('is shut when there is no start date', () => {
    expect(advocacyApplies(null, '2026-08-01')).toBe(false)
  })

  // The boundary, fixed at a period and varied by start date -- the same
  // arithmetic scripts/verify-scoring-view.sql §1 exercises, and the same
  // reason: because a period is always the first of a month, varying the
  // period cannot land on day 90 at all.
  //
  // 2026-04-01 minus 90 days is 2026-01-01. So:
  it('is shut at 89 days and open at exactly 90', () => {
    expect(advocacyApplies('2026-01-02', '2026-04-01')).toBe(false) // 89 days
    expect(advocacyApplies('2026-01-01', '2026-04-01')).toBe(true) //  90 days
    expect(advocacyApplies('2025-12-31', '2026-04-01')).toBe(true) //  91 days
  })

  it('crosses a year boundary correctly', () => {
    expect(advocacyApplies('2025-11-01', '2026-01-01')).toBe(false) // 61 days
    expect(advocacyApplies('2025-11-01', '2026-02-01')).toBe(true) //  92 days
  })

  // February 2028 has 29 days. Constructed so a naive 3-months-not-90-days
  // implementation would disagree.
  it('counts days, not months, across a leap February', () => {
    expect(advocacyApplies('2027-12-03', '2028-03-01')).toBe(false) // 89 days
    expect(advocacyApplies('2027-12-02', '2028-03-01')).toBe(true) //  90 days
  })
})

describe('advocacyOpensAt', () => {
  // The fact the owner most needs and the one most likely to be got wrong: the
  // gate does NOT open on day 90. A period is the first of a month, so it opens
  // on the first month beginning on or after day 90.
  it('rounds up to the first of the following month when day 90 is mid-month', () => {
    // 2026-01-15 + 90 days = 2026-04-15, so April is shut and May is the first
    // month that begins on or after it.
    expect(advocacyOpensAt('2026-01-15')).toBe('2026-05-01')
  })

  it('does not round up when day 90 is itself the first of a month', () => {
    // 2026-01-01 + 90 days = 2026-04-01 exactly.
    expect(advocacyOpensAt('2026-01-01')).toBe('2026-04-01')
  })

  it('agrees with advocacyApplies at the month it names', () => {
    for (const start of ['2026-01-15', '2026-01-01', '2025-12-31', '2026-02-28']) {
      const opens = advocacyOpensAt(start)
      expect(advocacyApplies(start, opens)).toBe(true)
      // ...and the month before it is shut.
      const [y, m] = opens.split('-').map(Number)
      const before = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}-01`
      expect(advocacyApplies(start, before)).toBe(false)
    }
  })
})

describe('advocacyGate', () => {
  it('is open with no reason once the gate applies', () => {
    expect(advocacyGate('2026-01-01', '2026-04-01')).toEqual({ open: true })
  })

  // Both shut reasons must be distinguishable, and neither may say "after 90
  // days" flatly -- the gate opens on a month, not on a day.
  it('names the missing start date as the reason', () => {
    const gate = advocacyGate(null, '2026-08-01')
    expect(gate.open).toBe(false)
    if (gate.open) return
    expect(gate.reason).toContain('start date')
    expect(gate.reason).not.toContain('90 days after')
  })

  it('names the month the gate opens when the client is inside their first 90 days', () => {
    const gate = advocacyGate('2026-01-15', '2026-03-01')
    expect(gate.open).toBe(false)
    if (gate.open) return
    expect(gate.reason).toContain('May 2026')
  })

  it('never returns an empty reason when shut', () => {
    for (const [start, period] of [
      [null, '2026-08-01'],
      ['2026-01-15', '2026-03-01'],
      ['2026-08-01', '2026-08-01'],
    ] as const) {
      const gate = advocacyGate(start, period)
      expect(gate.open).toBe(false)
      if (gate.open) continue
      expect(gate.reason.trim().length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --run src/lib/gate.test.ts`
Expected: FAIL — `Cannot find module './gate'`.

- [ ] **Step 3: Write `src/lib/gate.ts`**

```ts
import { formatPeriod } from './month'

// The 90-day Advocacy gate, spec §4. This is the second copy of a rule that
// also lives in SQL, as the predicate on public.checkin_scores.advocacy_applies:
//
//   (c.started_on is not null and ch.period >= c.started_on + 90)
//
// Two copies exist because the view can only answer for a check-in that already
// has a row, and this screen has to answer for a month nobody has scored yet --
// which is every month, the first time somebody opens it. tests/gateParity.test.ts
// is the entire mitigation for the duplication: it reads the number out of the
// migration and asserts it is the number below.
export const GATE_DAYS = 90

// Both arguments are YYYY-MM-DD, which is what a Postgres `date` renders as and
// what checkins.period stores. Two such strings compare correctly with `>=` as
// strings, which is why nothing here parses a date to compare one -- a Date
// parsed from a bare YYYY-MM-DD is UTC midnight, and in any western zone its
// local calendar day is the day before, which would move the gate by a day for
// half the year and pass every test written in UTC.
function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  // Date.UTC normalises the month and year rollover, and toISOString reads the
  // same UTC fields back out, so the round trip has no zone in it.
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10)
}

export function advocacyApplies(startedOn: string | null, period: string): boolean {
  // §4.3: a null start date excludes Advocacy. Not "assume they are old enough"
  // -- an unknown tenure scoring a bucket about referrals and case studies would
  // put a number on the board that nobody has grounds for.
  if (startedOn === null) return false
  return period >= addDays(startedOn, GATE_DAYS)
}

// The first period at which the gate opens: day 90, rounded UP to the first of a
// month. §4.2 and the fact the owner most needs -- a client who started on the
// 15th is not gated in on day 90, because a check-in covers a whole month and
// the month containing day 90 began before it.
export function advocacyOpensAt(startedOn: string): string {
  const ninety = addDays(startedOn, GATE_DAYS)
  const [year, month, date] = ninety.split('-').map(Number)
  // Already the first of a month: that month is the answer. Otherwise the next
  // one. Date.UTC handles month 13 rolling into January.
  const first = new Date(Date.UTC(year, month - 1 + (date === 1 ? 0 : 1), 1))
  return first.toISOString().slice(0, 10)
}

export type AdvocacyGate = { open: true } | { open: false; reason: string }

// What the screen says, decided here rather than as a ternary in JSX, for the
// reason clientForm.ts states for its own sentences: what the screen SAYS is a
// decision, and decisions are testable without a browser.
//
// §7: the shut section is shown rather than hidden "so the scorer learns the
// bucket exists", which means the reason has to be worth reading. The two shut
// cases are genuinely different -- one is a missing fact somebody can go and
// enter, the other is a client who is simply new -- and telling them apart is
// the difference between a fixable omission and a wait.
export function advocacyGate(startedOn: string | null, period: string): AdvocacyGate {
  if (advocacyApplies(startedOn, period)) return { open: true }

  if (startedOn === null) {
    return {
      open: false,
      reason:
        'This client has no start date, so Advocacy is not scored and this ' +
        'check-in is scored out of the other 18 questions. Adding the date on ' +
        'the client admin screen opens this section.',
    }
  }

  return {
    open: false,
    reason:
      `This client is still inside their first ${GATE_DAYS} days, so Advocacy ` +
      `is not scored yet and this check-in is scored out of the other 18 ` +
      `questions. It opens with the ${formatPeriod(advocacyOpensAt(startedOn))} ` +
      `check-in — a check-in covers a whole month, so the gate opens with the ` +
      `first month that begins on or after day ${GATE_DAYS}, not on day ` +
      `${GATE_DAYS} itself.`,
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- --run src/lib/gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the parity test**

Create `tests/gateParity.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GATE_DAYS } from '../src/lib/gate.ts'

// The TypeScript gate against the SQL one. Two copies of a rule exist because
// the view can only answer for a check-in that has a row and the screen must
// answer for one that does not; this file is what keeps them from drifting --
// the same bargain, and the same remedy, as tests/clientFormDrift.test.ts.
//
// What this does NOT prove: that Postgres actually evaluates the predicate this
// way. That is `npm run verify:scoring-view`, which exercises the real view
// against the 89/90/91-day boundary on a live database.
const MIGRATIONS = 'supabase/migrations'

function migration(suffix: string): string {
  const names = readdirSync(MIGRATIONS).filter((name) => name.endsWith(suffix))
  expect(names, `migrations ending in ${suffix}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

describe('the screen agrees with the view about the gate', () => {
  const sql = migration('_six_bucket_scoring.sql')

  it('uses the same number of days the view adds to started_on', () => {
    const matches = [...sql.matchAll(/started_on\s*\+\s*(\d+)/g)].map((m) => Number(m[1]))
    // A positive count first, so a regex that matched nothing cannot read as
    // agreement. This project has shipped one check that reported success by
    // finding no data.
    expect(matches.length).toBeGreaterThan(0)
    for (const days of matches) expect(days).toBe(GATE_DAYS)
  })

  // `>=`, not `>`. The difference is one day at the boundary, it is invisible in
  // every test that does not sit exactly on it, and gate.test.ts pins the
  // TypeScript side of the same boundary.
  it('compares the period inclusively, as the TypeScript gate does', () => {
    expect(sql).toMatch(/period\s*>=\s*c\.started_on\s*\+\s*90/)
  })
})
```

- [ ] **Step 6: Run it to verify it passes, then prove it can fail**

Run: `npm test -- --run tests/gateParity.test.ts`
Expected: PASS.

Then temporarily change `GATE_DAYS` to `89` in `src/lib/gate.ts`, re-run, and confirm the first test FAILS with `expected 90 to be 89`. **Restore `90`** and re-run to confirm PASS. A verifier nobody has watched fail is a verifier nobody has verified — this project's own rule.

- [ ] **Step 7: Run the full suite, build and lint**

Run: `npm test -- --run && npm run build && npm run lint`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/gate.ts src/lib/gate.test.ts tests/gateParity.test.ts
git commit -m "feat(score): the 90-day Advocacy gate in TypeScript, pinned to the view's SQL"
```

---

## Task 3: The draft cache, 22 answers wide and versioned

`draftCache` stores a partial check-in in `localStorage`. Its stored shape changes from five pillar keys to 22 question keys, and §7 is explicit that a stale draft must be **rejected, not migrated**: restoring one would populate the new form with values from retired pillars, which is a value meaning one thing being read as though it means another.

**Files:**
- Modify: `src/checkin/draftCache.ts`
- Test: `src/checkin/draftCache.test.ts` (rewrite)

**Interfaces:**
- Consumes: `ALL_QUESTIONS` from `src/lib/buckets.ts`; `MAX_SCORE`, `MIN_SCORE` from `src/lib/scoreMath.ts`.
- Produces:
  - `type QuestionScores = Partial<Record<string, number>>`
  - `type Draft = { answers: QuestionScores; notes: string }`
  - `EMPTY_DRAFT: Draft`
  - `DRAFT_KEY_PREFIX`, `DRAFT_VERSION`, `draftKey(clientId, period): string`
  - `readDraft`, `writeDraft`, `clearDraft`, `isDraftEmpty`, `draftsDiffer` — same signatures as today, `Draft` reshaped.

  `QuestionScores` is assignable to `scoreV2.Answers` (`Partial<Record<string, number | null>>`), so Task 6 can pass `draft.answers` straight into `overallScore` and `answeredCount`.

- [ ] **Step 1: Write the failing tests**

Rewrite `src/checkin/draftCache.test.ts`. Keep every existing test's *intent* — the storage-throws cases, the untrusted-JSON cases, the write-returns-honesty case — and retarget them at `answers`. The genuinely new tests:

```ts
import { describe, expect, it } from 'vitest'
import { ALL_QUESTIONS } from '../lib/buckets'
import {
  DRAFT_KEY_PREFIX,
  DRAFT_VERSION,
  EMPTY_DRAFT,
  clearDraft,
  draftKey,
  draftsDiffer,
  isDraftEmpty,
  readDraft,
  writeDraft,
  type StorageLike,
} from './draftCache'

function memoryStore(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  const store: StorageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
  return { store, map }
}

describe('the versioned key', () => {
  it('carries a version segment, so a v1 draft can never be read as a v2 one', () => {
    expect(draftKey(7, '2026-08-01')).toBe(`${DRAFT_KEY_PREFIX}:${DRAFT_VERSION}:7:2026-08-01`)
    expect(DRAFT_VERSION).not.toBe('')
  })

  // §7: rejected rather than migrated. A v1 draft holds `pillars`, whose five
  // keys are retired columns; restoring it would put values from a different
  // rubric into this form and call them this month's answers.
  it('ignores a v1 draft entirely', () => {
    const legacyKey = `${DRAFT_KEY_PREFIX}:7:2026-08-01`
    const { store } = memoryStore({
      [legacyKey]: JSON.stringify({ pillars: { relationship: 4, delivery: 5 }, notes: 'hi' }),
    })
    expect(readDraft(7, '2026-08-01', store)).toBeNull()
  })

  // Discarded, not merely ignored. An ignored key sits in a quota that this
  // file's header records as exhaustible, forever, for a value nothing will
  // ever read again.
  it('deletes the v1 draft it found, so it stops occupying the quota', () => {
    const legacyKey = `${DRAFT_KEY_PREFIX}:7:2026-08-01`
    const { store, map } = memoryStore({
      [legacyKey]: JSON.stringify({ pillars: { relationship: 4 }, notes: '' }),
    })
    readDraft(7, '2026-08-01', store)
    expect(map.has(legacyKey)).toBe(false)
  })

  it('discarding a v1 draft cannot throw out of readDraft', () => {
    const store: StorageLike = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error('quota')
      },
    }
    expect(() => readDraft(7, '2026-08-01', store)).not.toThrow()
  })
})

describe('the 22 answers', () => {
  it('round-trips every question key the rubric defines', () => {
    const answers = Object.fromEntries(ALL_QUESTIONS.map((key, index) => [key, (index % 5) + 1]))
    const { store } = memoryStore()
    expect(writeDraft(7, '2026-08-01', { answers, notes: '' }, store)).toBe(true)
    expect(readDraft(7, '2026-08-01', store)?.answers).toEqual(answers)
  })

  // The stray-key case. A draft is arbitrary JSON from the origin, and a key
  // that is not in the rubric would reach the upsert as a column that does not
  // exist -- a whole-save failure caused by a value nobody typed.
  it('drops a key the rubric does not define', () => {
    const { store } = memoryStore({
      [draftKey(7, '2026-08-01')]: JSON.stringify({
        answers: { comm_timely: 3, relationship: 4, not_a_question: 5 },
        notes: '',
      }),
    })
    expect(readDraft(7, '2026-08-01', store)?.answers).toEqual({ comm_timely: 3 })
  })

  it.each([0, 6, 2.5, Number.NaN, '3', null])('drops the out-of-range value %p', (bad) => {
    const { store } = memoryStore({
      [draftKey(7, '2026-08-01')]: JSON.stringify({
        answers: { comm_timely: 3, comm_constructive: bad },
        notes: '',
      }),
    })
    expect(readDraft(7, '2026-08-01', store)?.answers).toEqual({ comm_timely: 3 })
  })
})

describe('draftsDiffer', () => {
  it('is false for two drafts that differ only in key order', () => {
    const a = { answers: { comm_timely: 3, del_on_time: 4 }, notes: 'x' }
    const b = { answers: { del_on_time: 4, comm_timely: 3 }, notes: 'x ' }
    expect(draftsDiffer(a, b)).toBe(false)
  })

  it('is true when any one of the 22 differs', () => {
    for (const key of ALL_QUESTIONS) {
      expect(draftsDiffer({ answers: {}, notes: '' }, { answers: { [key]: 3 }, notes: '' })).toBe(true)
    }
  })
})

describe('isDraftEmpty', () => {
  it('is true for the empty draft', () => {
    expect(isDraftEmpty(EMPTY_DRAFT)).toBe(true)
  })

  it('is false once any answer or note is present', () => {
    expect(isDraftEmpty({ answers: { comm_timely: 1 }, notes: '' })).toBe(false)
    expect(isDraftEmpty({ answers: {}, notes: 'x' })).toBe(false)
  })
})
```

Also retain, retargeted from the current file: `writeDraft` returning `false` when the store throws; `writeDraft` removing rather than storing an empty draft and returning `true`; `readDraft` returning `null` for unparseable JSON, for a non-object, and for a draft that normalises to empty; `clearDraft` swallowing a throwing `removeItem`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- --run src/checkin/draftCache.test.ts`
Expected: FAIL — `DRAFT_VERSION` not exported, `Draft.answers` not a property.

- [ ] **Step 3: Rewrite `src/checkin/draftCache.ts`**

Keep the file's existing header comment (the two things a reviewer should check — storage is optional, everything read back is untrusted) and add the version paragraph. The changed parts:

```ts
import { ALL_QUESTIONS } from '../lib/buckets'
import { MAX_SCORE, MIN_SCORE } from '../lib/scoreMath'

// … existing header comment, then:
//
// Third, the stored shape is VERSIONED, as of the six-bucket model. A v1 draft
// holds `pillars`, whose five keys are columns being retired. Restoring one into
// this form would present values from a different rubric as this month's
// answers, which is the same failure class as reading a value that means one
// thing as though it meant another. So the key carries a version segment, a v1
// key can never be read as a v2 one, and readDraft deletes any v1 key it passes
// -- rejected rather than migrated, spec §7.

// Absent, not null: an unanswered question has no key. Everything downstream
// counts on that -- normaliseAnswers builds on it, and scoreV2.answeredCount
// treats undefined and null alike so either would be safe there, but the upsert
// in useCheckin spreads the rubric rather than the object's own keys and would
// not notice a null.
export type QuestionScores = Partial<Record<string, number>>
export type Draft = { answers: QuestionScores; notes: string }

export const EMPTY_DRAFT: Draft = { answers: {}, notes: '' }
export const DRAFT_KEY_PREFIX = 'checkin-draft'
export const DRAFT_VERSION = 'v2'

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function draftKey(clientId: number, period: string): string {
  return `${DRAFT_KEY_PREFIX}:${DRAFT_VERSION}:${clientId}:${period}`
}

// The unversioned key v1 wrote. Only readDraft knows it, and only to delete it.
function legacyDraftKey(clientId: number, period: string): string {
  return `${DRAFT_KEY_PREFIX}:${clientId}:${period}`
}

function isQuestion(key: string): boolean {
  return ALL_QUESTIONS.includes(key)
}

function validAnswer(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_SCORE &&
    value <= MAX_SCORE
  )
}

// The one place invalid entries get dropped, shared by readDraft (untrusted JSON
// from storage) and writeDraft (a caller-supplied Draft that can still hold an
// invalid value). Sharing it keeps the two paths from disagreeing about what
// counts as a valid answer, which is what let writeDraft report success for a
// draft that would come back empty.
function normaliseAnswers(source: unknown): QuestionScores {
  const answers: QuestionScores = {}
  if (typeof source === 'object' && source !== null) {
    for (const [key, value] of Object.entries(source)) {
      if (isQuestion(key) && validAnswer(value)) answers[key] = value
    }
  }
  return answers
}

export function isDraftEmpty(draft: Draft): boolean {
  return Object.keys(draft.answers).length === 0 && draft.notes.trim() === ''
}
```

`readDraft` — same body as today, with the legacy discard first and `answers` in place of `pillars`:

```ts
export function readDraft(
  clientId: number,
  period: string,
  store: StorageLike | null = defaultStorage(),
): Draft | null {
  if (!store) return null

  // Before anything else, and its own try/catch: a throwing removeItem must not
  // stop this month's real draft from being read. Nothing depends on the
  // deletion succeeding -- a surviving v1 key is still unreadable, because
  // draftKey can no longer name it.
  try {
    store.removeItem(legacyDraftKey(clientId, period))
  } catch {
    // Nothing to do and nothing to say.
  }

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

  const source = parsed as { answers?: unknown; notes?: unknown }
  const answers = normaliseAnswers(source.answers)
  const notes = typeof source.notes === 'string' ? source.notes : ''
  const draft: Draft = { answers, notes }

  // An empty draft is not a draft. Returning one would let it win over the
  // stored row on load and blank a real check-in.
  return isDraftEmpty(draft) ? null : draft
}
```

`writeDraft` and `clearDraft` — unchanged in structure; `normalisePillars` becomes `normaliseAnswers`, `pillars` becomes `answers`. Keep both existing comments verbatim, they still describe what the code does.

`draftsDiffer` — iterate the rubric:

```ts
// Compared key by key over ALL_QUESTIONS rather than by stringifying, because
// JSON.stringify is order-sensitive and would call two identical drafts
// different -- which would raise the "you have unsaved changes" warning on every
// load. Notes are trimmed for the same reason: a textarea's trailing newline is
// not a change the person made.
export function draftsDiffer(a: Draft, b: Draft): boolean {
  if (a.notes.trim() !== b.notes.trim()) return true
  for (const key of ALL_QUESTIONS) {
    if ((a.answers[key] ?? null) !== (b.answers[key] ?? null)) return true
  }
  return false
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- --run src/checkin/draftCache.test.ts`
Expected: PASS. `useCheckin.ts` and `CheckIn.tsx` will not compile yet — they are Tasks 6 and 7. `npm test` runs vitest, not tsc, so the suite still runs.

- [ ] **Step 5: Commit**

```bash
git add src/checkin/draftCache.ts src/checkin/draftCache.test.ts
git commit -m "feat(checkin): the draft cache holds 22 answers, and rejects v1 drafts"
```

The build is deliberately not run here — `useCheckin.ts` still reads `draft.pillars` and will not typecheck until Task 6. Task 6's build step is where the tree comes back to green.

---

## Task 4: `QuestionRow` replaces `PillarRow`

Twenty-two of these stack on one screen, so the row gets lighter than `PillarRow` was. Three things go, and each has a reason:

- **The three written anchors.** §7: "the scale gets one legend, not 66 anchors." Twenty-two questions times three anchors is 66 pieces of copy the owner's boss has not written. The questions are already specific statements, so one shared agreement legend carries them. The legend is rendered once by `CheckIn` (Task 7), not per row.
- **The hint line.** `buckets.ts`'s `Question` has `key` and `prompt` only — there is no hint to render.
- **The card chrome.** The bucket section becomes the bordered card; a question inside it is a plain row. Twenty-two bordered cards is a scroll, not a screen.

Everything else is kept **exactly**, including the two behaviours that were bug fixes: `flushSync` before moving focus on Clear, and the `.face`/`.input` sibling structure that keeps native radio semantics.

**Files:**
- Create: `src/checkin/QuestionRow.tsx`, `src/checkin/QuestionRow.module.css`, `src/checkin/QuestionRow.dom.test.tsx`
- Delete: `src/checkin/PillarRow.tsx`, `src/checkin/PillarRow.module.css`, `src/checkin/PillarRow.dom.test.tsx`

**Interfaces:**
- Consumes: `Question` from `src/lib/buckets.ts`; `SCORE_VALUES` from `src/lib/scoreMath.ts`.
- Produces:

```ts
type Props = {
  question: Question
  value: number | undefined
  lastValue: number | null
  disabled: boolean
  onChange: (value: number) => void
  onClear: () => void
}
export function QuestionRow(props: Props): JSX.Element
```

  Task 7 renders it.

- [ ] **Step 1: Move the files, preserving history**

```bash
git mv src/checkin/PillarRow.tsx src/checkin/QuestionRow.tsx
git mv src/checkin/PillarRow.module.css src/checkin/QuestionRow.module.css
git mv src/checkin/PillarRow.dom.test.tsx src/checkin/QuestionRow.dom.test.tsx
```

- [ ] **Step 2: Write the failing test**

Rewrite `src/checkin/QuestionRow.dom.test.tsx`. Carry every behavioural test the `PillarRow` version had — five radios, checked reflects `value`, `onChange` fires with the score, Clear only renders when there is a value, Clear moves focus to the first radio, disabled disables everything, "No score last month" versus a last value — retargeted at the new props. Add:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { QuestionRow } from './QuestionRow'

const QUESTION = { key: 'comm_timely', prompt: 'Provides timely feedback.' }

function renderRow(overrides: Partial<Parameters<typeof QuestionRow>[0]> = {}) {
  const onChange = vi.fn()
  const onClear = vi.fn()
  render(
    <QuestionRow
      question={QUESTION}
      value={undefined}
      lastValue={null}
      disabled={false}
      onChange={onChange}
      onClear={onClear}
      {...overrides}
    />,
  )
  return { onChange, onClear }
}

it('names the group by its prompt, so 22 groups on one screen are distinguishable', () => {
  renderRow()
  expect(screen.getByRole('radiogroup', { name: 'Provides timely feedback.' })).toBeInTheDocument()
})

// The radios are grouped by `name`. Two questions sharing one would make a
// single group of ten across the whole screen -- picking a Delivery score would
// silently unpick a Communication one.
it('scopes its radio name to the question key', () => {
  renderRow()
  for (const radio of screen.getAllByRole('radio')) {
    expect(radio).toHaveAttribute('name', 'question-comm_timely')
  }
})

// §7: one legend for the screen, not three anchors per question. 66 pieces of
// copy nobody has written is what this row is not carrying.
it('renders no per-question anchor list', () => {
  const { container } = render(
    <QuestionRow
      question={QUESTION}
      value={3}
      lastValue={null}
      disabled={false}
      onChange={() => {}}
      onClear={() => {}}
    />,
  )
  expect(container.querySelector('dl')).toBeNull()
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- --run src/checkin/QuestionRow.dom.test.tsx`
Expected: FAIL — `QuestionRow` is not exported (the file still exports `PillarRow`).

- [ ] **Step 4: Rewrite `src/checkin/QuestionRow.tsx`**

```tsx
import { useRef } from 'react'
import { flushSync } from 'react-dom'
import { SCORE_VALUES } from '../lib/scoreMath'
import type { Question } from '../lib/buckets'
import styles from './QuestionRow.module.css'

type Props = {
  question: Question
  value: number | undefined
  lastValue: number | null
  disabled: boolean
  onChange: (value: number) => void
  onClear: () => void
}

// One question. Lighter than the PillarRow it replaces: no hint (buckets.ts's
// Question carries a prompt and nothing else) and no per-question anchors (§7 --
// one legend for the screen, because 22 questions times three anchors is 66
// pieces of copy nobody has written, and the questions are already specific
// statements). The bucket section is the bordered card; this is a plain row
// inside it, because 22 bordered cards is a scroll rather than a screen.
export function QuestionRow({ question, value, lastValue, disabled, onChange, onClear }: Props) {
  // Derived from the question key so they are unique on a page rendering 22 of
  // these, and stable across renders.
  const labelId = `question-${question.key}-label`

  // Clear's button unmounts the instant it fires (it only renders while
  // value !== undefined), taking focus with it. An element detached while
  // focused hands focus to <body>, so without somewhere to send it the very
  // next Tab would restart at the top of the document instead of continuing in
  // this row. The first radio is never unmounted, so it is always a valid
  // target, and it is where the person is likely headed next: they just cleared
  // a score and the next move is to pick a different one.
  const firstRadio = useRef<HTMLInputElement>(null)

  function handleClear() {
    // flushSync, because the ORDER matters and the default order is wrong.
    // onClear() only queues the parent's state update, so without this the
    // focus() below runs while the cleared score is still checked in the DOM.
    // Browsers anchor a radio group's tab order to its checked radio, so the
    // group ends up anchored to a radio that is about to be unchecked, and the
    // next Tab stops on the score that was just cleared before leaving the row
    // -- reported by the owner, and confirmed by a test that reads which radios
    // are checked at the instant focus arrives.
    flushSync(() => {
      onClear()
    })
    firstRadio.current?.focus()
  }

  return (
    // A plain section with role="radiogroup", not a fieldset. A fieldset would
    // give the disabled cascade for free, but <legend> ignores parts of normal
    // layout and the workarounds are exactly the kind of thing that looks fine
    // in review and wrong on the deployed page. The inputs share a `name`, so
    // arrow-key navigation and the "3 of 5" announcement come from the native
    // radios either way.
    <section className={styles.row}>
      {/* The prompt is the group's accessible name. On a screen with 22 of
          these, a group named anything less specific is unnavigable. */}
      <p className="t-body" id={labelId}>
        {question.prompt}
      </p>

      <div className={styles.scale} role="radiogroup" aria-labelledby={labelId}>
        <div className={styles.options}>
          {SCORE_VALUES.map((score) => (
            <label className={styles.option} key={score}>
              <input
                ref={score === SCORE_VALUES[0] ? firstRadio : undefined}
                className={styles.input}
                type="radio"
                // Scoped to the question key. Two questions sharing a name would
                // be one radio group of ten across the screen, and scoring one
                // would silently unscore the other.
                name={`question-${question.key}`}
                value={score}
                checked={value === score}
                disabled={disabled}
                onChange={() => onChange(score)}
              />
              <span className={`${styles.face} numeric`}>{score}</span>
            </label>
          ))}
        </div>

        {/* A radio group cannot be unset by clicking, so without this a
            mis-click permanently turns an incomplete check-in into a complete
            one -- and the draft-versus-submitted distinction the board counts on
            is exactly what that would falsify. Rendered only when there is
            something to clear, so it is never a control that does nothing. */}
        {value !== undefined && (
          <button
            className={`button button--quiet ${styles.clear}`}
            type="button"
            disabled={disabled}
            onClick={handleClear}
          >
            Clear
          </button>
        )}

        {/* Last month, per question. §5.2: a score compared is a judgment and a
            score alone is a guess. Absent rather than zero when there was no
            check-in last month -- printing a 0 would invent a bad month. On the
            same line as the scale rather than below it, because 22 rows each
            carrying their own trailing line is a third of the screen's height
            spent on a value that is context, not the task. */}
        <p className={`t-caption ${styles.last}`}>
          {lastValue === null ? (
            'No score last month'
          ) : (
            <>
              Last month: <span className="numeric">{lastValue}</span>
            </>
          )}
        </p>
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Rewrite `src/checkin/QuestionRow.module.css`**

Keep `.scale`, `.options`, `.option`, `.input`, `.face`, `.clear` and every one of their comments **verbatim** — that block is load-bearing and was arrived at through fixes. Replace the top and the bottom:

```css
/* One question: its prompt, the 1-5 scale, Clear, and last month's value.
   Twenty-two of these stack inside six bucket sections on the check-in screen,
   so this row carries no border and no background of its own -- the section is
   the card. */

.row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
```

Delete `.heading`, `.anchors`, `.anchor` and `.anchorTerm` entirely. Add, at the end:

```css
/* Pushed to the end of the scale row so it sits opposite the numbers rather
   than under them. Wraps below on a narrow viewport, which .scale's flex-wrap
   already handles. */
.last {
  margin-inline-start: auto;
}
```

`margin-inline-start: auto` is the one margin in this file and it is alignment, not spacing — the flex idiom for pushing an item to the far edge. Every gap still comes from a container.

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- --run src/checkin/QuestionRow.dom.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/checkin/QuestionRow.tsx src/checkin/QuestionRow.module.css src/checkin/QuestionRow.dom.test.tsx
git rm -f src/checkin/PillarRow.tsx src/checkin/PillarRow.module.css src/checkin/PillarRow.dom.test.tsx 2>/dev/null || true
git commit -m "feat(checkin): QuestionRow replaces PillarRow, one legend instead of 66 anchors"
```

(The `git mv` in Step 1 already staged the deletions; the `git rm` is a no-op safety net.)

---

## Task 5: `saveState` counts against the required answers

Every count this module prints is currently `PILLARS.length` — a constant five. §4.4: "Every count on screen — the save button's label, the draft line, the board's progress sentence — is against the required number for that client and period, never a hardcoded 22." So `required` becomes a parameter, and `displayedTotal` becomes `displayedOverall` because the number it carries changed meaning: a sum out of 25 became a mean out of 5.

`saveReducer` and `submitBlock`'s ordering are unchanged. Do not touch the reducer's guards or the order of `submitBlock`'s checks — both carry comments explaining why the order is what it is, and both are pinned by existing tests.

**Files:**
- Modify: `src/checkin/saveState.ts`
- Test: `src/checkin/saveState.test.ts`

**Interfaces:**
- Consumes: nothing new. **Removes** the `PILLARS` import from `src/lib/score.ts`.
- Produces:
  - `submitLabel(scored: number, required: number): string`
  - `saveStatus(args: { state; block; scored: number; required: number; storedUpdatedAt: string | null }): SaveStatusLine[]`
  - `displayedOverall(args: { state: SaveState; localOverall: number | null; storedOverall: number | null }): number | null`
  - `submitBlock` — unchanged signature, one changed reason string.
  - `SaveState`, `SaveEvent`, `saveReducer`, `INITIAL_SAVE_STATE`, `SubmitBlock`, `SaveStatusTone`, `SaveStatusLine` — unchanged.

- [ ] **Step 1: Write the failing tests**

In `src/checkin/saveState.test.ts`, update the existing sweeps to pass `required` and add:

```ts
describe('submitLabel', () => {
  // 18 gated out, 22 gated in. A label that said "Submit" at 22 for a gated-out
  // client would never appear, and one that said it at 18 for a gated-in client
  // would promise a complete check-in that is four answers short.
  it('offers submit only when every REQUIRED question is answered', () => {
    expect(submitLabel(18, 18)).toBe('Submit check-in')
    expect(submitLabel(17, 18)).toBe('Save draft')
    expect(submitLabel(18, 22)).toBe('Save draft')
    expect(submitLabel(22, 22)).toBe('Submit check-in')
  })
})

describe('saveStatus counts against the required number', () => {
  it('names the required total in the clean draft line', () => {
    const lines = saveStatus({
      state: { kind: 'clean' },
      block: { blocked: false },
      scored: 7,
      required: 18,
      storedUpdatedAt: '2026-08-01T10:00:00Z',
    })
    expect(lines[0].text).toContain('7 of 18 questions scored')
  })

  it('names the required total in the saved-draft line', () => {
    const lines = saveStatus({
      state: { kind: 'saved', at: '2026-08-01T10:00:00Z', by: 'you', complete: false },
      block: { blocked: false },
      scored: 9,
      required: 22,
      storedUpdatedAt: null,
    })
    expect(lines[0].text).toContain('9 of 22 questions scored')
  })

  // The property the whole function exists for: never zero lines, never an
  // empty line, for any combination. Sweep both required values.
  it('always returns at least one non-empty line', () => {
    const states: SaveState[] = [
      { kind: 'clean' },
      { kind: 'dirty' },
      { kind: 'saving' },
      { kind: 'saved', at: '2026-08-01T10:00:00Z', by: 'you', complete: true },
      { kind: 'saved', at: '2026-08-01T10:00:00Z', by: 'you', complete: false },
      { kind: 'failed', error: 'nope' },
    ]
    const blocks: SubmitBlock[] = [{ blocked: false }, { blocked: true, reason: 'because' }]
    for (const state of states) {
      for (const block of blocks) {
        for (const required of [18, 22]) {
          const lines = saveStatus({ state, block, scored: 3, required, storedUpdatedAt: null })
          expect(lines.length).toBeGreaterThan(0)
          for (const line of lines) expect(line.text.trim()).not.toBe('')
        }
      }
    }
  })
})

describe('displayedOverall', () => {
  // §5.3, restated for the new model: the number belongs to the database, and
  // local arithmetic exists so it moves as questions are answered. The moment
  // the form matches what is stored, the STORED number shows -- so a
  // disagreement between scoreV2.ts and the view appears on screen instead of
  // hiding behind a local mean that always agrees with itself.
  it('shows the stored overall while the form matches the database', () => {
    for (const state of [{ kind: 'clean' }, { kind: 'saved', at: 'x', by: 'you', complete: true }] as SaveState[]) {
      expect(displayedOverall({ state, localOverall: 4.5, storedOverall: 3.2 })).toBe(3.2)
    }
  })

  it('shows the local overall while the form differs from it', () => {
    for (const kind of ['dirty', 'saving', 'failed'] as const) {
      const state = (kind === 'failed' ? { kind, error: 'x' } : { kind }) as SaveState
      expect(displayedOverall({ state, localOverall: 4.5, storedOverall: 3.2 })).toBe(4.5)
    }
  })

  it('passes null through rather than substituting a number', () => {
    expect(displayedOverall({ state: { kind: 'dirty' }, localOverall: null, storedOverall: 3.2 })).toBeNull()
    expect(displayedOverall({ state: { kind: 'clean' }, localOverall: 4.5, storedOverall: null })).toBeNull()
  })
})

describe('submitBlock', () => {
  it('asks for a question, not a pillar, when there is nothing to save', () => {
    const block = submitBlock({
      state: { kind: 'clean' },
      readFailed: false,
      canEdit: true,
      hasContent: false,
      storedSubmitted: false,
    })
    expect(block.blocked).toBe(true)
    if (!block.blocked) return
    expect(block.reason).toBe('Answer at least one question, or write a note, before saving.')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- --run src/checkin/saveState.test.ts`
Expected: FAIL — `displayedOverall` not exported, `submitLabel` takes one argument.

- [ ] **Step 3: Edit `src/checkin/saveState.ts`**

Delete the `PILLARS` import. Keep `formatSavedAt`. Then:

`submitLabel`:

```ts
// §5.4: one control, whose label reflects the state it is in. The label is the
// only place the draft/submitted distinction is visible before the press.
//
// `required`, not a constant: §4.4, a gated-out check-in requires 18 answers and
// a gated-in one 22, and a label promising a submit at the wrong number is a
// promise the save path will not keep.
export function submitLabel(scored: number, required: number): string {
  return scored === required ? 'Submit check-in' : 'Save draft'
}
```

`submitBlock` — one string changes, nothing else. Do not reorder the checks:

```ts
  if (!args.hasContent) {
    return {
      blocked: true,
      reason: 'Answer at least one question, or write a note, before saving.',
    }
  }
```

`displayedTotal` → `displayedOverall`. Same shape, renamed because the value changed meaning:

```ts
// §5.3 and §6, restated for the six-bucket model: the overall belongs to the
// database -- to public.checkin_scores, which is the only place the gated
// divisor is applied -- and local arithmetic exists so the number moves as
// questions are answered. The moment the form matches what is stored, the
// stored number is what shows, so a disagreement between scoreV2.overallScore
// and the view's expression appears on screen rather than being hidden behind a
// local mean that always agrees with itself.
//
// Renamed from displayedTotal, because the number changed meaning as well as
// value: a sum out of 25 became a mean out of 5, and a stale caller passing a
// total into a field that now shows a mean would print 18 where 3.60 belongs.
export function displayedOverall(args: {
  state: SaveState
  localOverall: number | null
  storedOverall: number | null
}): number | null {
  const formDiffers =
    args.state.kind === 'dirty' ||
    args.state.kind === 'saving' ||
    args.state.kind === 'failed'
  return formDiffers ? args.localOverall : args.storedOverall
}
```

`saveStatus` — add `required` to the args type, destructure it, and use it in the three places `PILLARS.length` appeared. Keep every comment in the function; they still describe the branches:

```ts
export function saveStatus(args: {
  state: SaveState
  block: SubmitBlock
  scored: number
  required: number
  storedUpdatedAt: string | null
}): SaveStatusLine[] {
  const { state, block, scored, required } = args
```

In `saved`:

```ts
      const tail = state.complete ? '' : ` ${scored} of ${required} questions scored.`
```

In `failed`:

```ts
            `again costs nothing.`  // submitLabel(scored, required) in the interpolation
```

i.e. the interpolation becomes `${submitLabel(scored, required)}`.

In `clean`:

```ts
          text: at
            ? `Draft saved ${at}. ${scored} of ${required} questions scored.`
            : `Draft saved. ${scored} of ${required} questions scored.`,
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- --run src/checkin/saveState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/checkin/saveState.ts src/checkin/saveState.test.ts
git commit -m "feat(checkin): save state counts against the required answers, not a constant five"
```

---

## Task 6: `useCheckin` for the six-bucket model

The hook changes in four ways: it holds 22 answers instead of five pillars; it knows whether the gate is open, which means it needs the client's `started_on`; it reads the overall from `public.checkin_scores` rather than from a generated column on the row; and its upsert writes 22 answer columns.

`started_on` comes from the board rather than from a second query here. The board already selects the client list, it needs the same column in step 3 for the gated-out card note, and one extra column on a query that already runs beats an extra round trip on every check-in open.

**Files:**
- Modify: `src/board/useBoard.ts`
- Modify: `src/checkin/useCheckin.ts`

**Interfaces:**
- Consumes: `advocacyApplies` (Task 2); `Draft`, `QuestionScores`, `EMPTY_DRAFT`, `readDraft`, `writeDraft`, `clearDraft`, `draftsDiffer`, `isDraftEmpty` (Task 3); `ALL_QUESTIONS` from `buckets.ts`; `answeredCount`, `overallScore`, `requiredQuestions` from `scoreV2.ts`.
- Produces:
  - `BoardClient = { id: number; name: string; status: string; started_on: string | null }`
  - `UseCheckin` gains `advocacyApplies: boolean`, `required: number`, `localOverall`, `storedOverall`, `lastOverall`; loses `localTotal`; `setPillar` becomes `setAnswer(key: string, value: number | null)`.

  Task 7 renders all of it.

- [ ] **Step 1: Widen the board's client select**

In `src/board/useBoard.ts`:

```ts
export type BoardClient = {
  id: number
  name: string
  status: string
  // Selected here rather than queried by the check-in screen, which is the only
  // thing that reads it today: this query already runs, and the check-in screen
  // opening would otherwise cost a round trip to fetch one date. Step 3's card
  // needs it too, for the gated-out client's five-bars-and-a-note.
  started_on: string | null
}
```

and

```ts
          .select('id, name, status, started_on')
```

- [ ] **Step 2: Write the failing test**

In `src/checkin/useCheckin.dom.test.ts` — if the file does not exist, create it following the pattern in `src/board/useBoard.dom.test.ts`, which mocks `../lib/supabase` and drives the hook with `renderHook`:

```ts
// The gate, through the hook. The screen's whole shape depends on this boolean
// and it is the one value here that is computed rather than fetched.
it('is gated out for a client with no start date, and requires 18', async () => {
  const { result } = renderCheckin({ client: { id: 1, name: 'Acme', started_on: null } })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.advocacyApplies).toBe(false)
  expect(result.current.required).toBe(18)
})

it('is gated in past 90 days, and requires 22', async () => {
  const { result } = renderCheckin({
    client: { id: 1, name: 'Acme', started_on: '2026-01-01' },
    period: '2026-04-01',
  })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.advocacyApplies).toBe(true)
  expect(result.current.required).toBe(22)
})

// §3.3: a missing answer must never read as a low score. 17 of 18 is null, not
// a mean of the 17.
it('has no local overall until every required question is answered', async () => {
  const { result } = renderCheckin({ client: { id: 1, name: 'Acme', started_on: null } })
  await waitFor(() => expect(result.current.status).toBe('ready'))

  const required = requiredQuestions(false)
  for (const key of required.slice(0, required.length - 1)) {
    act(() => result.current.setAnswer(key, 4))
  }
  expect(result.current.localOverall).toBeNull()

  act(() => result.current.setAnswer(required[required.length - 1], 4))
  expect(result.current.localOverall).toBe(4)
})

// The four gated-out Advocacy answers must not hold the overall hostage.
it('ignores unanswered Advocacy questions when the gate is shut', async () => {
  const { result } = renderCheckin({ client: { id: 1, name: 'Acme', started_on: null } })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  for (const key of requiredQuestions(false)) act(() => result.current.setAnswer(key, 3))
  expect(result.current.localOverall).toBe(3)
  expect(result.current.scored).toBe(18)
})

// Every answer column is sent, including the unanswered ones as null. Sending
// only the answered ones would leave a cleared answer at its old value in the
// database, and the bucket columns are generated from those columns -- so the
// bar on the board would be the one nobody chose.
it('sends all 22 answer columns on save, unanswered ones as null', async () => {
  const { result, upsert } = renderCheckin({ client: { id: 1, name: 'Acme', started_on: null } })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  act(() => result.current.setAnswer('comm_timely', 5))
  act(() => result.current.submit())
  await waitFor(() => expect(upsert).toHaveBeenCalled())

  const payload = upsert.mock.calls[0][0]
  for (const key of ALL_QUESTIONS) expect(payload).toHaveProperty(key)
  expect(payload.comm_timely).toBe(5)
  expect(payload.adv_left_review).toBeNull()
})

// The submitted marker tracks the REQUIRED count, so a gated-out check-in can
// be submitted at 18. Marking it only at 22 would make a complete check-in
// permanently unsubmittable for every client inside their first 90 days.
it('marks a gated-out check-in submitted at 18 answers', async () => {
  const { result, upsert } = renderCheckin({ client: { id: 1, name: 'Acme', started_on: null } })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  for (const key of requiredQuestions(false)) act(() => result.current.setAnswer(key, 3))
  act(() => result.current.submit())
  await waitFor(() => expect(upsert).toHaveBeenCalled())
  expect(upsert.mock.calls[0][0].submitted_at).not.toBeNull()
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- --run src/checkin/useCheckin.dom.test.ts`
Expected: FAIL — `setAnswer` is not a function; `advocacyApplies` undefined.

- [ ] **Step 4: Rewrite `src/checkin/useCheckin.ts`**

Imports: drop `PILLARS`, `scoredCount`, `totalScore` from `../lib/score`; add:

```ts
import { ALL_QUESTIONS } from '../lib/buckets'
import { advocacyApplies as gateApplies } from '../lib/gate'
import { answeredCount, overallScore, requiredQuestions } from '../lib/scoreV2'
import type { Draft, QuestionScores } from './draftCache'
```

`UseCheckin`:

```ts
export type CheckinRow = Database['public']['Tables']['checkins']['Row']
export type ScoreRow = Database['public']['Views']['checkin_scores']['Row']

export type UseCheckin = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  stored: CheckinRow | null
  lastMonth: CheckinRow | null
  lastPeriod: string
  draft: Draft
  saveState: SaveState
  // The gate, and the count that follows from it. §4.4: every count on screen is
  // against this number, never a hardcoded 22.
  advocacyApplies: boolean
  required: number
  scored: number
  localOverall: number | null
  storedOverall: number | null
  lastOverall: number | null
  hasContent: boolean
  storedSubmitted: boolean
  storedByYou: boolean
  draftPersisted: boolean
  unsavedFromEarlierVisit: boolean
  setAnswer: (key: string, value: number | null) => void
  setNotes: (notes: string) => void
  reload: () => void
  submit: () => void
}
```

Signature — the client, not just its id, because the gate needs the start date:

```ts
export function useCheckin(
  client: { id: number; started_on: string | null },
  period: string,
  profile: Profile,
): UseCheckin {
  const clientId = client.id
  const lastPeriod = previousPeriod(period)

  // Computed, not fetched. public.checkin_scores.advocacy_applies answers this
  // for a check-in that HAS a row, and this screen must answer it for one that
  // does not -- which is every check-in, the first time somebody opens it.
  // tests/gateParity.test.ts is what keeps the two answers the same.
  const applies = gateApplies(client.started_on, period)
  const required = requiredQuestions(applies).length
```

`draftFromRow`:

```ts
// The form's shape, from a stored row. Kept here rather than in draftCache
// because this is the only place a row is turned into a draft -- the reverse
// mapping, a draft into the row's columns, lives in submit() below.
//
// Iterates the rubric rather than the row's own keys: a row carries the retired
// pillar columns too, and they are not answers.
function draftFromRow(row: CheckinRow | null): Draft {
  if (!row) return EMPTY_DRAFT
  const answers: QuestionScores = {}
  for (const key of ALL_QUESTIONS) {
    const value = row[key as keyof CheckinRow]
    if (typeof value === 'number') answers[key] = value
  }
  return { answers, notes: row.notes ?? '' }
}
```

`load()` — add the view read alongside the existing one. Add state for it first:

```ts
  const [scores, setScores] = useState<ScoreRow[]>([])
```

and in `load`, replacing the single await:

```ts
      // Two reads, resolved together and treated as one outcome. The base table
      // carries the answers, the notes and the submitted marker; the view
      // carries the overall, which is the only place the gated divisor is
      // applied and therefore the only honest source for a saved score (§6).
      // Promise.all rather than two sequential awaits so this stays one round
      // trip's worth of latency, and one failure branch rather than two -- a
      // partial failure is not a state this screen has an answer for.
      const [rows, views] = await Promise.all([
        supabase
          .from('checkins')
          .select('*')
          .eq('client_id', clientId)
          .in('period', [lastPeriod, period]),
        supabase
          .from('checkin_scores')
          .select('*')
          .eq('client_id', clientId)
          .in('period', [lastPeriod, period]),
      ])

      if (isCancelled()) return

      const failure = rows.error ?? views.error
      if (failure) {
        setLoadError(describeError(failure))
        setStatus('error')
        return
      }

      const thisMonth = rows.data.find((row) => row.period === period) ?? null
      const previous = rows.data.find((row) => row.period === lastPeriod) ?? null

      setLoadError(null)
      setStored(thisMonth)
      setLastMonth(previous)
      setScores(views.data)
```

The rest of `load` — the draft-versus-row reconciliation, the two dispatches and their comments — is unchanged.

The derived values, replacing `scored`/`localTotal`:

```ts
  const scored = answeredCount(draft.answers, applies)
  const localOverall = overallScore(draft.answers, applies)
  const storedOverall = scores.find((row) => row.period === period)?.overall_score ?? null
  const lastOverall = scores.find((row) => row.period === lastPeriod)?.overall_score ?? null
  const hasContent = !isDraftEmpty(draft)
```

`setPillar` → `setAnswer`:

```ts
  const setAnswer = useCallback(
    (key: string, value: number | null) => {
      const answers: QuestionScores = { ...draft.answers }
      // Deleted, not set to null. An unanswered question is an absent key
      // everywhere else in this code -- draftCache validates on that basis, and
      // answeredCount counts on it.
      if (value === null) delete answers[key]
      else answers[key] = value
      applyEdit({ ...draft, answers })
    },
    [draft, applyEdit],
  )
```

`submit()` — the completeness test and the column spread:

```ts
      // Against the REQUIRED count, not 22. A gated-out check-in is complete at
      // 18, and marking it submitted only at 22 would make a complete check-in
      // permanently unsubmittable for every client inside their first 90 days.
      const complete = answeredCount(draft.answers, applies) === required
      const now = new Date().toISOString()

      // Every answer column is sent, including the unanswered ones as null, and
      // including the four Advocacy columns when the gate is shut. Sending only
      // the answered ones would leave a cleared answer at its old value in the
      // database, so the form and the row would disagree with no sign of it
      // anywhere -- and the six bucket columns are generated from these columns,
      // so the bar on the board would be the one nobody chose.
      const answers = Object.fromEntries(
        ALL_QUESTIONS.map((key) => [key, draft.answers[key] ?? null]),
      )
```

and in the upsert, `...answers` in place of `...pillars`. The `.select().single()` comment needs one correction — the row no longer carries the overall:

```ts
          // .select().single() rather than a second read: the row that comes
          // back carries the six generated bucket columns and updated_at, which
          // is the time the confirmation names. One round trip.
          //
          // What it does NOT carry is the overall -- that lives in
          // public.checkin_scores, which an upsert cannot return. reload()
          // below is what refreshes it, and until it lands displayedOverall
          // shows the local mean, which is the same value unless scoreV2 and
          // the view disagree. Surfacing that disagreement is the point of the
          // local/stored split, so this is the intended behaviour rather than a
          // gap.
          .select()
          .single()
```

and on success, after `setStored(data)`, refresh the view — but **do not call `load()`**:

```ts
        setStored(data)

        // The view is a separate relation, so the upsert could not return the
        // overall. It is re-read here, and AWAITED BEFORE the confirmation is
        // dispatched, for two reasons that pull the same way.
        //
        // Not load(): load() dispatches { type: 'loaded' }, which resets the
        // reducer to `clean` -- wiping the `succeeded` confirmation that is
        // about to be dispatched below. The confirmation IS this slice; the
        // whole rewrite exists because a save that worked looked exactly like
        // one that failed, and refreshing a number by erasing the sentence that
        // says the save happened would reintroduce that defect from the other
        // side.
        //
        // And awaited, not fired off: displayedOverall shows the STORED overall
        // once the state is `saved`, so dispatching the confirmation before this
        // lands would print an em dash beside "Check-in submitted" -- a complete
        // check-in reading as not scored, for one round trip.
        const refreshed = await supabase
          .from('checkin_scores')
          .select('*')
          .eq('client_id', clientId)
          .in('period', [lastPeriod, period])

        // A failed refresh is not a failed save. The write succeeded and the
        // person is told so; the overall stays at its pre-save value until the
        // next load. Reporting a save failure here would be the more harmful
        // lie of the two.
        if (!refreshed.error) setScores(refreshed.data)
```

Return the new shape:

```ts
  return {
    status,
    loadError,
    stored,
    lastMonth,
    lastPeriod,
    draft,
    saveState,
    advocacyApplies: applies,
    required,
    scored,
    localOverall,
    storedOverall,
    lastOverall,
    hasContent,
    storedSubmitted,
    storedByYou,
    draftPersisted,
    unsavedFromEarlierVisit,
    setAnswer,
    setNotes,
    reload: () => void load(),
    submit,
  }
```

Add `applies` and `required` to `submit`'s dependency array. **Do not add `load`** — `submit` no longer calls it, and adding it would rebuild `submit` on every load.

Add a test pinning the defect this avoids:

```ts
// The confirmation survives the score refresh. An earlier draft of this hook
// called load() here, which dispatches 'loaded' and resets the reducer to
// `clean` -- erasing the sentence that says the save happened, which is the
// exact defect this whole screen was rewritten to fix.
it('still says the check-in was saved after refreshing the overall', async () => {
  const { result } = renderCheckin({ client: { id: 1, name: 'Acme', started_on: null } })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  act(() => result.current.setAnswer('comm_timely', 4))
  act(() => result.current.submit())
  await waitFor(() => expect(result.current.saveState.kind).toBe('saved'))
  expect(result.current.saveState.kind).toBe('saved')
})
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- --run src/checkin/useCheckin.dom.test.ts src/board`
Expected: PASS. `CheckIn.tsx` still will not compile — Task 7.

- [ ] **Step 6: Commit**

```bash
git add src/board/useBoard.ts src/checkin/useCheckin.ts src/checkin/useCheckin.dom.test.ts
git commit -m "feat(checkin): useCheckin holds 22 answers, the gate, and the view's overall"
```

---

## Task 7: The check-in screen

Six sections in the boss's order — Communication, Growth, Finances, Relationship, Delivery, Advocacy — each a heading followed by its questions. Nothing collapses (§7: a collapsed section hides unanswered work, and §3.3's whole point is that unanswered work must be impossible to miss). One legend for the screen. The shut Advocacy section renders **disabled and visible**, with its reason, so the scorer learns the bucket exists.

**Files:**
- Modify: `src/checkin/CheckIn.tsx`, `src/checkin/CheckIn.module.css`
- Modify: `src/board/Board.tsx` (the `client` prop is now a `BoardClient`, which it already is — verify only)
- Test: `src/checkin/CheckIn.test.tsx`, `src/checkin/CheckIn.dom.test.tsx`

**Interfaces:**
- Consumes: everything produced by Tasks 2, 4, 5, 6; `BUCKETS`, `BUCKET_DEFINITIONS`, `questionsFor`, `GATED_BUCKET` from `buckets.ts`; `bandFor`, `BAND_LABELS`, `MAX_SCORE`, `SCORE_VALUES` from `scoreV2.ts`.
- Produces: the screen. Nothing consumes it but `Board.tsx`, unchanged.

- [ ] **Step 1: Write the failing tests**

`src/checkin/CheckIn.test.tsx` renders `CheckIn` with `useCheckin` mocked. Rewrite it against the new hook shape and add:

```tsx
it('renders all six buckets as headings, in the boss's order', () => {
  renderScreen()
  const headings = screen.getAllByTestId('bucket-heading').map((h) => h.textContent)
  expect(headings).toEqual([
    'Communication', 'Growth', 'Finances', 'Relationship', 'Delivery', 'Advocacy',
  ])
})

// §7: nothing collapses. A collapsed section hides unanswered work, and §3.3's
// whole point is that unanswered work is impossible to miss.
it('renders every one of the 22 questions at once', () => {
  renderScreen()
  expect(screen.getAllByRole('radiogroup')).toHaveLength(22)
})

// §7: one legend, not 66 anchors.
it('states the scale once', () => {
  renderScreen()
  expect(screen.getAllByTestId('scale-legend')).toHaveLength(1)
  expect(screen.getByTestId('scale-legend')).toHaveTextContent('strongly disagree')
  expect(screen.getByTestId('scale-legend')).toHaveTextContent('strongly agree')
})

describe('when the gate is shut', () => {
  // The reason is NOT a hook field -- the screen derives it from the client's
  // start date via advocacyGate(). So these drive it through `startedOn` on the
  // client prop, and only `advocacyApplies` comes from the mocked hook. A test
  // that passed a `gateReason` would be asserting against a prop that does not
  // exist and would pass whatever the screen rendered.
  it('still renders the Advocacy section, and names the missing start date', () => {
    renderScreen({ advocacyApplies: false, startedOn: null })
    expect(screen.getByTestId('bucket-advocacy')).toBeInTheDocument()
    expect(screen.getByTestId('advocacy-gate')).toHaveTextContent('no start date')
  })

  it('names the month the gate opens for a client inside their first 90 days', () => {
    renderScreen({ advocacyApplies: false, startedOn: '2026-01-15', period: '2026-03-01' })
    expect(screen.getByTestId('advocacy-gate')).toHaveTextContent('May 2026')
  })

  it('disables every Advocacy radio and leaves the other 18 enabled', () => {
    renderScreen({ advocacyApplies: false })
    const advocacy = within(screen.getByTestId('bucket-advocacy')).getAllByRole('radio')
    expect(advocacy).toHaveLength(20)
    for (const radio of advocacy) expect(radio).toBeDisabled()

    const communication = within(screen.getByTestId('bucket-communication')).getAllByRole('radio')
    for (const radio of communication) expect(radio).toBeEnabled()
  })

  it('says nothing about the gate when it is open', () => {
    renderScreen({ advocacyApplies: true })
    expect(screen.queryByTestId('advocacy-gate')).toBeNull()
  })
})

describe('the overall', () => {
  // §3.3: an incomplete check-in shows an em dash, never a number. The words
  // beside it are what a screen reader gets, since an em dash announces as
  // nothing on its own.
  it('shows an em dash and the count when there is no overall', () => {
    renderScreen({ storedOverall: null, localOverall: null, scored: 7, required: 18 })
    expect(screen.getByTestId('overall-value')).toHaveTextContent('—')
    expect(screen.getByTestId('overall-caption')).toHaveTextContent('not scored · 7 of 18 answered')
  })

  it('shows two decimals out of 5 when there is one', () => {
    renderScreen({ storedOverall: 3.6, localOverall: 3.6, saveState: { kind: 'clean' } })
    expect(screen.getByTestId('overall-value')).toHaveTextContent('3.60')
    expect(screen.getByTestId('overall-caption')).toHaveTextContent('of 5')
  })

  it('bands on the new thresholds', () => {
    renderScreen({ storedOverall: 3.6, saveState: { kind: 'clean' } })
    expect(screen.getByTestId('overall-band')).toHaveTextContent('Healthy')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- --run src/checkin/CheckIn.test.tsx`
Expected: FAIL — the component still renders `PILLARS.map`.

- [ ] **Step 3: Rewrite the body of `src/checkin/CheckIn.tsx`**

Imports:

```tsx
import { BUCKETS, BUCKET_DEFINITIONS, GATED_BUCKET, questionsFor } from '../lib/buckets'
import { BAND_LABELS, MAX_SCORE, bandFor } from '../lib/scoreV2'
import { advocacyGate } from '../lib/gate'
import { formatPeriod, formatSavedAt } from '../lib/month'
import { bandClassName } from '../styles/bandClass'
import type { Profile } from '../auth/useProfile'
import { can } from '../lib/capabilities'
import { useCheckin } from './useCheckin'
import type { CheckinRow } from './useCheckin'
import { QuestionRow } from './QuestionRow'
import { displayedOverall, saveStatus, submitBlock, submitLabel } from './saveState'
import type { SaveStatusTone } from './saveState'
import styles from './CheckIn.module.css'
```

Props — the client now carries its start date:

```tsx
type Props = {
  client: { id: number; name: string; started_on: string | null }
  period: string
  profile: Profile
  onBack: () => void
}
```

Destructure the new hook values, and:

```tsx
  const checkin = useCheckin(client, period, profile)
  const { advocacyApplies, required, scored, localOverall, storedOverall, lastOverall } = checkin

  const label = submitLabel(scored, required)
  const gate = advocacyGate(client.started_on, period)

  const block = submitBlock({ state: saveState, readFailed, canEdit, hasContent, storedSubmitted })
  const overall = displayedOverall({ state: saveState, localOverall, storedOverall })
  const statusLines = saveStatus({
    state: saveState,
    block,
    scored,
    required,
    storedUpdatedAt: stored?.updated_at ?? null,
  })
```

A local helper above the component, so the format decision is in one place:

```tsx
// Two decimals, always. numeric(3,2) is what the view stores and what
// scoreMath.meanTo2dp produces, so 3.6 and 3.60 are the same number -- but a
// column of scores where some show one decimal and some show two reads as
// noise, and the trailing zero is the difference between "3.6 out of 5" and a
// number somebody has to look twice at.
function formatOverall(overall: number): string {
  return overall.toFixed(2)
}
```

The totals block, replacing the two `.total` divs:

```tsx
      <div className={styles.totals}>
        <div className={styles.total}>
          <p className="t-label">This month</p>
          <p className={styles.totalLine}>
            {/* An incomplete check-in shows an em dash, never a number. §3.3:
                incomplete must not read as "at risk". The words beside it are
                what a screen reader gets, since an em dash on its own
                announces as nothing. */}
            <span className={`t-display ${styles.totalValue} numeric`} data-testid="overall-value">
              {overall === null ? '—' : formatOverall(overall)}
            </span>
            <span className="t-caption" data-testid="overall-caption">
              {overall === null
                ? `not scored · ${scored} of ${required} answered`
                : `of ${MAX_SCORE}`}
            </span>
          </p>
          <span className={bandClassName(bandFor(overall))} data-testid="overall-band">
            {BAND_LABELS[bandFor(overall)]}
          </span>
        </div>

        {/* §5.2: last month alongside, because a score compared is a judgment
            and a score alone is a guess. */}
        <div className={styles.total}>
          <p className="t-label">{formatPeriod(lastPeriod)}</p>
          <p className={styles.totalLine}>
            <span className={`t-display ${styles.totalValue} numeric`}>
              {lastOverall === null ? '—' : formatOverall(lastOverall)}
            </span>
            <span className="t-caption">
              {lastOverall === null ? 'not scored' : `of ${MAX_SCORE}`}
            </span>
          </p>
          <span className={bandClassName(bandFor(lastOverall))}>
            {BAND_LABELS[bandFor(lastOverall)]}
          </span>
        </div>
      </div>
```

The legend, placed once above the sections:

```tsx
      {/* §7: one legend for 22 questions, not three anchors on each. The
          questions are already specific statements, so an agreement scale
          carries them -- and the alternative is 66 pieces of copy nobody has
          written. A definition list because that is what it is: two scores and
          what each one means, with 2, 3 and 4 reading as between them. */}
      <dl className={styles.legend} data-testid="scale-legend">
        <div className={styles.legendPair}>
          <dt className={`t-label ${styles.legendTerm} numeric`}>1</dt>
          <dd className="t-caption">strongly disagree</dd>
        </div>
        <div className={styles.legendPair}>
          <dt className={`t-label ${styles.legendTerm} numeric`}>5</dt>
          <dd className="t-caption">strongly agree</dd>
        </div>
      </dl>
```

The six sections, replacing `<div className={styles.pillars}>`:

```tsx
      <div className={styles.buckets}>
        {BUCKETS.map((bucket) => {
          const definition = BUCKET_DEFINITIONS[bucket]
          // Only Advocacy is gated, and it is named rather than compared to a
          // string so the gate has one definition (buckets.ts).
          const shut = bucket === GATED_BUCKET && !advocacyApplies
          return (
            <section className={styles.bucket} data-testid={`bucket-${bucket}`} key={bucket}>
              <h3 className="t-header" data-testid="bucket-heading">
                {definition.label}
              </h3>

              {/* Shown, not hidden -- §7, "so the scorer learns the bucket
                  exists". A hidden section is a screen that silently asks for
                  18 questions one month and 22 the next with nothing to
                  explain the change. The reason distinguishes the two shut
                  cases, because one is a missing fact somebody can go and
                  enter and the other is a client who is simply new. */}
              {shut && !gate.open && (
                <p className="alert prose" data-testid="advocacy-gate" role="status">
                  {gate.reason}
                </p>
              )}

              {questionsFor(bucket).map((question) => (
                <QuestionRow
                  key={question.key}
                  question={question}
                  value={draft.answers[question.key]}
                  lastValue={
                    (lastMonth?.[question.key as keyof CheckinRow] as number | null) ?? null
                  }
                  disabled={saving || !canEdit || shut}
                  onChange={(value) => checkin.setAnswer(question.key, value)}
                  onClear={() => checkin.setAnswer(question.key, null)}
                />
              ))}
            </section>
          )
        })}
      </div>
```

Everything else on the screen — the error branch, the loading branch, the earlier-visit notice, the not-persisted notice, the read-only notice, the notes block, the save bar, the last-submitted line — is unchanged except that the read-only notice's wording "you can't score them" still reads correctly, and `PILLARS.length` appears nowhere.

Change the not-canEdit notice's first word only if it mentions pillars; it does not.

- [ ] **Step 4: Update `src/checkin/CheckIn.module.css`**

Rename `.pillars` to `.buckets` and add the section, legend and measure changes:

```css
.buckets {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* The section is the card, not the question. Twenty-two bordered question cards
   is a scroll; six bordered sections is a screen with six landmarks in it. */
.bucket {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--rule-hairline);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

/* Two pairs on one line where there is room. The scale is read once, at the
   top, and then not again -- so it is a caption-weight aside, not a panel. */
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-5);
}

.legendPair {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.legendTerm {
  text-align: end;
}
```

Fix the stale justification on `.screen`, but **keep `--measure-prose`**. The existing comment justifies the narrow measure by "the pillar rows below carry three anchor sentences each", which §7 has just retired — so the comment is now false and has to change. The *value* does not:

```css
  /* --measure-prose (62ch). The comment this replaces justified it by the three
     anchor sentences each pillar row carried, and §7 retired those in favour of
     one legend -- so the old reason is gone, but the measure stays. A wider
     screen would suit the new row shape (a prompt and a five-point scale that
     would rather not wrap), and the token for it, --measure-admin at 90ch,
     already exists on the unmerged admin-visual-pass branch. Declaring a second
     one here would collide with it on merge. Revisit when that branch lands. */
  max-width: var(--measure-prose);
```

**Do not add a `--measure-admin` token in this step.** It exists on `admin-visual-pass` (1 unpushed commit, not merged into this branch), and defining it twice guarantees a conflict. `.scale` already carries `flex-wrap`, so the "Last month" line wrapping below the numbers on a narrow measure is the intended behaviour, not a defect.

- [ ] **Step 5: Run to verify they pass**

Run: `npm test -- --run src/checkin/`
Expected: PASS.

- [ ] **Step 6: Run the full suite, build and lint**

Run: `npm test -- --run && npm run build && npm run lint`
Expected: all clean. This is the first point since Task 3 at which the whole tree typechecks — the build is the real gate here.

- [ ] **Step 7: Commit**

```bash
git add src/checkin/CheckIn.tsx src/checkin/CheckIn.module.css src/checkin/CheckIn.test.tsx src/checkin/CheckIn.dom.test.tsx
git commit -m "feat(checkin): six bucket sections, 22 questions, one legend, the gate shown not hidden"
```

---

## Task 8: Prove it on staging

No new code. This task is evidence, and it is the one that finds what unit tests with a mocked client cannot: that the 22 columns are named correctly, that RLS lets an ordinary account read the view, and that the gate agrees with the database it was written against.

**Preconditions:** `npm run db:which` prints `tgc-client-health-staging`. It is wired into `db:push` and `verify:privileges` so it cannot be skipped, but check it by hand first — `verify:privileges` does real writes and must never be aimed at production.

- [ ] **Step 1: Confirm the link**

Run: `npm run db:which`
Expected: `linked project: tgc-client-health-staging (dexsdhtpfsswgiytxntl, us-west-2)`. **If it says production, stop and relink.**

- [ ] **Step 2: Run every gate**

```bash
npm test -- --run
npm run build
npm run lint
npm run verify:score
npm run verify:scoring-view
npm run verify:privileges
npm run verify:capability
npm run verify:lifecycle
```

Expected: all eight green. `verify:score` should still report 0 mismatches across 5,616 states — this step adds no arithmetic, so a change there means something in Task 5 or 6 touched the model rather than the screen.

- [ ] **Step 3: Drive the real screen**

`npm run dev`, sign in, and check these six things. Record the answers in the ledger — this is the half no verifier covers.

1. A client with **no start date**: the Advocacy section renders, its four rows are disabled, the reason names the missing start date, and the count reads "of 18".
2. Enter a start date on the clients admin **more than 90 days back**, reload the check-in: Advocacy is enabled and the count reads "of 22".
3. Enter one **inside 90 days**: the reason names the month the gate opens, and that month is the first of a month later than day 90.
4. Answer every required question: the label turns to "Submit check-in", the overall shows two decimals out of 5, and the band matches the 3.6 / 2.2 thresholds.
5. Clear one answer: the overall returns to an em dash, **not** to a lower number.
6. Save, then reload the page: the answers come back, the confirmation names a time, and the overall still shows.

- [ ] **Step 4: Confirm the v1 draft is rejected, not migrated**

In the browser console on the check-in screen, plant a v1 draft and reload:

```js
localStorage.setItem('checkin-draft:1:2026-08-01', JSON.stringify({ pillars: { relationship: 5 }, notes: 'v1' }))
```

Expected: the screen loads with no note reading "v1", no "unsaved changes from an earlier visit" notice, and the key is gone from `localStorage` afterwards. Use the real client id and the period on screen.

- [ ] **Step 5: Write the ledger and commit it**

Record in `.superpowers/sdd/2026-08-28-slice-4-step-2-checkin-screen/progress.md`: the eight gate results with their numbers, the six manual answers, and anything that was found and fixed.

```bash
git add .superpowers/sdd/2026-08-28-slice-4-step-2-checkin-screen/progress.md
git commit -m "docs: step 2 verified on staging"
```

---

## What is still owed after this step

- **The eleven start dates.** Task 1 ships the field; entering the dates is the owner's. Two facts he needs first, both already recorded in the spec and both easy to get wrong: the gate opens on the **first check-in month beginning on or after day 90**, not on day 90 — so `started_on = 2026-01-15` leaves April shut and opens May. And entering a date retroactively moves that client's existing check-ins from the 18-divisor branch to the 22-divisor branch, nulling `overall_score` wherever the four Advocacy answers are blank. **Enter the dates before the first scoring round**, which is exactly what putting Task 1 first makes possible.
- **Step 3:** the board's six bars, the client × bucket data the matrix will read, and the `legacy_*` rename — which must wait until nothing reads the old pillar columns, and after this step the check-in screen no longer does. `src/board/cardSummary.ts` and `src/lib/pillars.ts` are the last two readers.
- **Step 4:** the migration on production, then the deploy. Production is still unmigrated and that is the owner's action.

---

## Self-Review

**Spec coverage.**

| Spec | Task |
|---|---|
| §3.3 incompleteness — null, never a partial mean | Task 6 (`overallScore` via `meanOrNull`), Task 7 (the em dash) |
| §4.1–§4.2 the gate reads `started_on` and `period` | Task 2 |
| §4.3 a null start date excludes Advocacy and says so | Task 2 (`advocacyGate`), Task 7 (the reason rendered) |
| §4.4 completeness varies, 18 or 22 | Task 5 (`required` everywhere), Task 6 |
| §5.1 `started_on` on the existing clients admin | Task 1 |
| §6 the overall lives in a view | Task 6 (the view read), Task 5 (`displayedOverall`) |
| §7 six sections in the boss's order | Task 7 |
| §7 nothing collapses | Task 7 (test: 22 radiogroups at once) |
| §7 `QuestionRow`, one legend not 66 anchors | Task 4, Task 7 |
| §7 shut Advocacy shown disabled with a reason | Task 7 |
| §7 the draft cache versions its key and discards old drafts | Task 3 |
| §8 the board's six bars | **Step 3, not this plan** — recorded above |
| §9.3 what only a person can check | Task 8 |

**Placeholders.** None. Every code step carries the code.

**Type consistency.** `bandClassName` (`src/styles/bandClass.ts`) types its argument as `Band` from `src/lib/score.ts`, and Task 7 passes `bandFor` from `scoreV2` — whose `Band` comes from `scoreMath.ts`. The two are the same string union (`'healthy' | 'watch' | 'at_risk' | 'incomplete'`), so this compiles unchanged; do not "fix" it by rewriting `bandClass.ts`, which still serves the board's `score.ts` Band until step 3 retires it. `Draft.answers` (Task 3) → `QuestionScores` → assignable to `scoreV2.Answers` (Task 6). `submitLabel(scored, required)` is called with two arguments in Task 7 and in `saveState.ts`'s own `failed` branch. `displayedOverall` is defined in Task 5 and called in Task 7 with matching keys. `advocacyApplies` is imported as `gateApplies` in Task 6 to avoid shadowing the `UseCheckin` field of the same name. `BoardClient` gains `started_on` in Task 6 Step 1, which is what makes `CheckIn`'s widened `client` prop typecheck in Task 7.

**One ordering note for the executor.** Tasks 3 and 6 leave the tree not typechecking between them, by design — `useCheckin.ts` reads `draft.pillars` until Task 6 rewrites it. `npm test` runs vitest and still passes; `npm run build` will not, and Task 3's step list deliberately does not ask for it. Task 6 Step 5 and Task 7 Step 6 are where the tree comes back to green. Do not "fix" Task 3 by half-migrating `useCheckin`.
