# Slice 2 Step 4 — The Clients Admin Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the screen that adds a client, renames one, assigns an owner, and gives a departing client an end date and a coded reason — the first screen in this project whose writes a database constraint can refuse.

**Architecture:** The same three-way split the check-in screen uses. Every decision the form makes lives in one pure module (`src/clients/clientForm.ts`) that imports no React and no Supabase client, so it is unit-testable in the node environment. The read and the two writes live behind one hook (`src/clients/useClients.ts`) so the screen can be rendered in a test with the database mocked out. The screen and its two forms render that hook's result and nothing else. Spec §9 states the rule this enforces: **the form's three rules are not ternaries in JSX.**

**Tech Stack:** React 19.2.8, TypeScript 6.0.2 (`strict`, `verbatimModuleSyntax`), Vite 8.2.0, Vitest 4.1.11 (`environment: 'node'` by default, jsdom opt-in per file), `@supabase/supabase-js` 2.112.3, `@testing-library/react` 16, oxlint 1.75.0.

**Spec:** `docs/superpowers/specs/2026-08-23-phase-1-slice-2-design.md` — §2 item 4, §7 (the screen), §8 (the widening this consumes), §9 (testing), §10 decisions 2–5, §11 item 6.

---

## Global Constraints

- **No new migration, and no database change of any kind.** Steps 1–3 built every column, constraint, index and policy this screen needs. If a task in this plan seems to want a migration, the plan is wrong — stop and say so.
- **No delete, anywhere** — spec §2 and §10 decision 5. No delete button, no `.delete()` call. `checkins.client_id` is `on delete cascade` and this project has no backups. `former` is how a client goes away.
- **Every colour and every typeface lives in `src/styles/tokens.css`.** `tests/tokens.test.ts` walks `src/` and `index.html` and fails the build on a hex literal, a colour function, a named colour after a colour property, the `font` shorthand, or a `font-family` that is not a single `var(--face-…)` reference. It walks comments too — spec §11 item 8 records that this gate has already false-positived twice on prose, so do not write an example of the banned syntax inside a comment in `src/`.
- **Tests that read the filesystem live in `tests/`, never under `src/`.** `tsconfig.app.json` sets `types: ["vite/client"]` and `include: ["src"]`; a `node:fs` import under `src/` passes `npm test` and fails `npm run build` with TS2591. `tsconfig.node.json` covers `tests/`. Recorded at `src/styles/tokenRules.ts:15` and `src/lib/capabilities.ts:18`.
- **`verbatimModuleSyntax`** — every type-only import must be spelled `import type`.
- **`noUnusedLocals` and `noUnusedParameters`** are on. An unused import fails `npm run build`, not just lint.
- **Three gates, all green, before every commit:** `npm test`, `npm run build`, `npm run lint`.
- **The permission model is enforced by Postgres, never by the UI.** `src/lib/capabilities.ts:3-8` states it: `can()` decides what a screen *draws*; the RLS policies decide what *happens*. A bug in `can()` is a usability defect. Never move a check out of the database into it.

---

## Four things measured before this plan was written

Spec §9's two standing instructions are "read the file before writing the step that edits it" and "a number in prose needs the command that produced it run in the same breath". These four came out of that reading, and each one changes a task below.

1. **`can()` does not compile against a real profile today.** `src/lib/capabilities.ts:56` declares `can(role: Role, capability: Capability)`, and `Profile['role']` is `string` — `src/types/database.ts:134`, because `profiles.role` is a text column with a check constraint. So `can(profile.role, 'manage_clients')` is a type error as the function stands. Task 1 widens the parameter, which also makes the closed-by-default guard the function already documents at line 52 reachable for the first time.
2. **`can()` has no caller in `src/`.** `grep -rn "capabilities'" src/ tests/` returns exactly one line, `tests/capabilities.test.ts:41`. This step is the first consumer of the TypeScript preset table — until now it existed only to be checked against the migration.
3. **The lifecycle columns are already in the generated types.** `src/types/database.ts:86-116` carries `ended_on`, `end_reason_code` and `end_reason_note` on all three of `Row`, `Insert` and `Update`. No type regeneration is needed, and a task that regenerates them risks reverting hand edits.
4. **`Board.tsx:75` tells the reader to add a client in the Supabase dashboard.** That sentence stops being true the moment this screen ships, and Task 4 edits it. Related: `Board.test.tsx:25` mocks `../lib/supabase` as `{}` because Board renders CheckIn, which imports `useCheckin`, which imports the client at module scope and throws when `VITE_` config is absent — and CI runs vitest with no `VITE_` env. Rendering `ClientsAdmin` from Board adds a second such chain, so Task 4 must mock `../clients/useClients` in that file or `supabase.from` is called on `{}`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/capabilities.ts` | **Modify.** Widen `can()`'s first parameter to `string`. | 1 |
| `tests/capabilities.test.ts` | **Modify.** One test proving an unknown role answers no. | 1 |
| `src/clients/clientForm.ts` | **Create.** Every decision the screen makes, as pure functions: the status and reason vocabularies, the three §7 rules, the two write payloads, the failure copy, the status line, the row sort. No React, no Supabase. | 1 |
| `src/clients/clientForm.test.ts` | **Create.** Node environment. The rules, exhaustively. | 1 |
| `tests/clientFormDrift.test.ts` | **Create.** Reads both migrations with `node:fs` and asserts the TypeScript vocabularies match the deployed check constraints. | 1 |
| `src/clients/useClients.ts` | **Create** (read half), **modify** (write half). The one place this screen talks to the database. | 2, 3 |
| `src/clients/ClientsAdmin.tsx` | **Create** (nav, masthead, list), **modify** (mount the forms). | 2, 3 |
| `src/clients/ClientsAdmin.module.css` | **Create** (list), **modify** (forms). | 2, 3 |
| `src/clients/ClientsAdmin.dom.test.tsx` | **Create** (read states), **append** (write states). One file, one fixture factory, so the two halves cannot drift. | 2, 3 |
| `src/clients/AddClientForm.tsx` | **Create.** Name, owner, Add. No status field. | 3 |
| `src/clients/EditClientForm.tsx` | **Create.** Name, owner, status, and the revealed lifecycle fields. | 3 |
| `src/board/Board.tsx` | **Modify.** A `view` state, the capability-gated link, and the empty-state sentence. | 4 |
| `src/board/Board.test.tsx` | **Modify.** The gate, both ways, and the navigation. | 4 |
| `README.md` | **Modify.** One paragraph on what the screen can and cannot refuse. | 4 |

---

### Task 1: The form's decisions, as pure functions

**Files:**
- Modify: `src/lib/capabilities.ts:52-58`
- Modify: `tests/capabilities.test.ts` (append one test)
- Create: `src/clients/clientForm.ts`
- Create: `src/clients/clientForm.test.ts`
- Create: `tests/clientFormDrift.test.ts`

**Interfaces:**
- Consumes: `formatSavedAt(iso: string): string` from `src/lib/month.ts`.
- Produces, and Tasks 2–4 rely on every name here:
  - `type ClientStatus = 'active' | 'paused' | 'cancelled' | 'former'`
  - `CLIENT_STATUSES: readonly ClientStatus[]`
  - `STATUS_LABELS: Record<ClientStatus, string>`, `STATUS_HINTS: Record<ClientStatus, string>`
  - `statusLabel(status: string): string`
  - `END_REASON_CODES: readonly string[]`, `END_REASON_LABELS: Record<string, string>`, `reasonLabel(code: string | null): string`
  - `isChurned(status: string): boolean`
  - `CLIENT_COLUMNS: string`, `type AdminClient`
  - `type ClientDraft`, `EMPTY_DRAFT: ClientDraft`, `draftFromRow(row: AdminClient): ClientDraft`
  - `type FormProblem`, `formProblems(draft: ClientDraft): FormProblem[]`
  - `reactivationWarning(from: string, to: string): string | null`
  - `insertPayload(draft: ClientDraft)`, `updatePayload(draft: ClientDraft)`
  - `writeFailureText(message: string, name: string): string`
  - `type WriteState`, `type StatusTone`, `type StatusLine`, `writeStatusLine(state: WriteState, problems: readonly FormProblem[]): StatusLine`
  - `ownerLabel(profile: { full_name: string | null; email: string }): string`
  - `sortClients(rows: readonly AdminClient[]): AdminClient[]`
  - `can(role: string, capability: Capability): boolean` (widened)

- [ ] **Step 1: Read the two files this step edits, and the two migrations it will be pinned against**

```bash
sed -n '29,58p' src/lib/capabilities.ts
sed -n '35,60p' tests/capabilities.test.ts
sed -n '5,20p'  supabase/migrations/20260821021840_create_clients_and_checkins.sql
sed -n '46,74p' supabase/migrations/20260823213144_add_client_lifecycle.sql
```

Expected, and if any of these is not what you see, stop: `can` takes `role: Role`; the clients table declares `status text not null default 'active' check (status in ('active', 'paused', 'cancelled', 'former'))`; the lifecycle migration declares `clients_end_reason_code_known` over the seven codes `price, scope_fit, in_housed, went_quiet, project_completed, agency_initiated, other`, and a unique index named `clients_name_unique` on `lower(name)`.

- [ ] **Step 2: Write the failing widening test**

Append to `tests/capabilities.test.ts`, inside the existing top-level `describe`:

```ts
  // The guard at src/lib/capabilities.ts:52 says an unexpected string must
  // answer "no" rather than throw. Until Slice 2 step 4 the parameter was typed
  // `Role`, so that sentence described behaviour no caller could reach and no
  // test could ask for. The screen passes `profile.role`, which is a text
  // column typed `string`, so the guard is now load-bearing.
  //
  // 'sales' is the same fourth role scripts/verify-capability.sql evaluates the
  // deployed CASE against, so both halves of the model are probed with the same
  // unknown value.
  it('answers no for a role it does not know, rather than throwing', () => {
    for (const capability of CAPABILITIES) {
      expect(can('sales', capability)).toBe(false)
      expect(can('', capability)).toBe(false)
    }
  })
```

If `can` and `CAPABILITIES` are not already imported at the top of that file, add them to the existing import from `../src/lib/capabilities.ts` (with the `.ts` extension — that file imports with the extension because `tsconfig.node.json` uses `module: nodenext`).

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run tests/capabilities.test.ts`
Expected: FAIL. The message will be a TypeScript-shaped complaint from esbuild about `'sales'` not being assignable to `Role`, or — because Vitest strips types rather than checking them — a PASS at runtime with `npm run build` failing instead. Either counts as red. Confirm the red with `npm run build` as well if the test alone passes.

- [ ] **Step 4: Widen `can`**

Replace `src/lib/capabilities.ts:52-58` with:

```ts
// Closed by default. `role` arrives from a profiles row -- a text column whose
// check constraint makes an unknown value unreachable through the database
// today -- so the parameter is `string` rather than `Role`. That is deliberate,
// and it changed in Slice 2 step 4: `Profile['role']` is `string`
// (src/types/database.ts), so a `Role` parameter meant the only real caller,
// the clients admin screen, could not pass the value it actually holds without
// an assertion at the call site. An assertion there would have moved the lie
// closer to the screen instead of removing it. An unexpected string must answer
// "no" rather than throw on `undefined.includes`, because a throw inside a
// render is how this project's screens go blank.
export function can(role: string, capability: Capability): boolean {
  // Annotated `| undefined` on purpose: `Record<Role, …>` indexed by an
  // asserted key is typed as always-present, which would make the `?.` below
  // read as dead code the next person deletes. The lookup genuinely can miss.
  const preset: readonly Capability[] | undefined = ROLE_CAPABILITIES[role as Role]
  return preset?.includes(capability) ?? false
}
```

- [ ] **Step 5: Green**

Run: `npx vitest run tests/capabilities.test.ts && npm run build`
Expected: PASS, and a clean build.

- [ ] **Step 6: Write the failing tests for the decisions module**

Create `src/clients/clientForm.test.ts`. This runs in the node environment (no `@vitest-environment` line — `vite.config.ts` sets `environment: 'node'`).

