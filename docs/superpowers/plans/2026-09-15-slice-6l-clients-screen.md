# Slice 6l — Clients Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One view button instead of two, an Edit client route from a check-in, and a client's current monthly rate on their card for admins.

**Architecture:** Three independent changes. The toggle is local to `Board.tsx`. The edit route threads one callback from `Shell` through `Board` to `CheckIn` and widens the `Destination` union by one optional field. The rate adds a pure module and a narrow admin-gated read to the board, and deliberately derives nothing for project clients.

**Tech Stack:** TypeScript, React, Supabase JS, CSS modules, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-15-slice-6l-clients-screen-design.md`

## Global Constraints

- **A missing row is never a zero.** A client with no entered revenue shows no figure at all — never `$0`.
- **This slice derives no monthly rate for project clients.** That is `fee ÷ duration`, which is the owner's boss's lifetime-value formula and belongs to its own slice. Show what is true of each kind and nothing more.
- **The revenue read is gated, not just the display.** A viewer without `manage_clients` must issue no query.
- **`can(role, capability)`** from `src/lib/capabilities.ts` is the only capability check — never a role string comparison.
- **Synthetic client names in every test.** This repository is public.
- **Money is integer cents** and is formatted with `formatMoney` from `src/revenue/money.ts`. Never `toFixed`.
- Commands: `npm test`, `npm run lint`, `npm run build`. All three must pass — `npm test` green is NOT a clean build.

---

### Task 1: One view button

**Files:**
- Modify: `src/board/Board.tsx:145-171` (the `viewToggle` block)
- Test: `src/board/Board.test.tsx:446-447` and the cases that use those helpers

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Read what is there and why**

`Board.tsx` currently renders two buttons in a `role="group"`, each with `aria-pressed`, above a comment arguing FOR that arrangement. Read the comment before changing it — the spec keeps half of its reasoning, and the replacement comment must say why.

- [ ] **Step 2: Write the failing test**

In `src/board/Board.test.tsx`, replace the two helpers at `:446-447` with one, and add the new cases. Find the existing describe block that uses `cardsButton`/`matrixButton` and update its cases to the single control.

```tsx
  // Slice 6l. One button showing the view you are NOT on, at the owner's
  // request. The visible word is the destination; the accessible name is the
  // action, which is what keeps the screen-reader half of the old two-button
  // arrangement -- a lone noun never says which view you are currently on.
  const viewButton = () => screen.getByRole('button', { name: /switch to (matrix|cards) view/i })

  it('offers the matrix while showing the cards', () => {
    given(READY)
    expect(viewButton().textContent).toBe('Matrix')
    expect(viewButton().getAttribute('aria-label')).toBe('Switch to matrix view')
  })

  it('offers the cards once the matrix is showing', async () => {
    given(READY)
    await userEvent.click(viewButton())
    expect(viewButton().textContent).toBe('Cards')
    expect(viewButton().getAttribute('aria-label')).toBe('Switch to cards view')
  })

  it('carries no aria-pressed, because it is not a toggle', () => {
    // A control whose action changes on every press has no pressed state to
    // report. aria-pressed here would announce a lie on one of the two views.
    given(READY)
    expect(viewButton().hasAttribute('aria-pressed')).toBe(false)
  })
```

**The helper in that file is `given(state)`** (`Board.test.tsx:106`), which mocks `useBoard` and renders `<Board profile={PROFILE} />` with the profile hard-coded. Use `given()` for these three cases — none of them needs a different role. Task 3 has to widen it; that is Task 3's problem, not this one.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/board/Board.test.tsx`
Expected: FAIL — no button with an accessible name matching `switch to … view`.

- [ ] **Step 4: Write the implementation**

Replace the `viewToggle` block in `src/board/Board.tsx`:

