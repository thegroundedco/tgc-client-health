# Month-aware Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The board shows, for the month picked, exactly the clients being scored that month; and a client can be paused or cancelled for that month from the check-in screen.

**Architecture:** One pure rule, `isOnBoardFor(client, period, hasCheckin)` in `src/board/boardScope.ts`, decides membership; `useBoard` computes the member set once per render and every board consumer (cards, matrix, counts, openability) reads that set instead of a status. The check-in actions are a new pure module (`src/clients/statusChange.ts`), a small write hook (`src/clients/useStatusChange.ts`) that reuses `draftFromRow` / `formProblems` / `updatePayload` / `writeFailureText`, and a panel component mounted on the check-in screen.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + Testing Library (jsdom files carry `// @vitest-environment jsdom` and are named `*.dom.test.ts(x)`), Supabase JS. No migration.

**Spec:** `docs/superpowers/specs/2026-10-28-month-aware-board-design.md` — read it first; this plan argues from it.

## Global Constraints

- A period is always `YYYY-MM-01` (`src/lib/month.ts`). Dates are `YYYY-MM-DD` strings and are compared **as strings**; never parse them into `Date` for comparison (time zones move midnight).
- `src/board/boardScope.ts` and `src/lib/month.ts` must not import `../lib/supabase` (it throws at module scope without VITE_ env, and CI has none).
- No migration, no change to RLS, no change to `clients_lifecycle_coherent`.
- The two new check-in actions render only when `can(profile.role, 'manage_clients')`.
- `cancelled`, never `former`, is what "Cancelled this month" writes.
- Every client write goes through `updatePayload(draft)` with `.eq('id', id)` and ends in `.maybeSingle()`; a null result is `UPDATE_MATCHED_NOTHING_TEXT`, never success.
- Commit only on branch `month-aware-board`. Run `git branch --show-current` before every commit. Stage explicit paths; never `git commit -a`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- A task is done only when `npx vitest run <its files>` passes AND `npx tsc -b` is clean — with one stated exception: Tasks 1 and 2 remove and reshape exports whose callers Task 3 rewrites, so `tsc -b` is expected to fail after them and becomes a gate again at the end of Task 3. Reviewers of Tasks 1–2 check vitest only.

## Review Focus

1. **A client whose status is churned is opened from a past month** (CRP in September): the panel must offer neither action — pausing would silently erase a recorded end date and reason. Pinned in Task 5.
2. **A paused client with a saved check-in is opened**: "Paused this month" must not be offered (already paused), "Cancelled this month" must be. Pinned in Task 5.
3. **A client who started mid-month is cancelled**: the date input's minimum is their start date, not the 1st, so an end before the start is impossible to pick. Pinned in Task 4 (`cancelDateBounds`) and Task 5 (input `min`).
4. **Pressing confirm twice quickly**: only one write is sent. Pinned in Task 4 (hook in-flight guard).
5. **The board is reloaded after an action**: returning from a pause must not show the stale card as still active. Covered by Board's existing `onBack → board.reload()`; Task 5 asserts pause calls `onPaused` only after a successful write.

---

### Task 1: The month rule

**Files:**
- Modify: `src/lib/month.ts` (append two functions)
- Modify: `src/board/boardScope.ts` (replace `ScopedClient`, `isOnBoard`, `activeCount`, `archivedCount`, `visibleClients`, `isOpenable`, `notOpenableReason`; keep `toggleLabel` unchanged)
- Test: `src/lib/month.test.ts` (append; create if absent), `src/board/boardScope.test.ts` (rewrite the parts covering the replaced functions; keep `toggleLabel` tests)

