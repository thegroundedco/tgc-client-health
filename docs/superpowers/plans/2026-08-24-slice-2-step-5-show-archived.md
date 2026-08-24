# Slice 2 Step 5 — The Board's Show-Archived Toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the board a way to show the clients it currently hides — paused, cancelled and former — without ever letting them be counted as check-ins that are owed, or scored as though they were still clients.

**Architecture:** The board's query stops filtering by status and the filtering moves into the browser, behind one `useState` toggle. Every decision that filtering implies — which statuses are on the board by default, what the toggle says, what order a mixed list reads in, and whether a card can be opened — lives in one new pure module (`src/board/boardScope.ts`) that imports no React and no Supabase client. The status vocabulary is not re-declared: it is imported from `src/clients/clientForm.ts`, which is already pinned against the database's check constraint by `tests/clientFormDrift.test.ts`.

**Tech Stack:** React 19.2.8, TypeScript 6.0.2 (`strict`, `verbatimModuleSyntax`, `erasableSyntaxOnly`), Vite 8.2.0, Vitest 4.1.11 (`environment: 'node'` by default, jsdom opt-in per file), `@supabase/supabase-js` 2.112.3, `@testing-library/react` 16, oxlint 1.75.0.

**Spec:** `docs/superpowers/specs/2026-08-23-phase-1-slice-2-design.md` — §2 item 5 and §4's step table. The binding requirement is in the **parent** spec, `docs/superpowers/specs/2026-08-20-tgc-client-health-design.md` §6.1: "`former` is hidden from the board behind a 'show archived' toggle." Parent §9.3's status-colour rule and §8.1's two interaction rules also bind.

---

## Global Constraints

- **No migration and no database change.** Step 1 built the lifecycle columns; step 4 shipped the screen that writes them. This step only changes what the board reads and draws. If a task seems to want a migration, the plan is wrong — stop and say so.
- **No delete of a client, anywhere.** `checkins.client_id` is `on delete cascade` and this project has no backups. Spec §2, §10 decision 5.
- **Colour is never the only signal.** Parent spec §9.3: luminance separation between the brand's status fills is inherently weak (teal against warm red is 1.76:1), so "the distinction rests on **hue plus a mandatory text label**, never on brightness… Any future status indicator follows the same rule." Every status marker this step adds carries its word.
- **Every colour and every typeface lives in `src/styles/tokens.css`.** `tests/tokens.test.ts` walks every `.ts`/`.tsx`/`.css` file under `src/` — comments included — and fails on a hex literal, a colour function, a named CSS colour after a colour property, the `font` shorthand, or a `font-family` that is not a single `var(--face-…)` reference.
- **`base.css` holds what more than one screen uses.** Its own header states the rule: "Anything used by more than one screen belongs here; anything used by exactly one belongs in that component's `.module.css`."
- **Tests that read the filesystem live in `tests/`, never under `src/`.** `tsconfig.app.json` has `include: ["src"]` and no node types. Files under `tests/` import from `src/` **with the `.ts` extension** (`tsconfig.node.json` uses `module: nodenext`).
- **`verbatimModuleSyntax`** — every type-only import spelled `import type`. **`noUnusedLocals` / `noUnusedParameters`** — an unused import fails `npm run build`, not just lint. **`erasableSyntaxOnly`** — generics and type annotations are fine; `enum`, parameter properties and namespaces are not.
- **Three gates green before every commit:** `npm test`, `npm run build`, `npm run lint`. Read counts off the real output; never type one from memory.
- **Never write after a failed read** (parent §8.1), and **a failed read must never render as an empty-but-working screen** — the founding defect of this project's predecessor.

---

## Five things measured before this plan was written

Each changed a task below. The commands that produced them are in the task steps.

1. **`useBoard.ts` carries a comment that this step makes false.** At the `submitted` count it says: *"Only active clients are counted, **because only active clients were read**."* The moment the query stops filtering, the reason is wrong even though the behaviour must stay right. Task 2 rewrites it. On this project a comment whose claim is false is a defect, not a style nit.
2. **`BoardClient` is `{ id: number; name: string }`** (`src/board/useBoard.ts:7`). Adding `status` to it breaks three construction sites at compile time, which is the point — but they must be updated in the same task: `src/board/ClientCard.dom.test.tsx:13` and `src/board/Board.test.tsx:200`. `src/checkin/CheckIn.tsx:12` declares its own narrower `client: { id: number; name: string }` and is structurally satisfied by a wider object, so the check-in screen needs no change. `src/checkin/CheckIn.test.tsx:45` builds its own literal against that narrower type and also needs none.
3. **`sortClients` already contains the ranking this step needs**, inline at `src/clients/clientForm.ts:359-362`. Task 1 extracts it as `statusRank` and has `sortClients` call it, so the board and the admin screen cannot disagree about what order statuses read in.
4. **The status pill exists, in one screen's module.** `src/clients/ClientsAdmin.module.css` defines `.statusPill` and `.statusPillEnded`. The board now needs the same marker, which by `base.css`'s own rule makes it global. Task 3 moves it.
5. **RLS does not stop a check-in being written for a former client.** `checkins_insert_edit_scores` gates on the `edit_scores` capability and has no status predicate — verified by reading `supabase/migrations/20260824160306_has_capability.sql`. Today that is unreachable because the board never draws a former client. Revealing the cards creates the path, so Task 3 must close it in the UI; nothing else will.

---

## Six decisions, with what they cost if wrong