```tsx
  // ONE button, showing the view you are not on. The owner asked for this
  // directly: "I'd like this to just be one button... when you're on cards, it
  // shows matrix, and when you're on the matrix, the button changes to cards."
  //
  // This replaces a PAIR of buttons whose own comment argued against exactly
  // this change -- that a lone "Matrix" gives no indication which view you are
  // currently on, where aria-pressed on a pair does. That objection was about
  // screen readers rather than taste, so it is kept rather than discarded: the
  // VISIBLE word is the destination the owner wanted, and the ACCESSIBLE NAME
  // is the action. A sighted reader gets one clean control; a screen-reader
  // user hears "Switch to matrix view" instead of a bare noun.
  //
  // No aria-pressed. A control whose action changes on every press has no
  // pressed state to report, and announcing one would be a lie on one of the
  // two views.
  //
  // Deliberately not in the empty-roster branch below. A view switch that
  // reveals a second empty screen is a control with nothing to control.
  const nextView = view === 'cards' ? 'matrix' : 'cards'
  const viewToggle = (
    <button
      aria-label={`Switch to ${nextView} view`}
      className="button button--quiet"
      onClick={() => setView(nextView)}
      type="button"
    >
      {nextView === 'matrix' ? 'Matrix' : 'Cards'}
    </button>
  )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/board/Board.test.tsx`
Expected: PASS.

- [ ] **Step 6: Prove the accessible name is load-bearing**

Temporarily delete the `aria-label` line. Run: `npx vitest run src/board/Board.test.tsx`
Expected: FAIL — the button can no longer be found by its accessible name.

Restore it and re-run. Expected: PASS. Report what you observed.

- [ ] **Step 7: Check the styles**

`styles.viewToggle` was the wrapper's class and the wrapper is gone. Run `grep -n "viewToggle" src/board/Board.module.css src/board/Board.tsx`. If the rule is now unused, delete it — a dead selector is the next person's confusion. If it still applies to something, leave it.

- [ ] **Step 8: Full verification**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/board/Board.tsx src/board/Board.test.tsx src/board/Board.module.css
git commit -m "feat(board): one view button, showing the view you are not on

The owner's request, verbatim: one button that says Matrix while you are
on cards and Cards while you are on the matrix.

It replaces a pair whose own comment argued against exactly this -- that
a lone noun never says which view you are currently on, where
aria-pressed on a pair does. That objection was about screen readers
rather than taste, so it is kept: the visible word is the destination,
and the accessible name is the action. Nothing is lost.

No aria-pressed. A control whose action changes on every press has no
pressed state to report, and announcing one would be a lie on one of the
two views."
```

---

### Task 2: Edit a client from their check-in

**Files:**
- Modify: `src/shell/destination.ts:18-22` (the `Destination` union)
- Modify: `src/shell/Shell.tsx:110` (pass `onEditClient` to `Board`)
- Modify: `src/shell/Admin.tsx:71` (pass `editClientId` to `ClientsAdmin`)
- Modify: `src/board/Board.tsx` (accept `onEditClient`, hand it to `CheckIn`)
- Modify: `src/checkin/CheckIn.tsx:131` (the Edit client button, beside Back)
- Modify: `src/clients/ClientsAdmin.tsx:28-35` (accept an initial `editClientId`)
- Test: `src/checkin/CheckIn.dom.test.tsx`, `src/clients/ClientsAdmin.dom.test.tsx`, `src/shell/destination.test.ts` if one exists

**Interfaces:**
- Consumes: `can` from `../lib/capabilities`.
- Produces:
  - `Destination` gains `| { kind: 'admin'; section: AdminSection; editClientId?: number }` — replacing the existing admin arm.
  - `Board` gains prop `onEditClient: (clientId: number) => void`.
  - `CheckIn` gains prop `onEditClient?: () => void` — optional, because the check-in screen is reachable in tests without it.
  - `ClientsAdmin` gains prop `editClientId?: number`.

- [ ] **Step 1: Widen the union**

In `src/shell/destination.ts`, replace the admin arm:

```ts
  // editClientId is OPTIONAL AND ONLY MEANINGFUL WHEN section is 'clients'.
  // That is precisely the looseness this union was written to avoid -- its
  // comment above asks for each impossible combination to be a compile error.
  // It is the price of opening a client's edit form from their check-in, and
  // the alternatives are recorded in the slice 6l spec section 5: a separate
  // destination kind means two routes to one screen and a menu bar that has to
  // know one of them is not a menu item.
  //
  // An id here is a REQUEST, NOT A PROMISE. ClientsAdmin opens that client if
  // it has them and renders its ordinary list if it does not.
  | { kind: 'admin'; section: AdminSection; editClientId?: number }