**Interfaces:**
- Produces:
  - `lastDayOf(period: string): string` — `'2026-09-01'` → `'2026-09-30'`
  - `formatDay(date: string): string` — `'2026-10-07'` → `'October 7, 2026'`
  - `type ScopedClient = { id: number; name: string; status: string; started_on: string | null; ended_on: string | null }`
  - `isOnBoardFor(client: ScopedClient, period: string, hasCheckin: boolean): boolean`
  - `boardMembers(clients: readonly ScopedClient[], period: string, checkins: ReadonlyMap<number, unknown>): Set<number>`
  - `archivedCount(clients: readonly ScopedClient[], members: ReadonlySet<number>): number`
  - `visibleClients<T extends ScopedClient>(clients: readonly T[], members: ReadonlySet<number>, showArchived: boolean): T[]`
  - `notOpenableReason(client: ScopedClient, period: string): string`
  - REMOVED: `isOnBoard`, `activeCount`, `isOpenable` (Task 3 removes their callers; `tsc -b` will fail between Task 1 and Task 3 — that is expected, so Task 1's gate is vitest on its own files only, and Tasks 1–3 are reviewed as a unit before `tsc -b` is required).

- [ ] **Step 1: Write the failing month tests** — append to `src/lib/month.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatDay, lastDayOf } from './month'

describe('lastDayOf', () => {
  it.each([
    ['2026-09-01', '2026-09-30'],
    ['2026-10-01', '2026-10-31'],
    ['2026-02-01', '2026-02-28'],
    ['2028-02-01', '2028-02-29'],
    ['2026-12-01', '2026-12-31'],
  ])('%s ends on %s', (period, last) => {
    expect(lastDayOf(period)).toBe(last)
  })
})

describe('formatDay', () => {
  it('reads as a date a person would write', () => {
    expect(formatDay('2026-10-07')).toBe('October 7, 2026')
  })
  it('hands back nonsense unchanged rather than printing "Invalid Date"', () => {
    expect(formatDay('soon')).toBe('soon')
  })
})
```

- [ ] **Step 2: Run, verify it fails** — `npx vitest run src/lib/month.test.ts` → FAIL, `lastDayOf` / `formatDay` not exported.

- [ ] **Step 3: Implement** — append to `src/lib/month.ts`:

```ts
// The last day of a period's month, as YYYY-MM-DD. Day 0 of the NEXT month is
// the last day of this one -- Date does the 28/29/30/31 arithmetic, and the
// result is formatted from its parts, never through toISOString, which would
// shift it across midnight in any zone west of UTC.
export function lastDayOf(period: string): string {
  const [year, month] = period.split('-').map(Number)
  const day = new Date(year, month, 0).getDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// A stored YYYY-MM-DD, written the way a person would. Built from parts for the
// same reason as lastDayOf. Nonsense comes back unchanged, like formatSavedAt.
export function formatDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(year, month - 1, day)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/lib/month.test.ts` → PASS.

- [ ] **Step 5: Write the failing rule tests** — in `src/board/boardScope.test.ts`, replace every test of `isOnBoard`, `activeCount`, `archivedCount`, `visibleClients`, `isOpenable`, `notOpenableReason` with the following (keep the `toggleLabel` tests as they are):

```ts
import { describe, expect, it } from 'vitest'
import {
  archivedCount,
  boardMembers,
  isOnBoardFor,
  notOpenableReason,
  toggleLabel,
  visibleClients,
} from './boardScope'
import type { ScopedClient } from './boardScope'

const SEPT = '2026-09-01'

function client(overrides: Partial<ScopedClient> = {}): ScopedClient {
  return { id: 1, name: 'Acme', status: 'active', started_on: '2026-01-01', ended_on: null, ...overrides }
}

// One table, read by both the rule and the member set, so the two cannot
// disagree about a case. Each row names the edge it exists to catch.
const CASES: [string, Partial<ScopedClient>, boolean, boolean][] = [
  // [why, client, hasCheckin, expected]
  ['active, started long ago', {}, false, true],
  ['started mid-month', { started_on: '2026-09-15' }, false, true],
  ['started on the last day', { started_on: '2026-09-30' }, false, true],
  ['starts the day after the month', { started_on: '2026-10-01' }, false, false],
  ['starts next month', { started_on: '2026-10-07' }, false, false],
  ['no start date', { started_on: null }, false, true],
  ['cancelled mid-month', { status: 'cancelled', ended_on: '2026-09-15' }, false, true],
  ['ended on the first day', { status: 'former', ended_on: '2026-09-01' }, false, true],
  ['ended the day before the month', { status: 'former', ended_on: '2026-08-31' }, false, false],
  ['ended in a later month', { status: 'cancelled', ended_on: '2026-11-30' }, false, true],
  ['paused, nothing saved', { status: 'paused' }, false, false],
  ['paused, check-in saved', { status: 'paused' }, true, true],
  ['ended before the month, check-in saved', { status: 'former', ended_on: '2026-08-31' }, true, true],
  ['starts next month, check-in saved', { started_on: '2026-10-07' }, true, true],
  ['unknown status', { status: 'archived' }, false, false],
]

describe('isOnBoardFor', () => {
  it.each(CASES)('%s', (_why, overrides, hasCheckin, expected) => {
    expect(isOnBoardFor(client(overrides), SEPT, hasCheckin)).toBe(expected)
  })

  it('takes the month end from the period, not a fixed day', () => {
    // A 31-day month: the 31st is inside it. Hard-coding 30 fails here.
    expect(isOnBoardFor(client({ started_on: '2026-10-31' }), '2026-10-01', false)).toBe(true)
    // February: the 29th of a non-leap year does not exist, the 1st of March is outside.
    expect(isOnBoardFor(client({ started_on: '2026-03-01' }), '2026-02-01', false)).toBe(false)
    expect(isOnBoardFor(client({ started_on: '2026-02-28' }), '2026-02-01', false)).toBe(true)
  })
})

describe('boardMembers', () => {
  it('agrees with isOnBoardFor on every case', () => {
    const roster = CASES.map(([, overrides], index) => client({ id: index + 1, ...overrides }))
    const checkins = new Map(CASES.flatMap(([, , has], index) => (has ? [[index + 1, {}]] : [])))
    const members = boardMembers(roster, SEPT, checkins)
    CASES.forEach(([why, , , expected], index) => {
      expect([why, members.has(index + 1)]).toEqual([why, expected])
    })
  })

  it('counts a check-in only if it is in the map, whatever it holds', () => {
    const paused = client({ id: 9, status: 'paused' })
    expect(boardMembers([paused], SEPT, new Map()).has(9)).toBe(false)
    expect(boardMembers([paused], SEPT, new Map([[9, null]])).has(9)).toBe(true)
  })
})

describe('what the board shows', () => {
  const ROSTER = [
    client({ id: 1, name: 'Zinc' }),
    client({ id: 2, name: 'Acme' }),
    client({ id: 3, name: 'Bellwether', status: 'paused' }),
    client({ id: 4, name: 'Cinder', status: 'cancelled', ended_on: '2026-09-30' }),
    client({ id: 5, name: 'Dune', status: 'former', ended_on: '2026-06-30' }),
    client({ id: 6, name: 'Early', started_on: '2026-10-07' }),
  ]
  const members = boardMembers(ROSTER, SEPT, new Map())

  it('shows only members while the toggle is off, by status then name', () => {
    expect(visibleClients(ROSTER, members, false).map((c) => c.name)).toEqual(['Acme', 'Zinc', 'Cinder'])
  })

  it('shows members first, then the rest, while the toggle is on', () => {
    expect(visibleClients(ROSTER, members, true).map((c) => c.name)).toEqual([
      'Acme', 'Zinc', 'Cinder', 'Early', 'Bellwether', 'Dune',
    ])
  })

  it('counts everyone who is not a member as archived', () => {
    expect(archivedCount(ROSTER, members)).toBe(3)
  })

  it('does not sort the array it was given', () => {
    const before = ROSTER.map((c) => c.id)
    visibleClients(ROSTER, members, true)
    expect(ROSTER.map((c) => c.id)).toEqual(before)
  })
})

describe('notOpenableReason', () => {
  it('says a paused client is coming back', () => {
    expect(notOpenableReason(client({ status: 'paused' }), SEPT)).toMatch(/paused/)
  })
  it('names the start date of a client who had not started', () => {
    expect(notOpenableReason(client({ started_on: '2026-10-07' }), SEPT)).toBe(
      'This client starts on October 7, 2026, after September 2026, so there is nothing to score yet.',
    )
  })
  it('names the end date of a client who had already left', () => {
    expect(notOpenableReason(client({ status: 'former', ended_on: '2026-06-30' }), SEPT)).toBe(
      'This client is former and ended on June 30, 2026, before September 2026. Their past check-ins are unchanged.',
    )
  })
  it('says what it found for a status it does not know', () => {
    expect(notOpenableReason(client({ status: 'archived' }), SEPT)).toMatch(/"archived"/)
  })
})
```

- [ ] **Step 6: Run, verify fail** — `npx vitest run src/board/boardScope.test.ts` → FAIL (`isOnBoardFor`, `boardMembers` not exported).

- [ ] **Step 7: Implement** — in `src/board/boardScope.ts`, replace the `ScopedClient` type and the functions `isOnBoard`, `activeCount`, `archivedCount`, `visibleClients`, `isOpenable`, `notOpenableReason` with the following. Keep `toggleLabel` and the module's header comment. Update the imports.

```ts
import { CLIENT_STATUSES, statusLabel, statusRank } from '../clients/clientForm'
import type { ClientStatus } from '../clients/clientForm'
import { formatDay, formatPeriod, lastDayOf } from '../lib/month'

// The columns every function here needs. ended_on joins started_on because the
// board is a MONTH's check-in grid, and which month a client belongs to is a
// question about their dates, not about their status today. Spec §2.
export type ScopedClient = {
  id: number
  name: string
  status: string
  started_on: string | null
  ended_on: string | null
}

function isKnownStatus(status: string): status is ClientStatus {
  return CLIENT_STATUSES.includes(status as ClientStatus)
}

// Spec §2. A client is on the board for a month when they have a check-in for
// it, or were a current client in it. Dates are compared as YYYY-MM-DD strings,
// which sort the same way the dates do.
//
// Rule 1 comes first and wins outright: a month's recorded work is never hidden
// by what happened after it -- a client paused in October still shows in the
// September they were scored in.
//
// A null start date counts as started. Sno-Go has none, and a missing date must
// not hide a client who is being scored. Closed by default on an unknown
// status, as before: a row written outside this app does not join the count of
// check-ins owed.
export function isOnBoardFor(client: ScopedClient, period: string, hasCheckin: boolean): boolean {
  if (hasCheckin) return true
  if (!isKnownStatus(client.status)) return false
  if (client.status === 'paused') return false
  if (client.started_on !== null && client.started_on > lastDayOf(period)) return false
  if (client.ended_on !== null && client.ended_on < period) return false
  return true
}

// The set every board consumer reads, computed once. The VALUE in `checkins` is
// never inspected: a saved draft is a check-in as much as a submitted one.
export function boardMembers(
  clients: readonly ScopedClient[],
  period: string,
  checkins: ReadonlyMap<number, unknown>,
): Set<number> {
  const members = new Set<number>()
  for (const client of clients) {
    if (isOnBoardFor(client, period, checkins.has(client.id))) members.add(client.id)
  }
  return members
}

export function archivedCount(clients: readonly ScopedClient[], members: ReadonlySet<number>): number {
  return clients.filter((client) => !members.has(client.id)).length
}

// Members first, then status rank, then name. A cancelled client still in their
// final month is a member and sorts with the month's work, after the active
// ones; everything behind the toggle follows.
export function visibleClients<T extends ScopedClient>(
  clients: readonly T[],
  members: ReadonlySet<number>,
  showArchived: boolean,
): T[] {
  const shown = showArchived ? clients : clients.filter((client) => members.has(client.id))
  const memberRank = (client: T) => (members.has(client.id) ? 0 : 1)
  // Copied before sorting: the array belongs to the hook's state.
  return [...shown].sort(
    (a, b) =>
      memberRank(a) - memberRank(b) ||
      statusRank(a.status) - statusRank(b.status) ||
      a.name.localeCompare(b.name),
  )
}

// Shown on a card that cannot be opened for this month. Only ever called for a
// non-member, so every branch is a reason the RULE gave, checked in the rule's
// own order.
export function notOpenableReason(client: ScopedClient, period: string): string {
  const month = formatPeriod(period)
  if (!isKnownStatus(client.status)) {
    return `This client's status is "${client.status}", which the board does not recognise, so it cannot be scored.`
  }
  if (client.status === 'paused') {
    return 'This client is paused, so no check-in is expected this month. Set them active on the client admin screen to score them again.'
  }
  if (client.started_on !== null && client.started_on > lastDayOf(period)) {
    return `This client starts on ${formatDay(client.started_on)}, after ${month}, so there is nothing to score yet.`
  }
  if (client.ended_on !== null && client.ended_on < period) {
    return `This client is ${statusLabel(client.status).toLowerCase()} and ended on ${formatDay(client.ended_on)}, before ${month}. Their past check-ins are unchanged.`
  }
  return `This client is not being scored for ${month}.`
}
```

- [ ] **Step 8: Run, verify pass** — `npx vitest run src/board/boardScope.test.ts src/lib/month.test.ts` → PASS.

- [ ] **Step 9: Commit**

```bash
git branch --show-current   # must print month-aware-board
git add src/lib/month.ts src/lib/month.test.ts src/board/boardScope.ts src/board/boardScope.test.ts
git commit -m "feat(board): who is on the board is a question about the month

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The board reads end dates and computes members