1. **The toggle reveals every client that is not `active` — paused, cancelled and former — not only `former`.** The parent spec names only `former`. But the board has only ever read `active`, so `paused` and `cancelled` are invisible today with no way at all to see them, and step 4's `STATUS_HINTS` — the sentence a person actually reads on screen — already promises `paused` is "Off the board." One toggle for "not active" is the coherent reading of an intent the spec expressed before `paused` had that meaning. Cost if wrong: the toggle shows two statuses the spec did not ask it to, each clearly labelled. Three separate toggles for a five-person agency tool is the alternative, and it is worse.
2. **The progress line counts active clients only, whatever the toggle says.** This is the sharpest point in the step. `progressLine(submitted, total)` renders "N of M check-ins submitted this month"; if M grew when the toggle was pressed, the board would claim check-ins are owed for clients who have left. Cost if wrong: a false number on the one line of this app that reports completeness — the exact class of defect Slice 1 was rewritten to eliminate.
3. **An archived card cannot be opened.** Its name renders as text, not a button. See measured fact 5: the policies permit the write, so the UI is the only thing standing between a revealed former client and a check-in row that says somebody scored them after they left. Cost if wrong: reading a former client's last check-in needs the reporting views (Phase 3) rather than a click. That is the right trade on a database with no backups.
4. **The toggle does not persist across a reload.** A plain `useState`, default off. Consistent with the board's other state-based navigation (Slice 1 §5.1: no router, so a refresh returns to the working view). Cost if wrong: somebody who wants the archived view every time presses one button each visit.
5. **The status marker is global CSS, moved rather than copied.** Measured fact 4 and `base.css`'s own rule. Cost if wrong: one class is defined in a file the clients screen no longer owns alone — which is the point.
6. **A mixed list sorts active first, then by status, then by name.** Name order alone would interleave a former client between two active ones, so the working roster would stop reading as a block. Reuses `statusRank` from Task 1. Cost if wrong: none identified; the alternative is a grid whose reading order does not match its meaning.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/clients/clientForm.ts` | **Modify.** Extract `statusRank(status: string): number` from `sortClients`'s inline `rank`, and export it. | 1 |
| `src/clients/clientForm.test.ts` | **Modify.** Two tests for `statusRank`. | 1 |
| `src/board/boardScope.ts` | **Create.** Every decision the toggle implies, as pure functions: the default scope, the toggle's label, the visible list, the sort, and whether a card is openable. No React, no Supabase. | 1 |
| `src/board/boardScope.test.ts` | **Create.** Node environment. | 1 |
| `src/board/useBoard.ts` | **Modify.** Drop the status filter, widen `BoardClient`, add `activeTotal`, rewrite the stale comment. | 2 |
| `src/board/useBoard.dom.test.ts` | **Create.** Pins the query's absence of a status filter and the active-only counts. Follows `src/clients/useClients.dom.test.ts`, the hook-test precedent set in step 4. | 2 |
| `src/board/ClientCard.dom.test.tsx` | **Modify.** Its `CLIENT` literal gains `status`; new cases for an archived card. | 2, 3 |
| `src/styles/base.css` | **Modify.** Receives `.status-pill` and `.status-pill--ended`. | 3 |
| `src/clients/ClientsAdmin.module.css` | **Modify.** Loses its local `.statusPill` / `.statusPillEnded`. | 3 |
| `src/clients/ClientsAdmin.tsx` | **Modify.** Uses the global classes. | 3 |
| `src/board/ClientCard.tsx` | **Modify.** Draws the status marker and refuses to open an archived client. | 3 |
| `src/board/ClientCard.module.css` | **Modify.** Layout for the un-openable name. | 3 |
| `src/board/Board.tsx` | **Modify.** The toggle, and the progress line reading `activeTotal`. | 4 |
| `src/board/Board.module.css` | **Modify.** The toggle row. | 4 |
| `src/board/Board.test.tsx` | **Modify.** Its `READY` fixture gains `status`/`activeTotal`; new toggle cases. | 4 |
| `README.md` | **Modify.** One section on what the toggle shows and what it refuses. | 4 |

---

### Task 1: The decisions the toggle implies

**Files:**
- Modify: `src/clients/clientForm.ts:358-368`
- Modify: `src/clients/clientForm.test.ts`
- Create: `src/board/boardScope.ts`
- Create: `src/board/boardScope.test.ts`

**Interfaces:**
- Consumes: `CLIENT_STATUSES`, `ClientStatus`, `statusLabel`, `isChurned` from `src/clients/clientForm.ts`.
- Produces:
  - `statusRank(status: string): number` (new export from `clientForm.ts`)
  - `type ScopedClient = { id: number; name: string; status: string }`
  - `isOnBoard(status: string): boolean`
  - `archivedCount(clients: readonly ScopedClient[]): number`
  - `activeCount(clients: readonly ScopedClient[]): number`
  - `visibleClients<T extends ScopedClient>(clients: readonly T[], showArchived: boolean): T[]`
  - `toggleLabel(archived: number, showArchived: boolean): string`
  - `isOpenable(status: string): boolean`
  - `notOpenableReason(status: string): string`

- [ ] **Step 1: Read what you are extracting, and confirm the vocabulary is already pinned**

```bash
sed -n '350,370p' src/clients/clientForm.ts
grep -n "statusRank\|const rank" src/clients/clientForm.ts
sed -n '1,20p' tests/clientFormDrift.test.ts
```

Expected: `sortClients` holds an inline `const rank = (status: string) => …` using `CLIENT_STATUSES.indexOf`, and there is no `statusRank` yet. `tests/clientFormDrift.test.ts` pins `CLIENT_STATUSES` against the migration's check constraint — which is why this task imports that vocabulary instead of declaring a second copy.

- [ ] **Step 2: Write the failing tests for `statusRank`**

Append to `src/clients/clientForm.test.ts`, inside the existing `describe('the list order', …)` block, and add `statusRank` to that file's import list from `./clientForm`:

```ts
  it('ranks the four statuses in board-reading order', () => {
    expect(CLIENT_STATUSES.map(statusRank)).toEqual([0, 1, 2, 3])
  })

  it('ranks a status it does not know after all the ones it does', () => {
    // Not -1, which would sort an unknown status FIRST and put a row nobody
    // meant at the top of the board.
    expect(statusRank('archived')).toBe(CLIENT_STATUSES.length)
  })
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/clients/clientForm.test.ts`
Expected: FAIL — `statusRank is not a function`, or a build error on the missing export. Confirm with `npm run build` if the test run alone is ambiguous.

- [ ] **Step 4: Extract `statusRank`**

Replace `src/clients/clientForm.ts:358-368` with:

```ts
// The order statuses read in, extracted from sortClients in Slice 2 step 5 so
// the board and this screen cannot disagree about it. An unknown status ranks
// LAST rather than -1: -1 would sort a status nobody meant to the top of the
// board, which is the opposite of what an unrecognised value deserves.
export function statusRank(status: string): number {
  const index = CLIENT_STATUSES.indexOf(status as ClientStatus)
  return index === -1 ? CLIENT_STATUSES.length : index
}

// Status then name, so the active roster reads first (spec §7). A status the
// four do not cover sorts last rather than being dropped: this screen is the
// only place such a row is visible at all.
export function sortClients(rows: readonly AdminClient[]): AdminClient[] {
  // Copied first: sorting the array the hook holds in state would mutate it in
  // place, and React compares by identity.
  return [...rows].sort(
    (a, b) => statusRank(a.status) - statusRank(b.status) || a.name.localeCompare(b.name),
  )
}
```

- [ ] **Step 5: Green, and confirm nothing else moved**

Run: `npx vitest run src/clients/clientForm.test.ts`
Expected: PASS, including every pre-existing `sortClients` test — those are what prove the extraction changed no behaviour.

- [ ] **Step 6: Write the failing tests for `boardScope.ts`**

Create `src/board/boardScope.test.ts` (node environment — no pragma needed):

```ts
import { describe, expect, it } from 'vitest'
import { CLIENT_STATUSES } from '../clients/clientForm'
import {
  activeCount,
  archivedCount,
  isOnBoard,
  isOpenable,
  notOpenableReason,
  toggleLabel,
  visibleClients,
} from './boardScope'
import type { ScopedClient } from './boardScope'

function client(overrides: Partial<ScopedClient> = {}): ScopedClient {
  return { id: 1, name: 'Acme', status: 'active', ...overrides }
}

const ROSTER: ScopedClient[] = [
  client({ id: 1, name: 'Zinc', status: 'active' }),
  client({ id: 2, name: 'Acme', status: 'active' }),
  client({ id: 3, name: 'Bellwether', status: 'paused' }),
  client({ id: 4, name: 'Cinder', status: 'cancelled' }),
  client({ id: 5, name: 'Test Client', status: 'former' }),
]

describe('what counts as on the board', () => {
  it('is active, and nothing else', () => {
    expect(CLIENT_STATUSES.filter(isOnBoard)).toEqual(['active'])
  })

  it('treats a status it does not recognise as off the board', () => {
    // Closed by default, for the same reason can() is: an unknown status is a
    // row written outside this app, and putting it on the working roster would
    // add a client nobody chose to the month's check-in count.
    expect(isOnBoard('archived')).toBe(false)
    expect(isOnBoard('')).toBe(false)
  })
})

describe('the two counts', () => {
  it('counts active and archived separately, and they total the roster', () => {
    expect(activeCount(ROSTER)).toBe(2)
    expect(archivedCount(ROSTER)).toBe(3)
    expect(activeCount(ROSTER) + archivedCount(ROSTER)).toBe(ROSTER.length)
  })

  it('counts nothing in an empty roster without throwing', () => {
    expect(activeCount([])).toBe(0)
    expect(archivedCount([])).toBe(0)
  })
})

