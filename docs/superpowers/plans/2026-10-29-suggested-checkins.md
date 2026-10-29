# Suggested Check-ins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI-written check-ins carry a "suggested" flag that shows on the board and check-in screen until a person confirms or saves them.

**Architecture:** One nullable column, `checkins.suggested_at`, plus a backfill. The board reads it with the other check-in columns and counts it among the month's members; the check-in screen's save clears it; a small hook + banner component offers Confirm. No view, policy or score change.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + Testing Library (`*.dom.test.ts(x)` with `// @vitest-environment jsdom`), Supabase. Postgres migration.

**Spec:** `docs/superpowers/specs/2026-10-29-suggested-checkins-design.md` — read it first.

## Global Constraints

- Column: `suggested_at timestamptz`, nullable, on `public.checkins`. No CHECK, no new policy, no grant.
- Migration file: `supabase/migrations/20261029120000_suggested_checkins.sql`.
- Backfill predicate, verbatim: `notes like 'AI-suggested:%' and updated_at <= created_at + interval '1 minute'`, setting `suggested_at = created_at`, one statement.
- Marker copy: card `Suggested — review`; matrix visible `Suggested`, hidden text `Suggested, not yet reviewed`; progress suffix ` · N to review` (middle dot U+00B7 with spaces, as written), absent when N is 0.
- Banner copy: `Suggested by AI on <Mon D>. Check the answers, then Confirm — or change anything and save.` where `<Mon D>` is `toLocaleDateString('en-US', { month: 'short', day: 'numeric' })` of `suggested_at` (e.g. `Oct 29`). Button label `Confirm`. Success line: `Confirmed <formatSavedAt(updated_at)>.`
- Confirm is offered only with `can(profile.role, 'edit_scores')`.
- Every write filters on BOTH `client_id` and `period` and ends in `.maybeSingle()`; null = failure.
- Tests that import anything reaching `src/lib/supabase` must mock it (tests/supabaseModuleScope.test.ts enforces this; CI has no VITE_ env).
- Branch `suggested-checkins`; `git branch --show-current` before every commit; explicit paths, never `git commit -a`. Commit trailer: `Co-Authored-By: Claude <model actually running> <noreply@anthropic.com>`.
- A task is done when its tests pass, the full `npx vitest run` passes, `npx tsc -b` and `npm run lint` are clean.

## Review Focus

1. **A person saves a suggested check-in without changing anything** — it must count as reviewed (the upsert always sends `suggested_at: null`). Task 3.
2. **Confirm succeeds but the page still says "Suggested"** — the banner must hide on success without a reload. Task 4.
3. **Confirm on a row RLS filters out** (a viewer whose capability was revoked mid-session) — must show a failure, not "Confirmed". Task 4.
4. **The month changes on the board** — `toReview` must be recomputed for the new month's members, never carried over. Task 2 (it is derived each render from the same state as `submitted`).
5. **A non-member's stale check-in** — cannot exist (a check-in makes a member), but `toReview` must be computed over members like `submitted`, so the two numbers on one line agree. Task 2.

---

### Task 1: The column, the backfill, the types

**Files:**
- Create: `supabase/migrations/20261029120000_suggested_checkins.sql`
- Modify: `src/types/database.ts` (the `checkins` Row / Insert / Update blocks)
- Create: `tests/suggestedMigration.test.ts`

**Interfaces:** Produces `checkins.suggested_at: string | null` in `Database['public']['Tables']['checkins']['Row']` (and optional in Insert/Update).

- [ ] **Step 1: Failing test** — `tests/suggestedMigration.test.ts`, following `tests/revenueMigration.test.ts`'s `migration()` and `withoutComments()` helpers (copy them):

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const MIGRATIONS = 'supabase/migrations'
const NAME = '20261029120000_suggested_checkins.sql'