**Files:**
- Modify: `src/board/useBoard.ts` (`BoardClient`, the select, `UseBoard`, the count block at the end)
- Test: `src/board/useBoard.dom.test.ts`

**Interfaces:**
- Consumes: `boardMembers` (Task 1).
- Produces: `BoardClient` gains `ended_on: string | null`; `UseBoard` gains `members: Set<number>`; `submitted` and `activeTotal` count members.

- [ ] **Step 1: Write the failing tests** — add to `src/board/useBoard.dom.test.ts`, using that file's existing fake (look at how its existing tests set the clients and check-in results, and set them the same way):

```ts
it('selects ended_on, because membership needs it', async () => {
  // Assert on the select string the fake captured for `clients`.
  // If the fake does not capture it yet, extend it to record the argument
  // passed to .select() for the clients table, then:
  expect(capturedClientSelect()).toContain('ended_on')
})

it('counts a cancelled client in their final month, and not a paused one without a check-in', async () => {
  // period 2026-09-01; clients: active (no check-in), cancelled ended 2026-09-30
  // (submitted check-in), paused (no check-in), starts 2026-10-07 (no check-in)
  // expect: activeTotal 2, submitted 1, members has the first two ids only
})
```

Write the second test concretely against the fake: four client rows `{ id, name, status, started_on, ended_on }` as in the comment, one check-in row for the cancelled client with `submitted_at: '2026-09-30T12:00:00Z'`, render `useBoard('2026-09-01')`, `await waitFor(() => expect(result.current.status).toBe('ready'))`, then:

```ts
expect(result.current.activeTotal).toBe(2)
expect(result.current.submitted).toBe(1)
expect([...result.current.members].sort()).toEqual([1, 2])
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/board/useBoard.dom.test.ts` → FAIL (`members` undefined / select lacks `ended_on`).

- [ ] **Step 3: Implement** in `src/board/useBoard.ts`:
  - `BoardClient`: add `ended_on: string | null` with a one-line comment ("Read for the month rule, spec §2.").
  - The clients query: `.select('id, name, status, started_on, ended_on')`.
  - `UseBoard`: add `members: Set<number>` with a comment that every board consumer reads this rather than a status.
  - Replace the import `activeCount, isOnBoard` with `boardMembers`.
  - Replace the counting block at the end with:

```ts
  // Spec §2: the month's members, computed once. Both numbers count them and
  // nothing else -- M is the check-ins owed this month, N the ones submitted.
  const members = boardMembers(clients, period, checkins)
  let submitted = 0
  for (const client of clients) {
    if (!members.has(client.id)) continue
    if (checkins.get(client.id)?.submitted_at != null) submitted += 1
  }
  const activeTotal = members.size

  return { status, loadError, clients, checkins, scores, submitted, activeTotal, members, reload: () => void load() }
```

  Update the long comment above `submitted` in `UseBoard` so it says "members of the month" rather than "ACTIVE clients".

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/board/useBoard.dom.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add src/board/useBoard.ts src/board/useBoard.dom.test.ts
git commit -m "feat(board): read end dates and count the month's members

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cards, matrix and toggle read the member set