describe('what the board shows', () => {
  it('shows only active clients while the toggle is off', () => {
    expect(visibleClients(ROSTER, false).map((c) => c.name)).toEqual(['Acme', 'Zinc'])
  })

  it('shows everything while the toggle is on, active roster first', () => {
    // Active before paused before cancelled before former, alphabetical inside
    // each. Name order alone would put Bellwether between Acme and Zinc and the
    // working roster would stop reading as a block.
    expect(visibleClients(ROSTER, true).map((c) => c.name)).toEqual([
      'Acme',
      'Zinc',
      'Bellwether',
      'Cinder',
      'Test Client',
    ])
  })

  it('does not mutate its input', () => {
    const input = [...ROSTER]
    visibleClients(input, true)
    expect(input.map((c) => c.id)).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps every field of the row it was given', () => {
    // Generic over the row type, so the board's real rows keep their check-in
    // columns rather than being narrowed to ScopedClient on the way through.
    const rows = [{ id: 1, name: 'Acme', status: 'active', extra: 'kept' }]
    expect(visibleClients(rows, false)[0].extra).toBe('kept')
  })
})

describe('what the toggle says', () => {
  it('offers to show, and then to hide, naming the count both ways', () => {
    expect(toggleLabel(3, false)).toBe('Show 3 archived')
    expect(toggleLabel(3, true)).toBe('Hide 3 archived')
  })

  it('says one client rather than 1 clients', () => {
    expect(toggleLabel(1, false)).toBe('Show 1 archived')
  })

  it('never returns an empty label, at any count', () => {
    // The caller does not draw the control at zero, but a label function that
    // can return '' is one refactor away from an unlabelled button.
    for (const count of [0, 1, 2, 99]) {
      expect(toggleLabel(count, false).length).toBeGreaterThan(0)
      expect(toggleLabel(count, true).length).toBeGreaterThan(0)
    }
  })
})

describe('whether a card can be opened', () => {
  it('opens an active client and refuses every other status', () => {
    expect(CLIENT_STATUSES.filter(isOpenable)).toEqual(['active'])
    expect(isOpenable('archived')).toBe(false)
  })

  it('says why, in words, for every status it refuses', () => {
    // The reason is shown on the card. checkins_insert_edit_scores has no
    // status predicate, so the database would accept a check-in for a client
    // who left -- this sentence is the only thing that explains why the app
    // will not offer it.
    for (const status of CLIENT_STATUSES.filter((s) => !isOpenable(s))) {
      expect(notOpenableReason(status).length).toBeGreaterThan(0)
    }
  })

  it('distinguishes a paused client from one that has left', () => {
    // Different facts deserve different sentences: a paused client is coming
    // back, a former one is not.
    expect(notOpenableReason('paused')).not.toBe(notOpenableReason('former'))
    expect(notOpenableReason('paused')).toContain('paused')
  })
})
```

- [ ] **Step 7: Run it and watch it fail**

Run: `npx vitest run src/board/boardScope.test.ts`
Expected: FAIL — `Failed to resolve import "./boardScope"`.

- [ ] **Step 8: Write `boardScope.ts`**

Create `src/board/boardScope.ts`:

```ts
import { CLIENT_STATUSES, statusLabel, statusRank } from '../clients/clientForm'

// Every decision the show-archived toggle implies, with no React and no
// Supabase client. Slice 2 step 5.
//
// The status vocabulary is IMPORTED rather than re-declared. There are already
// two copies of it -- the check constraint on public.clients and the array in
// clientForm.ts -- and tests/clientFormDrift.test.ts is what keeps those two
// in agreement. A third copy here would be outside that guard, so a fifth
// status arriving later would reach the board without anything failing.
//
// This module cannot import ../lib/supabase, and that is load-bearing rather
// than tidy: the client reads its config at module scope and THROWS when VITE_
// env is absent, and CI runs vitest with no VITE_ env at all.

// The columns every function here needs, and nothing more. The board's real
// rows are wider; the generic on visibleClients below is what keeps them wide.
export type ScopedClient = { id: number; name: string; status: string }

// The board is the month's check-in grid, so what belongs on it is exactly the
// clients a check-in is expected for. Written as an allowlist of one rather
// than as "not churned": `paused` is neither active nor churned, and step 4's
// STATUS_HINTS already tells the reader a paused client is off the board.
//
// Closed by default. An unrecognised status -- a row written outside this app --
// is archived, not active, because adding an unknown client to the working
// roster would also add it to the count of check-ins owed.
export function isOnBoard(status: string): boolean {
  return status === 'active'
}

export function activeCount(clients: readonly ScopedClient[]): number {
  return clients.filter((client) => isOnBoard(client.status)).length
}

export function archivedCount(clients: readonly ScopedClient[]): number {
  return clients.filter((client) => !isOnBoard(client.status)).length
}

// Generic, so a caller's richer row type survives the filter. The board passes
// rows carrying more than these three fields and needs them back unchanged;
// a signature returning ScopedClient[] would silently narrow them.
export function visibleClients<T extends ScopedClient>(
  clients: readonly T[],
  showArchived: boolean,
): T[] {
  const shown = showArchived ? clients : clients.filter((client) => isOnBoard(client.status))
  // Copied before sorting: the array belongs to the hook's state, React
  // compares by identity, and sorting in place would mutate it.
  return [...shown].sort(
    (a, b) => statusRank(a.status) - statusRank(b.status) || a.name.localeCompare(b.name),
  )
}

// Names the count in both directions, so the control says what pressing it will
// do rather than what state it is in. "Show 3 archived" tells the reader there
// is something to see before they press it -- which is the whole reason the
// board hides them in the first place.
export function toggleLabel(archived: number, showArchived: boolean): string {
  return `${showArchived ? 'Hide' : 'Show'} ${archived} archived`
}

// A check-in can only be written for a client the board considers current.
// This is not belt-and-braces: checkins_insert_edit_scores gates on the
// edit_scores capability and carries NO status predicate, so Postgres would
// accept a check-in for a client who left. Until this step the board never drew
// such a client, so the path did not exist; revealing the cards creates it, and
// this is what closes it.
export function isOpenable(status: string): boolean {
  return isOnBoard(status)
}

// Shown on the card, because a name that is suddenly not a link needs to say
// why. One sentence per reason, and `paused` gets its own: a paused client is
// coming back and a former one is not, so telling the reader they are the same
// thing would be false.
export function notOpenableReason(status: string): string {
  if (status === 'paused') {
    return 'This client is paused, so no check-in is expected this month. Set them active on the client admin screen to score them again.'
  }
  if (CLIENT_STATUSES.includes(status as (typeof CLIENT_STATUSES)[number])) {
    return `This client is ${statusLabel(status).toLowerCase()} and cannot be scored. Their past check-ins are unchanged.`
  }
  // Unreachable through the app -- a check constraint makes an unknown status
  // impossible to write -- but honest rather than reassuring if one ever
  // appears: it says what it found instead of guessing which of the four it is.
  return `This client's status is "${status}", which the board does not recognise, so it cannot be scored.`
}
```

- [ ] **Step 9: Green**

Run: `npx vitest run src/board/boardScope.test.ts`
Expected: PASS, all tests.

- [ ] **Step 10: All three gates**

Run: `npm test && npm run build && npm run lint`
Expected: all green. Record the test count from the real output.

- [ ] **Step 11: Commit**

```bash
git add src/board/boardScope.ts src/board/boardScope.test.ts src/clients/clientForm.ts src/clients/clientForm.test.ts
git commit -F - <<'MSG'
feat(board): the decisions the show-archived toggle implies