```

- [ ] **Step 2: Write the failing test for the admin screen**

In `src/clients/ClientsAdmin.dom.test.tsx`, add:

```tsx
  it('opens the named client for editing on arrival', () => {
    // Arriving from a check-in with "Edit client". ClientsAdmin already held
    // an editingId; this gives it an initial value rather than a new mechanism.
    renderAdmin({ editClientId: 1 })   // see the note below

    expect(screen.getByLabelText(/name/i)).toBeTruthy()
  })

  it('renders its ordinary list when the id names nobody', () => {
    // A stale request -- the client was archived between the board and here.
    // The screen must not look broken: no error, no empty state.
    renderAdmin({ editClientId: 9999 })

    expect(screen.queryByLabelText(/name/i)).toBeNull()
    expect(screen.getByText('Acme')).toBeTruthy()
  })
```

**That file's helper takes no props** — it is a bare `render(<ClientsAdmin onWritingChange={onWritingChange} />)` at `:77`, inside a function with no parameters. Extend THAT function to accept and forward `editClientId` rather than adding a second helper, and name it `renderAdmin` only if it is already called that; otherwise keep its existing name and adjust these two cases to match. Its client fixture is built by `client(overrides)` at `:30` and the roster comes from `hook(overrides)` at `:49` — the "names nobody" case needs a client actually present, so give it one named `Acme`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/clients/ClientsAdmin.dom.test.tsx`
Expected: FAIL — the form does not open.

- [ ] **Step 4: Give ClientsAdmin an initial editing id**

In `src/clients/ClientsAdmin.tsx`, change the props and the state initialiser:

```tsx
export function ClientsAdmin({ editClientId, onWritingChange }: Props) {
  // An INITIAL value, not a new mechanism: the screen has always held
  // editingId, and arriving from a check-in simply says which one to start on.
  // If the id names a client this screen does not have -- archived since, or a
  // stale request -- `editing` resolves to null below and the ordinary list
  // renders. The id is a request, not a promise.
  const [editingId, setEditingId] = useState<number | null>(editClientId ?? null)
```

and add `editClientId?: number` to that file's `Props` type.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/clients/ClientsAdmin.dom.test.tsx`
Expected: PASS.

- [ ] **Step 6: Thread the prop through Admin**

In `src/shell/Admin.tsx`, the `clients` case becomes:

```tsx
      case 'clients':
        return <ClientsAdmin editClientId={editClientId} onWritingChange={onWritingChange} />
```

and `Admin`'s own props gain `editClientId?: number`, passed down from `Shell`.

- [ ] **Step 7: Write the failing test for the check-in button**

In `src/checkin/CheckIn.dom.test.tsx`:

```tsx
  // The helper is `renderAs(role, overrides)` at CheckIn.dom.test.tsx:81 and it
  // hard-codes onBack and the client. It must be widened to forward
  // onEditClient -- extend that function, do not add a second one.
  //
  // The roles are admin | account_manager | viewer (src/lib/capabilities.ts).
  // `admin` and `account_manager` both carry manage_clients; `viewer` carries
  // only view_scores, so it is the one that must NOT see this button.
  it('offers Edit client to someone who can manage clients', () => {
    const onEditClient = vi.fn()
    renderAs('account_manager', {}, { onEditClient })

    fireEvent.click(screen.getByRole('button', { name: /edit client/i }))
    expect(onEditClient).toHaveBeenCalled()
  })

  it('offers it to nobody else', () => {
    // Capability, never a role string: `can` is the only check in this app.
    renderAs('viewer', {}, { onEditClient: vi.fn() })

    expect(screen.queryByRole('button', { name: /edit client/i })).toBeNull()
  })
```