**Files:**
- Modify: `src/board/Board.tsx` (archived/visible, ClientCard props, Matrix props)
- Modify: `src/board/ClientCard.tsx` (props `openable`, `period`; drop the `isOpenable` import)
- Modify: `src/board/Matrix.tsx` (prop `members`; replace both `isOpenable(row.client.status)` with `members.has(row.client.id)`; pass `members` to `matrixRows`)
- Modify: `src/board/matrixMath.ts` (`matrixRows(clients, members, checkins, scores)`)
- Test: `src/board/Board.test.tsx`, `src/board/ClientCard.dom.test.tsx`, `src/board/Matrix.dom.test.tsx`, `src/board/matrixMath.test.ts`, plus any other file `npx tsc -b` reports.

**Interfaces:**
- Consumes: `UseBoard.members`, `visibleClients(clients, members, showArchived)`, `archivedCount(clients, members)`, `notOpenableReason(client, period)`.
- Produces: `ClientCard` props `{ client, checkin, score, viewerId, onOpen, rate?, openable: boolean, period: string }`; `Matrix` props add `members: ReadonlySet<number>`; `matrixRows(clients, members, checkins, scores)`.

- [ ] **Step 1: Write the failing tests**

In `src/board/matrixMath.test.ts`, add:

```ts
it('lists exactly the members, whatever their status', () => {
  const clients = [
    { id: 1, name: 'Zinc', status: 'active', started_on: null, ended_on: null },
    { id: 2, name: 'Cinder', status: 'cancelled', started_on: null, ended_on: '2026-09-30' },
    { id: 3, name: 'Early', status: 'active', started_on: '2026-10-07', ended_on: null },
  ]
  const rows = matrixRows(clients, new Set([1, 2]), new Map(), new Map())
  expect(rows.map((row) => row.client.name)).toEqual(['Cinder', 'Zinc'])
})
```