Slice 2 step 5, task 1. Nothing renders yet and the board still reads
only active clients.

The status vocabulary is imported from clientForm rather than declared
again. Two copies already exist -- the check constraint and the
TypeScript array -- and tests/clientFormDrift.test.ts is what keeps them
in agreement; a third copy here would sit outside that guard.

statusRank is extracted from sortClients rather than written twice, so
the board and the clients admin cannot disagree about what order
statuses read in. The pre-existing sortClients tests are what prove the
extraction changed no behaviour.

isOpenable is not defensive tidiness. checkins_insert_edit_scores gates
on the edit_scores capability and carries no status predicate, so
Postgres will accept a check-in for a client who left. Until this step
the board never drew such a client, so the path did not exist. Revealing
the cards creates it, and this is what closes it.

isOnBoard is an allowlist of one rather than "not churned", because
`paused` is neither active nor churned and step 4's STATUS_HINTS already
promises a paused client is off the board.
MSG
```

---

### Task 2: The board reads every status, and still counts only the active ones

**Files:**
- Modify: `src/board/useBoard.ts`
- Create: `src/board/useBoard.dom.test.ts`
- Modify: `src/board/ClientCard.dom.test.tsx:13`

**Interfaces:**
- Consumes from Task 1: `activeCount`, `ScopedClient`.
- Produces: `BoardClient` becomes `{ id: number; name: string; status: string }`; `UseBoard` gains `activeTotal: number`.

- [ ] **Step 1: Read the hook, and the hook-test precedent you are copying**

```bash
cat src/board/useBoard.ts
sed -n '1,60p' src/clients/useClients.dom.test.ts
grep -n "CLIENT = " src/board/ClientCard.dom.test.tsx
```

Expected: `useBoard` filters with `.eq('status', 'active')`, `BoardClient` is `{ id: number; name: string }`, and the `submitted` count carries the comment *"Only active clients are counted, because only active clients were read"* — the claim this task falsifies. `src/clients/useClients.dom.test.ts` shows the fake-builder pattern to copy, including why the fake must capture rather than discard what it is handed.

- [ ] **Step 2: Write the failing hook test**

Create `src/board/useBoard.dom.test.ts`:

```ts
// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A fake of the Supabase chained builder, and the chain is part of what is
// asserted: the board's client query must NOT carry .eq('status', …) any more,
// and a fake that ignored its arguments could not tell. Same technique, and the
// same reason, as src/clients/useClients.dom.test.ts -- the hook test written in
// step 4 because a screen test that mocks the hook away cannot see inside it.
type Result = { data: unknown; error: unknown }

const db = vi.hoisted(() => ({
  // Every filter the client query applied, in order. The point of the file.
  clientFilters: [] as [string, unknown][],
  clients: async (): Promise<Result> => ({ data: [], error: null }),
  checkins: async (): Promise<Result> => ({ data: [], error: null }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) =>
      table === 'clients'
        ? {
            select: () => {
              const chain = {
                eq: (column: string, value: unknown) => {
                  db.clientFilters.push([column, value])
                  return chain
                },
                order: () => db.clients(),
              }
              return chain
            },
          }
        : {
            select: () => ({ eq: () => db.checkins() }),
          },
  },
}))

import { useBoard } from './useBoard'

const ROSTER = [
  { id: 1, name: 'Zinc', status: 'active' },
  { id: 2, name: 'Acme', status: 'active' },
  { id: 3, name: 'Bellwether', status: 'paused' },
  { id: 4, name: 'Test Client', status: 'former' },
]

beforeEach(() => {
  db.clientFilters = []
  db.clients = async () => ({ data: ROSTER, error: null })
  db.checkins = async () => ({ data: [], error: null })
})

// Passed by reference rather than as an arrow holding the hook call: an arrow
// trips react/rules-of-hooks, which this repo runs as an error.
async function ready() {
  const rendered = renderHook(() => useBoard('2026-08-01'))
  await waitFor(() => expect(rendered.result.current.status).toBe('ready'))
  return rendered
}