Widen `renderAs` to a third parameter carrying `CheckIn`'s new optional props, defaulting to `{}`, so every existing call site keeps working untouched.

- [ ] **Step 8: Run test to verify it fails**

Run: `npx vitest run src/checkin/CheckIn.dom.test.tsx`
Expected: FAIL — no Edit client button.

- [ ] **Step 9: Add the button**

In `src/checkin/CheckIn.tsx`, beside the existing Back button at `:131`:

```tsx
      {onEditClient !== undefined && can(profile.role, 'manage_clients') && (
        // The owner: "when I click into a card, I'd love for there to be an
        // option to hit edit client and it takes you into the client roster's
        // edit panel". Same capability the board checks before offering Add
        // client -- reused rather than a second rule about who may edit.
        <button className="button button--quiet" onClick={onEditClient} type="button">
          Edit client
        </button>
      )}
```

Add `onEditClient?: () => void` to `Props` and to the destructured parameters, and import `can` from `../lib/capabilities`.

- [ ] **Step 10: Thread it from the shell**

`Board` gains `onEditClient: (clientId: number) => void` in its `Props` and passes it down:

```tsx
        onEditClient={() => onEditClient(selected.id)}
```

on the `<CheckIn>` element at `Board.tsx:103`.

`Shell.tsx:110` becomes:

```tsx
        return (
          <Board
            key={clientsVisit}
            // Only the shell knows what a destination is. The board has not
            // navigated since slice 6a -- "Navigation left this file" -- and
            // this keeps that true: it forwards an id and learns nothing about
            // routing.
            onEditClient={(clientId) =>
              setDestination({ kind: 'admin', section: 'clients', editClientId: clientId })
            }
            profile={profile}
          />
        )
```

and `Shell` passes `destination.editClientId` into `<Admin>` in its `admin` case.

- [ ] **Step 11: Run the full suite**

Run: `npm test && npm run lint && npm run build`
Expected: all pass. TypeScript will name any component you missed in the chain.

- [ ] **Step 12: Prove the gate is real**

Temporarily change the button's condition to `onEditClient !== undefined &&` alone, dropping the `can(...)`.

Run: `npx vitest run src/checkin/CheckIn.dom.test.tsx`
Expected: FAIL — "offers it to nobody else".

Restore and re-run. Report what you observed.

- [ ] **Step 13: Commit**

```bash
git add src/shell/destination.ts src/shell/Shell.tsx src/shell/Admin.tsx \
        src/board/Board.tsx src/checkin/CheckIn.tsx src/clients/ClientsAdmin.tsx \
        src/checkin/CheckIn.dom.test.tsx src/clients/ClientsAdmin.dom.test.tsx
git commit -m "feat(clients): edit a client from their check-in

The owner: 'when I click into a card, I'd love for there to be an option
to hit edit client and it takes you into the client roster's edit
panel.'

Destination gains an optional editClientId, which is exactly the
looseness that union was written to avoid -- it asks for impossible
combinations to be compile errors, and an id that only means anything
for one section is not that. It is the price of the feature; a separate
destination kind was considered and rejected because it means two routes
to one screen.

The id is a REQUEST, NOT A PROMISE: ClientsAdmin opens that client if it
has them and renders its ordinary list if it does not, because a stale
id must not leave the screen looking broken.

Only the shell knows what a destination is. The board has not navigated
since 6a and still does not -- it forwards an id."
```

---

### Task 3: A client's current monthly rate, on their card

**Files:**
- Create: `src/board/rateMath.ts`
- Create: `src/board/rateMath.test.ts`
- Create: `src/board/useClientRates.ts`
- Modify: `src/board/Board.tsx` (call the hook when the viewer may see it, pass the rate to each card)
- Modify: `src/board/ClientCard.tsx` (render it)
- Modify: `src/board/ClientCard.dom.test.tsx`