```ts
import { describe, expect, it } from 'vitest'
import {
  CLIENT_STATUSES,
  END_REASON_CODES,
  EMPTY_DRAFT,
  draftFromRow,
  formProblems,
  insertPayload,
  isChurned,
  ownerLabel,
  reactivationWarning,
  reasonLabel,
  sortClients,
  statusLabel,
  updatePayload,
  writeFailureText,
  writeStatusLine,
} from './clientForm'
import type { AdminClient, ClientDraft } from './clientForm'

function row(overrides: Partial<AdminClient> = {}): AdminClient {
  return {
    id: 1,
    name: 'Acme',
    owner_id: null,
    status: 'active',
    ended_on: null,
    end_reason_code: null,
    end_reason_note: null,
    updated_at: '2026-08-24T15:42:00.000Z',
    ...overrides,
  }
}

function draft(overrides: Partial<ClientDraft> = {}): ClientDraft {
  return { ...EMPTY_DRAFT, name: 'Acme', ...overrides }
}

describe('the status vocabulary', () => {
  it('is the four the check constraint permits, active first', () => {
    expect(CLIENT_STATUSES).toEqual(['active', 'paused', 'cancelled', 'former'])
  })

  it('treats cancelled and former as churned, and nothing else', () => {
    expect(CLIENT_STATUSES.filter(isChurned)).toEqual(['cancelled', 'former'])
    expect(isChurned('sales')).toBe(false)
  })

  it('labels every status, and hands back an unknown one unchanged', () => {
    for (const status of CLIENT_STATUSES) {
      expect(statusLabel(status).length).toBeGreaterThan(0)
    }
    // Honest rather than reassuring: a status this screen does not know must
    // not be relabelled into one it does.
    expect(statusLabel('archived')).toBe('archived')
  })
})

describe('the reason vocabulary', () => {
  it('labels all seven codes, and says so when there is no code', () => {
    expect(END_REASON_CODES).toHaveLength(7)
    for (const code of END_REASON_CODES) {
      expect(reasonLabel(code)).not.toBe(code)
    }
    expect(reasonLabel(null)).toBe('No reason recorded')
    expect(reasonLabel('poached')).toBe('poached')
  })
})

describe('rule 1 -- a churned client needs a date and a coded reason', () => {
  it('asks for both when the status is cancelled or former', () => {
    for (const status of ['cancelled', 'former']) {
      const fields = formProblems(draft({ status })).map((p) => p.field)
      expect(fields).toContain('endedOn')
      expect(fields).toContain('endReasonCode')
    }
  })

  it('asks for neither when the status is active or paused', () => {
    for (const status of ['active', 'paused']) {
      expect(formProblems(draft({ status }))).toEqual([])
    }
  })

  it('is satisfied once both are supplied', () => {
    expect(
      formProblems(draft({ status: 'former', endedOn: '2026-08-01', endReasonCode: 'price' })),
    ).toEqual([])
  })

  it('never requires the note', () => {
    const problems = formProblems(
      draft({ status: 'former', endedOn: '2026-08-01', endReasonCode: 'price', endReasonNote: '' }),
    )
    expect(problems).toEqual([])
  })

  it('requires a name, and does not accept whitespace as one', () => {
    expect(formProblems(draft({ name: '   ' })).map((p) => p.field)).toEqual(['name'])
  })

  it('refuses a status it does not recognise, rather than saving it', () => {
    expect(formProblems(draft({ status: 'archived' })).map((p) => p.field)).toContain('status')
  })
})

describe('rule 2 -- reactivating destroys a recorded fact, and says so', () => {
  it('warns when leaving a churned status for a live one', () => {
    for (const from of ['cancelled', 'former']) {
      for (const to of ['active', 'paused']) {
        expect(reactivationWarning(from, to)).toContain('end date')
      }
    }
  })

  it('stays quiet in every other direction', () => {
    expect(reactivationWarning('active', 'former')).toBeNull()
    expect(reactivationWarning('active', 'paused')).toBeNull()
    expect(reactivationWarning('former', 'cancelled')).toBeNull()
    expect(reactivationWarning('former', 'former')).toBeNull()
  })

  it('clears all three columns in the one payload, for every live status', () => {
    // The constraint is bidirectional (spec §10 decision 2), so an update that
    // sets status without clearing these three is refused by Postgres. Sending
    // every column on every save is what makes that impossible to forget --
    // this is the assertion that stands in for the constraint.
    for (const status of ['active', 'paused']) {
      const payload = updatePayload(
        draft({ status, endedOn: '2026-08-01', endReasonCode: 'price', endReasonNote: 'left' }),
      )
      expect(payload.ended_on).toBeNull()
      expect(payload.end_reason_code).toBeNull()
      expect(payload.end_reason_note).toBeNull()
    }
  })

  it('sends all six columns on every save, whatever the status', () => {
    for (const status of CLIENT_STATUSES) {
      expect(Object.keys(updatePayload(draft({ status }))).sort()).toEqual([
        'end_reason_code',
        'end_reason_note',
        'ended_on',
        'name',
        'owner_id',
        'status',
      ])
    }
  })

  it('keeps the three columns on a churned save', () => {
    const payload = updatePayload(
      draft({ status: 'cancelled', endedOn: '2026-08-01', endReasonCode: 'price', endReasonNote: 'left' }),
    )
    expect(payload.ended_on).toBe('2026-08-01')
    expect(payload.end_reason_code).toBe('price')
    expect(payload.end_reason_note).toBe('left')
  })

  it('stores an empty note as null, not as an empty string', () => {
    const payload = updatePayload(
      draft({ status: 'cancelled', endedOn: '2026-08-01', endReasonCode: 'price', endReasonNote: '  ' }),
    )
    expect(payload.end_reason_note).toBeNull()
  })

  it('trims the name it sends', () => {
    expect(updatePayload(draft({ name: '  Acme  ' })).name).toBe('Acme')
    expect(insertPayload(draft({ name: '  Acme  ' })).name).toBe('Acme')
  })
})

describe('adding a client', () => {
  it('creates it active, and offers no way to create a churned one', () => {
    // Spec §7: "a client who has already left is not something anybody needs
    // to add". The absence of the three keys is the assertion -- a payload that
    // merely happened to send nulls would still let a future edit set them.
    const payload = insertPayload(draft({ status: 'former', endedOn: '2026-08-01' }))
    expect(payload.status).toBe('active')
    expect(Object.keys(payload).sort()).toEqual(['name', 'owner_id', 'status'])
  })
})

describe('a row becoming a form', () => {
  it('carries every column across, with nulls as empty strings', () => {
    expect(draftFromRow(row({ status: 'former', ended_on: '2026-08-01', end_reason_code: 'price' })))
      .toEqual({
        name: 'Acme',
        ownerId: null,
        status: 'former',
        endedOn: '2026-08-01',
        endReasonCode: 'price',
        endReasonNote: '',
      })
  })

  it('round-trips through updatePayload without inventing or losing a value', () => {
    const original = row({
      name: 'Polar Divide',
      owner_id: 'owner-1',
      status: 'cancelled',
      ended_on: '2026-07-15',
      end_reason_code: 'went_quiet',
      end_reason_note: 'stopped replying',
    })
    expect(updatePayload(draftFromRow(original))).toEqual({
      name: 'Polar Divide',
      owner_id: 'owner-1',
      status: 'cancelled',
      ended_on: '2026-07-15',
      end_reason_code: 'went_quiet',
      end_reason_note: 'stopped replying',
    })
  })
})

describe('the owner picker label', () => {
  it('prefers the name and falls back to the email', () => {
    expect(ownerLabel({ full_name: 'Amy Account', email: 'amy@example.com' })).toBe('Amy Account')
    expect(ownerLabel({ full_name: null, email: 'amy@example.com' })).toBe('amy@example.com')
    // A row whose full_name is whitespace is a row with no usable name.
    expect(ownerLabel({ full_name: '   ', email: 'amy@example.com' })).toBe('amy@example.com')
  })
})

describe('the list order', () => {
  it('reads the active roster first, then alphabetically inside each status', () => {
    const sorted = sortClients([
      row({ id: 1, name: 'Zinc', status: 'active' }),
      row({ id: 2, name: 'Test Client', status: 'former', ended_on: '2026-08-01', end_reason_code: 'other' }),
      row({ id: 3, name: 'Acme', status: 'active' }),
      row({ id: 4, name: 'Bellwether', status: 'paused' }),
    ])
    expect(sorted.map((c) => c.name)).toEqual(['Acme', 'Zinc', 'Bellwether', 'Test Client'])
  })

  it('puts a status it does not know last rather than dropping the row', () => {
    const sorted = sortClients([row({ id: 1, name: 'B', status: 'archived' }), row({ id: 2, name: 'A' })])
    expect(sorted.map((c) => c.name)).toEqual(['A', 'B'])
    expect(sorted).toHaveLength(2)
  })

  it('does not mutate its input', () => {
    const input = [row({ id: 1, name: 'Zinc' }), row({ id: 2, name: 'Acme' })]
    sortClients(input)
    expect(input.map((c) => c.name)).toEqual(['Zinc', 'Acme'])
  })
})

describe('what a refused write says', () => {
  it('turns the unique index into a sentence about names', () => {
    const text = writeFailureText(
      'duplicate key value violates unique constraint "clients_name_unique"',
      'acme',
    )
    expect(text).toContain('acme')
    expect(text).toContain('already exists')
    expect(text).not.toContain('clients_name_unique')
  })

  it('turns the lifecycle constraint into the rule it enforces', () => {
    const text = writeFailureText(
      'new row for relation "clients" violates check constraint "clients_lifecycle_coherent"',
      'Acme',
    )
    expect(text).toContain('end date')
    expect(text).not.toContain('clients_lifecycle_coherent')
  })

  it('turns the reason-code constraint into a sentence about the list', () => {
    const text = writeFailureText(
      'violates check constraint "clients_end_reason_code_known"',
      'Acme',
    )
    expect(text).toContain('reason')
    expect(text).not.toContain('clients_end_reason_code_known')
  })

  it('names the permission problem when RLS refuses the write', () => {
    expect(writeFailureText('permission denied for table clients', 'Acme')).toContain('not allowed')
    expect(writeFailureText('new row violates row-level security policy for table "clients"', 'Acme'))
      .toContain('not allowed')
  })

  it('passes anything else through rather than guessing', () => {
    expect(writeFailureText('the connection failed', 'Acme')).toContain('the connection failed')
  })

  it('always says nothing was changed, whatever the failure', () => {
    // The screen keeps the form populated on a failure, so the person is
    // looking at values that are NOT in the database. Every branch has to say
    // so, or the screen is lying by omission -- Slice 1's finding, restated.
    const messages = [
      'duplicate key value violates unique constraint "clients_name_unique"',
      'violates check constraint "clients_lifecycle_coherent"',
      'violates check constraint "clients_end_reason_code_known"',
      'permission denied for table clients',
      'something nobody anticipated',
    ]
    for (const message of messages) {
      expect(writeFailureText(message, 'Acme')).toContain('Nothing was changed')
    }
  })
})

describe('the status line', () => {
  it('never returns an empty sentence, in any state', () => {
    const states: Parameters<typeof writeStatusLine>[0][] = [
      { kind: 'idle' },
      { kind: 'saving' },
      { kind: 'saved', at: '2026-08-24T15:42:00.000Z', what: 'Changes saved' },
      { kind: 'failed', message: 'Nothing was changed.' },
    ]
    for (const state of states) {
      for (const problems of [[], [{ field: 'name' as const, text: 'A client needs a name.' }]]) {
        expect(writeStatusLine(state, problems).text.length).toBeGreaterThan(0)
      }
    }
  })

  it('names the time on a confirmation', () => {
    const line = writeStatusLine({ kind: 'saved', at: '2026-08-24T15:42:00.000Z', what: 'Client added' }, [])
    expect(line.tone).toBe('confirm')
    expect(line.text).toContain('Client added')
    expect(line.text).toMatch(/2026/)
  })

  it('reports the problems while idle, and the failure while failed', () => {
    const problems = [{ field: 'name' as const, text: 'A client needs a name.' }]
    expect(writeStatusLine({ kind: 'idle' }, problems).text).toContain('A client needs a name.')
    expect(writeStatusLine({ kind: 'failed', message: 'Refused. Nothing was changed.' }, problems).tone)
      .toBe('error')
  })
})
```

- [ ] **Step 7: Run it and watch it fail**

Run: `npx vitest run src/clients/clientForm.test.ts`
Expected: FAIL — `Failed to resolve import "./clientForm"`.

- [ ] **Step 8: Write the decisions module**

Create `src/clients/clientForm.ts`:

```ts
import { formatSavedAt } from '../lib/month'

// Every decision the clients admin screen makes, with no React and no Supabase
// client in sight. Spec §9 states the rule this file exists to keep: "The rules
// are not ternaries in JSX." The three rules in §7 are all enforced by a
// database constraint that will refuse the write if the form gets them wrong,
// so they are worth more than a condition inside a render nobody can test
// without a browser.
//
// This module also cannot import ../lib/supabase, and that is load-bearing
// rather than tidy: the client calls readSupabaseConfig at module scope and
// THROWS when VITE_ config is absent, and CI runs vitest with no VITE_ env at
// all. A test importing this file has to run anywhere. Same reason
// src/board/cardSummary.ts keeps its column literal beside its type instead of
// in the hook.

export type ClientStatus = 'active' | 'paused' | 'cancelled' | 'former'

// The four the check constraint on public.clients permits, in the order the
// list reads them: the active roster first (spec §7). tests/clientFormDrift.test.ts
// asserts this is the same set the migration declares.
export const CLIENT_STATUSES: readonly ClientStatus[] = [
  'active',
  'paused',
  'cancelled',
  'former',
]

export const STATUS_LABELS: Record<ClientStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  cancelled: 'Cancelled',
  former: 'Former',
}

// Rule 3 of spec §7, and it is here rather than in the markup because the spec
// is explicit about why it exists: "former and cancelled differ only in age, per
// the parent spec, so the form says so rather than making the reader guess."
export const STATUS_HINTS: Record<ClientStatus, string> = {
  active: 'On the board, and expecting a check-in every month.',
  paused: 'Still a client, but not being scored right now. Off the board.',
  cancelled: 'Recently left, and still under review. Needs an end date and a reason.',
  former: 'Settled and archived. Needs an end date and a reason.',
}

// Hands an unrecognised value straight back. A status this screen does not know
// is a row somebody wrote outside this screen, and relabelling it into one of
// the four would hide that rather than surface it.
export function statusLabel(status: string): string {
  return STATUS_LABELS[status as ClientStatus] ?? status
}

// Spec §6.1's seven, and the same seven clients_end_reason_code_known permits.
export const END_REASON_CODES: readonly string[] = [
  'price',
  'scope_fit',
  'in_housed',
  'went_quiet',
  'project_completed',
  'agency_initiated',
  'other',
]

export const END_REASON_LABELS: Record<string, string> = {
  price: 'Price',
  scope_fit: 'Scope did not fit',
  in_housed: 'Brought in house',
  went_quiet: 'Went quiet',
  project_completed: 'Project completed',
  agency_initiated: 'Ended by us',
  other: 'Other',
}

export function reasonLabel(code: string | null): string {
  if (code === null) return 'No reason recorded'
  return END_REASON_LABELS[code] ?? code
}

// The two statuses the lifecycle constraint calls churn. Written against the
// same literal list the constraint uses rather than as "not active and not
// paused", so a fifth status arriving later does not silently become churn.
export function isChurned(status: string): boolean {
  return status === 'cancelled' || status === 'former'
}

// Only the columns this screen reads, and the literal that fetches them, kept
// side by side -- the src/board/cardSummary.ts pattern. supabase-js infers the
// row type from the string, so a mistyped column fails `npm run build`; a
// computed string would degrade the row to untyped and the mistake would
// surface at runtime as undefined.
//
// `id` is here because the update needs it. `created_at` is not, because
// nothing on this screen shows it.
export const CLIENT_COLUMNS =
  'id, name, owner_id, status, ended_on, end_reason_code, end_reason_note, updated_at'

export type AdminClient = {
  id: number
  name: string
  owner_id: string | null
  // `string`, not ClientStatus, because that is what the column is: text with a
  // check constraint. Narrowing it here would be a claim this code cannot
  // verify, and formProblems() below is what turns an unknown value into a
  // refusal a person can read instead of a crash.
  status: string
  ended_on: string | null
  end_reason_code: string | null
  end_reason_note: string | null
  updated_at: string
}

// Strings throughout, including the date and the code, because that is what an
// <input> and a <select> hand back. The null-vs-empty-string translation happens
// once, in the payload builders below, so no other file has to remember it.
export type ClientDraft = {
  name: string
  ownerId: string | null
  status: string
  endedOn: string
  endReasonCode: string
  endReasonNote: string
}

export const EMPTY_DRAFT: ClientDraft = {
  name: '',
  ownerId: null,
  status: 'active',
  endedOn: '',
  endReasonCode: '',
  endReasonNote: '',
}

export function draftFromRow(row: AdminClient): ClientDraft {
  return {
    name: row.name,
    ownerId: row.owner_id,
    status: row.status,
    endedOn: row.ended_on ?? '',
    endReasonCode: row.end_reason_code ?? '',
    endReasonNote: row.end_reason_note ?? '',
  }
}

export type FormProblem = {
  field: 'name' | 'status' | 'endedOn' | 'endReasonCode'
  text: string
}

// Rule 1 of spec §7, plus the two things the table itself requires. Every
// problem this returns is one the database would refuse -- the point is to
// refuse it here first, in a sentence, rather than after a round trip in
// Postgres's words.
export function formProblems(draft: ClientDraft): FormProblem[] {
  const problems: FormProblem[] = []

  if (draft.name.trim() === '') {
    problems.push({ field: 'name', text: 'A client needs a name.' })
  }

  // Unreachable through the <select>, which only ever offers the four. Reachable
  // through a row somebody wrote elsewhere: draftFromRow copies the stored
  // status across verbatim, so opening such a row lands here. Blocking the save
  // is the honest outcome -- the alternative is quietly rewriting a status
  // nobody on this screen chose.
  if (!CLIENT_STATUSES.includes(draft.status as ClientStatus)) {
    problems.push({
      field: 'status',
      text: `This client's status is "${draft.status}", which is not one of the four this screen understands, so it cannot be saved here.`,
    })
  }

  if (isChurned(draft.status)) {
    if (draft.endedOn.trim() === '') {
      problems.push({ field: 'endedOn', text: 'A cancelled or former client needs the date they left.' })
    }
    if (draft.endReasonCode === '') {
      problems.push({
        field: 'endReasonCode',
        text: 'A cancelled or former client needs a reason from the list.',
      })
    }
  }

  // The note is never required. Spec §10 decision 3: the countable half is the
  // half that has to be there, and a mandatory note invites a full stop typed to
  // get past a form.

  return problems
}

// Rule 2 of spec §7. Not a confirmation dialog -- a sentence shown before the
// press, because the screen "must say it is doing that ... because it is
// destroying a recorded fact".
export function reactivationWarning(from: string, to: string): string | null {
  if (!isChurned(from)) return null
  if (isChurned(to)) return null
  return 'Saving will clear the end date and the reason. Those are recorded facts, and this screen cannot bring them back.'
}

// Status is fixed at 'active' and the three lifecycle columns are absent
// entirely, not sent as nulls. Spec §7: "the form does not offer a churned
// status on creation, because a client who has already left is not something
// anybody needs to add." Absent rather than null so a future edit that wants to
// send one has to add the key and notice this comment.
export function insertPayload(draft: ClientDraft) {
  return {
    name: draft.name.trim(),
    owner_id: draft.ownerId,
    status: 'active',
  }
}

// All six columns, every time, whatever the status. This is what makes rule 2's
// three-column clear structurally impossible to forget: the constraint is
// bidirectional (spec §10 decision 2), so an update that moves a client off
// `former` without nulling all three is refused by Postgres. Sending only the
// changed columns would make that a thing each caller had to remember.
export function updatePayload(draft: ClientDraft) {
  const churned = isChurned(draft.status)
  const note = draft.endReasonNote.trim()
  return {
    name: draft.name.trim(),
    owner_id: draft.ownerId,
    status: draft.status,
    ended_on: churned && draft.endedOn !== '' ? draft.endedOn : null,
    end_reason_code: churned && draft.endReasonCode !== '' ? draft.endReasonCode : null,
    // Null rather than an empty string, matching how the check-in screen stores
    // an empty note. An empty string is a value; the absence of a note is not.
    end_reason_note: churned && note !== '' ? note : null,
  }
}

// The four things this table can refuse, translated. Every branch ends with the
// same promise, because the screen deliberately keeps the form populated after a
// failure: the person is then looking at values that are NOT in the database,
// and a message that does not say so is Slice 1's defect wearing a new mask.
export function writeFailureText(message: string, name: string): string {
  const tail = ' Nothing was changed, and pressing save again costs nothing.'

  if (message.includes('clients_name_unique')) {
    return `A client called "${name}" already exists. Names are compared ignoring case, so "acme" and "Acme" count as the same client.${tail}`
  }

  if (message.includes('clients_lifecycle_coherent')) {
    return `A cancelled or former client needs an end date and a reason, and an active or paused one must have neither.${tail}`
  }

  if (message.includes('clients_end_reason_code_known')) {
    return `That end reason is not one of the seven this tool records.${tail}`
  }

  // 42501 and the RLS refusal read differently but mean the same thing to the
  // person: their account is not allowed to do this. Spec §7.2 -- the database
  // refusing IS the security, and this is what that refusal looks like on screen.
  if (message.includes('permission denied') || message.includes('row-level security')) {
    return `Your account is not allowed to change clients. Ask an admin.${tail}`
  }

  return `${message}.${tail}`
}

export type WriteState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string; what: string }
  | { kind: 'failed'; message: string }

export type StatusTone = 'confirm' | 'error' | 'quiet'

export type StatusLine = { text: string; tone: StatusTone }

// Returns a line in every state, never null and never an empty string -- the
// contract the screen relies on to render something whenever this region is
// visible. Slice 1's Critical 1 was a state with no branch at all: a routine
// saved draft, reopened, said nothing.
//
// The time is named on the confirmation, per spec §7. The durable half of that
// promise is not this line -- it is the "Updated ..." line on the client's own
// row in the list, which comes from updated_at and therefore survives a reload.
// This line is the immediate half.
export function writeStatusLine(
  state: WriteState,
  problems: readonly FormProblem[],
): StatusLine {
  switch (state.kind) {
    case 'saving':
      return { text: 'Saving…', tone: 'quiet' }

    case 'saved':
      return { text: `${state.what} ${formatSavedAt(state.at)}.`, tone: 'confirm' }

    case 'failed':
      return { text: state.message, tone: 'error' }

    case 'idle': {
      if (problems.length > 0) {
        return { text: problems.map((problem) => problem.text).join(' '), tone: 'quiet' }
      }
      return { text: 'Ready to save.', tone: 'quiet' }
    }

    default: {
      // Exhaustiveness check: a new WriteState kind stops this compiling
      // instead of falling through and returning nothing.
      const exhaustive: never = state
      throw new Error(`Unhandled write state: ${JSON.stringify(exhaustive)}`)
    }
  }
}

// Spec §7: the picker "lists active profiles by name, or email where full_name
// is null". Whitespace counts as null -- a name of three spaces is not a name,
// and it would render as an unlabelled option.
export function ownerLabel(profile: { full_name: string | null; email: string }): string {
  const name = profile.full_name?.trim() ?? ''
  return name === '' ? profile.email : name
}

// Status then name, so the active roster reads first (spec §7). A status the
// four do not cover sorts last rather than being dropped: this screen is the
// only place such a row is visible at all.
export function sortClients(rows: readonly AdminClient[]): AdminClient[] {
  const rank = (status: string) => {
    const index = CLIENT_STATUSES.indexOf(status as ClientStatus)
    return index === -1 ? CLIENT_STATUSES.length : index
  }
  // Copied first: sorting the array the hook holds in state would mutate it in
  // place, and React compares by identity.
  return [...rows].sort(
    (a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name),
  )
}
```

- [ ] **Step 9: Green**

Run: `npx vitest run src/clients/clientForm.test.ts`
Expected: PASS, all tests.

- [ ] **Step 10: Write the failing drift guard**

Create `tests/clientFormDrift.test.ts`. It lives in `tests/` because it reads the migrations with `node:fs` — see Global Constraints. It imports from `src/` **with the `.ts` extension**, because `tsconfig.node.json` uses `module: nodenext`.

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CLIENT_STATUSES,
  END_REASON_CODES,
  END_REASON_LABELS,
} from '../src/clients/clientForm.ts'

// The screen's vocabularies against the deployed constraints. Two copies of the
// same list exist because a <select> cannot ask Postgres what it permits, and
// this file is the entire mitigation for that -- the same bargain, and the same
// remedy, as src/lib/capabilities.ts and tests/capabilities.test.ts.
//
// What this does NOT prove: that Postgres enforces either list. That is
// `npm run verify:lifecycle`, which reads the live constraint out of
// pg_constraint and evaluates it over all 32 combinations of its inputs.
const MIGRATIONS = 'supabase/migrations'

function migration(suffix: string): string {
  const names = readdirSync(MIGRATIONS).filter((name) => name.endsWith(suffix))
  // Exactly one, or the assertions below could be reading a file nobody meant.
  expect(names, `migrations ending in ${suffix}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