describe('the board hook', () => {
  it('does not filter the client query by status any more', () => {
    // The whole point of this step. A .eq('status', 'active') here would make
    // the toggle structurally unable to show anything, and no screen test could
    // see it because they all mock this hook.
    return ready().then(() => {
      expect(db.clientFilters.map(([column]) => column)).not.toContain('status')
    })
  })

  it('hands back every client, whatever its status', async () => {
    const { result } = await ready()
    expect(result.current.clients.map((client) => client.name).sort()).toEqual([
      'Acme',
      'Bellwether',
      'Test Client',
      'Zinc',
    ])
  })

  it('counts only the active clients as the check-in denominator', async () => {
    // The sharpest requirement in this step. If this number grew to 4, the
    // board would report that four check-ins are owed this month -- two of them
    // for a paused client and a client who has left.
    const { result } = await ready()
    expect(result.current.activeTotal).toBe(2)
  })

  it('counts a submitted check-in for an archived client as neither submitted nor owed', async () => {
    // A former client can hold a check-in from when they were active. It must
    // not inflate either half of the progress line.
    db.checkins = async () => ({
      data: [
        { client_id: 1, total_score: 20, submitted_at: '2026-08-01T00:00:00.000Z', submitted_by: null },
        { client_id: 4, total_score: 15, submitted_at: '2026-08-01T00:00:00.000Z', submitted_by: null },
      ],
      error: null,
    })

    const { result } = await ready()
    expect(result.current.submitted).toBe(1)
    expect(result.current.activeTotal).toBe(2)
  })

  it('reports a failed client read and writes no clients', async () => {
    // Never write after a failed read, and never let a failure look empty.
    db.clients = async () => ({ data: null, error: { message: 'permission denied for table clients' } })

    const rendered = renderHook(() => useBoard('2026-08-01'))
    await waitFor(() => expect(rendered.result.current.status).toBe('error'))
    expect(rendered.result.current.loadError).toContain('permission denied')
    expect(rendered.result.current.clients).toEqual([])
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/board/useBoard.dom.test.ts`
Expected: FAIL on at least two counts — `status` IS among the filters, and `activeTotal` is `undefined`.

- [ ] **Step 4: Widen the query and add the active total**

Four edits to `src/board/useBoard.ts`.

Add the import:

```ts
import { activeCount } from './boardScope'
```

Widen the row type:

```ts
// `status` joins the row in Slice 2 step 5, because the board now reads every
// client and decides in the browser which ones to draw. It is `string`, not a
// union, for the same reason AdminClient's is: that is what the column holds --
// text with a check constraint -- and narrowing it here would be a claim this
// file cannot verify.
export type BoardClient = { id: number; name: string; status: string }
```

Extend the returned shape:

```ts
export type UseBoard = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  clients: BoardClient[]
  checkins: Map<number, CardCheckin>
  submitted: number
  // The denominator of the progress line, and deliberately NOT clients.length.
  // See the count below.
  activeTotal: number
  reload: () => void
}
```

Drop the filter, keeping the order:

```ts
        const clientResult = await supabase
          .from('clients')
          // No status filter, as of Slice 2 step 5. The board used to read only
          // active clients; it now reads every row and the show-archived toggle
          // decides what is drawn. `status` is selected because that decision
          // needs it.
          .select('id, name, status')
          .order('name')
```

Replace the `submitted` count and its comment:

```ts
  // Counted here rather than in the component so the progress line and the card
  // footers cannot disagree: both read submitted_at, from the same rows.
  //
  // Both numbers count ACTIVE clients only, and as of Slice 2 step 5 that is a
  // rule this code enforces rather than a side effect of the query. The comment
  // here used to say "only active clients are counted, because only active
  // clients were read" -- true then, false the moment the filter came off, and
  // the behaviour it described is the one thing that must not change with it.
  //
  // Why it must not change: the progress line reads "N of M check-ins submitted
  // this month". A former client cannot owe a check-in, so counting one in M
  // would make that sentence false -- and a former client CAN hold a check-in
  // from when they were active, so counting it in N would too.
  let submitted = 0
  for (const client of clients) {
    if (!isOnBoard(client.status)) continue
    if (checkins.get(client.id)?.submitted_at != null) submitted += 1
  }

  const activeTotal = activeCount(clients)
```

and add `isOnBoard` to the `boardScope` import so that loop compiles:

```ts
import { activeCount, isOnBoard } from './boardScope'
```

Then return it:

```ts
  return { status, loadError, clients, checkins, submitted, activeTotal, reload: () => void load() }
```

- [ ] **Step 5: Fix the one construction site this breaks**

`src/board/ClientCard.dom.test.tsx:13` builds a `BoardClient` literal and no longer compiles. Change it to:

```tsx
const CLIENT = { id: 7, name: 'Polar Divide', status: 'active' }
```

`src/board/Board.test.tsx:200` is the other site; Task 4 owns that file, so leave it — `npm run build` will fail until Task 4 lands, which is why Step 6 below runs the tests and the build separately and expects exactly that one failure.

- [ ] **Step 6: Green on the tests, with one known build failure**

Run: `npx vitest run src/board/useBoard.dom.test.ts src/board/ClientCard.dom.test.tsx`
Expected: PASS.

Run: `npm test`
Expected: PASS. Vitest strips types, so `Board.test.tsx`'s stale literal does not fail here.

Run: `npm run build`
Expected: **FAIL**, with exactly one class of error — `Board.test.tsx` around line 200, on `status` missing from the client literal, and `activeTotal` missing from the `READY` fixture. **If the build fails for any other reason, stop and report it.** Do not fix `Board.test.tsx` here; Task 4 owns it.

- [ ] **Step 7: Commit**

```bash
git add src/board/useBoard.ts src/board/useBoard.dom.test.ts src/board/ClientCard.dom.test.tsx
git commit -F - <<'MSG'
feat(board): read every client, count only the active ones

Slice 2 step 5, task 2. The query stops filtering by status. Nothing on
screen changes yet -- Board.tsx still draws whatever the hook hands it,
which is now every client -- so this commit alone makes the board show
archived clients with no way to hide them. Task 4 adds the toggle.

`npm run build` fails at this commit, on purpose and in one place:
Board.test.tsx's fixture predates activeTotal and its client literal
predates `status`. Task 4 owns that file. `npm test` passes, because
vitest strips types.

activeTotal exists because clients.length is now the wrong denominator.
The progress line reads "N of M check-ins submitted this month"; a
former client cannot owe one, and can still hold one from when they were
active, so both halves have to filter on status rather than trusting the
query to have done it.

The comment at that count used to say only active clients were counted
"because only active clients were read". That was true and is now false,
while the behaviour it described is the one thing that must not change.
Rewritten to say which rule is doing the work.

useBoard.dom.test.ts is the second hook test in this repo, after
useClients.dom.test.ts in step 4. It exists for one assertion no screen
test can make: that the client query carries no status filter. Every
board screen test mocks this hook away.
MSG
```

---

### Task 3: An archived card says what it is, and refuses to be scored

**Files:**
- Modify: `src/styles/base.css`
- Modify: `src/clients/ClientsAdmin.module.css`
- Modify: `src/clients/ClientsAdmin.tsx`
- Modify: `src/board/ClientCard.tsx`
- Modify: `src/board/ClientCard.module.css`
- Modify: `src/board/ClientCard.dom.test.tsx`

**Interfaces:**
- Consumes from Task 1: `isOpenable`, `notOpenableReason`; from Task 2: `BoardClient` with `status`.
- Consumes from step 4: `statusLabel`, `isChurned` from `src/clients/clientForm.ts`.
- Produces: global CSS classes `.status-pill` and `.status-pill--ended`.

- [ ] **Step 1: Read the pill you are moving, and the rule that says to move it**

```bash
sed -n '1,12p' src/styles/base.css
sed -n '/statusPill/,/^}/p' src/clients/ClientsAdmin.module.css
grep -n "styles.statusPill" src/clients/ClientsAdmin.tsx
```

Expected: `base.css` opens by stating "Anything used by more than one screen belongs here; anything used by exactly one belongs in that component's `.module.css`." `ClientsAdmin.module.css` defines `.statusPill` and `.statusPillEnded`, and `ClientsAdmin.tsx` has exactly one site using both.

- [ ] **Step 2: Write the failing card tests**

Append to `src/board/ClientCard.dom.test.tsx`. It already has `render`, `screen`, `userEvent` and the `CLIENT` literal from Task 2.

```tsx
describe('an archived client card', () => {
  const ARCHIVED = { id: 8, name: 'Test Client', status: 'former' }
  const PAUSED = { id: 9, name: 'Bellwether', status: 'paused' }

  it('marks an active card with no status pill, so the working roster stays quiet', () => {
    render(<ClientCard checkin={null} client={CLIENT} onOpen={() => {}} viewerId={ME} />)

    // The default case carries no marker: eleven identical pills reading ACTIVE
    // would be noise on the screen whose whole job is the active roster.
    expect(screen.queryByTestId('card-status')).toBeNull()
  })

  it('names the status in words, not only as a colour', () => {
    // Parent spec §9.3: the brand's status fills are within 1.9:1 of each other,
    // so the distinction rests on hue plus a mandatory text label. A pill with
    // no word is unreadable in greyscale and to a colour-blind viewer.
    render(<ClientCard checkin={null} client={ARCHIVED} onOpen={() => {}} viewerId={ME} />)

    expect(screen.getByTestId('card-status').textContent).toBe('Former')
  })

  it('does not offer the name as a button', async () => {
    // checkins_insert_edit_scores has no status predicate, so the database would
    // accept a check-in for a client who left. This is the only thing that
    // stops one being written.
    const onOpen = vi.fn()
    render(<ClientCard checkin={null} client={ARCHIVED} onOpen={onOpen} viewerId={ME} />)

    expect(screen.queryByRole('button', { name: /Test Client/ })).toBeNull()
    // Still legible, and still a heading: the card must remain findable and
    // readable, it just is not a link.
    expect(screen.getByRole('heading', { name: 'Test Client' })).toBeTruthy()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('says why it cannot be scored', async () => {
    render(<ClientCard checkin={null} client={ARCHIVED} onOpen={() => {}} viewerId={ME} />)

    expect(screen.getByTestId('card-locked').textContent).toContain('cannot be scored')
  })

  it('gives a paused client its own reason, not a churned one', async () => {
    render(<ClientCard checkin={null} client={PAUSED} onOpen={() => {}} viewerId={ME} />)

    expect(screen.getByTestId('card-status').textContent).toBe('Paused')
    expect(screen.getByTestId('card-locked').textContent).toContain('paused')
  })

  it('still shows the scores a former client did have', async () => {
    // Their history is unchanged, and hiding it would make the card look like a
    // client who was never scored.
    render(
      <ClientCard
        checkin={{
          total_score: 21,
          submitted_at: '2026-08-21T17:04:00.000Z',
          submitted_by: ME,
          relationship: 5,
          delivery: 4,
          financial: 4,
          sentiment: 4,
          growth: 4,
        }}
        client={ARCHIVED}
        onOpen={() => {}}
        viewerId={ME}
      />,
    )

    expect(screen.getByTestId('total').textContent).toBe('21')
  })

  it('keeps the open button on an active card', async () => {
    // The regression guard for the branch above: an implementation that removed
    // the button for everyone would pass every test in the archived block.
    const onOpen = vi.fn()
    render(<ClientCard checkin={null} client={CLIENT} onOpen={onOpen} viewerId={ME} />)

    await userEvent.click(screen.getByRole('button', { name: /Polar Divide/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('card-locked')).toBeNull()
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/board/ClientCard.dom.test.tsx`
Expected: FAIL — no `card-status`, no `card-locked`, and the name is still a button for the archived client.

- [ ] **Step 4: Move the pill into `base.css`**

Append to `src/styles/base.css`, after the `.band` block:

```css
/* ---------------------------------------------------------------------------
   The client status pill. A different fact from the health band above -- that
   one is a score, this one is where the client stands -- so it is a separate
   class rather than a variant of .band: sharing would make a change to either
   one silently change the other.

   Global rather than in a module because two screens draw it: the clients admin
   list and, as of Slice 2 step 5, an archived board card. This file's own rule
   at the top says anything used by more than one screen belongs here. Moved out
   of ClientsAdmin.module.css unchanged apart from the class names.

   The word inside it is not decoration. Parent spec §9.3: every candidate
   status fill lands within 1.9:1 of the others, so the fill can never be the
   only signal.
   --------------------------------------------------------------------------- */

.status-pill {
  display: inline-flex;
  /* align-self, because this pill sits in flex containers: display:inline-flex
     governs the pill's inside, not how it is sized as a flex ITEM, and a
     default align-items:stretch would pull it across the row. Recorded on
     .band above after the owner found exactly that on the deployed page. */
  align-self: flex-start;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
  color: var(--text-secondary);
  font-family: var(--face-caption);
  font-stretch: var(--wdth-caption);
  font-weight: var(--wght-caption);
  font-size: var(--step--1);
  letter-spacing: var(--tracking-band);
  text-transform: uppercase;
  white-space: nowrap;
}

/* A churned client, marked as well as labelled. The word is still there; this
   only makes the row scannable. */
.status-pill--ended {
  background: var(--brand-blush);
  color: var(--text-primary);
}
```

Then delete the `.statusPill` and `.statusPillEnded` blocks from `src/clients/ClientsAdmin.module.css`, and change the one site in `src/clients/ClientsAdmin.tsx` from

```tsx
                <span
                  className={`${styles.statusPill} ${isChurned(client.status) ? styles.statusPillEnded : ''}`}
                >
```

to

```tsx
                <span
                  className={`status-pill ${isChurned(client.status) ? 'status-pill--ended' : ''}`}
                >
```

- [ ] **Step 5: Make the card draw the status and refuse to open**

Three edits to `src/board/ClientCard.tsx`.

Add the imports:

```ts
import { isChurned, statusLabel } from '../clients/clientForm'
import { isOpenable, notOpenableReason } from './boardScope'
```

Inside the component, above the `return`:

```tsx
  const openable = isOpenable(client.status)
```

Replace the `cardHead` block with:

```tsx
      <div className={styles.cardHead}>
        <h3 className="t-body">
          {openable ? (
            <button className={styles.cardOpen} type="button" onClick={onOpen}>
              {client.name}
            </button>
          ) : (
            // Text, not a disabled button. A disabled control invites the
            // reader to work out why it is disabled; the sentence below says
            // so outright. It stays inside the h3 so the card is still a
            // findable, labelled heading.
            <span className={styles.cardName}>{client.name}</span>
          )}
        </h3>
        {/* The band always carries its text label. Colour is never the only
            signal: teal against warm red measures 1.76:1, so any two bands are
            indistinguishable to a colour-blind viewer. Parent spec §9.3. */}
        <span className={bandClassName(band)}>{BAND_LABELS[band]}</span>
        {/* Only when it is not active. Eleven identical pills reading ACTIVE
            would be noise on the screen whose whole job is the active roster,
            so the default case is the unmarked one. */}
        {!openable && (
          <span
            className={`status-pill ${isChurned(client.status) ? 'status-pill--ended' : ''}`}
            data-testid="card-status"
          >
            {statusLabel(client.status)}
          </span>
        )}
      </div>
```

And after the footer line, before the closing `</li>`:

```tsx
      {/* Why the name is not a link. Without this the card is a dead end that
          looks like a bug -- and the reason is worth stating rather than
          implying, because the database would in fact accept a check-in for
          this client: checkins_insert_edit_scores has no status predicate. */}
      {!openable && (
        <p className="t-caption" data-testid="card-locked">
          {notOpenableReason(client.status)}
        </p>
      )}
```

- [ ] **Step 6: Add the one CSS rule the un-openable name needs**

Append to `src/board/ClientCard.module.css`:

```css
/* The name of a card that cannot be opened. It inherits the h3's type role, so
   this only removes the affordances .cardOpen adds -- no pointer, no underline,
   no hover. Deliberately NOT dimmed: a former client's card is still there to
   be read, and greying it out would make the whole card look disabled rather
   than the one control that is. */
.cardName {
  cursor: default;
}
```

- [ ] **Step 7: Green**

Run: `npx vitest run src/board/ClientCard.dom.test.tsx src/clients/ClientsAdmin.dom.test.tsx`
Expected: PASS. The clients-admin tests are included because Step 4 changed that screen's class names — they query text rather than classes, so they should be unaffected, and this run is what proves it.

- [ ] **Step 8: Confirm the pill is really global and really gone from the module**

```bash
grep -rn "statusPill" src/ || echo "no module-scoped pill remains (expected)"
grep -c "status-pill" src/styles/base.css src/board/ClientCard.tsx src/clients/ClientsAdmin.tsx
```

Expected: the first prints the "expected" line. The second shows `base.css` with 2, and one or two occurrences in each component. If `grep -rn "statusPill"` finds anything, the move is half-done and the clients screen has lost its pill silently — the tests would not catch that, because they assert the word and not the class.

- [ ] **Step 9: All three gates, with the same known build failure**

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: **FAIL**, still only on `src/board/Board.test.tsx` (Task 4 owns it). Any other error, stop and report.

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/styles/base.css src/board/ClientCard.tsx src/board/ClientCard.module.css src/board/ClientCard.dom.test.tsx src/clients/ClientsAdmin.module.css src/clients/ClientsAdmin.tsx
git commit -F - <<'MSG'
feat(board): an archived card says what it is and cannot be scored

Slice 2 step 5, task 3. `npm run build` still fails only on
Board.test.tsx, which task 4 owns.

The name of an archived card is text, not a disabled button. A disabled
control invites the reader to work out why; the sentence under the card
says so outright. And the reason is worth stating rather than implying:
checkins_insert_edit_scores gates on the edit_scores capability and
carries no status predicate, so Postgres would accept a check-in for a
client who left. Until this step the board never drew one, so the path
did not exist.

The status pill moves from ClientsAdmin.module.css to base.css because
two screens now draw it, which is the rule stated at the top of that
file. Moved unchanged apart from the class names. Note the clients-admin
tests assert the WORD and not the class, so a half-finished move would
have passed them -- there is a grep step in the plan for exactly that.

Only non-active cards carry a pill. Eleven identical ACTIVE pills would
be noise on the screen whose whole job is the active roster.

The card keeps showing the scores a former client did have. Hiding them
would make the card look like a client who was never scored, which is a
different and false fact.
MSG
```

---

### Task 4: The toggle

**Files:**
- Modify: `src/board/Board.tsx`
- Modify: `src/board/Board.module.css`
- Modify: `src/board/Board.test.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes from Task 1: `archivedCount`, `toggleLabel`, `visibleClients`; from Task 2: `UseBoard` with `activeTotal`, `BoardClient` with `status`.
- Produces: nothing new.

- [ ] **Step 1: Read the file in full, and the fixture you must repair**

```bash
cat -n src/board/Board.tsx
sed -n '190,215p' src/board/Board.test.tsx
grep -n "progressLine" src/board/*.ts src/board/*.tsx
```

Expected: `Board.tsx` has `selected` and `showingClients` state and four early returns (error, loading, empty, populated), each carrying `{adminLink}`; the populated branch calls `progressLine(board.submitted, board.clients.length)`. `Board.test.tsx` has a `READY` fixture around line 200 whose client literal lacks `status` and which lacks `activeTotal` — this task's Step 5 repairs it, which is what makes `npm run build` pass again.

- [ ] **Step 2: Write the failing tests**

In `src/board/Board.test.tsx`, first repair the `READY` fixture so the file compiles, adding `status` and `activeTotal`:

```tsx
  const READY = {
    status: 'ready' as const,
    loadError: null,
    clients: [{ id: 1, name: 'Acme', status: 'active' }],
    checkins: new Map(),
    submitted: 0,
    activeTotal: 1,
    reload: vi.fn(),
  }
```

Every other `given({ clients: [] })` / `mockReturnValue({ ...READY, clients: [] })` site needs `activeTotal: 0` alongside `clients: []`, or the empty-state tests will assert against a denominator of 1. Update each one.

Then append:

```tsx
describe('the show-archived toggle', () => {
  const MIXED = {
    ...READY,
    clients: [
      { id: 1, name: 'Acme', status: 'active' },
      { id: 2, name: 'Bellwether', status: 'paused' },
      { id: 3, name: 'Test Client', status: 'former' },
    ],
    activeTotal: 1,
  }

  const cardNames = () =>
    [...screen.getByRole('list', { name: 'Clients' }).querySelectorAll('h3')].map(
      (heading) => heading.textContent,
    )

  it('shows only the active roster by default', () => {
    vi.mocked(useBoard).mockReturnValue(MIXED)
    render(<Board profile={PROFILE} />)

    expect(cardNames()).toEqual(['Acme'])
  })

  it('offers a toggle naming how many are hidden', () => {
    vi.mocked(useBoard).mockReturnValue(MIXED)
    render(<Board profile={PROFILE} />)

    expect(screen.getByRole('button', { name: 'Show 2 archived' })).toBeTruthy()
  })

  it('reveals them, active roster first, and offers to hide them again', async () => {
    vi.mocked(useBoard).mockReturnValue(MIXED)
    render(<Board profile={PROFILE} />)

    await userEvent.click(screen.getByRole('button', { name: 'Show 2 archived' }))

    expect(cardNames()).toEqual(['Acme', 'Bellwether', 'Test Client'])
    expect(screen.getByRole('button', { name: 'Hide 2 archived' })).toBeTruthy()
  })

  it('hides them again', async () => {
    vi.mocked(useBoard).mockReturnValue(MIXED)
    render(<Board profile={PROFILE} />)

    await userEvent.click(screen.getByRole('button', { name: 'Show 2 archived' }))
    await userEvent.click(screen.getByRole('button', { name: 'Hide 2 archived' }))

    expect(cardNames()).toEqual(['Acme'])
  })

  it('does not draw the toggle when nothing is archived', () => {
    // A control that reveals nothing is worse than no control: it implies
    // there is something hidden.
    vi.mocked(useBoard).mockReturnValue(READY)
    render(<Board profile={PROFILE} />)

    expect(screen.queryByRole('button', { name: /archived/ })).toBeNull()
  })

  it('never counts an archived client in the progress line', async () => {
    // The sharpest requirement in this step. "1 of 3" would tell the reader
    // that three check-ins are owed this month, two of them for a paused
    // client and a client who has left.
    vi.mocked(useBoard).mockReturnValue({ ...MIXED, submitted: 1 })
    render(<Board profile={PROFILE} />)

    expect(screen.getByRole('status').textContent).toBe(
      'All 1 check-ins submitted this month',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Show 2 archived' }))

    // Unchanged by the toggle. This is the assertion that would fail if the
    // denominator were clients.length.
    expect(screen.getByRole('status').textContent).toBe(
      'All 1 check-ins submitted this month',
    )
  })

  it('offers the toggle when every client is archived, rather than an empty board', async () => {
    // Reachable the moment somebody retires their last client. Without the
    // toggle here, the roster would look permanently empty with no hint that
    // three clients exist.
    vi.mocked(useBoard).mockReturnValue({
      ...MIXED,
      clients: [{ id: 3, name: 'Test Client', status: 'former' }],
      activeTotal: 0,
      submitted: 0,
    })
    render(<Board profile={PROFILE} />)

    expect(screen.getByText('No active clients')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Show 1 archived' }))
    expect(cardNames()).toEqual(['Test Client'])
  })

  it('does not offer the toggle on a failed read', () => {
    // A count derived from a list that could not be read would be a made-up
    // number, and the error must own the screen.
    vi.mocked(useBoard).mockReturnValue({
      ...READY,
      status: 'error',
      loadError: 'the connection failed',
      clients: [],
      activeTotal: 0,
    })
    render(<Board profile={PROFILE} />)

    expect(screen.queryByRole('button', { name: /archived/ })).toBeNull()
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx vitest run src/board/Board.test.tsx`
Expected: FAIL — no toggle exists, and the board renders all three cards because nothing filters them.

- [ ] **Step 4: Wire the toggle**

Four edits to `src/board/Board.tsx`.

Add the imports:

```ts
import { archivedCount, toggleLabel, visibleClients } from './boardScope'
```

Add the state beside `showingClients`:

```tsx
  // Not persisted, deliberately. A reload returns to the working view, which is
  // the same choice §5.1 makes for the check-in screen: no router, no URL
  // state, so a refresh lands somewhere predictable rather than wherever the
  // last visit left off.
  const [showArchived, setShowArchived] = useState(false)
```

Below the `showingClients` early return, and above the error branch, derive the three values and the control:

```tsx
  // Derived after the two navigation returns and before the four render
  // branches, so every branch below can use them.
  const archived = archivedCount(board.clients)
  const visible = visibleClients(board.clients, showArchived)

  // Drawn only when there is something to reveal. A control that reveals
  // nothing is worse than no control: it implies something is hidden.
  //
  // Not drawn on a failed read either -- that branch returns before this is
  // used -- because the count would come from a list that could not be read,
  // which is a made-up number on a screen whose job at that moment is to say
  // the read failed.
  const archiveToggle = archived > 0 ? (
    <button
      className="button button--quiet"
      onClick={() => setShowArchived((shown) => !shown)}
      type="button"
    >
      {toggleLabel(archived, showArchived)}
    </button>
  ) : null
```

Then change the empty branch's condition from `board.clients.length === 0` to test the visible list, and give it the toggle:

```tsx
  if (visible.length === 0) {
    return (
      <section className={styles.state}>
        {adminLink}
        {/* The same sentence progressLine gives the populated board, so the two
            empty states cannot drift apart in wording. activeTotal, not
            visible.length: this line is about the roster, not about what the
            toggle happens to be showing. */}
        <h2 className="t-header">{progressLine(board.submitted, board.activeTotal)}</h2>
        {archived > 0 ? (
          // Reachable the moment somebody retires their last client. Without
          // this the roster looks permanently empty with no hint that anything
          // exists.
          <div className={styles.archiveBar}>{archiveToggle}</div>
        ) : (
          <p className="t-body prose">
            Add one on the client admin screen to see it here.
          </p>
        )}
      </section>
    )
  }
```

And in the populated branch, use `activeTotal` for the progress line, add the toggle to the period bar, and map over `visible`:

```tsx
      <div className={styles.periodBar}>
        <h2 className="t-header">{formatPeriod(period)}</h2>
        {/* §6's progress line. role="status" because this number changes on the
            way back from a check-in -- the one moment somebody wants to hear
            that their submission counted.
            activeTotal, never visible.length: a former client cannot owe a
            check-in, so counting one here would make this sentence false, and
            pressing the toggle must not change what it says. */}
        <p className="t-caption" role="status">
          {progressLine(board.submitted, board.activeTotal)}
        </p>
        {archiveToggle}
      </div>

      <ul aria-label="Clients" className={styles.grid} role="list">
        {visible.map((client) => (
          <ClientCard
            checkin={board.checkins.get(client.id) ?? null}
            client={client}
            key={client.id}
            onOpen={() => setSelected(client)}
            viewerId={profile.id}
          />
        ))}
      </ul>
```

- [ ] **Step 5: Add the one CSS rule**

Append to `src/board/Board.module.css`:

```css
/* The show-archived toggle on the empty-roster screen. In the populated board
   it sits inside .periodBar and needs no rule of its own; the empty screen has
   no such row, and .state is a column, so without this the button would
   stretch to the measure. */
.archiveBar {
  display: flex;
}
```

- [ ] **Step 6: Green, and the build passes again**

Run: `npx vitest run src/board/Board.test.tsx`
Expected: PASS, including every pre-existing test in the file.

Run: `npm run build`
Expected: **PASS.** This is the commit where the deliberate two-task build failure closes. If it still fails, the `READY` fixture or one of the `clients: []` sites is missing `activeTotal`.

- [ ] **Step 7: Document it**

Add to `README.md`, immediately before the `## The clients admin screen` section:

```markdown
## The board's show-archived toggle

The board is the month's check-in grid, so by default it shows only `active`
clients — the ones a check-in is expected for. **Show N archived** reveals the
rest: `paused`, `cancelled` and `former`, sorted after the active roster.

The parent spec names only `former` as hidden behind this toggle. It reveals all
three because the board has only ever read `active`, so `paused` and `cancelled`
were invisible with no way at all to see them — and the clients admin screen
already tells the reader that a paused client is "Off the board."

Two things the toggle deliberately does not do:

- **It never changes the progress line.** That line reads "N of M check-ins
  submitted this month", and M is the count of *active* clients whatever the
  toggle says. A former client cannot owe a check-in, and can still hold one
  from when they were active, so both halves of that fraction filter on status.
  `useBoard` computes them; `clients.length` is the wrong denominator and there
  is a test that fails if it is used.
- **It does not make an archived client scorable.** Their card shows its status
  and its past scores, but the name is text rather than a link, and the card
  says why. This is a UI-only guard and it is the only one there is:
  `checkins_insert_edit_scores` gates on the `edit_scores` capability and
  carries **no status predicate**, so Postgres would accept a check-in for a
  client who left. Before this toggle the board never drew such a client, so the
  path did not exist.

The toggle is not remembered across a reload. A refresh returns to the working
view, the same choice the board makes for its other navigation.
```

- [ ] **Step 8: All three gates**

Run: `npm test && npm run build && npm run lint`
Expected: all green. Read the final test count off this run and use that number anywhere you state it.

- [ ] **Step 9: Commit**

```bash
git add src/board/Board.tsx src/board/Board.module.css src/board/Board.test.tsx README.md
git commit -F - <<'MSG'
feat(board): show archived clients behind a toggle

Slice 2 step 5, task 4, and the last step in Slice 2. `npm run build`
passes again -- Board.test.tsx's fixture now carries activeTotal and
each client literal carries a status.

The toggle reveals paused, cancelled and former, not only former as the
parent spec's letter says. The board has only ever read active, so those
first two were invisible with no way at all to see them, and step 4's
STATUS_HINTS already promises a paused client is off the board. One
toggle for "not active" is the coherent reading of an intent written
before `paused` had that meaning.

The progress line does not move when the toggle does, and there is a
test that fails if it ever does. "1 of 3 check-ins submitted" would tell
the reader three are owed this month, two of them for a paused client
and one for a client who has left. progressLine reads activeTotal from
the hook, never the length of what is on screen.

The empty-roster branch now tests the VISIBLE list rather than the whole
roster, so retiring your last client leaves a screen that says "No
active clients" and offers the toggle, rather than one that looks
permanently empty with no hint that anything exists.

The toggle is not drawn at zero archived -- a control that reveals
nothing implies something is hidden -- and not on a failed read, where
the count would come from a list that could not be read.
MSG
```

---

## Self-review against the spec

**Spec coverage.** The binding requirement is parent §6.1's one sentence: "`former` is hidden from the board behind a 'show archived' toggle." Task 4 builds the toggle; Task 2 stops the query hiding anything; Task 1 decides what "archived" means; Task 3 makes a revealed card legible and inert. Slice 2 §2 item 5 and §4's step-5 row are the same requirement restated. Parent §9.3's rule — "hue plus a mandatory text label, never brightness… Any future status indicator follows the same rule" — binds the new pill, and Task 3 has a test asserting the word rather than the fill. Parent §8.1's "failures name themselves" binds the toggle's absence on a failed read, tested in Task 4.

**One deliberate divergence, recorded in the code, the README and the commit message.** The parent spec names only `former`; the toggle reveals `paused` and `cancelled` too. The argument is in Decision 1 and in the README section: those two statuses are invisible today with no route to them at all, and step 4's own on-screen copy already promises `paused` is off the board. Reading the spec's letter would leave two statuses unreachable while claiming to have implemented a toggle for hidden clients.

**One thing this plan does NOT do, and must not.** Slice 1's card footer can name a person and the card's `owner` field is buildable — both unblocked by step 3's widening, and `src/board/cardSummary.ts:41` records that. Slice 2 §8 defers them to "the first slice that touches the board after this," which is literally this one. They stay out: this step is the archived toggle, and bundling the owner field would put two unrelated changes in one review. Carry them into the next board slice.

**Placeholder scan.** No task contains "TBD", "handle edge cases", "add validation", "similar to Task N", or a step describing an action without the code for it. Every test is written out. Every file modified is read in that task's own first step.

**Type consistency.** `ScopedClient` is defined once (Task 1) and `visibleClients` is generic over it, so Task 4 passing `BoardClient[]` gets `BoardClient[]` back — that is what the "keeps every field" test in Task 1 pins. `activeTotal` is spelled the same in `UseBoard` (Task 2), the `READY` fixture and both `progressLine` calls (Task 4). `statusRank` is exported from `clientForm.ts` in Task 1 and consumed only by `sortClients` and `visibleClients`. `isOnBoard` is used by `useBoard` (Task 2) and by `isOpenable` (Task 1); `activeCount` by `useBoard` only. `card-status` and `card-locked` are the two new test ids, spelled identically in Task 3's tests and markup.

**A deliberate two-task red build, stated in both commit messages.** Task 2 widens `BoardClient`, which breaks `Board.test.tsx`'s fixture; Task 4 owns that file and repairs it. So `npm run build` fails at the end of Tasks 2 and 3 and passes at the end of Task 4, while `npm test` passes throughout because vitest strips types. Both tasks' steps say so and tell the implementer to stop if the build fails for any other reason. The alternative — having Task 2 reach into Task 4's test file — would make two tasks own one file and give a reviewer nothing coherent to approve.