**Interfaces:**
- Consumes: `formatMoney` from `../revenue/money`; `can` from `../lib/capabilities`.
- Produces:
  - `type RateRow = { client_id: number; period: string; retainer_cents: number; project_cents: number }`
  - `type ClientRate = { cents: number; kind: 'retainer' | 'project' }`
  - `currentRates(rows: readonly RateRow[]): Map<number, ClientRate>`
  - `useClientRates(enabled: boolean): { status: 'loading' | 'ready' | 'error'; rates: Map<number, ClientRate> }`
  - `ClientCard` gains prop `rate?: ClientRate`.

- [ ] **Step 1: Write the failing test**

Create `src/board/rateMath.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { currentRates } from './rateMath'
import type { RateRow } from './rateMath'

// Synthetic ids only; this repository is public.
function row(client_id: number, period: string, retainer_cents: number, project_cents = 0): RateRow {
  return { client_id, period, retainer_cents, project_cents }
}

describe('currentRates — what a client is worth per month, now', () => {
  it('reads a retainer client as their latest retainer figure', () => {
    const rates = currentRates([
      row(1, '2026-08-01', 400_000),
      row(1, '2026-09-01', 500_000),
    ])
    expect(rates.get(1)).toEqual({ cents: 500_000, kind: 'retainer' })
  })

  it('reads a project-only client as their latest project fee, NOT a monthly rate', () => {
    // This slice derives nothing for project clients. Fee over duration is the
    // owner's boss's lifetime-value formula and belongs to its own slice;
    // guessing it here and correcting it there is work done twice.
    const rates = currentRates([row(2, '2026-09-01', 0, 900_000)])
    expect(rates.get(2)).toEqual({ cents: 900_000, kind: 'project' })
  })

  it('gives a client with nothing entered NO rate, rather than zero', () => {
    // A missing row is not a zero anywhere in this codebase, and a health card
    // reading $0 says the agency bills them nothing rather than that nobody
    // has typed it.
    expect(currentRates([]).get(3)).toBeUndefined()
  })

  it('gives a client whose latest month is an explicit zero NO rate either', () => {
    // An entered zero is a fact about a month, not a rate. "They are a $0 a
    // month client" is not what that row says.
    const rates = currentRates([row(4, '2026-09-01', 0, 0)])
    expect(rates.get(4)).toBeUndefined()
  })

  it('takes the latest month per client, not the latest month overall', () => {
    // A client who stopped billing in July still has a July rate; reading the
    // roster's latest month would give them nothing.
    const rates = currentRates([
      row(5, '2026-07-01', 300_000),
      row(6, '2026-09-01', 800_000),
    ])
    expect(rates.get(5)).toEqual({ cents: 300_000, kind: 'retainer' })
  })

  it('prefers the retainer when a month holds both', () => {
    // A retainer client who also had a project that month is still a retainer
    // client, and the retainer is the recurring half -- which is what "rate"
    // means here.
    const rates = currentRates([row(7, '2026-09-01', 500_000, 200_000)])
    expect(rates.get(7)).toEqual({ cents: 500_000, kind: 'retainer' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/board/rateMath.test.ts`
Expected: FAIL — cannot find module `./rateMath`.

- [ ] **Step 3: Write the implementation**

Create `src/board/rateMath.ts`:

