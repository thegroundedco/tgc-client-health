# Payments on the Check-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirm or enter a client's monthly retainer and project revenue on its check-in screen, with the retainer stored per client in Clients admin as the source of truth.

**Architecture:** A new revenue-gated table `client_retainers` holds the current monthly retainer. A security-invoker SQL function `save_month_payment` writes a month's revenue and, optionally, the retainer in one transaction, so RLS decides who may write. A pure module decides the box's state and whether to ask "update the retainer?". A hook reads and saves, and a component renders the box above the scores. After a save, the check-in re-reads the finance suggestion and overwrites the two finance answers in the form.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest (+ jsdom, Testing Library), Supabase (Postgres RLS, supabase-js), oxlint.

**Spec:** `docs/superpowers/specs/2026-11-02-payments-on-checkin-design.md`

## Global Constraints

- The repo is PUBLIC. Never commit project refs, tokens, URLs or any client's real amounts. Test fixtures use placeholder clients (`Acme`, `Delta`), never real client names.
- Money is integer cents everywhere. Parse with `parseMoney` and display with `formatMoney` (`src/revenue/money.ts`). The cap is `MAX_CENTS`.
- Gate at the READ, not the render. A role without `view_revenue` issues no query against `client_month_revenue` or `client_retainers`. Use `can(role, cap)` from `src/lib/capabilities.ts` to decide what to draw. RLS is the enforcement.
- Access: admin (`edit_revenue`) enters and changes. account_manager (`view_revenue` only) sees amounts read-only. viewer sees nothing about money.
- A ghost amount is never stored, and never shown to anyone as if it were confirmed (spec §9).
- `period` keeps today's meaning: the month the invoice is dated (spec §6). The box's caption says "Invoiced in <Month>".
- Stage explicit paths. Never `git commit -a`. Check `git branch --show-current` is `payments-on-checkin` before every commit.
- Verify like CI: `npx tsc -b`, `npm run lint`, and `npm test` run with `.env.local` moved aside, and once more with `TZ=UTC`. Move `.env.local` back afterwards.
- Migrations are applied to STAGING (its ref is in the controller's memory, never in the repo) only during Tasks 1–6. Production is Task 7, with the owner's confirmation.

## Review Focus

1. **An admin types only a Project amount for a retainer client and leaves Retainer blank.** Blank under a ghost means the ghost amount, so the stored retainer is saved and nothing is asked. Pinned in Task 2 (`effectiveRetainer`) and Task 4.
2. **An admin types `0` in Retainer for a retainer client.** That differs from the stored retainer, so the box asks, and "Yes" removes the retainer (deletes the row). Pinned in Task 1 (function deletes on 0) and Task 2.
3. **The page opens for a month that already has a revenue row (entered on Revenue entry).** It shows the saved figures as values, not ghosts, and editing only Project asks nothing even if the saved retainer differs from the stored one. Pinned in Task 2 (`shouldAskRetainer` needs the retainer field edited).
4. **A payment is saved while the person has unsaved score edits.** Their edits survive, and only the two finance keys change. Pinned in Task 5.
5. **An account manager opens a month with nothing entered.** They see "Not entered yet" with no amounts, no ghost and no buttons. Pinned in Task 4.

---

### Task 1: The `client_retainers` table and `save_month_payment`

**Files:**
- Create: `supabase/migrations/20261102120000_client_retainers.sql`
- Create: `tests/retainersMigration.test.ts`
- Modify: `src/types/database.ts` (add the `client_retainers` table and the `save_month_payment` function to `Database['public']`)
- Modify: `scripts/verify-privileges.sql` (expected-grants list)

**Interfaces:**
- Produces: table `public.client_retainers(client_id bigint primary key references clients(id) on delete restrict, monthly_cents integer not null check (monthly_cents > 0 and monthly_cents <= 2147483647), updated_by uuid references profiles(id) on delete set null, updated_at timestamptz not null default now())`, with the `private.touch_updated_at()` trigger.
- Produces: `public.save_month_payment(p_client_id bigint, p_period date, p_retainer_cents integer, p_project_cents integer, p_set_retainer boolean) returns void`, `language plpgsql`, **`security invoker`**, `set search_path = ''`.
  - It upserts `client_month_revenue` on `(client_id, period)` with `entered_by = auth.uid()`.
  - When `p_set_retainer` is true: if `p_retainer_cents > 0` it upserts `client_retainers` (`updated_by = auth.uid()`), otherwise it deletes that client's row.
  - It is one function, so one transaction (spec §4: "Yes" writes both or neither).

- [ ] **Step 1: Write the failing migration-text test** in `tests/retainersMigration.test.ts`, following `tests/revenueMigration.test.ts`'s `migration()` and `withoutComments()` helpers. Assert that:
  - `revoke all on public.client_retainers from anon, authenticated` appears before `grant select, insert, update, delete on public.client_retainers to authenticated`
  - RLS is enabled
  - there are exactly four policies, `for select` using `has_capability('view_revenue')` and `for insert`, `for update` and `for delete` using `has_capability('edit_revenue')`
  - the function text contains `security invoker` and not `security definer`
  - `revoke execute on function public.save_month_payment` from `public, anon` appears and `grant execute ... to authenticated` appears
  - the touch trigger is wired
  - `on delete restrict` is on the client FK
- [ ] **Step 2: Run it.** `npx vitest run tests/retainersMigration.test.ts`. Expected: FAIL (the migration file does not exist).
- [ ] **Step 3: Write the migration.** Comment it in the house style: why not a column on `clients` (spec §1), why a delete policy exists here when `client_month_revenue` has none, and why invoker rather than definer.
- [ ] **Step 4: Update the expected grants.** Add `client_retainers` SELECT/INSERT/UPDATE/DELETE for `authenticated` to `scripts/verify-privileges.sql`'s expected list, with a comment. Add the types to `src/types/database.ts` by hand, matching the generated shape of `client_month_revenue` and an existing entry under `Functions`.
- [ ] **Step 5: Run the test and the full verify.** The test should PASS. Then tsc, lint and test as in Global Constraints, all green.
- [ ] **Step 6: Apply to STAGING and exercise it.** Use MCP `apply_migration` on staging. Then `execute_sql` on staging:
  - Simulate an account manager with `set local role authenticated; set local request.jwt.claims = '{"sub":"<an account_manager profile id on staging>"}'`. `select public.save_month_payment(...)` must fail with an RLS error, and `select * from client_retainers` must succeed.
  - Simulate a viewer the same way. The select must return zero rows.
  - Simulate an admin. The call must write both tables, and `p_retainer_cents = 0` with `p_set_retainer` must delete the retainer row.
  - Run it all inside `begin; … rollback;`. If staging has no account_manager or viewer profile, record that in the report and test with whichever roles exist. Do not create users.
- [ ] **Step 7: Commit.** `git add supabase/migrations/20261102120000_client_retainers.sql tests/retainersMigration.test.ts src/types/database.ts scripts/verify-privileges.sql && git commit -m "feat(db): client_retainers and save_month_payment"`

### Task 2: The box's decisions, as pure functions

**Files:**
- Create: `src/revenue/paymentBox.ts`
- Create: `src/revenue/paymentBox.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type MonthRow = { retainer_cents: number; project_cents: number; entered_by: string | null; updated_at: string }
  export type BoxMode = 'confirm' | 'save' | 'readonly'
  export function initialFields(row: MonthRow | null): { retainer: string; project: string }
  export function effectiveRetainer(typed: string, storedRetainer: number | null): number | null
  export function shouldAskRetainer(args: { retainerEdited: boolean; retainerCents: number; storedRetainer: number | null }): boolean
  export function boxMode(args: { canEdit: boolean; row: MonthRow | null; storedRetainer: number | null; fields: { retainer: string; project: string } }): BoxMode
  export function paymentCaption(period: string): string
  export function retainerQuestion(clientName: string, period: string, storedRetainer: number | null, newCents: number): { text: string; yes: string; no: string }
  ```

Rulings these encode (from the spec plus the controller's calls):
- `initialFields(null)` returns two empty strings. With a row it returns plain-number strings of the saved cents (e.g. 400000 → `"4000"`, 12345 → `"123.45"`). They are not `formatMoney` output, so `parseMoney` reads them back to the same cents.
- `effectiveRetainer('', 400000)` returns 400000 (blank under a ghost means the ghost). `effectiveRetainer('', null)` returns 0. Otherwise it returns `parseMoney(typed)`, and null means invalid.
- `shouldAskRetainer` is true only when `retainerEdited` is true and `retainerCents !== (storedRetainer ?? 0)`.
- `boxMode` returns `'readonly'` when `!canEdit`. It returns `'confirm'` when `row === null`, `storedRetainer !== null` and both fields are blank. Otherwise it returns `'save'`.
- `paymentCaption('2026-10-01')` returns `"Invoiced in October"`.
- `retainerQuestion('Acme', '2026-10-01', 400000, 350000)` returns `{ text: "Acme's retainer is $4,000 a month in Clients admin. Change it to $3,500 from now on?", yes: 'Yes, update the retainer', no: 'No, just October' }`.
  - With `storedRetainer` null: `"Acme has no retainer in Clients admin. Set a retainer of $3,500 a month from now on?"`.
  - With `newCents` 0: `"Acme's retainer is $4,000 a month in Clients admin. Remove it from now on?"`.

- [ ] **Step 1: Write the failing tests.** Write one `it` per bullet above with those exact values, plus a round-trip test: `parseMoney(initialFields({retainer_cents: 12345, …}).retainer) === 12345`.
- [ ] **Step 2: Run it.** `npx vitest run src/revenue/paymentBox.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement it.** Month names via `formatPeriod` or the equivalent in `src/lib/month.ts`. Reuse it, don't add a second month table.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/revenue/paymentBox.ts src/revenue/paymentBox.test.ts && git commit -m "feat(revenue): payment box decisions"`

### Task 3: `useMonthPayment`, the read and the save

**Files:**
- Create: `src/revenue/useMonthPayment.ts`
- Create: `src/revenue/useMonthPayment.dom.test.ts`

**Interfaces:**
- Consumes: `save_month_payment` (Task 1) and `MonthRow` (Task 2).
- Produces:
  ```ts
  export type UseMonthPayment = {
    status: 'loading' | 'ready' | 'error' | 'off'   // 'off' = may not read revenue; no query issued
    loadError: string | null
    row: MonthRow | null
    storedRetainer: number | null
    enteredByName: string | null                   // profiles.full_name ?? email for row.entered_by
    save: (p: { retainerCents: number; projectCents: number; setRetainer: boolean }) => Promise<{ ok: true } | { ok: false; error: string }>
    reload: () => void
  }
  export function useMonthPayment(clientId: number, period: string, canRead: boolean): UseMonthPayment
  ```
- Reads: `client_month_revenue` `.select('retainer_cents, project_cents, entered_by, updated_at').eq('client_id').eq('period').maybeSingle()`, `client_retainers` `.select('monthly_cents').eq('client_id').maybeSingle()`, and the entering profile's name when `entered_by` is set.
- Save calls `supabase.rpc('save_month_payment', { p_client_id, p_period, p_retainer_cents, p_project_cents, p_set_retainer })` and then reloads. Errors go through `describeError` (`src/lib/errorText.ts`). A rejected promise is caught and becomes `{ ok: false }`, never an unhandled rejection.

- [ ] **Step 1: Write the failing tests.** Mock `../lib/supabase` the way `src/clients/useStatusChange.dom.test.ts` does. Tests:
  - `'issues no query when the person may not read revenue'`: canRead false, so status is `'off'` and `from` is never called.
  - `'reads the month row and the stored retainer'`
  - `'treats a missing retainer row as no retainer'`: storedRetainer is null.
  - `'a failed read is an error, not an empty month'`
  - `'save sends the five arguments and reloads'`: assert the exact rpc name and argument object.
  - `'a thrown save resolves to an error'`
- [ ] **Step 2: Run them.** `npx vitest run src/revenue/useMonthPayment.dom.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement it,** with a cancelled-flag guard like `useFinanceSuggestion`.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/revenue/useMonthPayment.ts src/revenue/useMonthPayment.dom.test.ts && git commit -m "feat(revenue): useMonthPayment"`

### Task 4: `PaymentsBox`

**Files:**
- Create: `src/checkin/PaymentsBox.tsx`
- Create: `src/checkin/PaymentsBox.module.css` (tokens from `src/styles/tokens.css` only, matching `EndClientPanel.module.css`)
- Create: `src/checkin/PaymentsBox.dom.test.tsx`

**Interfaces:**
- Consumes: Task 2's functions and `UseMonthPayment` (Task 3), passed in as a prop so the component tests need no Supabase.
- Produces: `export function PaymentsBox(props: { clientName: string; period: string; canEdit: boolean; payment: UseMonthPayment; onSaved: () => void }): JSX.Element | null`. It returns null when `payment.status === 'off'`.

Rendering (spec §3–4):
- **Heading and caption.** An `h3` with the text `"<Month> payments"`, then the caption from `paymentCaption`.
- **Two labelled inputs.** `Retainer` and `Project`, `inputMode="decimal"`. Retainer's placeholder is `formatMoney(storedRetainer)` when there is a stored retainer and no row, otherwise `"No retainer"`. Project's placeholder is `"$0"`.
- **The button.** The `'confirm'` mode shows the button `Confirm <formatMoney(storedRetainer)> retainer`, and `'save'` shows `Save`. Both are disabled while saving.
- **Saving.** Parse first. An invalid field shows `"<Field> is not a dollar amount up to $21,474,836.47. Nothing was saved."` with `role="alert"`. If `shouldAskRetainer` is true, show the question (from `retainerQuestion`) with its two buttons and write nothing until one is pressed. Then `payment.save(...)`, with `setRetainer` true only on "Yes". On ok, call `onSaved()`.
- **A saved row.** Show `"Entered by <name>, <shortDay>"`, or `"Entered <shortDay>"` with no name.
- **`'readonly'`.** No inputs and no buttons. With a row, show both amounts as text. With no row, show `"Not entered yet"` and never the stored retainer.
- **Loading and error.** `'loading'` shows `"Loading payments…"`. `'error'` shows `loadError` in `role="alert"`.

- [ ] **Step 1: Write the failing tests,** one per behaviour, using a fake `payment` object with `save: vi.fn().mockResolvedValue({ ok: true })`:
  - `'renders nothing for someone who may not see revenue'`
  - `'shows the stored retainer as ghost text, not as a value'`: the input's `value` is `''` and the placeholder is `'$4,000'`.
  - `'confirms the stored retainer with one click'`: save is called with `{ retainerCents: 400000, projectCents: 0, setRetainer: false }` and nothing is asked.
  - `'a project amount alone keeps the ghost retainer and asks nothing'` (Review Focus 1)
  - `'a different retainer asks before writing anything'`: save is not called until a choice is made. "No, just October" means `setRetainer: false`, and "Yes, update the retainer" means `setRetainer: true`.
  - `'typing 0 offers to remove the retainer'` (Review Focus 2)
  - `'a saved month shows its figures as values and editing only project asks nothing'` (Review Focus 3)
  - `'a client with no retainer shows No retainer and a Save button'`
  - `'an account manager sees Not entered yet and no amounts'` (Review Focus 5): the text `$4,000` appears nowhere in the box.
  - `'an account manager sees a saved month read-only'`
  - `'an invalid amount is refused and nothing is saved'`
  - `'a failed save keeps what was typed and says why'`
- [ ] **Step 2: Run them.** `npx vitest run src/checkin/PaymentsBox.dom.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement it.** Reset the fields from `initialFields(payment.row)` when `payment.row` changes identity (after reload), not on every render. That is the same reasoning as `RevenueAdmin`'s `buildEntries` effect.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/checkin/PaymentsBox.tsx src/checkin/PaymentsBox.module.css src/checkin/PaymentsBox.dom.test.tsx && git commit -m "feat(checkin): payments box"`

### Task 5: On the check-in, with finance answers following the payment

**Files:**
- Modify: `src/checkin/CheckIn.tsx` (mount the box, refresh finance)
- Modify: `src/checkin/useCheckin.ts` (`setAnswers` gains an overwrite option)
- Modify: `src/checkin/useFinanceSuggestion.ts` (a `version` argument)
- Test: `src/checkin/CheckIn.dom.test.tsx`, `src/checkin/useCheckin.dom.test.ts`, `src/checkin/useFinanceSuggestion.dom.test.ts`

**Interfaces:**
- Consumes: `PaymentsBox` (Task 4) and `useMonthPayment` (Task 3).
- Changes:
  - `setAnswers(values: Record<string, number>, options?: { overwrite?: boolean }) => void`. With `overwrite`, it replaces those keys even when present, still without persisting a local draft (keep the existing comment's reasoning), and it dispatches `'edited'` only if some value actually changed.
  - `useFinanceSuggestion(clientId, period, canReadRevenue, canReadPackages, version = 0)`: a changed `version` re-runs the read.

Placement: inside the ready branch, after `EndClientPanel` and before `SuggestionBanner`. It's built as `useMonthPayment(client.id, period, can(profile.role, 'view_revenue'))` and `canEdit={can(profile.role, 'edit_revenue')}`.

After a payment save (`onSaved`): bump a `financeVersion` state. A second effect, separate from the existing once-per-visit prefill, waits for the finance suggestion produced for that version. For each finance key the data answers, it calls `checkin.setAnswers(values, { overwrite: true })`. Keys the data still cannot answer are left alone (spec §5). The existing once-per-visit prefill is unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `useCheckin`: `'setAnswers with overwrite replaces a stored answer without persisting a draft'` and `'setAnswers with overwrite and identical values is not an edit'`.
  - `useFinanceSuggestion`: `'a new version re-reads revenue'`.
  - `CheckIn`: `'shows the payments box above the scores for someone who may see revenue'`. Assert DOM order: the payments heading precedes the first bucket heading, via `compareDocumentPosition`.
  - `CheckIn`: `'a viewer gets no payments box and no revenue query'`.
  - `CheckIn`: `'after a payment save the finance answers take the new values over the stored placeholder'`. Stored `fin_rate_increased: 3`, and the re-read suggestion says 5, so the form shows 5 and the screen reads unsaved.
  - `CheckIn`: `'a payment save keeps unsaved score edits'` (Review Focus 4). Edit `comm_timely`, save a payment, and `comm_timely` still holds the edit.

  Mock `useMonthPayment` and `useFinanceSuggestion` as module seams, the way `src/shell/Revenue.dom.test.tsx` mocks its hooks.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the whole suite.** tsc, lint and test as in Global Constraints. Expected: green. The existing `CheckIn` tests must still pass unmodified, except for adding the new hook mock.
- [ ] **Step 5: Commit.** `git add src/checkin/CheckIn.tsx src/checkin/useCheckin.ts src/checkin/useFinanceSuggestion.ts src/checkin/CheckIn.dom.test.tsx src/checkin/useCheckin.dom.test.ts src/checkin/useFinanceSuggestion.dom.test.ts && git commit -m "feat(checkin): payments above the scores; finance follows the payment"`

### Task 6: Monthly retainer in Clients admin

**Files:**
- Create: `src/clients/useRetainer.ts`, `src/clients/useRetainer.dom.test.ts`
- Modify: `src/shell/Admin.tsx` (pass `role` to `ClientsAdmin`)
- Modify: `src/clients/ClientsAdmin.tsx` (accept `role: string`, pass it on)
- Modify: `src/clients/EditClientForm.tsx` (a Monthly retainer block)
- Test: `src/clients/ClientsAdmin.dom.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function useRetainer(clientId: number, canRead: boolean): {
    status: 'loading' | 'ready' | 'error' | 'off'; loadError: string | null; monthlyCents: number | null
    save: (cents: number) => Promise<{ ok: true } | { ok: false; error: string }>   // 0 deletes the row
  }
  ```
  Save upserts or deletes `client_retainers` directly. RLS gates it on `edit_revenue`.

Ruling: the block has **its own Save button**, separate from the client form's Save, like the package recorder beside it. A failure in one write then never blocks or half-applies the other.

Block: label `Monthly retainer`, caption `"Shown on each check-in to confirm. Blank means no retainer."`.
- Admins get an input plus a `Save retainer` button.
- Account managers get the amount as text (`"$4,000 a month"` or `"No retainer"`).
- Roles without `view_revenue` get no block and no query.

Blank and `0` both save as "no retainer" (delete). Invalid input is refused with the same message shape as Task 4.

- [ ] **Step 1: Write the failing tests:**
  - `useRetainer`: `'issues no query without view_revenue'`, `'save 0 deletes the row'` and `'save upserts the amount'`.
  - `ClientsAdmin`/`EditClientForm`: `'an admin edits the monthly retainer'`, `'an account manager sees the retainer read-only'` and `'blank saves as no retainer'`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the whole suite.** It must be green as in Global Constraints.
- [ ] **Step 5: Commit.** Stage the six files explicitly. Message: `feat(clients): monthly retainer in Clients admin`.

### Task 7: Seed, ship, verify (controller with the owner — not a subagent)

- [ ] **Step 1: Look at it running against staging.** Use the existing dev server (`npx vite --port 5173`, in this worktree, against staging). Seed one staging client's retainer, then walk states 1–4 by hand. Positional claims ("above the scores") need the owner's eyes, because jsdom does no layout.
- [ ] **Step 2: Run the whole-branch review** on the most capable model, then fix anything it finds.
- [ ] **Step 3: Production migration, with the owner's go-ahead.** `apply_migration` on production. Then re-run Task 1's role checks inside `begin; … rollback;`.
- [ ] **Step 4: Seed (spec §7).** Show the owner the list first: current clients whose most recent revenue row has `retainer_cents > 0`. Insert only after a yes. The amounts never go into the repo.
- [ ] **Step 5: Merge and deploy.** Merge to `main` with the owner's go-ahead, push, watch the deploy, and confirm the live bundle hash changed and contains `save_month_payment`.