In `src/board/ClientCard.dom.test.tsx`, add (using that file's existing render helper and fixture, now with `ended_on`):

```ts
it('opens a cancelled client the month they are a member of', () => {
  // render with client { status: 'cancelled', ended_on: '2026-09-30', ... }, openable true
  // expect the name to be a button
})

it('explains a client who had not started yet, and is not a link', () => {
  // render with client { started_on: '2026-10-07' }, openable false, period '2026-09-01'
  // expect text 'This client starts on October 7, 2026, after September 2026, so there is nothing to score yet.'
  // expect no button with the client's name
})
```

In `src/board/Board.test.tsx`, add one test using that file's mocked `useBoard`: return a `members` set that excludes a client whose `status` is `'active'` and includes one whose status is `'former'`; assert the former client's card is in the "Clients" list and the excluded active client is not, and the toggle reads `Show 1 archived`.

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/board` → the new tests FAIL.

- [ ] **Step 3: Implement**

`matrixMath.ts`:

```ts
export function matrixRows(
  clients: readonly BoardClient[],
  members: ReadonlySet<number>,
  checkins: ReadonlyMap<number, CardCheckin>,
  scores: ReadonlyMap<number, BoardScore>,
): MatrixRow[] {
  return clients
    .filter((client) => members.has(client.id))
    .map((client) => ({
      client,
      checkin: checkins.get(client.id) ?? null,
      overall: scores.get(client.id)?.overall_score ?? null,
    }))
    .sort((a, b) => a.client.name.localeCompare(b.client.name))
}
```

Rewrite the comment above it: "The month's members (spec §2), not the board's show-archived state, deliberately: the Average row describes the month and must not move because somebody pressed a display control." Remove the `isOnBoard` import.

`Matrix.tsx`: add `members: ReadonlySet<number>` to `Props` and the destructure; `matrixRows(clients, members, checkins, scores)`; both `isOpenable(row.client.status)` become `members.has(row.client.id)`; remove the `isOpenable` import; update the comment that says "The matrix only ever shows active clients" to "The matrix only ever shows the month's members".

`ClientCard.tsx`: add `openable: boolean` and `period: string` to `Props` and the destructure; delete `const openable = isOpenable(client.status)`; `notOpenableReason(client.status)` → `notOpenableReason(client, period)`; import only `notOpenableReason`.

`Board.tsx`:

```ts
  const archived = archivedCount(board.clients, board.members)
  const visible = visibleClients(board.clients, board.members, showArchived)
```

ClientCard gets `openable={board.members.has(client.id)}` and `period={period}`; Matrix gets `members={board.members}`. Update the two comments that say "activeTotal ... a former client cannot owe a check-in" and "Every active client, not `visible`" to say "the month's members".

- [ ] **Step 4: Typecheck and fix fixtures** — `npx tsc -b`. Every error will be a test fixture or mock missing `ended_on` on a `BoardClient`/`ScopedClient`, a mocked `useBoard` result missing `members`, or a `ClientCard` render missing `openable`/`period`. Fix each by adding `ended_on: null`, `members: new Set(<the ids the old test treated as active>)`, `openable: <what the old status implied>`, `period: '2026-09-01'`. Do not change any assertion while doing this; if an existing assertion now fails, stop and report it — it is a behaviour change the spec must account for.

- [ ] **Step 5: Run everything** — `npx vitest run` → all PASS; `npx tsc -b` → clean; `npm run lint` → clean.

- [ ] **Step 6: Commit**

```bash
git branch --show-current
git add src/board/Board.tsx src/board/ClientCard.tsx src/board/Matrix.tsx src/board/matrixMath.ts \
  src/board/Board.test.tsx src/board/ClientCard.dom.test.tsx src/board/Matrix.dom.test.tsx src/board/matrixMath.test.ts
# plus each fixture file tsc reported, named explicitly
git commit -m "feat(board): cards, matrix and counts read the month's members

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The status change, as rules and a write

**Files:**
- Create: `src/clients/statusChange.ts`, `src/clients/statusChange.test.ts`
- Create: `src/clients/useStatusChange.ts`, `src/clients/useStatusChange.dom.test.ts`

**Interfaces:**
- Consumes: `ClientDraft`, `EMPTY_DRAFT`, `formProblems`, `draftFromRow`, `updatePayload`, `writeFailureText`, `UPDATE_MATCHED_NOTHING_TEXT`, `CLIENT_COLUMNS`, `AdminClient`, `WriteState` from `./clientForm`; `lastDayOf` from `../lib/month`; `describeError` from `../lib/errorText`.
- Produces:
  - `type CancelChange = { kind: 'cancel'; endedOn: string; endReasonCode: string; endReasonNote: string }`
  - `type StatusChange = { kind: 'pause' } | CancelChange`
  - `cancelDateBounds(period: string, startedOn: string | null): { min: string; max: string }`
  - `draftWithChange(draft: ClientDraft, change: StatusChange): ClientDraft`
  - `cancelProblems(change: CancelChange, bounds: { min: string; max: string }): string[]`
  - `useStatusChange(clientId: number): { state: WriteState; apply: (change: StatusChange) => Promise<boolean> }`

- [ ] **Step 1: Write the failing pure tests** — `src/clients/statusChange.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { EMPTY_DRAFT, updatePayload } from './clientForm'
import { cancelDateBounds, cancelProblems, draftWithChange } from './statusChange'
import type { CancelChange } from './statusChange'

const SEPT = '2026-09-01'
const cancel = (overrides: Partial<CancelChange> = {}): CancelChange => ({
  kind: 'cancel', endedOn: '2026-09-30', endReasonCode: 'price', endReasonNote: '', ...overrides,
})

describe('cancelDateBounds', () => {
  it('is the month, for a client who started before it', () => {
    expect(cancelDateBounds(SEPT, '2026-01-01')).toEqual({ min: '2026-09-01', max: '2026-09-30' })
  })
  it('is the month, for a client with no start date', () => {
    expect(cancelDateBounds(SEPT, null)).toEqual({ min: '2026-09-01', max: '2026-09-30' })
  })
  it('starts at the start date for a client who began mid-month', () => {
    expect(cancelDateBounds(SEPT, '2026-09-16')).toEqual({ min: '2026-09-16', max: '2026-09-30' })
  })
})

describe('draftWithChange', () => {
  const draft = { ...EMPTY_DRAFT, name: 'Acme', note: 'kept', typeCode: 'ecommerce' }
  it('pauses, clearing nothing that is not a lifecycle field', () => {
    const paused = draftWithChange(draft, { kind: 'pause' })
    expect(paused).toEqual({ ...draft, status: 'paused', endedOn: '', endReasonCode: '', endReasonNote: '' })
  })
  it('cancels, carrying the date, reason and note into the payload', () => {
    const payload = updatePayload(draftWithChange(draft, cancel({ endReasonNote: ' too dear ' })))
    expect(payload).toMatchObject({
      status: 'cancelled', ended_on: '2026-09-30', end_reason_code: 'price', end_reason_note: 'too dear',
      note: 'kept', type_code: 'ecommerce',
    })
  })
})

describe('cancelProblems', () => {
  const bounds = cancelDateBounds(SEPT, '2026-09-16')
  it('accepts a complete cancellation inside the bounds', () => {
    expect(cancelProblems(cancel(), bounds)).toEqual([])
  })
  it('refuses a missing reason, in the roster form’s own words', () => {
    expect(cancelProblems(cancel({ endReasonCode: '' }), bounds)).toEqual([
      'A cancelled or former client needs a reason from the list.',
    ])
  })
  it('refuses a missing date', () => {
    expect(cancelProblems(cancel({ endedOn: '' }), bounds)).toEqual([
      'A cancelled or former client needs the date they left.',
    ])
  })
  it.each(['2026-09-15', '2026-10-01'])('refuses %s, outside the bounds', (endedOn) => {
    expect(cancelProblems(cancel({ endedOn }), bounds)).toEqual([
      'The end date has to fall between September 16, 2026 and September 30, 2026.',
    ])
  })
  it('accepts both ends of the bounds', () => {
    expect(cancelProblems(cancel({ endedOn: '2026-09-16' }), bounds)).toEqual([])
    expect(cancelProblems(cancel({ endedOn: '2026-09-30' }), bounds)).toEqual([])
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/clients/statusChange.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/clients/statusChange.ts`:

```ts
import { EMPTY_DRAFT, formProblems } from './clientForm'
import type { ClientDraft } from './clientForm'
import { formatDay, lastDayOf } from '../lib/month'

// What the check-in screen can do to a client's status (spec §3). Two changes,
// no more: settling `cancelled` to `former`, or anything else, stays on the
// roster, where Edit client already goes.
export type CancelChange = { kind: 'cancel'; endedOn: string; endReasonCode: string; endReasonNote: string }
export type StatusChange = { kind: 'pause' } | CancelChange

export type DateBounds = { min: string; max: string }

// The month being scored, but never before the client started: an end date
// earlier than the start is a client who left before they arrived.
export function cancelDateBounds(period: string, startedOn: string | null): DateBounds {
  const min = startedOn !== null && startedOn > period ? startedOn : period
  return { min, max: lastDayOf(period) }
}

// Only the four lifecycle fields move. Name, owner, start date, note and type
// are carried across untouched, because updatePayload sends every column on
// every write and a change here must not rewrite what the roster holds.
export function draftWithChange(draft: ClientDraft, change: StatusChange): ClientDraft {
  if (change.kind === 'pause') {
    return { ...draft, status: 'paused', endedOn: '', endReasonCode: '', endReasonNote: '' }
  }
  return {
    ...draft,
    status: 'cancelled',
    endedOn: change.endedOn,
    endReasonCode: change.endReasonCode,
    endReasonNote: change.endReasonNote,
  }
}

// What the panel refuses before anything is sent. The lifecycle sentences come
// from formProblems itself, run on a stand-in draft, so the panel and the
// roster can never word the same rule two ways. The bounds are this screen's
// own rule (spec §3), added after.
export function cancelProblems(change: CancelChange, bounds: DateBounds): string[] {
  const lifecycle = formProblems(draftWithChange({ ...EMPTY_DRAFT, name: 'stand-in' }, change))
    .filter((problem) => problem.field === 'endedOn' || problem.field === 'endReasonCode')
    .map((problem) => problem.text)
  const outside = change.endedOn !== '' && (change.endedOn < bounds.min || change.endedOn > bounds.max)
  return outside
    ? [...lifecycle, `The end date has to fall between ${formatDay(bounds.min)} and ${formatDay(bounds.max)}.`]
    : lifecycle
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/clients/statusChange.test.ts` → PASS.

- [ ] **Step 5: Write the failing hook tests** — `src/clients/useStatusChange.dom.test.ts`. Model the Supabase fake on `src/clients/useClients.dom.test.ts` (vi.hoisted `db`, `vi.mock('../lib/supabase', ...)`), but for this hook's chain: `from('clients').select(cols).eq('id', id).maybeSingle()` for the read and `from('clients').update(payload).eq('id', id).select(cols).maybeSingle()` for the write. Record `db.reads`, `db.updates`, `db.lastUpdate`, `db.lastFilter`.

```ts
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UPDATE_MATCHED_NOTHING_TEXT } from './clientForm'

const ROW = {
  id: 7, name: 'Acme', owner_id: null, status: 'active', started_on: '2026-01-01', ended_on: null,
  end_reason_code: null, end_reason_note: null, note: 'kept', type_code: null, updated_at: '2026-10-28T10:00:00Z',
}

// ... db + vi.mock as described above; `db.read` resolves { data: ROW, error: null } by default,
// `db.write` resolves { data: { ...ROW, ...db.lastUpdate, updated_at: '2026-10-28T11:00:00Z' }, error: null }.

describe('useStatusChange', () => {
  beforeEach(() => { /* reset db to defaults */ })

  it('pauses by id, sending the whole row with only the status changed', async () => {
    const { result } = renderHook(() => useStatusChange(7))
    let ok = false
    await act(async () => { ok = await result.current.apply({ kind: 'pause' }) })
    expect(ok).toBe(true)
    expect(db.lastFilter).toEqual(['id', 7])
    expect(db.lastUpdate).toMatchObject({ status: 'paused', note: 'kept', name: 'Acme', ended_on: null })
    expect(result.current.state).toMatchObject({ kind: 'saved' })
  })

  it('cancels with the date and reason given', async () => {
    const { result } = renderHook(() => useStatusChange(7))
    await act(async () => {
      await result.current.apply({ kind: 'cancel', endedOn: '2026-09-30', endReasonCode: 'price', endReasonNote: '' })
    })
    expect(db.lastUpdate).toMatchObject({ status: 'cancelled', ended_on: '2026-09-30', end_reason_code: 'price', end_reason_note: null })
  })

  it('treats an update that matched nothing as a failure, not a success', async () => {
    db.write = async () => ({ data: null, error: null })
    const { result } = renderHook(() => useStatusChange(7))
    let ok = true
    await act(async () => { ok = await result.current.apply({ kind: 'pause' }) })
    expect(ok).toBe(false)
    expect(result.current.state).toEqual({ kind: 'failed', message: UPDATE_MATCHED_NOTHING_TEXT })
  })

  it('sends nothing when the row cannot be read', async () => {
    db.read = async () => ({ data: null, error: { message: 'boom' } })
    const { result } = renderHook(() => useStatusChange(7))
    await act(async () => { await result.current.apply({ kind: 'pause' }) })
    expect(db.updates).toBe(0)
    expect(result.current.state).toMatchObject({ kind: 'failed' })
  })

  it('refuses an incomplete cancellation before any write', async () => {
    const { result } = renderHook(() => useStatusChange(7))
    await act(async () => {
      await result.current.apply({ kind: 'cancel', endedOn: '2026-09-30', endReasonCode: '', endReasonNote: '' })
    })
    expect(db.updates).toBe(0)
    expect(result.current.state).toEqual({ kind: 'failed', message: 'A cancelled or former client needs a reason from the list.' })
  })

  it('sends one write when confirm is pressed twice', async () => {
    const { result } = renderHook(() => useStatusChange(7))
    await act(async () => {
      await Promise.all([result.current.apply({ kind: 'pause' }), result.current.apply({ kind: 'pause' })])
    })
    expect(db.updates).toBe(1)
  })

  it('shows a translated failure when the database refuses', async () => {
    db.write = async () => ({ data: null, error: { message: 'violates check constraint "clients_lifecycle_coherent"' } })
    const { result } = renderHook(() => useStatusChange(7))
    await act(async () => { await result.current.apply({ kind: 'pause' }) })
    expect(result.current.state).toMatchObject({ kind: 'failed', message: expect.stringContaining('needs an end date and a reason') })
  })
})
```

- [ ] **Step 6: Run, verify fail** — `npx vitest run src/clients/useStatusChange.dom.test.ts` → FAIL (module missing).

- [ ] **Step 7: Implement** — `src/clients/useStatusChange.ts`:

```ts
import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import {
  CLIENT_COLUMNS,
  UPDATE_MATCHED_NOTHING_TEXT,
  draftFromRow,
  formProblems,
  updatePayload,
  writeFailureText,
} from './clientForm'
import type { AdminClient, WriteState } from './clientForm'
import { draftWithChange } from './statusChange'
import type { StatusChange } from './statusChange'

const READ_FAILED_TEXT = 'This client could not be read, so nothing was changed. Try again in a moment.'

// Pause or cancel one client from the check-in screen (spec §3). Reads the row
// first because updatePayload sends EVERY column: writing from the check-in's
// partial client object would blank the owner, note and type. The read and the
// write both filter on id; the write ends in .maybeSingle() for the reason
// useClients documents -- a refused caller matches zero rows and raises nothing.
export function useStatusChange(clientId: number) {
  const [state, setState] = useState<WriteState>({ kind: 'idle' })
  const inFlight = useRef(false)

  const apply = useCallback(
    async (change: StatusChange): Promise<boolean> => {
      if (inFlight.current) return false
      inFlight.current = true
      setState({ kind: 'saving' })
      try {
        const read = await supabase.from('clients').select(CLIENT_COLUMNS).eq('id', clientId).maybeSingle()
        if (read.error || read.data === null) {
          setState({ kind: 'failed', message: READ_FAILED_TEXT })
          return false
        }
        const draft = draftWithChange(draftFromRow(read.data as AdminClient), change)
        const problems = formProblems(draft)
        if (problems.length > 0) {
          setState({ kind: 'failed', message: problems.map((problem) => problem.text).join(' ') })
          return false
        }
        const { data, error } = await supabase
          .from('clients')
          .update(updatePayload(draft))
          .eq('id', clientId)
          .select(CLIENT_COLUMNS)
          .maybeSingle()
        if (error) {
          setState({ kind: 'failed', message: writeFailureText(describeError(error), draft.name.trim()) })
          return false
        }
        if (data === null) {
          setState({ kind: 'failed', message: UPDATE_MATCHED_NOTHING_TEXT })
          return false
        }
        setState({ kind: 'saved', at: data.updated_at, what: change.kind === 'pause' ? 'Paused' : 'Cancelled' })
        return true
      } catch (thrown) {
        setState({ kind: 'failed', message: writeFailureText(describeError(thrown), '') })
        return false
      } finally {
        inFlight.current = false
      }
    },
    [clientId],
  )

  return { state, apply }
}
```

- [ ] **Step 8: Run, verify pass** — `npx vitest run src/clients/statusChange.test.ts src/clients/useStatusChange.dom.test.ts` → PASS; `npx tsc -b` clean.

- [ ] **Step 9: Commit**

```bash
git branch --show-current
git add src/clients/statusChange.ts src/clients/statusChange.test.ts src/clients/useStatusChange.ts src/clients/useStatusChange.dom.test.ts
git commit -m "feat(clients): pause or cancel a client for a month, through the roster's own rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The panel on the check-in screen

**Files:**
- Create: `src/checkin/EndClientPanel.tsx`, `src/checkin/EndClientPanel.module.css`, `src/checkin/EndClientPanel.dom.test.tsx`
- Modify: `src/checkin/CheckIn.tsx` (Props `client` gains `status: string`; mount the panel in the ready branch only)
- Test: `src/checkin/CheckIn.dom.test.tsx` (gating)

**Interfaces:**
- Consumes: `useStatusChange`, `cancelDateBounds`, `cancelProblems`, `END_REASON_CODES`, `END_REASON_LABELS`, `formatDay`.
- Produces: `EndClientPanel` props `{ client: { id: number; name: string; status: string; started_on: string | null }; period: string; hasCheckin: boolean; onPaused: () => void }`.

- [ ] **Step 1: Write the failing panel tests** — `src/checkin/EndClientPanel.dom.test.tsx`. Mock `../clients/useStatusChange` with `vi.mock`, so `apply` is a `vi.fn` resolving `true` (or `false` with a failed state, per test) and `state` is controllable.

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hook = vi.hoisted(() => ({
  apply: vi.fn(async () => true),
  state: { kind: 'idle' } as { kind: string; message?: string },
}))
vi.mock('../clients/useStatusChange', () => ({
  useStatusChange: () => ({ state: hook.state, apply: hook.apply }),
}))

import { EndClientPanel } from './EndClientPanel'

const ACTIVE = { id: 7, name: 'Acme', status: 'active', started_on: '2026-09-16' }

function renderPanel(overrides: Partial<Parameters<typeof EndClientPanel>[0]> = {}) {
  const onPaused = vi.fn()
  render(<EndClientPanel client={ACTIVE} hasCheckin={false} onPaused={onPaused} period="2026-09-01" {...overrides} />)
  return { onPaused }
}

describe('EndClientPanel', () => {
  beforeEach(() => { hook.apply.mockReset(); hook.apply.mockResolvedValue(true); hook.state = { kind: 'idle' } })

  it('offers both actions for an active client', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: 'Paused this month' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancelled this month' })).toBeTruthy()
  })

  it('offers only cancel for a paused client', () => {
    renderPanel({ client: { ...ACTIVE, status: 'paused' } })
    expect(screen.queryByRole('button', { name: 'Paused this month' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancelled this month' })).toBeTruthy()
  })

  it.each(['cancelled', 'former'])('offers nothing for a %s client, whose end must not be overwritten', (status) => {
    const { container } = render(
      <EndClientPanel client={{ ...ACTIVE, status }} hasCheckin onPaused={vi.fn()} period="2026-09-01" />,
    )
    expect(container.textContent).toBe('')
  })

  it('pauses only after confirming, then leaves the screen', async () => {
    const { onPaused } = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Paused this month' }))
    expect(hook.apply).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Pause Acme' }))
    expect(hook.apply).toHaveBeenCalledWith({ kind: 'pause' })
    expect(onPaused).toHaveBeenCalledTimes(1)
  })

  it('says a client with a check-in stays on this month', async () => {
    renderPanel({ hasCheckin: true })
    await userEvent.click(screen.getByRole('button', { name: 'Paused this month' }))
    expect(screen.getByText(/stay on September 2026’s board because they already have a check-in/)).toBeTruthy()
  })

  it('does not leave the screen when the pause fails', async () => {
    hook.apply.mockResolvedValue(false)
    const { onPaused } = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Paused this month' }))
    await userEvent.click(screen.getByRole('button', { name: 'Pause Acme' }))
    expect(onPaused).not.toHaveBeenCalled()
  })

  it('bounds the end date to the month, from the start date, defaulting to the last day', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelled this month' }))
    const date = screen.getByLabelText('End date') as HTMLInputElement
    expect([date.min, date.max, date.value]).toEqual(['2026-09-16', '2026-09-30', '2026-09-30'])
  })

  it('refuses a cancellation with no reason before sending anything', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelled this month' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mark cancelled' }))
    expect(hook.apply).not.toHaveBeenCalled()
    expect(screen.getByText('A cancelled or former client needs a reason from the list.')).toBeTruthy()
  })

  it('cancels and stays, saying the check-in can still be finished', async () => {
    const { onPaused } = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelled this month' }))
    await userEvent.selectOptions(screen.getByLabelText('Reason they left'), 'price')
    await userEvent.click(screen.getByRole('button', { name: 'Mark cancelled' }))
    expect(hook.apply).toHaveBeenCalledWith({ kind: 'cancel', endedOn: '2026-09-30', endReasonCode: 'price', endReasonNote: '' })
    expect(onPaused).not.toHaveBeenCalled()
    expect(screen.getByText('Acme is cancelled as of September 30, 2026. You can still finish this check-in. To undo it, use Edit client.')).toBeTruthy()
  })

  it('shows the failure the hook reports', () => {
    hook.state = { kind: 'failed', message: 'Nope. Nothing was changed.' }
    renderPanel()
    expect(screen.getByRole('alert').textContent).toBe('Nope. Nothing was changed.')
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/checkin/EndClientPanel.dom.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/checkin/EndClientPanel.tsx`:

```tsx
import { useState } from 'react'
import { END_REASON_CODES, END_REASON_LABELS } from '../clients/clientForm'
import { cancelDateBounds, cancelProblems } from '../clients/statusChange'
import { useStatusChange } from '../clients/useStatusChange'
import { formatDay, formatPeriod } from '../lib/month'
import styles from './EndClientPanel.module.css'

type Props = {
  client: { id: number; name: string; status: string; started_on: string | null }
  period: string
  hasCheckin: boolean
  // Called only after a pause has been written. The board re-reads on the way
  // back, so the card it returns to is the paused one.
  onPaused: () => void
}

// Spec §3. Pause or cancel the client for the month being scored, without a
// trip to the roster. Offered only where it cannot overwrite a recorded end:
// an active client can be paused or cancelled, a paused one cancelled, and a
// cancelled or former one neither -- pausing them would clear an end date and a
// reason, and that belongs on the roster where the warning for it lives.
export function EndClientPanel({ client, period, hasCheckin, onPaused }: Props) {
  const { state, apply } = useStatusChange(client.id)
  const bounds = cancelDateBounds(period, client.started_on)
  const [open, setOpen] = useState<'none' | 'pause' | 'cancel'>('none')
  const [endedOn, setEndedOn] = useState(bounds.max)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [cancelledOn, setCancelledOn] = useState<string | null>(null)

  const canPause = client.status === 'active'
  const canCancel = client.status === 'active' || client.status === 'paused'
  if (!canPause && !canCancel) return null

  const saving = state.kind === 'saving'
  const change = { kind: 'cancel' as const, endedOn, endReasonCode: reason, endReasonNote: note }
  const problems = cancelProblems(change, bounds)

  if (cancelledOn !== null) {
    return (
      <p className="t-body prose" role="status">
        {client.name} is cancelled as of {formatDay(cancelledOn)}. You can still finish this check-in. To undo
        it, use Edit client.
      </p>
    )
  }

  return (
    <div className={styles.panel}>
      {open === 'none' && (
        <div className={styles.actions}>
          {canPause && (
            <button className="button button--quiet" onClick={() => setOpen('pause')} type="button">
              Paused this month
            </button>
          )}
          <button className="button button--quiet" onClick={() => setOpen('cancel')} type="button">
            Cancelled this month
          </button>
        </div>
      )}

      {open === 'pause' && (
        <div className={styles.confirm}>
          <p className="t-body prose">
            Pause {client.name}? They come off the board until you set them active again.
            {hasCheckin &&
              ` They will still stay on ${formatPeriod(period)}’s board because they already have a check-in.`}
          </p>
          <div className={styles.actions}>
            <button
              className="button"
              disabled={saving}
              onClick={async () => {
                if (await apply({ kind: 'pause' })) onPaused()
              }}
              type="button"
            >
              Pause {client.name}
            </button>
            <button className="button button--quiet" onClick={() => setOpen('none')} type="button">
              Keep active
            </button>
          </div>
        </div>
      )}

      {open === 'cancel' && (
        <form
          className={styles.confirm}
          onSubmit={async (event) => {
            event.preventDefault()
            setAttempted(true)
            if (problems.length > 0) return
            if (await apply(change)) setCancelledOn(endedOn)
          }}
        >
          <label className="t-label" htmlFor="end-client-date">End date</label>
          <input
            id="end-client-date"
            max={bounds.max}
            min={bounds.min}
            onChange={(event) => setEndedOn(event.target.value)}
            type="date"
            value={endedOn}
          />
          <label className="t-label" htmlFor="end-client-reason">Reason they left</label>
          <select id="end-client-reason" onChange={(event) => setReason(event.target.value)} value={reason}>
            <option value="">Choose a reason</option>
            {END_REASON_CODES.map((code) => (
              <option key={code} value={code}>{END_REASON_LABELS[code]}</option>
            ))}
          </select>
          <label className="t-label" htmlFor="end-client-note">Note (optional)</label>
          <textarea id="end-client-note" onChange={(event) => setNote(event.target.value)} value={note} />
          {attempted && problems.length > 0 && <p className="t-caption prose">{problems.join(' ')}</p>}
          <div className={styles.actions}>
            <button className="button" disabled={saving} type="submit">Mark cancelled</button>
            <button className="button button--quiet" onClick={() => setOpen('none')} type="button">Never mind</button>
          </div>
        </form>
      )}

      {state.kind === 'failed' && (
        <p className="alert prose" role="alert">{state.message}</p>
      )}
    </div>
  )
}
```

`src/checkin/EndClientPanel.module.css`:

```css
.panel { display: grid; gap: var(--space-s, 0.75rem); }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-s, 0.75rem); }
.confirm { display: grid; gap: var(--space-xs, 0.5rem); max-inline-size: 36rem; }
```

Before writing the CSS, check `src/styles/` for the real spacing token names (`grep -n "\-\-space" src/styles/*.css`) and use those; `tests/customProperties.test.ts` fails on an undefined custom property, so a fallback is not enough if the token name is wrong — fix the name.

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/checkin/EndClientPanel.dom.test.tsx` → PASS.

- [ ] **Step 5: Write the failing gating tests** — in `src/checkin/CheckIn.dom.test.tsx`, using its existing render helper and profiles: (a) a profile with `manage_clients` sees "Cancelled this month" once the screen is ready; (b) a profile without it does not; (c) while loading, neither the Edit client button's neighbour panel nor its buttons render (`queryByRole('button', { name: 'Cancelled this month' })` is null during loading). Every fixture `client` gains `status: 'active'`.

- [ ] **Step 6: Run, verify fail** — `npx vitest run src/checkin/CheckIn.dom.test.tsx` → (a) FAILS.

- [ ] **Step 7: Implement** — in `src/checkin/CheckIn.tsx`:
  - `Props.client`: `{ id: number; name: string; status: string; started_on: string | null }`.
  - Import `EndClientPanel`.
  - In the final (ready) `return`, directly after `{masthead}`:

```tsx
      {can(profile.role, 'manage_clients') && (
        // Spec §3: pausing or cancelling for this month, beside Edit client
        // rather than a trip to the roster. Ready branch only -- an action that
        // changes who is scored has no business beside an unread check-in.
        <EndClientPanel client={client} hasCheckin={stored != null} onPaused={onBack} period={period} />
      )}
```

  Board already passes `selected` (a `BoardClient`, which has `status`), so no Board change is needed.

- [ ] **Step 8: Run everything** — `npx vitest run` → PASS; `npx tsc -b` → clean; `npm run lint` → clean.

- [ ] **Step 9: Commit**

```bash
git branch --show-current
git add src/checkin/EndClientPanel.tsx src/checkin/EndClientPanel.module.css src/checkin/EndClientPanel.dom.test.tsx \
  src/checkin/CheckIn.tsx src/checkin/CheckIn.dom.test.tsx
git commit -m "feat(checkin): pause or cancel a client from the month being scored

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Prove it

**Files:** none created; scratch mutations are reverted.

- [ ] **Step 1: Mutation pass on the rule.** In `src/board/boardScope.ts`, apply each mutation alone, run `npx vitest run src/board`, record that it FAILS, then `git checkout src/board/boardScope.ts`:
  1. `started_on > lastDayOf(period)` → `>=`
  2. `ended_on < period` → `<=`
  3. delete `if (hasCheckin) return true`
  4. delete `client.started_on !== null &&` (null start)
  5. delete `if (client.status === 'paused') return false`
  6. `lastDayOf(period)` → `period`

  And in `src/clients/statusChange.ts`: `startedOn > period ? startedOn : period` → `period`; `change.endedOn > bounds.max` → `>=`. And in `src/clients/useStatusChange.ts`: delete `if (inFlight.current) return false`; `.eq('id', clientId)` on the update → removed. Any mutant that survives: add the test that kills it, in the owning task's test file, and commit it.

- [ ] **Step 2: CI's own command** — `mv .env.local .env.local.aside && npx vitest run --exclude '**/rls.test.ts'; mv .env.local.aside .env.local`. Expected: PASS. Then `npm run build` → clean.

- [ ] **Step 3: Staging expectations.** Run the spec §2 rule as SQL against **staging** (`dexsdhtpfsswgiytxntl`) for 2026-08, 2026-09 and 2026-10 — the same query the spec's production numbers came from — and write the three lists into the handoff, so the owner knows what the dev server should show before opening it.

- [ ] **Step 4: Whole-branch review** on the strongest model, then hand to the owner for the staging look. Do not merge or push until the owner says so.