```ts
// What a client is worth per month, now, for their card on the board.
//
// THIS MODULE DERIVES NOTHING FOR PROJECT CLIENTS, deliberately. A retainer
// client has a monthly rate: it is what they bill in a month. A project client
// does not, and inventing one means fee over duration -- which is exactly the
// formula the owner's boss described at a whiteboard for lifetime value, and
// which has its own slice waiting on a photograph of it. Guessing it here and
// correcting it there is work done twice, in the one place a wrong figure
// would be read as a fact about a client's worth.
//
// Pure, and separate from the read for the same reason every other pair in
// this codebase is: these rules are testable without a database or a DOM.

export type RateRow = {
  client_id: number
  period: string
  retainer_cents: number
  project_cents: number
}

export type ClientRate = { cents: number; kind: 'retainer' | 'project' }

/**
 * The latest month each client actually billed in, as a rate.
 *
 * PER CLIENT, not the roster's latest month. A client who stopped billing in
 * July still has a July rate, and reading everybody against September would
 * silently give them nothing -- which the card would then show as "no revenue
 * entered", a different and untrue statement.
 *
 * A month of zero yields NO RATE. An entered zero is a fact about a month, not
 * a rate: "they are a nothing-a-month client" is not what that row says, and a
 * card reading zero would claim the agency bills them nothing.
 */
export function currentRates(rows: readonly RateRow[]): Map<number, ClientRate> {
  const latest = new Map<number, RateRow>()
  for (const row of rows) {
    if (row.retainer_cents === 0 && row.project_cents === 0) continue
    const held = latest.get(row.client_id)
    // Periods are YYYY-MM-01 strings and compare correctly as strings, which is
    // why nothing here parses a Date -- the trap tenureMath documents at length.
    if (held === undefined || row.period > held.period) latest.set(row.client_id, row)
  }

  const rates = new Map<number, ClientRate>()
  for (const [clientId, row] of latest) {
    // The retainer wins a month that holds both. A retainer client who also ran
    // a project is still a retainer client, and the retainer is the recurring
    // half -- which is what "rate" means.
    rates.set(
      clientId,
      row.retainer_cents > 0
        ? { cents: row.retainer_cents, kind: 'retainer' }
        : { cents: row.project_cents, kind: 'project' },
    )
  }
  return rates
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/board/rateMath.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Mutate the two rules that carry the weight**

Change `if (row.retainer_cents === 0 && row.project_cents === 0) continue` to `if (false) continue`.
Run: `npx vitest run src/board/rateMath.test.ts` — expected FAIL on "explicit zero".
Restore.

Change `row.period > held.period` to `row.period < held.period`.
Run: `npx vitest run src/board/rateMath.test.ts` — expected FAIL on "reads a retainer client as their latest".
Restore and re-run. Report both.

- [ ] **Step 6: Write the read**

Create `src/board/useClientRates.ts`, following the shape of `src/revenue/useRevenue.ts` (status/loadError/useCallback, `isCancelled` guard). Read it first and match its structure.

```ts
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { currentRates } from './rateMath'
import type { ClientRate, RateRow } from './rateMath'

// The board's own narrow revenue read.
//
// NOT useRetention, which reads the same table for a different purpose. Its
// whole-table read is justified by what retention needs, not by what a card
// needs, and a hook named for retention living inside the board is a boundary
// worth more than the file it would save.
//
// GATED AT THE READ, NOT THE RENDER. `enabled` is false for a viewer without
// manage_clients and no query is issued at all -- hiding a figure that was
// already fetched is not a permission check.

export function useClientRates(enabled: boolean): {
  status: 'loading' | 'ready' | 'error'
  rates: Map<number, ClientRate>
} {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    enabled ? 'loading' : 'ready',
  )
  const [rates, setRates] = useState<Map<number, ClientRate>>(new Map())

  const load = useCallback(
    async (isCancelled: () => boolean) => {
      if (!enabled) return
      setStatus('loading')
      const { data, error } = await supabase
        .from('client_month_revenue')
        .select('client_id, period, retainer_cents, project_cents')
      if (isCancelled()) return
      if (error) {
        setStatus('error')
        return
      }
      setRates(currentRates((data ?? []) as RateRow[]))
      setStatus('ready')
    },
    [enabled],
  )

  useEffect(() => {
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load])

  return { status, rates }
}
```

- [ ] **Step 7: Render it on the card**

In `src/board/ClientCard.tsx`, add `rate?: ClientRate` to `Props` and render beneath the score:

```tsx
      {rate !== undefined && (
        <p className="t-caption" data-testid="client-card-rate">
          {formatMoney(rate.cents)}
          {rate.kind === 'retainer' ? ' a month' : ' project work'}
        </p>
      )}