// Pulls the quoted literals out of a check constraint's IN list. Anchored on the
// column name so it cannot pick up a different constraint in the same file.
function inListAfter(sql: string, column: string): string[] {
  const match = sql.match(new RegExp(`${column}\\s+in\\s*\\(([^)]*)\\)`, 'i'))
  expect(match, `an IN list for ${column}`).not.toBeNull()
  return [...(match?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

describe('the screen agrees with the database about statuses', () => {
  const sql = migration('_create_clients_and_checkins.sql')

  it('offers exactly the statuses the check constraint permits', () => {
    const permitted = inListAfter(sql, 'status')
    // A positive count first, so a regex that matched nothing cannot read as
    // agreement. This project has shipped one check that reported success by
    // finding no data.
    expect(permitted.length).toBe(4)
    expect([...CLIENT_STATUSES].sort()).toEqual([...permitted].sort())
  })
})

describe('the screen agrees with the database about end reasons', () => {
  const sql = migration('_add_client_lifecycle.sql')

  it('offers exactly the codes the check constraint permits', () => {
    const permitted = inListAfter(sql, 'end_reason_code')
    expect(permitted.length).toBe(7)
    expect([...END_REASON_CODES].sort()).toEqual([...permitted].sort())
  })

  it('has a label for every code and no label for a code that does not exist', () => {
    expect(Object.keys(END_REASON_LABELS).sort()).toEqual([...END_REASON_CODES].sort())
  })
})
```

- [ ] **Step 11: Run it, and prove it can actually fail**

Run: `npx vitest run tests/clientFormDrift.test.ts`
Expected: PASS.

Then prove the guard is not vacuous — a passing drift test that cannot fail is worse than none:

```bash
sed -i '' "s/  'went_quiet',/  'went_quiet_typo',/" src/clients/clientForm.ts
npx vitest run tests/clientFormDrift.test.ts
```
Expected: FAIL, on both the codes assertion and the labels assertion. Then put it back:
```bash
sed -i '' "s/  'went_quiet_typo',/  'went_quiet',/" src/clients/clientForm.ts
npx vitest run tests/clientFormDrift.test.ts
```
Expected: PASS. Confirm the file is clean with `git diff --stat src/clients/clientForm.ts` showing no change from the version you wrote in Step 8.

- [ ] **Step 12: All three gates**

Run: `npm test && npm run build && npm run lint`
Expected: all green. Record the test count from the `npm test` output — do not type it from memory later (spec §9's second standing instruction).

- [ ] **Step 13: Commit**

```bash
git add src/lib/capabilities.ts tests/capabilities.test.ts src/clients/clientForm.ts src/clients/clientForm.test.ts tests/clientFormDrift.test.ts
git commit -F - <<'MSG'
feat(clients): the admin form's rules, as pure functions

Slice 2 step 4, task 1. Nothing renders yet.

Spec §9 asks for the three §7 rules as pure functions rather than
ternaries in JSX, because each one is enforced by a constraint that
will refuse the write if the form gets it wrong. updatePayload sends
all six columns on every save, which is what makes rule 2's
three-column clear structurally impossible to forget rather than
something each caller remembers.

writeFailureText is beyond the spec's letter: the unique index on
lower(name) answers a duplicate with Postgres's own words, and
"duplicate key value violates unique constraint" is not a sentence to
put in front of an account manager. Every branch ends by saying
nothing was changed, because the screen keeps the form populated after
a failure and would otherwise be showing values the database does not
hold.

can() now takes a string. Profile['role'] is string -- profiles.role is
a text column -- so a Role parameter meant this screen could not pass
the value it holds without an assertion at the call site, which would
have moved the lie closer to the screen rather than removing it. It
also makes the closed-by-default guard the function has documented
since it was written reachable for the first time, and there is now a
test for it.

tests/clientFormDrift.test.ts pins both vocabularies against the
deployed check constraints, and was proved able to fail by editing a
code and watching it go red.
MSG
```

---

### Task 2: The screen, reading

**Files:**
- Create: `src/clients/useClients.ts`
- Create: `src/clients/ClientsAdmin.tsx`
- Create: `src/clients/ClientsAdmin.module.css`
- Create: `src/clients/ClientsAdmin.dom.test.tsx`

**Interfaces:**
- Consumes from Task 1: `CLIENT_COLUMNS`, `AdminClient`, `sortClients`, `statusLabel`, `reasonLabel`, `ownerLabel`.
- Consumes from the existing tree: `supabase` (`src/lib/supabase.ts`), `describeError` (`src/lib/errorText.ts`), `formatSavedAt` (`src/lib/month.ts`).
- Produces, and Task 3 extends: `type OwnerOption = { id: string; label: string }`, `type UseClients`, `useClients(): UseClients`, and `ClientsAdmin({ onBack }: { onBack: () => void })`.

- [ ] **Step 1: Read the two files this step copies its shape from**

```bash
cat src/board/useBoard.ts
sed -n '1,30p' src/board/ClientCard.dom.test.tsx
```

Expected: `useBoard` takes an `isCancelled` **parameter** (not a closed-over `let`), reports `status`/`loadError`, sets no state after a failed read, and returns `reload`. `ClientCard.dom.test.tsx` opens with the `// @vitest-environment jsdom` pragma on line 1 and clears `document.body` in an `afterEach`.

- [ ] **Step 2: Write the failing test for the read states**

Create `src/clients/ClientsAdmin.dom.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminClient } from './clientForm'
import type { UseClients } from './useClients'

// TWO mocks, and the second is not optional. Mocking the hook is why useClients
// exists -- there is no other seam at which this screen can be rendered without
// a database. And `../lib/supabase` must be mocked as well: the unmocked client
// calls readSupabaseConfig at module scope and THROWS when VITE_ config is
// absent, and CI runs vitest with no VITE_ env at all. Without that line this
// file passes locally off .env.local and fails in CI. Recorded at
// src/board/Board.test.tsx:19.
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('./useClients', () => ({ useClients: vi.fn() }))

import { ClientsAdmin } from './ClientsAdmin'
import { useClients } from './useClients'

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const AMY = '11111111-1111-1111-1111-111111111111'
const BEN = '22222222-2222-2222-2222-222222222222'

function client(overrides: Partial<AdminClient> = {}): AdminClient {
  return {
    id: 1,
    name: 'Acme',
    owner_id: null,
    status: 'active',
    ended_on: null,
    end_reason_code: null,
    end_reason_note: null,
    updated_at: '2026-08-24T15:42:00.000Z',
    ...overrides,
  }
}

// One factory for the whole file. Task 3 appends the write members here and
// nowhere else, so the two halves of this file cannot drift apart.
function hook(overrides: Partial<UseClients> = {}): UseClients {
  return {
    status: 'ready',
    loadError: null,
    clients: [],
    owners: [
      { id: AMY, label: 'Amy Account' },
      { id: BEN, label: 'ben@example.com' },
    ],
    reload: vi.fn(),
    ...overrides,
  }
}

function mount(overrides: Partial<UseClients> = {}, onBack = vi.fn()) {
  vi.mocked(useClients).mockReturnValue(hook(overrides))
  render(<ClientsAdmin onBack={onBack} />)
}

describe('the clients admin screen, reading', () => {
  it('gives a failed read the whole screen, with no list behind it', () => {
    // Parent spec §8.1 and v1's founding defect: a broken tool must never look
    // like an empty one. A list rendered under an error reads as "no clients".
    mount({ status: 'error', loadError: 'permission denied for table clients' })

    expect(screen.getByRole('alert').textContent).toContain('permission denied')
    expect(screen.queryByRole('list', { name: 'Clients' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('says it is loading, and shows no list yet', () => {
    mount({ status: 'loading' })

    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Clients' })).toBeNull()
  })

  it('says the roster is empty rather than showing an empty list', () => {
    mount({ clients: [] })

    expect(screen.getByText(/No clients yet/)).toBeTruthy()
  })

  it('lists every client whatever its status', () => {
    // The point of this screen: a former client has to stay visible somewhere,
    // and the board deliberately reads only active rows.
    mount({
      clients: [
        client({ id: 1, name: 'Acme', status: 'active' }),
        client({ id: 2, name: 'Bellwether', status: 'paused' }),
        client({ id: 3, name: 'Cinder', status: 'cancelled', ended_on: '2026-07-01', end_reason_code: 'price' }),
        client({ id: 4, name: 'Test Client', status: 'former', ended_on: '2026-08-01', end_reason_code: 'other' }),
      ],
    })

    const items = screen.getByRole('list', { name: 'Clients' }).querySelectorAll('li')
    expect(items).toHaveLength(4)
    for (const name of ['Acme', 'Bellwether', 'Cinder', 'Test Client']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
  })

  it('renders the order the hook hands it, without re-sorting', () => {
    // sortClients is tested in clientForm.test.ts and applied in the hook. This
    // asserts the screen does not quietly apply a second, different order.
    mount({
      clients: [client({ id: 1, name: 'Zinc' }), client({ id: 2, name: 'Acme' })],
    })

    const names = [...screen.getByRole('list', { name: 'Clients' }).querySelectorAll('li')]
      .map((item) => item.querySelector('[data-testid="client-name"]')?.textContent)
    expect(names).toEqual(['Zinc', 'Acme'])
  })

  it('names the owner, falls back to the email, and says so when there is none', () => {
    mount({
      clients: [
        client({ id: 1, name: 'Acme', owner_id: AMY }),
        client({ id: 2, name: 'Bellwether', owner_id: BEN }),
        client({ id: 3, name: 'Cinder', owner_id: null }),
      ],
    })

    expect(screen.getByText('Amy Account')).toBeTruthy()
    expect(screen.getByText('ben@example.com')).toBeTruthy()
    expect(screen.getByText('Unassigned')).toBeTruthy()
  })

  it('says so when a client has an owner nobody can name', () => {
    // An owner_id pointing at an inactive profile: the picker lists only active
    // ones, so the label lookup misses. Printing the raw UUID would be worse
    // than useless, and printing "Unassigned" would be a lie -- there IS an
    // owner.
    mount({ clients: [client({ owner_id: '99999999-9999-9999-9999-999999999999' })] })

    expect(screen.getByText('Owner is not an active account')).toBeTruthy()
  })

  it('shows the end date and the reason on a churned row', () => {
    mount({
      clients: [
        client({ id: 4, name: 'Test Client', status: 'former', ended_on: '2026-08-01', end_reason_code: 'other' }),
      ],
    })

    const row = screen.getByRole('list', { name: 'Clients' }).querySelector('li')
    expect(row?.textContent).toContain('2026-08-01')
    expect(row?.textContent).toContain('Other')
  })

  it('shows no end line at all on a live row', () => {
    mount({ clients: [client({ status: 'active' })] })

    expect(screen.queryByTestId('client-ended')).toBeNull()
  })

  it('names when each client last changed, which is what survives a reload', () => {
    // Spec §7: every write says what happened and names the time, and survives a
    // reload -- no toast. The status line beside a form is the immediate half;
    // THIS is the durable half, because it comes from updated_at.
    mount({ clients: [client({ updated_at: '2026-08-24T15:42:00.000Z' })] })

    expect(screen.getByTestId('client-updated').textContent).toMatch(/Updated .*2026/)
  })

  it('shows the status as text, not only as a shape', () => {
    // A pill's fill is not information a greyscale print or a colour-blind
    // reader can read. Spec §9's 2026-08-23 lesson, restated: an accessible
    // name and a visible label are two questions.
    mount({ clients: [client({ status: 'paused' })] })

    expect(screen.getByText('Paused')).toBeTruthy()
  })

  it('offers a way back to the board', async () => {
    const onBack = vi.fn()
    mount({}, onBack)

    screen.getByRole('button', { name: 'Board' }).click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('retries the read on demand', () => {
    const reload = vi.fn()
    mount({ status: 'error', loadError: 'the connection failed', reload })

    screen.getByRole('button', { name: 'Try again' }).click()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/clients/ClientsAdmin.dom.test.tsx`
Expected: FAIL — `Failed to resolve import "./useClients"`.

- [ ] **Step 4: Write the hook's read half**

Create `src/clients/useClients.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import { CLIENT_COLUMNS, ownerLabel, sortClients } from './clientForm'
import type { AdminClient } from './clientForm'

// The one place this screen talks to the database, so the screen itself can be
// rendered in a test with this module mocked. Same seam, and the same reason, as
// src/board/useBoard.ts -- four tests in Board.test.tsx were permanently skipped
// until the board's read moved behind a hook.

export type OwnerOption = { id: string; label: string }

export type UseClients = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  clients: AdminClient[]
  owners: OwnerOption[]
  reload: () => void
}

export function useClients(): UseClients {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clients, setClients] = useState<AdminClient[]>([])
  const [owners, setOwners] = useState<OwnerOption[]>([])

  // `isCancelled` is a parameter, and the flag it closes over belongs to the
  // effect below -- the same shape as useBoard, useCheckin and useProfile. It
  // cannot be a `let` inside this function: an async function returns a promise,
  // so a cleanup returned from here would never be called and the flag could
  // never become true. That mistake produces a guard that reads as protection
  // and provides none.
  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    setStatus('loading')

    // postgrest-js resolves most failures into `error` rather than rejecting, so
    // the catch is defensive. It is here because the failure it guards is
    // invisible: an unobserved rejection leaves status on 'loading' for good,
    // and the person sees a spinner with no message and no retry.
    try {
      // No status filter, deliberately, and this is the one query in the app
      // that reads every row. The board reads only active clients; this screen
      // is where a former one has to stay visible. clients_select_view_scores
      // has no status predicate, so the policy permits it.
      const clientResult = await supabase
        .from('clients')
        .select(CLIENT_COLUMNS)
        .order('name')

      if (isCancelled()) return

      if (clientResult.error) {
        // describeError, not .error.message: an empty message is falsy, and a
        // truthiness guard on the screen would miss it and render an empty list
        // over a failed read. See src/lib/errorText.ts.
        setLoadError(describeError(clientResult.error))
        setStatus('error')
        return
      }

      // The owner picker. Readable at all only because Slice 2 step 3 added
      // profiles_select_active_users -- under profiles_select_own this returns
      // exactly one row, the reader's own, and the picker cannot work. Spec §8.
      //
      // Active profiles only, per spec §7. A client already assigned to an
      // account that was since deactivated therefore has an owner_id this list
      // cannot name, and the screen says that rather than printing a UUID or
      // claiming the client is unassigned.
      const ownerResult = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('is_active', true)

      if (isCancelled()) return

      if (ownerResult.error) {
        setLoadError(describeError(ownerResult.error))
        setStatus('error')
        return
      }

      // Never write after a failed read: everything below runs only because both
      // queries succeeded.
      setLoadError(null)
      setClients(sortClients(clientResult.data))
      setOwners(
        ownerResult.data
          .map((profile) => ({ id: profile.id, label: ownerLabel(profile) }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      )
      setStatus('ready')
    } catch (thrown) {
      if (isCancelled()) return
      setLoadError(describeError(thrown))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    // A fresh flag per run. `load` has an empty dependency array so its identity
    // never changes today; the flag is what marks the run cancelled on unmount,
    // and what would guard a re-run if this hook ever gained an argument.
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load])

  // A manual reload has nothing to be cancelled by, so it uses the default.
  return { status, loadError, clients, owners, reload: () => void load() }
}
```

- [ ] **Step 5: Write the screen's read half**

Create `src/clients/ClientsAdmin.tsx`:

```tsx
import { formatSavedAt } from '../lib/month'
import { isChurned, reasonLabel, statusLabel } from './clientForm'
import type { AdminClient } from './clientForm'
import { useClients } from './useClients'
import type { OwnerOption } from './useClients'
import styles from './ClientsAdmin.module.css'

type Props = { onBack: () => void }

// Spec §7: one screen, a list and a form, no modal. The list shows every client
// regardless of status, because this is the screen where a former client has to
// remain visible -- the board reads only active rows, by design.

// Not "Unassigned" when the lookup misses, and not the raw UUID either. The
// picker lists active profiles only, so a client assigned to an account that was
// since deactivated lands here: there IS an owner, so "Unassigned" would be
// false, and a UUID tells the reader nothing they can act on.
function ownerText(client: AdminClient, owners: readonly OwnerOption[]): string {
  if (client.owner_id === null) return 'Unassigned'
  return owners.find((owner) => owner.id === client.owner_id)?.label
    ?? 'Owner is not an active account'
}

export function ClientsAdmin({ onBack }: Props) {
  const admin = useClients()

  const back = (
    <nav className={styles.nav}>
      <button className="button button--quiet" type="button" onClick={onBack}>
        Board
      </button>
    </nav>
  )

  const masthead = (
    <div className="masthead">
      <p className="t-eyebrow">Clients</p>
      <h2 className="t-header">Client admin</h2>
    </div>
  )

  // Error before loading, and the error gets the whole screen. A list rendered
  // under a failed read reads as "no clients" -- v1's founding defect, that a
  // broken tool looks like an empty one.
  if (admin.status === 'error') {
    return (
      <section className={styles.screen}>
        {back}
        {masthead}
        <h3 className="t-header">Cannot reach the database</h3>
        <p className="alert prose" role="alert">
          {admin.loadError}
        </p>
        <p className="t-body prose">
          Nothing has been changed. The client list is still there; it just could not be
          read.
        </p>
        <button className="button" type="button" onClick={admin.reload}>
          Try again
        </button>
      </section>
    )
  }

  if (admin.status === 'loading') {
    return (
      <section className={styles.screen}>
        {back}
        {masthead}
        <p className="t-body">Loading…</p>
      </section>
    )
  }

  return (
    <section className={styles.screen}>
      {back}
      {masthead}

      {admin.clients.length === 0 ? (
        <p className="t-body prose">
          No clients yet. Add the first one above and it appears on the board straight
          away.
        </p>
      ) : (
        // role="list" because base.css removes markers globally, and WebKit
        // drops a list's semantics when its markers are removed -- so in Safari
        // with VoiceOver this would otherwise announce as a group of paragraphs
        // with no count and no position. The label is what lets a test address
        // this list and what tells a screen reader which list it is.
        <ul aria-label="Clients" className={styles.list} role="list">
          {admin.clients.map((client) => (
            <li className={styles.row} key={client.id}>
              <div className={styles.rowHead}>
                <p className="t-body" data-testid="client-name">
                  {client.name}
                </p>
                {/* The label is the information; the fill is decoration. A
                    greyscale print or a colour-blind reader gets the word. */}
                <span
                  className={`${styles.statusPill} ${isChurned(client.status) ? styles.statusPillEnded : ''}`}
                >
                  {statusLabel(client.status)}
                </span>
              </div>

              <p className="t-caption">{ownerText(client, admin.owners)}</p>

              {isChurned(client.status) && (
                <p className="t-caption" data-testid="client-ended">
                  Ended {client.ended_on ?? 'on an unrecorded date'} ·{' '}
                  {reasonLabel(client.end_reason_code)}
                  {client.end_reason_note === null ? '' : ` · ${client.end_reason_note}`}
                </p>
              )}

              {/* The durable half of spec §7's "survives a reload". The status
                  line beside a form says what just happened; this says when this
                  client last changed, and it is still here after a refresh
                  because it comes from updated_at. */}
              <p className="t-caption" data-testid="client-updated">
                Updated {formatSavedAt(client.updated_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 6: Write the stylesheet**

Create `src/clients/ClientsAdmin.module.css`:

```css
/* The clients admin screen: a form and a list, on one screen, no modal.
   Every colour and every face comes from a token -- src/styles/tokens.css is
   the only file in the tree allowed to name either. */

.screen {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  /* --measure-prose, matching the check-in screen and App.module.css's
     .centred, rather than --measure-column, which is sized for the
     single-field sign-in form. This screen carries a form and a list. */
  max-width: var(--measure-prose);
}

.nav {
  display: flex;
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--rule-hairline);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

.rowHead {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

/* Not the global .band chip: that one carries a health band, and a status is a
   different fact. Sharing the class would make a future change to one of them
   silently change the other. */
.statusPill {
  display: inline-flex;
  /* align-self, because this pill sits in flex containers: display:inline-flex
     governs the pill's inside, not how it is sized as a flex ITEM, and a
     default align-items:stretch would pull it across the row. Recorded on
     .band in base.css after the owner found exactly that on the deployed page. */
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
.statusPillEnded {
  background: var(--brand-blush);
  color: var(--text-primary);
}
```

- [ ] **Step 7: Green**

Run: `npx vitest run src/clients/ClientsAdmin.dom.test.tsx`
Expected: PASS, all tests.

- [ ] **Step 8: All three gates**

Run: `npm test && npm run build && npm run lint`
Expected: all green. `npm run build` is the one that would catch an unused import or a missing `import type`, and `npm test` includes the token gate walking `src/clients/`.

- [ ] **Step 9: Commit**

```bash
git add src/clients/useClients.ts src/clients/ClientsAdmin.tsx src/clients/ClientsAdmin.module.css src/clients/ClientsAdmin.dom.test.tsx
git commit -F - <<'MSG'
feat(clients): the admin screen, reading

Slice 2 step 4, task 2. The list only -- nothing writes yet, and
nothing navigates here yet either.

This is the first query in the app with no status filter. The board
reads only active clients by design, so this screen is the only place
a former one is visible at all.

The owner picker's read is what Slice 2 step 3 was for: under
profiles_select_own it would return exactly one row, the reader's own.
It asks for active profiles only, per spec §7, so a client assigned to
an account that was since deactivated has an owner this list cannot
name. The screen says that in words rather than printing a UUID or
claiming the client is unassigned -- there is an owner, so
"Unassigned" would be false.

Each row names when that client last changed. That is the durable half
of spec §7's "survives a reload -- no toast": it comes from
updated_at, so it is still there after a refresh, which is the check
the owner ran on v1 and got no answer from.

A failed read gets the whole screen with no list behind it, because a
list under an error reads as "no clients" -- v1's founding defect.
MSG
```

---

### Task 3: The screen, writing

**Files:**
- Create: `src/clients/AddClientForm.tsx`
- Create: `src/clients/EditClientForm.tsx`
- Modify: `src/clients/useClients.ts` (add the write half)
- Modify: `src/clients/ClientsAdmin.tsx` (mount the forms)
- Modify: `src/clients/ClientsAdmin.module.css` (form layout)
- Modify: `src/clients/ClientsAdmin.dom.test.tsx` (append, and extend the one fixture factory)

**Interfaces:**
- Consumes from Task 1: `ClientDraft`, `EMPTY_DRAFT`, `draftFromRow`, `formProblems`, `reactivationWarning`, `insertPayload`, `updatePayload`, `writeFailureText`, `writeStatusLine`, `WriteState`, `StatusLine`, `CLIENT_STATUSES`, `STATUS_LABELS`, `STATUS_HINTS`, `END_REASON_CODES`, `END_REASON_LABELS`, `isChurned`.
- Consumes from Task 2: `useClients`, `UseClients`, `OwnerOption`.
- Produces: `UseClients` gains `addState`, `editState`, `addClient(draft)`, `saveClient(id, draft)`, `resetAdd()`, `resetEdit()`. `AddClientForm` and `EditClientForm` are used only by `ClientsAdmin`.

- [ ] **Step 1: Re-read what you are extending**

```bash
cat src/clients/useClients.ts
sed -n '1,60p' src/clients/ClientsAdmin.tsx
sed -n '205,285p' src/checkin/useCheckin.ts
```

Expected: `useCheckin`'s `submit` shows the pattern to copy — an `inFlight` ref read at the top and cleared in a `finally`, the whole write inside `void (async () => { … })()`, and `.select().single()` rather than a second read so the row that comes back carries the database's own `updated_at`.

- [ ] **Step 2: Write the failing tests for the write states**

Two edits to `src/clients/ClientsAdmin.dom.test.tsx`.

First, extend the single fixture factory. Replace its body's `reload: vi.fn(),` line with:

```tsx
    reload: vi.fn(),
    addState: { kind: 'idle' },
    editState: { kind: 'idle' },
    addClient: vi.fn(),
    saveClient: vi.fn(),
    resetAdd: vi.fn(),
    resetEdit: vi.fn(),
```

And add `userEvent` to the imports at the top of the file:

```tsx
import userEvent from '@testing-library/user-event'
```

Then append this block to the end of the file:

```tsx
describe('the clients admin screen, adding', () => {
  it('takes a name and an owner, and offers no status field', () => {
    // Spec §7: "the form does not offer a churned status on creation, because a
    // client who has already left is not something anybody needs to add."
    mount()

    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(screen.getByLabelText('Owner')).toBeTruthy()
    expect(screen.queryByLabelText('Status')).toBeNull()
  })

  it('sends the typed name and the chosen owner', async () => {
    const addClient = vi.fn()
    mount({ addClient })

    await userEvent.type(screen.getByLabelText('Name'), 'Polar Divide')
    await userEvent.selectOptions(screen.getByLabelText('Owner'), AMY)
    await userEvent.click(screen.getByRole('button', { name: 'Add client' }))

    expect(addClient).toHaveBeenCalledTimes(1)
    expect(addClient.mock.calls[0][0]).toMatchObject({
      name: 'Polar Divide',
      ownerId: AMY,
      status: 'active',
    })
  })

  it('refuses to send a nameless client, and says why', async () => {
    const addClient = vi.fn()
    mount({ addClient })

    expect(screen.getByRole('button', { name: 'Add client' })).toHaveProperty('disabled', true)
    expect(screen.getByTestId('add-status').textContent).toContain('A client needs a name.')
    expect(addClient).not.toHaveBeenCalled()
  })

  it('clears the field only once the add is confirmed, and names the time', async () => {
    // The press is not the confirmation. Clearing on the press would lose the
    // typed name the instant the unique index on lower(name) refused it -- which
    // is the most likely refusal this form will ever see, and the one case where
    // the person most wants to look at what they typed.
    //
    // Two renders rather than one, because that is the only way to observe the
    // transition: the first render has the press with the state still idle, the
    // second has the confirmed state the hook would then report.
    vi.mocked(useClients).mockReturnValue(hook())
    const { rerender } = render(<ClientsAdmin onBack={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Name'), 'Acme')
    await userEvent.click(screen.getByRole('button', { name: 'Add client' }))
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Acme')

    vi.mocked(useClients).mockReturnValue(
      hook({ addState: { kind: 'saved', at: '2026-08-24T15:42:00.000Z', what: 'Client added' } }),
    )
    rerender(<ClientsAdmin onBack={vi.fn()} />)

    expect(screen.getByLabelText('Name')).toHaveProperty('value', '')
    const line = screen.getByTestId('add-status')
    expect(line.textContent).toContain('Client added')
    expect(line.textContent).toMatch(/2026/)
  })

  it('shows the refusal in words, and says nothing was changed', () => {
    mount({
      addState: {
        kind: 'failed',
        message: 'A client called "Acme" already exists. Nothing was changed, and pressing save again costs nothing.',
      },
    })

    const line = screen.getByTestId('add-status')
    expect(line.textContent).toContain('already exists')
    expect(line.textContent).toContain('Nothing was changed')
    expect(line.textContent).not.toContain('clients_name_unique')
  })
})

describe('the clients admin screen, editing', () => {
  const ACME = client({ id: 1, name: 'Acme', status: 'active', owner_id: AMY })
  const GONE = client({
    id: 2,
    name: 'Test Client',
    status: 'former',
    ended_on: '2026-08-01',
    end_reason_code: 'other',
  })

  async function open(name: string, overrides: Partial<UseClients> = {}) {
    mount({ clients: [ACME, GONE], ...overrides })
    await userEvent.click(screen.getByRole('button', { name: `Edit ${name}` }))
  }

  it('opens no form until a row is edited', () => {
    mount({ clients: [ACME] })
    expect(screen.queryByLabelText('Status')).toBeNull()
  })

  it('opens one form, populated from the row', async () => {
    await open('Acme')

    expect(screen.getByLabelText('Client name')).toHaveProperty('value', 'Acme')
    expect(screen.getByLabelText('Status')).toHaveProperty('value', 'active')
    // One form, not one per row: spec §7 says a list and a form.
    expect(screen.getAllByLabelText('Status')).toHaveLength(1)
  })

  it('hides the lifecycle fields while the status is live', async () => {
    await open('Acme')

    expect(screen.queryByLabelText('End date')).toBeNull()
    expect(screen.queryByLabelText('Reason they left')).toBeNull()
  })

  it('reveals the lifecycle fields when a churned status is chosen', async () => {
    // Rule 1 of spec §7.
    await open('Acme')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'cancelled')

    expect(screen.getByLabelText('End date')).toBeTruthy()
    expect(screen.getByLabelText('Reason they left')).toBeTruthy()
    expect(screen.getByLabelText('Note (optional)')).toBeTruthy()
  })

  it('says how cancelled and former differ, rather than making the reader guess', async () => {
    // Rule 3 of spec §7, and this asserts the sighted reader can see it -- the
    // 2026-08-23 lesson is that an accessible name says nothing about that.
    await open('Acme')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'cancelled')
    expect(screen.getByTestId('status-hint').textContent).toContain('under review')

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'former')
    expect(screen.getByTestId('status-hint').textContent).toContain('archived')
  })

  it('blocks the save until the date and the reason are both there', async () => {
    await open('Acme')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'former')

    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save).toHaveProperty('disabled', true)
    expect(screen.getByTestId('edit-status').textContent).toContain('needs the date')

    await userEvent.type(screen.getByLabelText('End date'), '2026-08-01')
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true)
    expect(screen.getByTestId('edit-status').textContent).toContain('needs a reason')

    await userEvent.selectOptions(screen.getByLabelText('Reason they left'), 'price')
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', false)
  })

  it('never requires the note', async () => {
    await open('Acme')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'former')
    await userEvent.type(screen.getByLabelText('End date'), '2026-08-01')
    await userEvent.selectOptions(screen.getByLabelText('Reason they left'), 'price')

    expect(screen.getByLabelText('Note (optional)')).toHaveProperty('value', '')
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', false)
  })

  it('warns before reactivating, because a recorded fact is about to go', async () => {
    // Rule 2 of spec §7: "The screen must say it is doing that."
    await open('Test Client')
    expect(screen.queryByTestId('reactivation-warning')).toBeNull()

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'active')
    expect(screen.getByTestId('reactivation-warning').textContent).toContain('clear the end date')
  })

  it('sends the reactivation as one update that clears all three columns', async () => {
    const saveClient = vi.fn()
    await open('Test Client', { saveClient })
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'active')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(saveClient).toHaveBeenCalledTimes(1)
    expect(saveClient.mock.calls[0][0]).toBe(GONE.id)
    expect(saveClient.mock.calls[0][1]).toMatchObject({ status: 'active' })
  })

  it('sends a rename with the id of the row that was opened', async () => {
    const saveClient = vi.fn()
    await open('Acme', { saveClient })
    await userEvent.clear(screen.getByLabelText('Client name'))
    await userEvent.type(screen.getByLabelText('Client name'), 'Acme Holdings')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(saveClient.mock.calls[0][0]).toBe(ACME.id)
    expect(saveClient.mock.calls[0][1]).toMatchObject({ name: 'Acme Holdings' })
  })

  it('closes the form on cancel, without saving', async () => {
    const saveClient = vi.fn()
    await open('Acme', { saveClient })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('Status')).toBeNull()
    expect(saveClient).not.toHaveBeenCalled()
  })

  it('confirms a save, and names the time', async () => {
    await open('Acme', {
      editState: { kind: 'saved', at: '2026-08-24T15:42:00.000Z', what: 'Changes saved' },
    })

    const line = screen.getByTestId('edit-status')
    expect(line.textContent).toContain('Changes saved')
    expect(line.textContent).toMatch(/2026/)
  })

  it('keeps the form populated after a refused save', async () => {
    await open('Acme', {
      editState: {
        kind: 'failed',
        message: 'Your account is not allowed to change clients. Ask an admin. Nothing was changed, and pressing save again costs nothing.',
      },
    })

    expect(screen.getByLabelText('Client name')).toHaveProperty('value', 'Acme')
    expect(screen.getByTestId('edit-status').textContent).toContain('not allowed')
  })

  it('disables every control while a save is in flight', async () => {
    await open('Acme', { editState: { kind: 'saving' } })

    expect(screen.getByLabelText('Client name')).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('Status')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true)
  })

  it('offers no way to delete a client', async () => {
    // Spec §2 and §10 decision 5. checkins.client_id is on delete cascade and
    // this project has no backups, so a delete would destroy that client's whole
    // history. This test is the standing guard against somebody adding one.
    await open('Acme')

    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/clients/ClientsAdmin.dom.test.tsx`
Expected: FAIL — the new `describe` blocks cannot find `Add client`, `Edit Acme`, or `Status`. The Task 2 tests still pass.

- [ ] **Step 4: Add the write half to the hook**

Add these imports at the top of `src/clients/useClients.ts`, alongside the existing ones:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
```

and extend the `clientForm` import:

```ts
import {
  CLIENT_COLUMNS,
  insertPayload,
  ownerLabel,
  sortClients,
  updatePayload,
  writeFailureText,
} from './clientForm'
import type { AdminClient, ClientDraft, WriteState } from './clientForm'
```

Extend the `UseClients` type:

```ts
export type UseClients = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  clients: AdminClient[]
  owners: OwnerOption[]
  // Two independent write states, because the two forms are on screen at the
  // same time and a confirmation for one must never appear beside the other.
  addState: WriteState
  editState: WriteState
  reload: () => void
  addClient: (draft: ClientDraft) => void
  saveClient: (id: number, draft: ClientDraft) => void
  resetAdd: () => void
  resetEdit: () => void
}
```

Inside `useClients`, after the existing `useState` calls, add:

```ts
  const [addState, setAddState] = useState<WriteState>({ kind: 'idle' })
  const [editState, setEditState] = useState<WriteState>({ kind: 'idle' })

  // Read at the top of each write to refuse a second concurrent one. A state
  // update is not visible until the next render, so two presses in the same tick
  // would both see 'idle' and both send a request. The buttons are disabled
  // during a save, which stops the ordinary case; these stop its edges. Same
  // shape as useCheckin's inFlight ref.
  const addInFlight = useRef(false)
  const editInFlight = useRef(false)
```

And before the `return`, add the two writes:

```ts
  const addClient = useCallback((draft: ClientDraft) => {
    if (addInFlight.current) return
    addInFlight.current = true
    setAddState({ kind: 'saving' })

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('clients')
          .insert(insertPayload(draft))
          // .select().single() rather than a second read: the row that comes
          // back carries the database's own updated_at, which is the time the
          // confirmation names and the time the new list row shows. One round
          // trip, and no window in which the screen shows a time the database
          // does not hold.
          .select(CLIENT_COLUMNS)
          .single()

        if (error) {
          // writeFailureText, not describeError alone: the unique index on
          // lower(name) answers a duplicate in Postgres's own words, and
          // "duplicate key value violates unique constraint" is not a sentence
          // to put in front of an account manager. describeError still runs
          // first, because an empty message is falsy and would render as nothing.
          setAddState({ kind: 'failed', message: writeFailureText(describeError(error), draft.name.trim()) })
          return
        }

        setClients((current) => sortClients([...current, data]))
        setAddState({ kind: 'saved', at: data.updated_at, what: 'Client added' })
      } catch (thrown) {
        setAddState({ kind: 'failed', message: writeFailureText(describeError(thrown), draft.name.trim()) })
      } finally {
        // finally, not a line after the await: if this ever rejects past the
        // catch, a latched ref would refuse every future press for the life of
        // the screen and nothing would say why.
        addInFlight.current = false
      }
    })()
  }, [])

  const saveClient = useCallback((id: number, draft: ClientDraft) => {
    if (editInFlight.current) return
    editInFlight.current = true
    setEditState({ kind: 'saving' })

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('clients')
          // All six columns, every time -- see updatePayload's comment. The
          // lifecycle constraint is bidirectional, so moving a client off
          // `former` without nulling the three lifecycle columns in the SAME
          // statement is refused by Postgres.
          .update(updatePayload(draft))
          .eq('id', id)
          .select(CLIENT_COLUMNS)
          .single()

        if (error) {
          setEditState({ kind: 'failed', message: writeFailureText(describeError(error), draft.name.trim()) })
          return
        }

        setClients((current) =>
          sortClients(current.map((client) => (client.id === id ? data : client))),
        )
        setEditState({ kind: 'saved', at: data.updated_at, what: 'Changes saved' })
      } catch (thrown) {
        setEditState({ kind: 'failed', message: writeFailureText(describeError(thrown), draft.name.trim()) })
      } finally {
        editInFlight.current = false
      }
    })()
  }, [])

  const resetAdd = useCallback(() => setAddState({ kind: 'idle' }), [])
  const resetEdit = useCallback(() => setEditState({ kind: 'idle' }), [])
```

And return them:

```ts
  return {
    status,
    loadError,
    clients,
    owners,
    addState,
    editState,
    reload: () => void load(),
    addClient,
    saveClient,
    resetAdd,
    resetEdit,
  }
```

- [ ] **Step 5: Write the add form**

Create `src/clients/AddClientForm.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { EMPTY_DRAFT, formProblems, writeStatusLine } from './clientForm'
import type { ClientDraft, WriteState } from './clientForm'
import type { OwnerOption } from './useClients'
import styles from './ClientsAdmin.module.css'

type Props = {
  owners: readonly OwnerOption[]
  state: WriteState
  onAdd: (draft: ClientDraft) => void
  onEdited: () => void
}

// The class each status tone renders as. Kept beside the component that consumes
// it rather than in clientForm.ts: clientForm.ts decides what the screen should
// SAY, and which CSS role that becomes is presentation. Same division
// CheckIn.tsx documents for its own TONE_CLASS.
const TONE_CLASS = {
  confirm: 't-body',
  error: 'alert',
  quiet: 't-caption',
} as const

// Spec §7: "Adding takes a name and an optional owner. Status is active; the
// form does not offer a churned status on creation." There is deliberately no
// status control here -- the absence is the feature.
export function AddClientForm({ owners, state, onAdd, onEdited }: Props) {
  const [draft, setDraft] = useState<ClientDraft>(EMPTY_DRAFT)

  const problems = formProblems(draft)
  const saving = state.kind === 'saving'
  const line = writeStatusLine(state, problems)

  // One place that both updates the form and clears a stale confirmation, so no
  // edit path can forget the second half. A confirmation left standing beside a
  // form somebody has since changed is the same class of lie as no confirmation
  // at all.
  function edit(next: ClientDraft) {
    setDraft(next)
    if (state.kind !== 'idle') onEdited()
  }

  // Cleared on a CONFIRMED add, never on the press. Spec §7: "A failed write
  // keeps the form populated and says retrying is safe." Clearing in submit()
  // below would lose the typed name the instant the write was refused -- and the
  // most likely refusal this form will ever see is the unique index on
  // lower(name), which is precisely the case where the person wants to look at
  // what they typed and change one word of it.
  //
  // Safe against re-firing: once this runs, `state` is unchanged, so the effect
  // does not re-run. The next keystroke calls edit(), which resets the state to
  // idle and moves the dependency off 'saved' for good.
  useEffect(() => {
    if (state.kind === 'saved') setDraft(EMPTY_DRAFT)
  }, [state])

  function submit() {
    if (problems.length > 0 || saving) return
    onAdd(draft)
  }

  return (
    <div className={styles.panel}>
      <h3 className="t-header">Add a client</h3>

      <div className={styles.fieldBlock}>
        <label className="t-label" htmlFor="add-client-name">
          Name
        </label>
        <input
          className="field"
          disabled={saving}
          id="add-client-name"
          onChange={(event) => edit({ ...draft, name: event.target.value })}
          type="text"
          value={draft.name}
        />
      </div>

      <div className={styles.fieldBlock}>
        <label className="t-label" htmlFor="add-client-owner">
          Owner
        </label>
        <select
          className="field"
          disabled={saving}
          id="add-client-owner"
          onChange={(event) =>
            edit({ ...draft, ownerId: event.target.value === '' ? null : event.target.value })
          }
          value={draft.ownerId ?? ''}
        >
          <option value="">Unassigned</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.actions}>
        <button
          aria-describedby="add-client-status"
          className="button"
          disabled={problems.length > 0 || saving}
          onClick={submit}
          type="button"
        >
          Add client
        </button>

        {/* role="status" so the confirmation is announced rather than only
            drawn. The whole reason Slice 1 was rewritten is that a write which
            worked looked exactly like one that failed. */}
        <p
          className={TONE_CLASS[line.tone]}
          data-testid="add-status"
          id="add-client-status"
          role="status"
        >
          {line.text}
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Write the edit form**

Create `src/clients/EditClientForm.tsx`:

```tsx
import { useState } from 'react'
import {
  CLIENT_STATUSES,
  END_REASON_CODES,
  END_REASON_LABELS,
  STATUS_HINTS,
  STATUS_LABELS,
  draftFromRow,
  formProblems,
  isChurned,
  reactivationWarning,
  writeStatusLine,
} from './clientForm'
import type { AdminClient, ClientDraft, ClientStatus, WriteState } from './clientForm'
import type { OwnerOption } from './useClients'
import styles from './ClientsAdmin.module.css'

type Props = {
  client: AdminClient
  owners: readonly OwnerOption[]
  state: WriteState
  onSave: (id: number, draft: ClientDraft) => void
  onCancel: () => void
  onEdited: () => void
}

const TONE_CLASS = {
  confirm: 't-body',
  error: 'alert',
  quiet: 't-caption',
} as const

// Spec §7: name, owner and status, with the three lifecycle fields revealed only
// when the status is one that requires them. Every decision below comes out of
// clientForm.ts -- rule 1 is formProblems, rule 2 is reactivationWarning plus
// updatePayload, rule 3 is STATUS_HINTS. Spec §9: "The rules are not ternaries
// in JSX."
export function EditClientForm({ client, owners, state, onSave, onCancel, onEdited }: Props) {
  // Keyed by the client's id at the call site, so opening a different row
  // remounts this component with that row's values. Without the key this
  // useState would keep the first row's draft and quietly edit the wrong
  // client's name into the second row's id.
  const [draft, setDraft] = useState<ClientDraft>(() => draftFromRow(client))

  const problems = formProblems(draft)
  const saving = state.kind === 'saving'
  const line = writeStatusLine(state, problems)
  // Measured against the STORED status, not the draft's, because the question is
  // what saving would destroy.
  const warning = reactivationWarning(client.status, draft.status)
  const churned = isChurned(draft.status)

  function edit(next: ClientDraft) {
    setDraft(next)
    if (state.kind !== 'idle') onEdited()
  }

  function submit() {
    if (problems.length > 0 || saving) return
    onSave(client.id, draft)
  }

  return (
    <div className={styles.panel}>
      <h4 className="t-label">Editing {client.name}</h4>

      <div className={styles.fieldBlock}>
        <label className="t-label" htmlFor="edit-client-name">
          Client name
        </label>
        <input
          className="field"
          disabled={saving}
          id="edit-client-name"
          onChange={(event) => edit({ ...draft, name: event.target.value })}
          type="text"
          value={draft.name}
        />
      </div>

      <div className={styles.fieldBlock}>
        <label className="t-label" htmlFor="edit-client-owner">
          Owner
        </label>
        <select
          className="field"
          disabled={saving}
          id="edit-client-owner"
          onChange={(event) =>
            edit({ ...draft, ownerId: event.target.value === '' ? null : event.target.value })
          }
          value={draft.ownerId ?? ''}
        >
          <option value="">Unassigned</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.fieldBlock}>
        <label className="t-label" htmlFor="edit-client-status">
          Status
        </label>
        <select
          className="field"
          disabled={saving}
          id="edit-client-status"
          onChange={(event) => edit({ ...draft, status: event.target.value })}
          value={draft.status}
        >
          {CLIENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        {/* Rule 3: cancelled and former differ only in age, so the form says
            which is which instead of making the reader guess. Rendered as
            visible text, not only as a description -- an accessible name and a
            sighted reader are two separate questions. */}
        <p className="t-caption prose" data-testid="status-hint">
          {STATUS_HINTS[draft.status as ClientStatus] ?? ''}
        </p>
      </div>

      {/* Rule 2. A sentence before the press rather than a dialog after it: the
          spec asks the screen to SAY it is clearing the end date and reason,
          because that is a recorded fact being destroyed. */}
      {warning !== null && (
        <p className="alert prose" data-testid="reactivation-warning" role="status">
          {warning}
        </p>
      )}

      {/* Rule 1: revealed, not merely enabled. An always-present date field on
          an active client invites somebody to fill it in, and the constraint
          would then refuse the whole save. */}
      {churned && (
        <>
          <div className={styles.fieldBlock}>
            <label className="t-label" htmlFor="edit-client-ended">
              End date
            </label>
            <input
              className="field"
              disabled={saving}
              id="edit-client-ended"
              onChange={(event) => edit({ ...draft, endedOn: event.target.value })}
              type="date"
              value={draft.endedOn}
            />
          </div>

          <div className={styles.fieldBlock}>
            <label className="t-label" htmlFor="edit-client-reason">
              Reason they left
            </label>
            <select
              className="field"
              disabled={saving}
              id="edit-client-reason"
              onChange={(event) => edit({ ...draft, endReasonCode: event.target.value })}
              value={draft.endReasonCode}
            >
              <option value="">Choose a reason</option>
              {END_REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {END_REASON_LABELS[code]}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.fieldBlock}>
            <label className="t-label" htmlFor="edit-client-note">
              Note (optional)
            </label>
            {/* Optional, and labelled as such. Spec §10 decision 3: only the
                countable half can be made mandatory without inviting a full
                stop typed to get past a form. */}
            <textarea
              className="field"
              disabled={saving}
              id="edit-client-note"
              onChange={(event) => edit({ ...draft, endReasonNote: event.target.value })}
              rows={2}
              value={draft.endReasonNote}
            />
          </div>
        </>
      )}

      <div className={styles.actions}>
        <button
          aria-describedby="edit-client-status-line"
          className="button"
          disabled={problems.length > 0 || saving}
          onClick={submit}
          type="button"
        >
          Save changes
        </button>
        <button
          className="button button--quiet"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>

        <p
          className={TONE_CLASS[line.tone]}
          data-testid="edit-status"
          id="edit-client-status-line"
          role="status"
        >
          {line.text}
        </p>
      </div>

      {/* There is no delete control here, and that is a decision rather than an
          omission. checkins.client_id is `on delete cascade` and this project
          has no backups, so deleting a client would silently destroy its entire
          check-in history. `former` is how a client goes away. Spec §2 and §10
          decision 5. */}
    </div>
  )
}
```

- [ ] **Step 7: Mount the forms in the screen**

Three edits to `src/clients/ClientsAdmin.tsx`.

Add to the imports:

```tsx
import { useState } from 'react'
import { AddClientForm } from './AddClientForm'
import { EditClientForm } from './EditClientForm'
```

Inside the component, above the `back` definition:

```tsx
  // Which row's form is open, by id rather than by row object: the hook replaces
  // the row object after a save (that is how the list shows the new name), and a
  // held object would then be the pre-save copy.
  const [editingId, setEditingId] = useState<number | null>(null)
  const editing = admin.clients.find((client) => client.id === editingId) ?? null
```

Then, in the ready branch, put the add form above the list, and render the edit form inside the row it belongs to. Replace the ready branch's `return` with:

```tsx
  return (
    <section className={styles.screen}>
      {back}
      {masthead}

      <AddClientForm
        onAdd={admin.addClient}
        onEdited={admin.resetAdd}
        owners={admin.owners}
        state={admin.addState}
      />

      {admin.clients.length === 0 ? (
        <p className="t-body prose">
          No clients yet. Add the first one above and it appears on the board straight
          away.
        </p>
      ) : (
        <ul aria-label="Clients" className={styles.list} role="list">
          {admin.clients.map((client) => (
            <li className={styles.row} key={client.id}>
              <div className={styles.rowHead}>
                <p className="t-body" data-testid="client-name">
                  {client.name}
                </p>
                <span
                  className={`${styles.statusPill} ${isChurned(client.status) ? styles.statusPillEnded : ''}`}
                >
                  {statusLabel(client.status)}
                </span>
              </div>

              <p className="t-caption">{ownerText(client, admin.owners)}</p>

              {isChurned(client.status) && (
                <p className="t-caption" data-testid="client-ended">
                  Ended {client.ended_on ?? 'on an unrecorded date'} ·{' '}
                  {reasonLabel(client.end_reason_code)}
                  {client.end_reason_note === null ? '' : ` · ${client.end_reason_note}`}
                </p>
              )}

              <p className="t-caption" data-testid="client-updated">
                Updated {formatSavedAt(client.updated_at)}
              </p>

              {editing?.id === client.id ? (
                // Keyed by id so opening a different row remounts the form with
                // that row's values rather than keeping the first row's draft.
                <EditClientForm
                  client={editing}
                  key={editing.id}
                  onCancel={() => {
                    setEditingId(null)
                    admin.resetEdit()
                  }}
                  onEdited={admin.resetEdit}
                  onSave={admin.saveClient}
                  owners={admin.owners}
                  state={admin.editState}
                />
              ) : (
                <div className={styles.actions}>
                  <button
                    className="button button--quiet"
                    onClick={() => {
                      setEditingId(client.id)
                      // A confirmation from the previous row must not appear
                      // beside this one's fields.
                      admin.resetEdit()
                    }}
                    type="button"
                  >
                    {/* The client's name is in the accessible name, not only in
                        the row above it: "Edit" repeated twelve times is
                        unusable in a screen reader's control list. */}
                    Edit {client.name}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
```

Note the empty-state branch now sits **below** the add form, so "Add the first one above" is true.

- [ ] **Step 8: Add the form layout to the stylesheet**

Append to `src/clients/ClientsAdmin.module.css`:

```css
/* A form block: the add form, and the edit form inside a row. Bordered rather
   than floated, because spec §7 asks for a list and a form on one screen and
   explicitly not a modal. */
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--rule-hairline);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

/* The edit form sits inside a .row, which already has that background. Sunken
   so the open form reads as nested rather than as a second card floating in the
   list. */
.row .panel {
  background: var(--surface-sunken);
}

.fieldBlock {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
```

- [ ] **Step 9: Green**

Run: `npx vitest run src/clients/ClientsAdmin.dom.test.tsx`
Expected: PASS, every test in both halves of the file.

If the "opens one form, populated from the row" test fails on `getAllByLabelText('Status')` finding more than one element, the edit form is being rendered for every row rather than the selected one — check the `editing?.id === client.id` guard.

- [ ] **Step 10: All three gates**

Run: `npm test && npm run build && npm run lint`
Expected: all green. Record the counts from the output.

- [ ] **Step 11: Commit**

```bash
git add src/clients/
git commit -F - <<'MSG'
feat(clients): the admin screen, writing

Slice 2 step 4, task 3. Adds, renames, reassigns and retires a client.
Still not reachable from the board -- that is task 4.

All three of spec §7's rules are enforced by clientForm.ts and merely
rendered here, because each one is backed by a constraint that refuses
the write when the form gets it wrong. Rule 1 is formProblems, which
also disables the button and prints the reason. Rule 2 is
reactivationWarning before the press plus updatePayload's six-column
write, so the three-column clear cannot be forgotten. Rule 3 is
STATUS_HINTS, rendered as visible text rather than only as an
accessible description -- those are two separate questions.

The lifecycle fields are revealed rather than merely enabled: an
always-present end date on an active client invites somebody to fill
it in, and the bidirectional constraint would then refuse the whole
save.

The edit form is keyed by client id, so opening a second row remounts
it with that row's values instead of carrying the first row's draft
into the second row's id.

Two write states, not one, because both forms are on screen together
and a confirmation for one must never appear beside the other. Every
edit clears a stale confirmation for the same reason.

No delete control, and a test that fails if one is added. Spec §10
decision 5: checkins.client_id is on delete cascade and there are no
backups.
MSG
```

---

### Task 4: Reaching it from the board

**Files:**
- Modify: `src/board/Board.tsx`
- Modify: `src/board/Board.test.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: `can` (widened in Task 1), `ClientsAdmin` (Task 2/3).
- Produces: nothing new. This task only wires what exists.

- [ ] **Step 1: Read the file you are about to edit, in full**

```bash
cat -n src/board/Board.tsx
sed -n '1,60p' src/board/Board.test.tsx
```

Expected: four early returns in `Board` — `selected`, `status === 'error'`, `status === 'loading'`, `clients.length === 0` — before the populated board. Line 75 is the "Add one in the Supabase dashboard to see it here." sentence. `Board.test.tsx` mocks `../lib/supabase` and `./useBoard`.

- [ ] **Step 2: Write the failing tests**

Append to `src/board/Board.test.tsx`. Note the third mock — see measured fact 4.

Add at the top, beside the existing `vi.mock` calls:

```tsx
// The third mock, and it is not optional. Board now renders ClientsAdmin, which
// uses useClients, which imports the Supabase client. `supabase` is mocked as
// `{}` above, so an unmocked useClients would call `.from` on an empty object
// and this file would fail on navigation rather than on anything it is testing.
vi.mock('../clients/useClients', () => ({
  useClients: () => ({
    status: 'ready',
    loadError: null,
    clients: [],
    owners: [],
    addState: { kind: 'idle' },
    editState: { kind: 'idle' },
    reload: vi.fn(),
    addClient: vi.fn(),
    saveClient: vi.fn(),
    resetAdd: vi.fn(),
    resetEdit: vi.fn(),
  }),
}))
```

Then append these tests. `PROFILE` and the `useBoard` mock helper already exist in this file — reuse them; do not redefine them.

```tsx
describe('reaching the clients admin', () => {
  const READY = {
    status: 'ready' as const,
    loadError: null,
    clients: [{ id: 1, name: 'Acme' }],
    checkins: new Map(),
    submitted: 0,
    reload: vi.fn(),
  }

  it('offers the link to an account manager', () => {
    vi.mocked(useBoard).mockReturnValue(READY)
    render(<Board profile={PROFILE} />)

    expect(screen.getByRole('button', { name: 'Clients' })).toBeTruthy()
  })

  it('offers it to an admin', () => {
    vi.mocked(useBoard).mockReturnValue(READY)
    render(<Board profile={{ ...PROFILE, role: 'admin' }} />)

    expect(screen.getByRole('button', { name: 'Clients' })).toBeTruthy()
  })

  it('does not draw it for a viewer', () => {
    // Convenience, not security -- spec §7.2. A viewer who reached the screen
    // anyway would have every write refused by clients_insert_manage_clients
    // and clients_update_manage_clients, which is what actually enforces this.
    // Hiding the control just stops offering somebody a button that fails.
    vi.mocked(useBoard).mockReturnValue(READY)
    render(<Board profile={{ ...PROFILE, role: 'viewer' }} />)

    expect(screen.queryByRole('button', { name: 'Clients' })).toBeNull()
  })

  it('does not draw it for a role nobody has heard of', () => {
    vi.mocked(useBoard).mockReturnValue(READY)
    render(<Board profile={{ ...PROFILE, role: 'sales' }} />)

    expect(screen.queryByRole('button', { name: 'Clients' })).toBeNull()
  })

  it('opens the screen, and comes back', async () => {
    vi.mocked(useBoard).mockReturnValue(READY)
    render(<Board profile={PROFILE} />)

    await userEvent.click(screen.getByRole('button', { name: 'Clients' }))
    expect(screen.getByRole('heading', { name: 'Client admin' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Board' }))
    expect(screen.getByRole('list', { name: 'Clients' })).toBeTruthy()
  })

  it('offers the link when the board is empty, which is when it is needed most', () => {
    // The old copy sent the reader to the Supabase dashboard. A board with no
    // clients and no way to add one is the exact state this screen exists for.
    vi.mocked(useBoard).mockReturnValue({ ...READY, clients: [] })
    render(<Board profile={PROFILE} />)

    expect(screen.getByRole('button', { name: 'Clients' })).toBeTruthy()
    expect(screen.queryByText(/Supabase dashboard/)).toBeNull()
  })

  it('offers the link when the read failed, so the screen is not a dead end', () => {
    vi.mocked(useBoard).mockReturnValue({
      ...READY,
      status: 'error',
      loadError: 'the connection failed',
    })
    render(<Board profile={PROFILE} />)

    expect(screen.getByRole('button', { name: 'Clients' })).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/board/Board.test.tsx`
Expected: FAIL — no button named `Clients`. The existing tests in the file still pass.

- [ ] **Step 4: Wire the board**

Four edits to `src/board/Board.tsx`.

Add to the imports:

```tsx
import { can } from '../lib/capabilities'
import { ClientsAdmin } from '../clients/ClientsAdmin'
```

Add the view state beside the existing `selected` state:

```tsx
  // §5.1 again: state-based navigation in the board container, no router,
  // therefore no URL change and a refresh returns to the board. A linkable
  // admin URL needs the GitHub Pages 404.html redirect trick, which is not
  // worth buying until somebody wants to send a colleague a link to it.
  const [showingClients, setShowingClients] = useState(false)
```

Below the existing `if (selected)` block, add:

```tsx
  if (showingClients) {
    return (
      <ClientsAdmin
        onBack={() => {
          setShowingClients(false)
          // Re-read on the way back, so a client added, renamed or retired here
          // shows correctly on the board. Without this the board would show what
          // it read before the change -- the same picture as a change that did
          // nothing.
          board.reload()
        }}
      />
    )
  }
```

Then, above the `if (board.status === 'error')` block, define the link once:

```tsx
  // Drawn only for a role whose preset includes manage_clients. Convenience,
  // not security: spec §7.2, "UI hiding is convenience; the database refusing is
  // the security". A viewer who reached the screen would have every write
  // refused by clients_insert_manage_clients and clients_update_manage_clients.
  // This is the first caller of can() in the application.
  //
  // Defined here, above the four early returns below, and included in every one
  // of them. It has to be reachable from the empty state and from the failed
  // read in particular: a board with no clients is exactly when somebody needs
  // to add one, and a failed read is not a reason to strand them.
  const adminLink = can(profile.role, 'manage_clients') ? (
    <nav className={styles.adminLink}>
      <button
        className="button button--quiet"
        onClick={() => setShowingClients(true)}
        type="button"
      >
        Clients
      </button>
    </nav>
  ) : null
```

Then add `{adminLink}` as the first child of each of the four remaining returns — the error `<section>`, the loading branch, the empty `<section>`, and the populated `<section>`. The loading branch has no wrapper today, so give it one:

```tsx
  if (board.status === 'loading') {
    return (
      <section className={styles.state}>
        {adminLink}
        <p className="t-body">Loading…</p>
      </section>
    )
  }
```

And change the empty state's second sentence — line 75 as the file stands — from `Add one in the Supabase dashboard to see it here.` to:

```tsx
        <p className="t-body prose">
          Add one on the client admin screen to see it here.
        </p>
```

Finally, add the rule to `src/board/Board.module.css`:

```css
/* The link to the clients admin, above whatever the board is showing. A flex
   row of its own so it hugs its content and sits left, rather than stretching
   across the column its parent is. */
.adminLink {
  display: flex;
}
```

- [ ] **Step 5: Green**

Run: `npx vitest run src/board/Board.test.tsx`
Expected: PASS, every test in the file including the ones that were already there.

- [ ] **Step 6: Document what the screen can and cannot refuse**

`README.md` has no section about screens today — measured with `grep -n '^##* ' README.md`, whose headings run Status, Development, Tests, Deploying, Configuration…, Rebuilding…, Two Supabase projects, Database, then Security notes. Add this as a new top-level section **immediately before `## Security notes`**, so it sits after the four `verify:*` sections it refers to and before the security discussion it feeds into:

```markdown
## The clients admin screen

Reached from the board by anyone whose role preset includes `manage_clients` —
today an admin or an account manager. It adds a client, renames one, assigns an
owner, and gives a departing client an end date and a coded reason.

The button is hidden from a viewer, and that is convenience rather than
security. What actually stops a viewer changing a client is
`clients_insert_manage_clients` and `clients_update_manage_clients` in Postgres.
A viewer who reached the screen would see every save refused, and the screen
says so in words rather than showing Postgres's `permission denied for table
clients`.

**There is no delete, and there will not be one.** `checkins.client_id` is
`on delete cascade` and this project has no backups, so deleting a client would
silently destroy that client's entire check-in history. `former` is how a client
goes away, and a former client stays visible on this screen — that is the reason
the screen reads every row while the board reads only the active ones.

Three refusals come from the database and are worth knowing by name, because the
screen translates them rather than repeating them:

- Two clients whose names differ only in case cannot both exist —
  `clients_name_unique`, a unique index on `lower(name)`.
- A cancelled or former client must have an end date and a coded reason, and an
  active or paused one must have none of the three — `clients_lifecycle_coherent`.
  This is why reactivating a client clears all three columns in the same update,
  and why the form warns before it does.
- The reason must be one of seven — `clients_end_reason_code_known`.

`npm run verify:lifecycle` proves the second and third of those are what is
actually deployed, by reading the constraints out of `pg_constraint` and
evaluating them over all 32 combinations of their inputs.
```

- [ ] **Step 7: All three gates**

Run: `npm test && npm run build && npm run lint`
Expected: all green. Read the test count off this run and use that number in the commit message and in anything you write afterwards — spec §9's second standing instruction exists because the only two false claims that reached a commit in Slice 1 step 4 were counts typed from memory.

- [ ] **Step 8: Commit**

```bash
git add src/board/Board.tsx src/board/Board.module.css src/board/Board.test.tsx README.md
git commit -F - <<'MSG'
feat(board): reach the clients admin, gated on manage_clients

Slice 2 step 4, task 4. The screen is now reachable, and this is the
first caller of can() in the application -- until now the TypeScript
preset table existed only to be checked against the migration.

Hiding the button from a viewer is convenience, not security: spec
§7.2. clients_insert_manage_clients and clients_update_manage_clients
are what refuse the write, and the screen translates that refusal into
a sentence instead of repeating Postgres's.

The link appears in all four board states, including the empty one and
the failed read. A board with no clients is exactly when somebody needs
to add one, and the empty state used to tell them to go to the Supabase
dashboard -- a sentence that stopped being true the moment this screen
shipped.

Board.test.tsx needed a third mock. It already mocked ../lib/supabase
as {} because Board renders CheckIn, which imports the client at module
scope; Board now also renders ClientsAdmin, which uses useClients,
which does the same. Without mocking useClients the navigation test
would call .from on an empty object.
MSG
```

---

## After the four tasks: what the owner does, and in what order

Nothing in this step touches the database, so there is no `db:push` and no
`ALLOW_PRODUCTION=1`. What is left is the two things no test in this repository
can do.

**1. The staging sign-in — do this before looking at production.** Spec §11 item
4: staging has never had an active profile, so no policy has ever been exercised
there. Three migrations and one `security definer` function have now been
applied to it and verified only against production. This screen is the first one
that reads `profiles` for somebody other than the reader, which is exactly the
surface a wrong grant hides in.

```bash
cd ~/Downloads/CLAUDE/tgc-client-health
npx --yes supabase@latest link --project-ref dexsdhtpfsswgiytxntl   # staging
npm run db:which                                                    # confirm staging
npm run dev
```

Then, in the browser at `http://localhost:5173`: request a magic link, follow it,
land on the access-pending screen, and run `scripts/activate-staging-profile.sql`
in the staging SQL editor to turn that profile active. Reload, and the board
appears. Then open **Clients** and confirm the list, the owner picker, and one
retire-and-reactivate round trip. `npm run verify:privileges` against staging
afterwards will, for the first time on that project, have a real profile row to
measure §10b, §10f and §10g against.

**2. Give `Test Client` a proper end.** Spec §11 item 6. On production, open
**Clients**, edit `Test Client`, set the status to `former`, today's date, and
`Other`. It leaves the board and stays on this screen. Reversible: edit it back
to `active` and accept the warning about clearing the end date.

**3. Then `npm run verify:privileges` against production** — not because this
step changed a policy, but because it is the cheapest way to confirm the screen's
reads and writes did not depend on anything the allowlist forbids.

---

## Self-review against the spec

**Spec coverage, §7 line by line.** The list shows every client regardless of
status — Task 2's query has no status filter, and a test asserts four rows across
four statuses. Name, owner, status, and for churned rows the end date and coded
reason — Task 2's row markup, four tests. Sorted by status then name — `sortClients`,
tested in Task 1 and asserted un-re-sorted in Task 2. Adding takes a name and an
optional owner, status `active`, no churned status offered — `insertPayload` plus
Task 3's "offers no status field" test. Rule 1 revealed-and-required — `formProblems`
plus Task 3's reveal and blocking tests. Rule 2 cleared in the same update and
said out loud — `updatePayload`'s six columns plus `reactivationWarning`, tested
both as a value and as rendered markup. Rule 3 stated on the form — `STATUS_HINTS`,
asserted as visible text. The owner picker lists active profiles by name or email
— `ownerLabel` plus the hook's `.eq('is_active', true)`. The save confirmation
names the time, survives a reload, and is not a toast — `writeStatusLine` for the
immediate half and the row's `updated_at` line for the durable half, each with its
own test. A failed write keeps the form populated and says retrying is safe —
`writeFailureText`'s common tail plus two tests. A failed read does not render a
form over it — Task 2's first test.

**Spec §9's testing table.** The screen's states: jsdom plus `@testing-library/react`
with the hook mocked, Tasks 2 and 3. The form's three rules: pure functions in the
node environment, Task 1 — and the spec's "the rules are not ternaries in JSX" is
why `clientForm.ts` exists at all. Shape, in front of the deployed site: the owner,
above.

**Deliberate divergences from the spec, both recorded in the code.**

1. **`writeFailureText` is not in the spec.** The spec does not say what a
   duplicate name looks like on screen, and the unique index answers one with
   `duplicate key value violates unique constraint "clients_name_unique"`. That
   is not a sentence to put in front of an account manager, and the spec's own
   §7 requirement — "a failed write keeps the form populated and says retrying
   is safe" — cannot be met by passing Postgres's words through. Four constraints
   are translated; everything else passes through verbatim, because a server that
   answers with a real complaint is diagnosable and replacing its words with a
   guess is worse.

2. **"Owner is not an active account" is a third state the spec does not name.**
   §7 says the picker lists active profiles. A client assigned to an account that
   was since deactivated therefore has an `owner_id` the picker cannot label.
   The spec offers two options and both are wrong: "Unassigned" is false, and the
   raw UUID is useless. Production is known to hold at least one inactive profile,
   so this is not hypothetical.

**One defect found in this plan's own first draft, recorded rather than quietly
fixed.** `AddClientForm.submit()` cleared the draft on the press. That directly
contradicts spec §7 — "a failed write keeps the form populated" — and it fails on
the single most likely refusal this form has, the unique index on `lower(name)`:
press Add on a duplicate, the name vanishes, and the error says retrying is safe
while there is nothing left to retry. Worse, the test written beside it did not
catch it, because it typed the name *after* mounting with a failed state and so
asserted nothing about the transition. Both are fixed above: the clear moved into
an effect keyed on a confirmed save, and the test now renders twice to observe
the press and the confirmation separately. This is the fourth plan on this project
whose first draft carried a defect its own test would have passed — the pattern is
always a test written from the same sentence as the code rather than against it.

**Placeholder scan.** No task contains "TBD", "handle edge cases", "add
validation", "similar to Task N", or a step that says what to do without the code
to do it. Every test in the plan is written out. Every file that is modified is
read first, in that task's own first step.

**Type consistency.** `AdminClient`, `ClientDraft`, `WriteState`, `StatusLine`,
`FormProblem`, `OwnerOption` and `UseClients` are each defined once and spelled
the same in every later task. `writeStatusLine(state, problems)` takes the same
two arguments in Task 1's test, `AddClientForm` and `EditClientForm`.
`saveClient(id, draft)` takes the id first in the hook, the form and the test.
`onEdited` is the prop name in both forms. `formProblems`'s `field` union
(`'name' | 'status' | 'endedOn' | 'endReasonCode'`) covers every value pushed in
its body.

**One thing this plan deliberately does not do.** Slice 1's card footer can now
name a person, and the board card's `owner` field is buildable — spec §8 says
both are unblocked by step 3 and neither is in this slice. `src/board/cardSummary.ts:41`
already records that. Do not build them here.

**And one it must not do.** The board's show-archived toggle is step 5. Nothing
in these four tasks adds a status filter to the board's query or a control beside
it.