function migration(name: string): string {
  const names = readdirSync(MIGRATIONS).filter((entry) => entry === name)
  expect(names, `migration named ${name}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}
function withoutComments(sql: string): string {
  return sql.replaceAll(/--[^\n]*/g, '')
}
// One statement, sliced at its own semicolon, so an assertion cannot pass on
// text from a neighbouring statement.
function statement(sql: string, startsWith: RegExp): string {
  const match = sql.match(new RegExp(`${startsWith.source}[\\s\\S]*?;`, 'i'))
  expect(match, String(startsWith)).not.toBeNull()
  return match![0].replaceAll(/\s+/g, ' ').trim()
}

describe('the suggested check-ins migration', () => {
  const sql = withoutComments(migration(NAME))

  it('adds exactly one nullable timestamptz column', () => {
    expect(statement(sql, /alter table public\.checkins/)).toBe(
      'alter table public.checkins add column suggested_at timestamptz;',
    )
  })

  it('backfills only untouched AI rows, from their creation time', () => {
    const update = statement(sql, /update public\.checkins/)
    expect(update).toContain('set suggested_at = created_at')
    expect(update).toContain("notes like 'AI-suggested:%'")
    expect(update).toContain("updated_at <= created_at + interval '1 minute'")
  })

  it('adds no policy, grant or constraint', () => {
    expect(sql).not.toMatch(/create policy|grant |check \(/i)
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/suggestedMigration.test.ts` → FAIL (migration named … length 0).

- [ ] **Step 3: Write the migration** — `supabase/migrations/20261029120000_suggested_checkins.sql`:

```sql
-- Suggested check-ins (spec docs/superpowers/specs/2026-10-29-suggested-checkins-design.md).
--
-- Since 2026-10-28 Claude writes a monthly "AI-suggested" check-in per client
-- straight to production, and those rows were indistinguishable from the
-- owner's own except for a note prefix. suggested_at says "written as a
-- suggestion, not yet reviewed by a person". Null means a person entered it or
-- reviewed it. The check-in screen's save always sends it as null, so any save
-- is a review; a Confirm button clears it without touching anything else.
--
-- No CHECK, policy or grant, for the reason 20260912090000 gives: the
-- table-level grant covers a new column, and checkins_update_edit_scores
-- already decides who may update a row. Anyone who may score may review.
--
-- checkin_scores is not rebuilt: the board reads checkins directly for the
-- card, and the view's columns are unchanged.

alter table public.checkins add column suggested_at timestamptz;

comment on column public.checkins.suggested_at is
  'When this check-in was written as an AI suggestion that no person has yet '
  'reviewed. Null once a person saves or confirms it, or if a person entered it.';

-- The backfill. updated_at is moved by checkins_touch_updated_at on every
-- update, so a row a person has saved since it was written has updated_at well
-- after created_at and is left alone. On production 2026-10-29 this marks 24
-- rows (11 September, 13 October); Sno-Go and Triquetra (September) and Babaloo
-- (October) were already edited by the owner.
--
-- One statement, evaluated against the pre-update rows. Setting suggested_at
-- itself fires the touch trigger, so a second run matches nothing -- it cannot
-- double-apply.
update public.checkins
set suggested_at = created_at
where notes like 'AI-suggested:%'
  and updated_at <= created_at + interval '1 minute';
```

- [ ] **Step 4: Types** — in `src/types/database.ts`, inside `checkins:` add alphabetically: in `Row` `suggested_at: string | null`; in `Insert` and `Update` `suggested_at?: string | null`. (Hand edit; the file is generated but this project edits it by hand when a migration lands, and `tsc -b` checks it against use.)

- [ ] **Step 5: Run** — `npx vitest run tests/suggestedMigration.test.ts` PASS; full suite, `npx tsc -b`, lint clean.

- [ ] **Step 6: Commit** — `git add supabase/migrations/20261029120000_suggested_checkins.sql src/types/database.ts tests/suggestedMigration.test.ts`; message `migration: suggested check-ins, and the backfill that marks October's and September's`.

(The migration is NOT applied in this task. The controller applies it to staging, then production, at rollout.)

---

### Task 2: The board shows and counts suggestions

**Files:**
- Modify: `src/board/cardSummary.ts` (`CardCheckin`, `CHECKIN_COLUMNS`, `progressLine`), `src/board/useBoard.ts` (`UseBoard.toReview`), `src/board/Board.tsx` (pass `toReview`), `src/board/ClientCard.tsx` (marker), `src/board/Matrix.tsx` (marker)
- Test: `src/board/cardSummary.test.ts`, `src/board/useBoard.dom.test.ts`, `src/board/ClientCard.dom.test.tsx`, `src/board/Matrix.dom.test.tsx`, `src/board/Board.test.tsx`

**Interfaces:**
- `CardCheckin.suggested_at: string | null`
- `progressLine(submitted: number, total: number, period: string, toReview = 0): string`
- `UseBoard.toReview: number`

- [ ] **Step 1: Failing tests**

`cardSummary.test.ts`:

```ts
it('reads suggested_at with the other check-in columns', () => {
  expect(CHECKIN_COLUMNS.split(', ')).toContain('suggested_at')
})

describe('progressLine with suggestions', () => {
  it('says nothing about review when there is nothing to review', () => {
    expect(progressLine(14, 14, '2026-10-01', 0)).toBe('All 14 check-ins submitted for October 2026')
  })
  it('names how many are waiting for review', () => {
    expect(progressLine(14, 14, '2026-10-01', 12)).toBe('All 14 check-ins submitted for October 2026 · 12 to review')
    expect(progressLine(3, 14, '2026-10-01', 1)).toBe('3 of 14 check-ins submitted for October 2026 · 1 to review')
  })
})
```

`useBoard.dom.test.ts` (use the file's fake; one month, three members): member A check-in `suggested_at: '2026-10-29T10:00:00Z'`, member B check-in `suggested_at: null`, member C no check-in → `expect(result.current.toReview).toBe(1)`. Also add `suggested_at: null` to existing check-in fixtures that type as `CardCheckin`.

`ClientCard.dom.test.tsx`:

```tsx
it('marks a suggested check-in for review, and still shows its score', () => {
  // render with checkin { ...submitted fixture, suggested_at: '2026-10-29T10:00:00Z' } and a score
  expect(screen.getByText('Suggested — review')).toBeTruthy()
  // the card's total is still rendered (assert the existing total test id / text the file already uses)
})
it('does not mark a reviewed check-in', () => {
  // same with suggested_at: null
  expect(screen.queryByText('Suggested — review')).toBeNull()
})
```

`Matrix.dom.test.tsx`: a row whose check-in has `suggested_at` set shows `getByTestId('matrix-suggested')` whose text includes `Suggested, not yet reviewed`; a row with null shows none.

`Board.test.tsx`: mocked `useBoard` returning `toReview: 2` → the progress line (role="status") ends with ` · 2 to review`.

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/board` → the new tests FAIL.

- [ ] **Step 3: Implement**

`cardSummary.ts`: add `suggested_at: string | null` to `CardCheckin` (after `submitted_by`, with a one-line comment: "Spec 2026-10-29: set while an AI suggestion awaits review."); add `'suggested_at'` to `CHECKIN_COLUMNS` after `'submitted_by'`; and:

```ts
export function progressLine(submitted: number, total: number, period: string, toReview = 0): string {
  const month = formatPeriod(period)
  if (total === 0) return `Nobody is on the board for ${month}`
  const review = toReview > 0 ? ` · ${toReview} to review` : ''
  if (submitted === total) return `All ${total} check-ins submitted for ${month}${review}`
  return `${submitted} of ${total} check-ins submitted for ${month}${review}`
}
```

`useBoard.ts`: in `UseBoard` add `toReview: number` ("Members of the month whose check-in is an unreviewed AI suggestion; counted over the same set as submitted, so the two numbers on one line agree."). In the counting loop:

```ts
  let submitted = 0
  let toReview = 0
  for (const client of clients) {
    if (!members.has(client.id)) continue
    const checkin = checkins.get(client.id)
    if (checkin?.submitted_at != null) submitted += 1
    if (checkin?.suggested_at != null) toReview += 1
  }
```

and return `toReview`. Fix every mocked `useBoard` result in tests to include `toReview: 0` (tsc will list them).

`Board.tsx`: both `progressLine(board.submitted, board.activeTotal, period)` calls gain `, board.toReview`.

`ClientCard.tsx`: directly after the band `<span className={bandClassName(band)}>…</span>`:

```tsx
        {/* Spec 2026-10-29: an AI suggestion nobody has reviewed. The score
            still shows and counts; this says nobody has looked yet. */}
        {checkin?.suggested_at != null && (
          <span className="status-pill" data-testid="card-suggested">
            Suggested — review
          </span>
        )}
```

`Matrix.tsx`: in the name cell, after the name button/span and before the band, add:

```tsx
                      {row.checkin?.suggested_at != null && (
                        <span className="status-pill" data-testid="matrix-suggested">
                          <span aria-hidden="true">Suggested</span>
                          <span className={styles.hidden}>Suggested, not yet reviewed</span>
                        </span>
                      )}
```

- [ ] **Step 4: Run** — `npx vitest run` PASS, `npx tsc -b`, lint clean.

- [ ] **Step 5: Commit** — explicit paths; message `feat(board): mark AI suggestions for review, and count them`.

---

### Task 3: Saving a check-in reviews it

**Files:** Modify `src/checkin/useCheckin.ts` (the upsert payload); Test `src/checkin/useCheckin.dom.test.ts`.

- [ ] **Step 1: Failing test** — in `useCheckin.dom.test.ts`, using the file's existing fake that captures the upsert payload, add a test that submits a check-in and asserts:

```ts
expect(Object.prototype.hasOwnProperty.call(capturedUpsert, 'suggested_at')).toBe(true)
expect(capturedUpsert.suggested_at).toBeNull()
```

(If the fake does not yet capture the upsert payload, extend it to record the first argument of `.upsert()`.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — in the upsert object, after `submitted_by: …`:

```ts
              // Any save by a person is a review (spec 2026-10-29): an AI
              // suggestion that has been opened, judged and saved -- changed or
              // not -- is no longer waiting for anybody.
              suggested_at: null,
```

- [ ] **Step 4: Run** — focused file PASS, full suite, tsc, lint.

- [ ] **Step 5: Commit** — `feat(checkin): saving a check-in clears its suggestion`.

---

### Task 4: Confirm, on the check-in screen

**Files:**
- Create: `src/checkin/useConfirmSuggestion.ts`, `src/checkin/useConfirmSuggestion.dom.test.ts`, `src/checkin/SuggestionBanner.tsx`, `src/checkin/SuggestionBanner.dom.test.tsx`
- Modify: `src/checkin/CheckIn.tsx` (mount), `src/checkin/CheckIn.dom.test.tsx` and `src/checkin/CheckIn.test.tsx` (mock the new hook)

**Interfaces:**
- `useConfirmSuggestion(clientId: number, period: string): { state: ConfirmState; confirm: () => Promise<boolean> }` where `type ConfirmState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'confirmed'; at: string } | { kind: 'failed'; message: string }`
- `SuggestionBanner` props `{ clientId: number; period: string; suggestedAt: string; canConfirm: boolean }`

- [ ] **Step 1: Failing hook tests** — `useConfirmSuggestion.dom.test.ts`, with a vi.hoisted fake of `from('checkins').update(payload).eq(col, val).eq(col, val).select(cols).maybeSingle()` recording `lastUpdate` and every `eq` filter:

```ts
it('clears the flag on exactly this client and month, and nothing else', async () => {
  // confirm() → true; lastUpdate toEqual({ suggested_at: null }); filters toEqual([['client_id', 7], ['period', '2026-10-01']]) (either order: compare as a sorted list)
  // state → { kind: 'confirmed', at: <row.updated_at> }
})
it('treats a confirm that matched no row as a failure', async () => {
  // maybeSingle resolves { data: null, error: null } → confirm() false; state.kind 'failed'; message is UPDATE_MATCHED_NOTHING_TEXT from ../clients/clientForm
})
it('reports a database error', async () => {
  // { data: null, error: { message: 'boom' } } → failed, message contains 'boom'
})
it('sends one update when pressed twice', async () => {
  // Promise.all two confirms → one update
})
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — `src/checkin/useConfirmSuggestion.ts`:

```ts
import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import { UPDATE_MATCHED_NOTHING_TEXT } from '../clients/clientForm'

export type ConfirmState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'confirmed'; at: string }
  | { kind: 'failed'; message: string }

// Confirm an AI suggestion as it stands (spec 2026-10-29). Clears suggested_at
// and nothing else -- the answers are the suggestion the person just read and
// accepted. Filters on client AND month: a dropped period filter would confirm
// every month of this client's suggestions at once. .maybeSingle(), and a null
// result is a failure, for the reason useClients documents: RLS filters a
// refused update to zero rows without raising.
export function useConfirmSuggestion(clientId: number, period: string) {
  const [state, setState] = useState<ConfirmState>({ kind: 'idle' })
  const inFlight = useRef(false)

  const confirm = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return false
    inFlight.current = true
    setState({ kind: 'saving' })
    try {
      const { data, error } = await supabase
        .from('checkins')
        .update({ suggested_at: null })
        .eq('client_id', clientId)
        .eq('period', period)
        .select('updated_at')
        .maybeSingle()
      if (error) {
        setState({ kind: 'failed', message: `${describeError(error)} Nothing was changed.` })
        return false
      }
      if (data === null) {
        setState({ kind: 'failed', message: UPDATE_MATCHED_NOTHING_TEXT })
        return false
      }
      setState({ kind: 'confirmed', at: data.updated_at })
      return true
    } catch (thrown) {
      setState({ kind: 'failed', message: `${describeError(thrown)} Nothing was changed.` })
      return false
    } finally {
      inFlight.current = false
    }
  }, [clientId, period])

  return { state, confirm }
}
```

- [ ] **Step 4: Failing banner tests** — `SuggestionBanner.dom.test.tsx`, mocking `./useConfirmSuggestion` with hoisted `confirm` vi.fn and `state` (and `afterEach(cleanup)` as `EndClientPanel.dom.test.tsx` does):

```tsx
it('says when the suggestion was made and how to review it', () => {
  // render suggestedAt '2026-10-29T15:00:00Z', canConfirm true
  // getByText('Suggested by AI on Oct 29. Check the answers, then Confirm — or change anything and save.')
})
it('offers Confirm only to someone who may score', () => {
  // canConfirm false → no button 'Confirm'; the line still renders
})
it('confirms, then replaces the line with the confirmation', async () => {
  // click Confirm with confirm resolving true and state then { kind: 'confirmed', at: '2026-10-29T16:00:00Z' }
  // expect confirm called once; the 'Suggested by AI' line is gone; role="status" text starts 'Confirmed '
})
it('shows the failure and keeps the line when Confirm fails', () => {
  // state { kind: 'failed', message: 'Nope. Nothing was changed.' } → getByRole('alert') has that text; line still present; button still present
})
```

- [ ] **Step 5: Run, verify fail.**

- [ ] **Step 6: Implement** — `src/checkin/SuggestionBanner.tsx`:

```tsx
import { formatSavedAt } from '../lib/month'
import { useConfirmSuggestion } from './useConfirmSuggestion'

type Props = { clientId: number; period: string; suggestedAt: string; canConfirm: boolean }

function shortDay(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Spec 2026-10-29: an AI suggestion that no person has reviewed. Confirm
// accepts it as it stands; saving the form below also counts as review (the
// save clears suggested_at), so this line is gone either way once a person has
// looked. The line hides on a successful Confirm without a reload, because the
// stored row this screen holds still carries the old suggested_at.
export function SuggestionBanner({ clientId, period, suggestedAt, canConfirm }: Props) {
  const { state, confirm } = useConfirmSuggestion(clientId, period)

  if (state.kind === 'confirmed') {
    return (
      <p className="t-body prose" role="status">
        Confirmed {formatSavedAt(state.at)}.
      </p>
    )
  }

  return (
    <div className="prose">
      <p className="t-body" data-testid="suggestion-line">
        Suggested by AI on {shortDay(suggestedAt)}. Check the answers, then Confirm — or change anything and save.
      </p>
      {canConfirm && (
        <button className="button" disabled={state.kind === 'saving'} onClick={() => void confirm()} type="button">
          Confirm
        </button>
      )}
      {state.kind === 'failed' && (
        <p className="alert prose" role="alert">
          {state.message}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Mount** — in `CheckIn.tsx`, ready branch only, directly after the `EndClientPanel` block (after `{masthead}`):

```tsx
      {stored?.suggested_at != null && (
        <SuggestionBanner
          canConfirm={can(profile.role, 'edit_scores')}
          clientId={client.id}
          period={period}
          suggestedAt={stored.suggested_at}
        />
      )}
```

In `CheckIn.dom.test.tsx` and `CheckIn.test.tsx`, add `vi.mock('./useConfirmSuggestion', …)` returning an idle stub (required by the supabaseModuleScope guard). Add CheckIn tests: a stored row with `suggested_at` set renders the suggestion line; with null it does not; while loading it does not.

- [ ] **Step 8: Run** — full suite, tsc, lint.

- [ ] **Step 9: Commit** — `feat(checkin): confirm an AI suggestion as it stands`.

---

### Task 5: Prove it

- [ ] **Step 1: Mutations** (apply alone, run the owning tests, confirm FAIL, revert with an Edit — NOT `git checkout`, which would also discard uncommitted work; there should be none, but check `git status` first):
  - useCheckin: delete `suggested_at: null,` from the upsert.
  - useConfirmSuggestion: delete `.eq('period', period)`.
  - useConfirmSuggestion: delete `if (data === null) { … }`.
  - useConfirmSuggestion: delete `if (inFlight.current) return false`.
  - ClientCard: `checkin?.suggested_at != null` → `== null`.
  - useBoard: move `toReview` counting above the `members.has` guard (count non-members).
  - progressLine: `toReview > 0` → `toReview >= 0`.
  - CheckIn: drop the `canConfirm={can(...)}` → `canConfirm`.
- [ ] **Step 2: CI's command** — `mv .env.local .env.local.aside && npx vitest run --exclude '**/rls.test.ts'; mv .env.local.aside .env.local`; confirm `.env.local` restored; `npm run build`.
- [ ] **Step 3 (controller): rollout per spec §7** — apply to staging via MCP `apply_migration` (name `suggested_checkins`, the file's SQL), verify column + count; owner looks at staging; apply to production, verify 24 rows and the three named nulls; then merge and push.