```

In `src/board/Board.tsx`, call the hook once and pass each card its rate:

```tsx
  // Gated at the READ. can() is the only capability check in this app, and the
  // board already asks it for Add client.
  const canSeeRates = can(profile.role, 'manage_clients')
  const { rates } = useClientRates(canSeeRates)
```

then `rate={rates.get(client.id)}` on each `<ClientCard>`.

- [ ] **Step 8: Test the card and the gate**

In `src/board/ClientCard.dom.test.tsx`:

```tsx
  it('shows a retainer client their monthly rate', () => {
    renderCard({ rate: { cents: 500_000, kind: 'retainer' } })
    expect(screen.getByTestId('client-card-rate').textContent).toMatch(/\$5,000 a month/)
  })

  it('names project work rather than calling it a monthly rate', () => {
    renderCard({ rate: { cents: 900_000, kind: 'project' } })
    expect(screen.getByTestId('client-card-rate').textContent).toMatch(/project work/)
    expect(screen.getByTestId('client-card-rate').textContent).not.toMatch(/a month/)
  })

  it('shows nothing at all when there is no rate', () => {
    // Not $0. A missing row is not a zero anywhere in this codebase.
    renderCard({})
    expect(screen.queryByTestId('client-card-rate')).toBeNull()
  })
```

Use the file's existing render helper; extend it to forward props rather than adding a second.

- [ ] **Step 9: Test that the read itself is gated**

In `src/board/Board.test.tsx`:

```tsx
  it('issues no revenue read for a viewer who may not see rates', () => {
    // THE HALF A LAZY TEST SKIPS. Hiding a figure that was already fetched is
    // not a permission check -- the query must not happen.
    //
    // This file mocks useBoard, not the Supabase client, so the assertion is on
    // the hook's own argument: useClientRates(false) issues nothing. Mock
    // useClientRates alongside useBoard at the top of the file.
    vi.mocked(useClientRates).mockClear()
    givenAs('viewer')

    expect(vi.mocked(useClientRates)).toHaveBeenCalledWith(false)
  })

  it('does read them for a viewer who may', () => {
    vi.mocked(useClientRates).mockClear()
    givenAs('account_manager')

    expect(vi.mocked(useClientRates)).toHaveBeenCalledWith(true)
  })
```

`given(state)` at `:106` hard-codes `<Board profile={PROFILE} />`, so these two cases need a variant that takes a role — add `givenAs(role, state = {})` beside it rather than changing `given`'s signature and every existing call.

- [ ] **Step 10: Full verification**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add src/board/rateMath.ts src/board/rateMath.test.ts src/board/useClientRates.ts \
        src/board/Board.tsx src/board/Board.test.tsx \
        src/board/ClientCard.tsx src/board/ClientCard.dom.test.tsx
git commit -m "feat(board): what a client is worth per month, on their card

The owner: 'If I have admin access, I'd love to be able to see revenue
in the card itself.' He chose the current monthly rate over a rolling
year, the shown month, or lifetime billing.

IT DERIVES NOTHING FOR PROJECT CLIENTS. A retainer client has a monthly
rate; a project client does not, and inventing one means fee over
duration -- which is exactly the lifetime-value formula his boss
described at a whiteboard, and which has its own slice waiting on a
photograph. A project client's card names their latest project fee as
project work, and says no more than that.

A client with nothing entered shows no figure at all, and so does one
whose latest month is an explicit zero. An entered zero is a fact about
a month, not a rate.

The read is gated, not just the display: a viewer without manage_clients
issues no query. Hiding a figure already fetched is not a permission
check."
```

---

## Not in this plan

- **The archived roster** (spec §4). The board fell from 31 clients to 19 because the backfill created twenty-nine departures. That is correct behaviour and it is the owner's to rule on; nothing here changes it.
- **The derived monthly rate for project clients**, which is the lifetime-value slice.
- **The Overview page**, which the owner put last on purpose.
