# Slice D — Moving up the ladder: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the package ladder on the Overview page — who sits on each rung, who has moved up or down, and whether clients who join at Foundation stay longer than clients who join above it — and move the landing destination to Overview.

**Architecture:** One new pure module in `src/clients/` holds every rule, importing `journeyOf`/`currentStint`/`sortStints` from `clientPackages.ts`, `departedRows` from `tenureMath.ts` and `medianOf` from `mixMath.ts`, and reimplementing none of them. One new read hook, `usePackages(enabled)`, in the shape of `useClientRates` — gated at the query, not at the render. `Overview.tsx` gains a `role` prop, renders the section only for `manage_clients`, and deliberately does **not** fold the new read into the status it already composes.

**Tech Stack:** React 19, TypeScript, Vite, Vitest (node by default; DOM tests carry `// @vitest-environment jsdom`), @testing-library/react, Supabase JS.

**Spec:** `docs/superpowers/specs/2026-09-24-slice-d-package-progression-design.md`

## Global Constraints

- **Synthetic client names in every test.** This repository is public and names real clients. Use `Client Alpha`, `Acme`, `Beta` — never a real one.
- **No `.toBeInTheDocument()`.** There is no jest-dom here. Use `.toBeTruthy()`.
- **DOM tests must carry `// @vitest-environment jsdom`** as their first line. `vite.config.ts:12` defaults to node.
- **Nothing under `src/` may import `node:*`.** `tsconfig.app.json` gives `src/` no Node types: a source-reading test passes `vitest` and fails `tsc -b` with TS2591. Such tests live in `tests/`.
- **Every test must be watched to fail before it is believed.** Slice 6l shipped six tests whose assertions could not fail, slice 6k four. Each task names the mutants that must break it; a task is not done until each has been applied, seen to fail, and reverted.
- **CSS tokens that exist:** `--space-1..7`, `--radius-sm|md|pill`, `--text-primary`, `--text-secondary`, `--surface-page|raised|sunken`, `--rule-hairline`. Do not invent one.
- **Never a colour alone.** The primary reader is colourblind: every distinction carries words.
- **Run tests as `npx vitest run <path>`.** `npm test` runs the whole suite.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/clients/packageProgress.ts` | **Create.** Every rule in spec §3, pure. |
| `src/clients/packageProgress.test.ts` | **Create.** Its tests, node environment. |
| `src/clients/usePackages.ts` | **Create.** The one new read, gated on `enabled`. |
| `src/clients/usePackages.dom.test.ts` | **Create.** Read gate, error and rejection behaviour. |
| `src/revenue/tenureMath.ts` | **Modify.** Split `LifecycleClient` so `departedRows` accepts a narrower roster. |
| `src/shell/Overview.tsx` | **Modify.** The section, and a `role` prop. |
| `src/shell/Overview.module.css` | **Modify.** The ladder's layout. |
| `src/shell/Overview.dom.test.tsx` | **Modify.** The section's DOM tests and both gates. |
| `src/shell/Shell.tsx` | **Modify.** Pass `profile.role` to Overview. |
| `src/shell/destination.ts` | **Modify.** `LANDING`. |
| `src/shell/Shell.dom.test.tsx` | **Modify.** The landing test. |
| `tests/overviewProvenance.test.ts` | **Modify.** Pin the new contents deliberately. |

**Three corrections to the spec, made while writing this plan and to be carried back into it:**

1. **§3.3 `movements` takes `asOf`.** The spec omitted it, but the "where they are now" half has to respect the same rule the ladder does — `currentStint` ignores stints dated in the future because a move recorded ahead of time is a plan, not the present.
2. **§3.4 `onRampComparison` does NOT take `asOf`.** It measures ended relationships to the day they ended, so a clock changes no answer. Slice C removed exactly such a parameter from `clientMix` "rather than leave it unused, so that a future caller cannot supply a date under the impression it changes an answer", and the same reasoning applies here.
3. **`departedRows` needs a narrower parameter type.** `LifecycleClient` requires `end_reason_note`, which the roster `useRetention` reads does not carry. Task 2 splits the type rather than fabricating a `null` note at the call site.

---

## Task 1: The descriptive rules

**Files:**
- Create: `src/clients/packageProgress.ts`
- Test: `src/clients/packageProgress.test.ts`

**Interfaces:**
- Consumes: `PACKAGE_CODES`, `PackageStint`, `sortStints`, `currentStint`, `journeyOf` from `./clientPackages`; `isChurned` from `./clientForm`.
- Produces: `type ProgressClient`, `entryRung(stints)`, `ladderStanding(clients, byClient, asOf)`, `movements(clients, byClient, asOf)`, and the types `LadderStanding`, `Move`, `Movements`. Task 2 adds to this file; Task 4 consumes all of it.

- [ ] **Step 1: Write the failing tests**

Create `src/clients/packageProgress.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { entryRung, ladderStanding, movements } from './packageProgress'
import type { PackageStint } from './clientPackages'

let nextId = 1
function stint(client_id: number, package_code: string, started_on: string): PackageStint {
  return { id: nextId++, client_id, package_code, started_on, note: null }
}

function client(id: number, name: string, over: Partial<{ status: string; started_on: string | null; ended_on: string | null }> = {}) {
  return {
    id,
    name,
    status: 'active',
    started_on: '2025-01-01',
    ended_on: null,
    ...over,
  }
}

function byClient(...stints: PackageStint[]) {
  const map = new Map<number, PackageStint[]>()
  for (const entry of stints) {
    const found = map.get(entry.client_id) ?? []
    found.push(entry)
    map.set(entry.client_id, found)
  }
  return map
}

const TODAY = '2026-09-24'

describe('entryRung', () => {
  it('is the earliest stint by date, not the first row handed over', () => {
    // Reversed on purpose: rows arrive in whatever order the database gives
    // them, and somebody correcting history enters an older stint last.
    const stints = [stint(1, 'grow', '2026-03-01'), stint(1, 'foundation', '2025-06-01')]

    expect(entryRung(stints)).toBe('foundation')
  })

  it('is null when nothing is recorded', () => {
    expect(entryRung([])).toBeNull()
  })

  it('returns a rung this vocabulary does not know, rather than null', () => {
    // Unlike journeyOf, which cannot place an unknown rung on the ladder. A
    // client who entered on one still entered somewhere, and the only question
    // asked of this value is whether it IS foundation.
    expect(entryRung([stint(1, 'platinum', '2025-06-01')])).toBe('platinum')
  })
})

describe('ladderStanding', () => {
  it('counts active clients on each rung, in ladder order', () => {
    const clients = [client(1, 'Acme'), client(2, 'Beta'), client(3, 'Gamma')]
    const map = byClient(
      stint(1, 'foundation', '2025-01-01'),
      stint(2, 'grow', '2025-01-01'),
      stint(3, 'grow', '2025-01-01'),
    )

    expect(ladderStanding(clients, map, TODAY).rungs).toEqual([
      { code: 'foundation', count: 1 },
      { code: 'grow', count: 2 },
      { code: 'scale', count: 0 },
    ])
  })

  it('counts a paused client, who is still a client', () => {
    const clients = [client(1, 'Acme', { status: 'paused' })]
    const map = byClient(stint(1, 'grow', '2025-01-01'))

    expect(ladderStanding(clients, map, TODAY).rungs).toContainEqual({ code: 'grow', count: 1 })
  })

  it('does not count a client who has left', () => {
    const clients = [client(1, 'Acme', { status: 'former', ended_on: '2026-02-01' })]
    const map = byClient(stint(1, 'grow', '2025-01-01'))

    expect(ladderStanding(clients, map, TODAY).rungs).toContainEqual({ code: 'grow', count: 0 })
    expect(ladderStanding(clients, map, TODAY).unrecorded).toBe(0)
  })

  it('counts a client with no package recorded, rather than dropping them', () => {
    const clients = [client(1, 'Acme'), client(2, 'Beta')]
    const map = byClient(stint(1, 'foundation', '2025-01-01'))

    const standing = ladderStanding(clients, map, TODAY)

    expect(standing.unrecorded).toBe(1)
    expect(standing.rungs).toContainEqual({ code: 'foundation', count: 1 })
  })

  it('does not read an unrecorded client as Foundation', () => {
    const standing = ladderStanding([client(1, 'Acme')], new Map(), TODAY)

    expect(standing.rungs).toContainEqual({ code: 'foundation', count: 0 })
    expect(standing.unrecorded).toBe(1)
  })

  it('reads a stint dated in the future as a plan, not the present', () => {
    const clients = [client(1, 'Acme')]
    const map = byClient(stint(1, 'foundation', '2025-01-01'), stint(1, 'scale', '2027-01-01'))

    expect(ladderStanding(clients, map, TODAY).rungs).toContainEqual({
      code: 'foundation',
      count: 1,
    })
  })
})

describe('movements', () => {
  it('names a climb from where they entered to the highest rung reached', () => {
    const clients = [client(1, 'Acme')]
    const map = byClient(stint(1, 'foundation', '2025-01-01'), stint(1, 'grow', '2026-01-01'))

    expect(movements(clients, map, TODAY).climbed).toEqual([
      { clientId: 1, name: 'Acme', from: 'foundation', to: 'grow', now: null },
    ])
  })

  it('names where a client is now when they have come back down', () => {
    const clients = [client(1, 'Acme')]
    const map = byClient(
      stint(1, 'foundation', '2025-01-01'),
      stint(1, 'scale', '2025-06-01'),
      stint(1, 'grow', '2026-01-01'),
    )

    expect(movements(clients, map, TODAY).climbed).toEqual([
      { clientId: 1, name: 'Acme', from: 'foundation', to: 'scale', now: 'grow' },
    ])
  })

  it('separates a descent from a climb', () => {
    const clients = [client(1, 'Acme'), client(2, 'Beta')]
    const map = byClient(
      stint(1, 'foundation', '2025-01-01'),
      stint(1, 'grow', '2026-01-01'),
      stint(2, 'scale', '2025-01-01'),
      stint(2, 'grow', '2026-01-01'),
    )

    const moved = movements(clients, map, TODAY)

    expect(moved.climbed.map((move) => move.name)).toEqual(['Acme'])
    expect(moved.descended).toEqual([
      { clientId: 2, name: 'Beta', from: 'scale', to: 'grow', now: null },
    ])
  })

  it('leaves out a client who has stayed put', () => {
    const clients = [client(1, 'Acme')]
    const map = byClient(stint(1, 'grow', '2025-01-01'))

    expect(movements(clients, map, TODAY)).toEqual({ climbed: [], descended: [] })
  })

  it('includes a client who climbed and then left', () => {
    // A completed relationship still climbed. Dropping them would quietly make
    // these lists a story about the current roster instead.
    const clients = [client(1, 'Acme', { status: 'former', ended_on: '2026-06-01' })]
    const map = byClient(stint(1, 'foundation', '2025-01-01'), stint(1, 'grow', '2025-09-01'))

    expect(movements(clients, map, TODAY).climbed.map((move) => move.name)).toEqual(['Acme'])
  })

  it('puts the most recent move first', () => {
    const clients = [client(1, 'Acme'), client(2, 'Beta')]
    const map = byClient(
      stint(1, 'foundation', '2025-01-01'),
      stint(1, 'grow', '2025-03-01'),
      stint(2, 'foundation', '2025-01-01'),
      stint(2, 'grow', '2026-08-01'),
    )

    expect(movements(clients, map, TODAY).climbed.map((move) => move.name)).toEqual([
      'Beta',
      'Acme',
    ])
  })
})
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/clients/packageProgress.test.ts`
Expected: FAIL — `Failed to resolve import "./packageProgress"`.

- [ ] **Step 3: Write the module**

Create `src/clients/packageProgress.ts`:

```ts
import { isChurned } from './clientForm'
import { PACKAGE_CODES, currentStint, journeyOf, sortStints } from './clientPackages'
import type { PackageStint } from './clientPackages'

// Who is on which rung, who has moved, and whether the on-ramp works.
//
// The owner's boss, 2026-09-11: "I would love to see a brand join us and we're
// in foundation. And then I'd love to see them graduate from foundation into
// grow... almost being able to see which brands are moving up the ladder with
// us... Do they stay with us longer than a brand who skips foundation and jumps
// straight into grow?"
//
// In clients/ rather than shell/ deliberately: this is domain arithmetic about
// clients, not this application's chrome, and it is meant to survive the tool
// being folded into another. Pure for the same reason clientPackages.ts is --
// src/lib/supabase.ts throws at import when the VITE_ config is absent, and CI
// runs vitest with no VITE_ env at all.

/**
 * The lifecycle columns every rule here reads.
 *
 * Narrower than tenureMath's LifecycleClient on purpose: the roster Overview
 * already holds comes from useRetention, which does not select end_reason_note.
 * Task 2 makes departedRows accept this.
 */
export type ProgressClient = {
  id: number
  name: string
  status: string
  started_on: string | null
  ended_on: string | null
}

/**
 * The rung a client came in on.
 *
 * The EARLIEST stint by date, via sortStints -- not the first row returned.
 * Rows arrive in whatever order the database gives them, and somebody
 * correcting history enters an older stint after a newer one.
 *
 * An unrecognised code comes back as itself rather than as null, which is where
 * this parts company with journeyOf. That function must place a rung ON the
 * ladder to judge movement and cannot place one it does not know; this one is
 * only ever asked whether the rung IS foundation, and "some other rung" is a
 * true answer to that.
 */
export function entryRung(stints: readonly PackageStint[]): string | null {
  const sorted = sortStints(stints)
  return sorted.length === 0 ? null : sorted[0].package_code
}

export type LadderStanding = {
  rungs: { code: string; count: number }[]
  unrecorded: number
}

/**
 * Where the current roster sits, and how much of it is unrecorded.
 *
 * ACTIVE MEANS NOT CHURNED, which includes paused: clientForm describes paused
 * as "still a client, but not being scored right now", so they sit on a rung.
 * `status === 'active'` is the wrong test and the easy mistake here.
 *
 * `unrecorded` is returned beside the rungs and not as an afterthought. A ladder
 * showing three counts and hiding the fourth would undo clientPackages' decision
 * that null is "nobody has said" rather than foundation -- at the last step,
 * where it is least visible.
 *
 * A rung this vocabulary does not know is counted after the three it does,
 * rather than silently dropped or folded into unrecorded: somebody IS on it.
 */
export function ladderStanding(
  clients: readonly ProgressClient[],
  byClient: ReadonlyMap<number, PackageStint[]>,
  asOf: string,
): LadderStanding {
  const counts = new Map<string, number>(PACKAGE_CODES.map((code) => [code, 0]))
  let unrecorded = 0

  for (const client of clients) {
    if (isChurned(client.status)) continue

    // currentStint already ignores a stint dated in the future: a move recorded
    // ahead of time is a plan, not the current state.
    const stint = currentStint(byClient.get(client.id) ?? [], asOf)
    if (stint === null) {
      unrecorded += 1
      continue
    }
    counts.set(stint.package_code, (counts.get(stint.package_code) ?? 0) + 1)
  }

  return {
    rungs: [...counts].map(([code, count]) => ({ code, count })),
    unrecorded,
  }
}

export type Move = {
  clientId: number
  name: string
  /** The rung they entered on. */
  from: string
  /** The highest rung reached for a climb, the lowest for a descent. */
  to: string
  /** Where they are today, when that is not `to`. Null when it is. */
  now: string | null
}

export type Movements = { climbed: Move[]; descended: Move[] }

/**
 * Who has moved, in which direction, most recent move first.
 *
 * Membership is journeyOf and nothing else, so these lists cannot come to a
 * different view from the function that defines the words. That also means
 * `from` and `to` describe the ENTRY and the EXTREME rung rather than the
 * latest one, because that is how journeyOf decides -- foundation to scale and
 * back to grow is a client who climbed. `now` exists so that reading does not
 * imply scale is current.
 *
 * Departed clients are included. A completed relationship still climbed, and
 * dropping them would make these lists a story about the current roster.
 */
export function movements(
  clients: readonly ProgressClient[],
  byClient: ReadonlyMap<number, PackageStint[]>,
  asOf: string,
): Movements {
  const climbed: { move: Move; on: string }[] = []
  const descended: { move: Move; on: string }[] = []

  for (const client of clients) {
    const stints = byClient.get(client.id) ?? []
    const journey = journeyOf(stints)
    if (journey === null || journey === 'stayed') continue

    const sorted = sortStints(stints)
    // journeyOf returned non-null, so every rung is on the ladder.
    const rungs = sorted.map((entry) => PACKAGE_CODES.indexOf(entry.package_code))
    const extreme = journey === 'climbed' ? Math.max(...rungs) : Math.min(...rungs)
    const reached = sorted[rungs.indexOf(extreme)]
    const current = currentStint(sorted, asOf)

    const move: Move = {
      clientId: client.id,
      name: client.name,
      from: sorted[0].package_code,
      to: reached.package_code,
      now:
        current === null || current.package_code === reached.package_code
          ? null
          : current.package_code,
    }
    ;(journey === 'climbed' ? climbed : descended).push({ move, on: reached.started_on })
  }

  // Most recent move first: this page is a snapshot, and who moved lately is
  // the more useful half of who moved. Two YYYY-MM-DD strings compare correctly
  // as strings, which is why nothing here parses one to order it.
  const order = (a: { move: Move; on: string }, b: { move: Move; on: string }) =>
    b.on.localeCompare(a.on) || a.move.name.localeCompare(b.move.name)

  return {
    climbed: climbed.sort(order).map((entry) => entry.move),
    descended: descended.sort(order).map((entry) => entry.move),
  }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/clients/packageProgress.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Mutate every rule, and quote each failure in your report**

Apply each, run the file, confirm the named test FAILS, then revert before the next:

| # | Mutation | Test that must fail |
|---|---|---|
| 1 | `entryRung` returns `stints[0]?.package_code ?? null` without sorting | `is the earliest stint by date, not the first row handed over` |
| 2 | `ladderStanding` filters `client.status !== 'active'` instead of `isChurned` | `counts a paused client, who is still a client` |
| 3 | `ladderStanding` drops the `isChurned` guard entirely | `does not count a client who has left` |
| 4 | `ladderStanding` counts an unrecorded client as `foundation` | `does not read an unrecorded client as Foundation` |
| 5 | `ladderStanding` skips unrecorded clients instead of counting them | `counts a client with no package recorded, rather than dropping them` |
| 6 | `ladderStanding` calls `currentStint(stints)` with no `asOf` | `reads a stint dated in the future as a plan, not the present` |
| 7 | `movements` uses `sorted[sorted.length - 1]` for `to` | `names a climb from where they entered to the highest rung reached` is unaffected — `names where a client is now when they have come back down` must fail |
| 8 | `movements` skips departed clients | `includes a client who climbed and then left` |
| 9 | `movements` sorts by name only | `puts the most recent move first` |

**If a mutation does not fail its test, the test is vacuous — fix the test, not the mutation.** Four of this project's last ten tests failed exactly this check.

- [ ] **Step 6: Commit**

```bash
git add src/clients/packageProgress.ts src/clients/packageProgress.test.ts
git commit -F - <<'MSG'
feat(clients): where each client sits on the ladder, and who has moved

The rules behind the Overview section: the rung a client entered on, the
current roster by rung, and the clients who have climbed or descended.

Two decisions worth naming. Unrecorded clients are counted beside the
three rungs rather than dropped, because clientPackages decided null is
"nobody has said" and hiding that number would undo the decision where it
is least visible. And active means NOT CHURNED, which includes paused --
a paused client is still a client and still sits on a rung.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 2: The verdict

**Files:**
- Modify: `src/revenue/tenureMath.ts` (the `LifecycleClient` split, ~line 40, and `departedRows`, ~line 161)
- Modify: `src/clients/packageProgress.ts` (append)
- Test: `src/clients/packageProgress.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `ProgressClient` and `entryRung`; `departedRows` from `../revenue/tenureMath`; `medianOf` from `../revenue/mixMath`.
- Produces: `MIN_GROUP`, `type Group`, `type Comparison`, `onRampComparison(clients, byClient)`. Task 4 renders the result.

- [ ] **Step 1: Widen `departedRows` so a narrower roster can use it**

In `src/revenue/tenureMath.ts`, replace the `LifecycleClient` declaration:

```ts
/**
 * The lifecycle columns a departure can be judged from.
 *
 * Split out of LifecycleClient in slice D: the Overview page holds the roster
 * useRetention reads, which carries no end_reason_note, and it needs exactly
 * this rule over exactly these columns. Fabricating a null note at that call
 * site would have put a lie in the data to satisfy a type.
 */
export type LifecycleBasics = {
  id: number
  name: string
  status: string
  started_on: string | null
  ended_on: string | null
}

export type LifecycleClient = LifecycleBasics & {
  end_reason_code: string | null
  end_reason_note: string | null
}
```

Then make `departedRows` generic — its body is unchanged, only the signature:

```ts
export function departedRows<T extends LifecycleBasics>(
  rows: readonly T[],
): { client: T; days: number | null }[] {
```

`DepartedRow` stays as it is: `departedRows(lifecycleClients)` still returns `{ client: LifecycleClient; days }[]`, so `Tenure.tsx` is untouched.

- [ ] **Step 2: Run the existing tenure suite to prove nothing moved**

Run: `npx vitest run src/revenue/tenureMath.test.ts src/revenue/Tenure.dom.test.tsx`
Expected: PASS, unchanged counts. A failure here means the widening changed behaviour, which it must not.

- [ ] **Step 3: Write the failing tests**

Append to `src/clients/packageProgress.test.ts`:

```ts
import { MIN_GROUP, onRampComparison } from './packageProgress'

// A departed client with a start date, an end date and a recorded entry rung.
function departed(
  id: number,
  name: string,
  rung: string,
  started_on: string,
  ended_on: string,
) {
  return {
    client: client(id, name, { status: 'former', started_on, ended_on }),
    stint: stint(id, rung, started_on),
  }
}

function comparisonOf(entries: ReturnType<typeof departed>[], extra: PackageStint[] = []) {
  return onRampComparison(
    entries.map((entry) => entry.client),
    byClient(...entries.map((entry) => entry.stint), ...extra),
  )
}

describe('onRampComparison', () => {
  it('waits until there are enough ended relationships on both sides', () => {
    const result = comparisonOf([
      departed(1, 'Acme', 'foundation', '2025-01-01', '2025-07-01'),
      departed(2, 'Beta', 'grow', '2025-01-01', '2025-04-01'),
    ])

    expect(result).toEqual({ kind: 'waiting', foundation: 1, above: 1 })
  })

  it('says Foundation stayed longer when they did', () => {
    const result = comparisonOf([
      departed(1, 'Acme', 'foundation', '2025-01-01', '2026-01-01'),
      departed(2, 'Beta', 'foundation', '2025-01-01', '2026-01-01'),
      departed(3, 'Gamma', 'foundation', '2025-01-01', '2026-01-01'),
      departed(4, 'Delta', 'grow', '2025-01-01', '2025-03-01'),
      departed(5, 'Epsilon', 'grow', '2025-01-01', '2025-03-01'),
      departed(6, 'Zeta', 'scale', '2025-01-01', '2025-03-01'),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.longer).toBe('foundation')
    expect(result.foundation.measured).toBe(3)
    expect(result.above.measured).toBe(3)
  })

  // THE TEST THIS SLICE MOST NEEDS. A verdict hard-coded to 'foundation' would
  // pass every other case in this file.
  it('says the other side stayed longer when THEY did', () => {
    const result = comparisonOf([
      departed(1, 'Acme', 'foundation', '2025-01-01', '2025-03-01'),
      departed(2, 'Beta', 'foundation', '2025-01-01', '2025-03-01'),
      departed(3, 'Gamma', 'foundation', '2025-01-01', '2025-03-01'),
      departed(4, 'Delta', 'grow', '2025-01-01', '2026-01-01'),
      departed(5, 'Epsilon', 'grow', '2025-01-01', '2026-01-01'),
      departed(6, 'Zeta', 'scale', '2025-01-01', '2026-01-01'),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.longer).toBe('above')
    expect(result.above.medianDays).toBeGreaterThan(result.foundation.medianDays)
  })

  it('calls an exact draw a tie', () => {
    const result = comparisonOf([
      departed(1, 'Acme', 'foundation', '2025-01-01', '2025-07-01'),
      departed(2, 'Beta', 'foundation', '2025-01-01', '2025-07-01'),
      departed(3, 'Gamma', 'foundation', '2025-01-01', '2025-07-01'),
      departed(4, 'Delta', 'grow', '2025-01-01', '2025-07-01'),
      departed(5, 'Epsilon', 'grow', '2025-01-01', '2025-07-01'),
      departed(6, 'Zeta', 'scale', '2025-01-01', '2025-07-01'),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.longer).toBe('tie')
  })

  it('leaves out clients who are still here', () => {
    // Three ended Foundation clients and three ACTIVE ones above. The active
    // side cannot reach MIN_GROUP, so the answer is still waiting.
    const ended = [
      departed(1, 'Acme', 'foundation', '2025-01-01', '2026-01-01'),
      departed(2, 'Beta', 'foundation', '2025-01-01', '2026-01-01'),
      departed(3, 'Gamma', 'foundation', '2025-01-01', '2026-01-01'),
    ]
    const active = [client(4, 'Delta'), client(5, 'Epsilon'), client(6, 'Zeta')]

    const result = onRampComparison(
      [...ended.map((entry) => entry.client), ...active],
      byClient(
        ...ended.map((entry) => entry.stint),
        stint(4, 'grow', '2025-01-01'),
        stint(5, 'grow', '2025-01-01'),
        stint(6, 'grow', '2025-01-01'),
      ),
    )

    expect(result).toEqual({ kind: 'waiting', foundation: 3, above: 0 })
  })

  it('leaves out a departed client with no package recorded', () => {
    const ended = [
      departed(1, 'Acme', 'foundation', '2025-01-01', '2026-01-01'),
      departed(2, 'Beta', 'foundation', '2025-01-01', '2026-01-01'),
      departed(3, 'Gamma', 'foundation', '2025-01-01', '2026-01-01'),
    ]
    const unrecorded = client(9, 'Omega', { status: 'former', ended_on: '2026-01-01' })

    const result = onRampComparison(
      [...ended.map((entry) => entry.client), unrecorded],
      byClient(...ended.map((entry) => entry.stint)),
    )

    // Omega is not silently read as "joined above Foundation".
    expect(result).toEqual({ kind: 'waiting', foundation: 3, above: 0 })
  })

  it('counts a departed client with no start date, and does not measure them', () => {
    const entries = [
      departed(1, 'Acme', 'foundation', '2025-01-01', '2026-01-01'),
      departed(2, 'Beta', 'foundation', '2025-01-01', '2026-01-01'),
      departed(3, 'Gamma', 'foundation', '2025-01-01', '2026-01-01'),
      departed(4, 'Delta', 'grow', '2025-01-01', '2025-04-01'),
      departed(5, 'Epsilon', 'grow', '2025-01-01', '2025-04-01'),
      departed(6, 'Zeta', 'grow', '2025-01-01', '2025-04-01'),
    ]
    const nostart = {
      client: { ...client(7, 'Eta', { status: 'former', ended_on: '2026-01-01' }), started_on: null },
      stint: stint(7, 'grow', '2025-01-01'),
    }

    const result = onRampComparison(
      [...entries.map((entry) => entry.client), nostart.client],
      byClient(...entries.map((entry) => entry.stint), nostart.stint),
    )

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    // In the count, out of the median: an unknown treated as a zero would drag
    // the median down, and dropping them from the count answers a different
    // question from the one the sentence appears to answer.
    expect(result.above.count).toBe(4)
    expect(result.above.measured).toBe(3)
  })

  it('groups an unrecognised entry rung above Foundation', () => {
    const result = comparisonOf([
      departed(1, 'Acme', 'foundation', '2025-01-01', '2026-01-01'),
      departed(2, 'Beta', 'foundation', '2025-01-01', '2026-01-01'),
      departed(3, 'Gamma', 'foundation', '2025-01-01', '2026-01-01'),
      departed(4, 'Delta', 'platinum', '2025-01-01', '2025-04-01'),
      departed(5, 'Epsilon', 'grow', '2025-01-01', '2025-04-01'),
      departed(6, 'Zeta', 'grow', '2025-01-01', '2025-04-01'),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.above.measured).toBe(3)
  })

  it('uses the rung they ENTERED on, not the one they left on', () => {
    // Three clients who entered at Foundation and climbed out of it before
    // leaving. Grouping by the latest rung would put all three in `above` and
    // leave Foundation empty.
    const result = comparisonOf(
      [
        departed(1, 'Acme', 'foundation', '2025-01-01', '2026-01-01'),
        departed(2, 'Beta', 'foundation', '2025-01-01', '2026-01-01'),
        departed(3, 'Gamma', 'foundation', '2025-01-01', '2026-01-01'),
        departed(4, 'Delta', 'grow', '2025-01-01', '2025-04-01'),
        departed(5, 'Epsilon', 'grow', '2025-01-01', '2025-04-01'),
        departed(6, 'Zeta', 'grow', '2025-01-01', '2025-04-01'),
      ],
      [stint(1, 'scale', '2025-06-01'), stint(2, 'scale', '2025-06-01'), stint(3, 'scale', '2025-06-01')],
    )

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.foundation.measured).toBe(3)
    expect(result.above.measured).toBe(3)
  })

  it('names the threshold once, where the rule and the sentence both read it', () => {
    expect(MIN_GROUP).toBe(3)
  })
})
```

- [ ] **Step 4: Run the tests and watch them fail**

Run: `npx vitest run src/clients/packageProgress.test.ts`
Expected: FAIL — `onRampComparison is not a function`.

- [ ] **Step 5: Write the rule**

Append to `src/clients/packageProgress.ts`, and add `import { medianOf } from '../revenue/mixMath'` and `import { departedRows } from '../revenue/tenureMath'` at the top:

```ts
/**
 * How many measured relationships each side needs before a median is printed.
 *
 * Three, set by the owner on 2026-09-24: low enough that the sentence can
 * appear within a few months of the history being recorded, high enough that
 * one unusual departure cannot set a median by itself. Exported so the rule and
 * the sentence describing it cannot drift apart.
 */
export const MIN_GROUP = 3

export type Group = {
  /** Everybody in the group, including those with no start date. */
  count: number
  /** How many of them could actually be measured. */
  measured: number
  medianDays: number
}

export type Comparison =
  | { kind: 'waiting'; foundation: number; above: number }
  | {
      kind: 'ready'
      foundation: Group
      above: Group
      longer: 'foundation' | 'above' | 'tie'
    }

/**
 * Whether clients who joined at Foundation stayed longer than clients who
 * joined above it.
 *
 * THIS IS NOT THE COMPARISON THAT WAS ASKED FOR, and spec section 1 is the
 * argument. The question as put pairs clients who signed at Foundation AND
 * graduated against everyone who joined above Foundation -- so the first group
 * holds only the on-ramp's successes while the second holds winners and losers
 * alike, and it would report Foundation as the stronger on-ramp whatever the
 * truth is. Both groups are therefore fixed at the moment the client signed:
 * nothing that happens afterwards can move anybody between them.
 *
 * NO asOf PARAMETER. Every relationship here has ended and is measured to the
 * day it ended, so no clock changes an answer. Slice C removed exactly such a
 * parameter from clientMix rather than leave it unused, so that a future caller
 * could not supply a date under the impression it changed something.
 *
 * departedRows is reused rather than refiltered: it already decides who has
 * left, already measures to the day they left rather than to today, and already
 * returns null days when a date is missing. Three chances for this section and
 * the Tenure report to disagree, removed.
 */
export function onRampComparison(
  clients: readonly ProgressClient[],
  byClient: ReadonlyMap<number, PackageStint[]>,
): Comparison {
  const recorded = clients.filter((client) => (byClient.get(client.id) ?? []).length > 0)

  const days: { foundation: (number | null)[]; above: (number | null)[] } = {
    foundation: [],
    above: [],
  }

  for (const row of departedRows(recorded)) {
    const rung = entryRung(byClient.get(row.client.id) ?? [])
    if (rung === null) continue
    days[rung === 'foundation' ? 'foundation' : 'above'].push(row.days)
  }

  // Counted and measured are not the same number -- the distinction
  // tenureMath.summarise already documents. A departed client with no start
  // date is IN the group and OUT of the median: treating the unknown as a zero
  // would drag the median down, and dropping them from the count would answer a
  // different question from the one the sentence appears to answer.
  function group(all: readonly (number | null)[]) {
    const measured = all.filter((value): value is number => value !== null)
    return { count: all.length, measured: measured.length, medianDays: medianOf(measured) }
  }

  const foundation = group(days.foundation)
  const above = group(days.above)

  // MIN_GROUP gates on the MEASURED count, since that is what the median rests
  // on. The null checks are narrowing rather than defence: medianOf returns null
  // only for an empty list, which measured >= MIN_GROUP already excludes.
  if (
    foundation.measured < MIN_GROUP ||
    above.measured < MIN_GROUP ||
    foundation.medianDays === null ||
    above.medianDays === null
  ) {
    return { kind: 'waiting', foundation: foundation.measured, above: above.measured }
  }

  return {
    kind: 'ready',
    foundation: { ...foundation, medianDays: foundation.medianDays },
    above: { ...above, medianDays: above.medianDays },
    longer:
      foundation.medianDays === above.medianDays
        ? 'tie'
        : foundation.medianDays > above.medianDays
          ? 'foundation'
          : 'above',
  }
}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run src/clients/packageProgress.test.ts`
Expected: PASS, 25 tests.

- [ ] **Step 7: Mutate, and quote each failure**

| # | Mutation | Test that must fail |
|---|---|---|
| 1 | `longer` hard-coded to `'foundation'` | `says the other side stayed longer when THEY did` |
| 2 | `MIN_GROUP` changed to `1` | `waits until there are enough ended relationships on both sides` |
| 3 | The `recorded` filter removed | `leaves out a departed client with no package recorded` |
| 4 | `departedRows(recorded)` replaced with all of `recorded` | `leaves out clients who are still here` |
| 5 | `group` filters nulls out of `count` as well as the median | `counts a departed client with no start date, and does not measure them` |
| 6 | `group` maps a null day to `0` instead of dropping it | `counts a departed client with no start date, and does not measure them` |
| 7 | Grouping reads `currentStint` instead of `entryRung` | `uses the rung they ENTERED on, not the one they left on` |
| 8 | The gate reads `foundation.count` instead of `foundation.measured` | `counts a departed client with no start date, and does not measure them` — if it does not, add a case where a group's count clears MIN_GROUP and its measured count does not |

- [ ] **Step 8: Commit**

```bash
git add src/revenue/tenureMath.ts src/clients/packageProgress.ts src/clients/packageProgress.test.ts
git commit -F - <<'MSG'
feat(clients): whether the Foundation on-ramp holds clients longer

Both groups are fixed at the moment the client signed -- joined at
Foundation, or joined above it -- and only relationships that have ended
are measured.

That is deliberately not the comparison that was asked for. The question
as put pairs clients who signed at Foundation AND graduated against
everyone who joined above Foundation, so one group holds only the
on-ramp's successes and the other holds winners and losers alike; it
would report Foundation as the stronger on-ramp whatever the truth is.
Defining both groups at signing means nothing that happens afterwards can
move a client between them.

departedRows is reused rather than refiltered, which needed its parameter
type split: LifecycleClient demands an end_reason_note the Overview
roster does not carry, and fabricating a null one would have put a lie in
the data to satisfy a type.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 3: The read

**Files:**
- Create: `src/clients/usePackages.ts`
- Test: `src/clients/usePackages.dom.test.ts`

**Interfaces:**
- Consumes: `PACKAGE_COLUMNS`, `PackageStint` from `./clientPackages`; `supabase` from `../lib/supabase`; `describeError` from `../lib/errorText`.
- Produces: `usePackages(enabled: boolean): { status, loadError, byClient }` where `byClient` is `Map<number, PackageStint[]>`. Task 4 mounts it.

- [ ] **Step 1: Write the failing test**

Create `src/clients/usePackages.dom.test.ts`:

```ts
// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

import { usePackages } from './usePackages'
import { supabase } from '../lib/supabase'

function resolving(result: unknown) {
  const order = vi.fn().mockResolvedValue(result)
  const select = vi.fn(() => ({ order }))
  vi.mocked(supabase.from).mockReturnValue({ select } as never)
  return { select, order }
}

function rejecting() {
  const order = vi.fn().mockRejectedValue(new Error('network down'))
  const select = vi.fn(() => ({ order }))
  vi.mocked(supabase.from).mockReturnValue({ select } as never)
  return { select, order }
}

const STINT = {
  id: 1,
  client_id: 7,
  package_code: 'foundation',
  started_on: '2025-01-01',
  note: null,
}

beforeEach(() => {
  vi.mocked(supabase.from).mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('usePackages', () => {
  it('groups the stints by client', async () => {
    resolving({ data: [STINT, { ...STINT, id: 2, package_code: 'grow' }], error: null })

    const { result } = renderHook(() => usePackages(true))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.byClient.get(7)?.length).toBe(2)
  })

  // GATED AT THE READ, NOT THE RENDER. Hiding a figure that was already
  // fetched is not a permission check.
  it('issues no query at all when it is not enabled', async () => {
    const { select } = resolving({ data: [STINT], error: null })

    const { result } = renderHook(() => usePackages(false))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(supabase.from).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    expect(result.current.byClient.size).toBe(0)
  })

  it('reports a refused read rather than rendering it as no packages', async () => {
    resolving({ data: null, error: { message: 'permission denied for table client_packages' } })

    const { result } = renderHook(() => usePackages(true))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.loadError).toBeTruthy()
    expect(result.current.byClient.size).toBe(0)
  })

  // A REJECTED promise, not a resolved { data, error }. Without the try/catch
  // this escapes the effect as an unhandled rejection and the hook hangs in
  // 'loading' -- the exact defect found in useClientRates on slice 6l.
  it('lands on error when the request rejects outright', async () => {
    rejecting()

    const { result } = renderHook(() => usePackages(true))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.loadError).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/clients/usePackages.dom.test.ts`
Expected: FAIL — `Failed to resolve import "./usePackages"`.

- [ ] **Step 3: Write the hook**

Create `src/clients/usePackages.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { describeError } from '../lib/errorText'
import { supabase } from '../lib/supabase'
import { PACKAGE_COLUMNS } from './clientPackages'
import type { PackageStint } from './clientPackages'

// Every client's package history, for a screen that only reads it.
//
// NOT useClients, though that hook already selects these columns. It carries
// add, edit and two write paths for a screen that writes; a read-only section
// inheriting all of it would be coupled to every future change made for the
// admin screen's benefit. useTenure gives the same reason about itself.
//
// GATED AT THE READ, NOT THE RENDER. client_packages is select-gated on
// manage_clients in RLS, and `enabled` is false for anyone without it, so no
// query is issued at all -- hiding rows that were already fetched is not a
// permission check. The same arrangement useClientRates has.

export type UsePackages = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  byClient: Map<number, PackageStint[]>
}

export function usePackages(enabled: boolean): UsePackages {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    enabled ? 'loading' : 'ready',
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [byClient, setByClient] = useState<Map<number, PackageStint[]>>(new Map())

  const load = useCallback(
    async (isCancelled: () => boolean) => {
      if (!enabled) return
      setStatus('loading')

      // A REJECTED promise -- a genuine network failure rather than a resolved
      // { data, error } -- must not escape this effect as an unhandled
      // rejection, leaving the hook in 'loading' forever. useClientRates
      // shipped without this guard and it had to be added back.
      try {
        const { data, error } = await supabase
          .from('client_packages')
          .select(PACKAGE_COLUMNS)
          .order('started_on')

        if (isCancelled()) return

        if (error) {
          // Reported, never fallen through to an empty map: a failed read that
          // renders as "no packages recorded" is this project's oldest defect,
          // a broken tool looking like an empty one.
          setLoadError(describeError(error))
          setStatus('error')
          return
        }

        const grouped = new Map<number, PackageStint[]>()
        for (const stint of (data ?? []) as PackageStint[]) {
          const found = grouped.get(stint.client_id) ?? []
          found.push(stint)
          grouped.set(stint.client_id, found)
        }

        setByClient(grouped)
        setLoadError(null)
        setStatus('ready')
      } catch (thrown: unknown) {
        if (isCancelled()) return
        setLoadError(describeError(thrown))
        setStatus('error')
      }
    },
    [enabled],
  )

  useEffect(() => {
    // A fresh flag per run, marked cancelled on unmount, so a slow response
    // cannot resolve into a torn-down tree. useBoard explains the same guard.
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load])

  return { status, loadError, byClient }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/clients/usePackages.dom.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Mutate**

| # | Mutation | Test that must fail |
|---|---|---|
| 1 | Delete `if (!enabled) return` from `load` | `issues no query at all when it is not enabled` |
| 2 | Initialise `status` to `'loading'` unconditionally | `issues no query at all when it is not enabled` (it never reaches 'ready') |
| 3 | Replace the `if (error)` branch with `setByClient(new Map())` and `setStatus('ready')` | `reports a refused read rather than rendering it as no packages` |
| 4 | Remove the `try`/`catch` | `lands on error when the request rejects outright` |

- [ ] **Step 6: Commit**

```bash
git add src/clients/usePackages.ts src/clients/usePackages.dom.test.ts
git commit -F - <<'MSG'
feat(clients): a read-only view of every client's package history

Its own hook rather than useClients, which carries two write paths a
read-only section has no business mounting, and gated at the query rather
than at the render: client_packages is select-gated on manage_clients in
RLS, so a viewer without it issues no request at all. Hiding rows that
were already fetched is not a permission check.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 4: The section on the page

**Files:**
- Modify: `src/shell/Overview.tsx`
- Modify: `src/shell/Overview.module.css`
- Modify: `src/shell/Overview.dom.test.tsx`
- Modify: `src/shell/Shell.tsx:108`
- Modify: `tests/overviewProvenance.test.ts`

**Interfaces:**
- Consumes: Task 1's `ladderStanding`, `movements`, Task 2's `MIN_GROUP`, `onRampComparison`, `Comparison`; Task 3's `usePackages`; `packageLabel` from `../clients/clientPackages`; `can` from `../lib/capabilities`; `formatTenure`, `todayISO` from `../revenue/tenureMath`.
- Produces: `<Overview role={string} />`.

- [ ] **Step 1: Give Overview its prop and mount the read**

In `src/shell/Overview.tsx`, add the imports and change the signature:

```tsx
import { packageLabel } from '../clients/clientPackages'
import { MIN_GROUP, ladderStanding, movements, onRampComparison } from '../clients/packageProgress'
import type { Comparison } from '../clients/packageProgress'
import { usePackages } from '../clients/usePackages'
import { can } from '../lib/capabilities'
import { formatTenure, todayISO } from '../revenue/tenureMath'

export function Overview({ role }: { role: string }) {
  const revenue = useRetention()
  const board = useBoard(defaultPeriod())

  // BOTH gates, and both are load-bearing. client_packages is select-gated on
  // manage_clients in RLS, so drawing this section for anyone else would render
  // an empty ladder that reads as "nobody has a package recorded" -- a
  // different and false statement.
  const maySeePackages = can(role, 'manage_clients')
  const packages = usePackages(maySeePackages)
  ...
```

**Leave the existing `status` composition exactly as it is.** `packages` must not join it — see Step 3.

In `src/shell/Shell.tsx:108`, change `return <Overview />` to `return <Overview role={profile.role} />`.

- [ ] **Step 2: Write the sentence builder and the section**

Add above the component in `Overview.tsx`:

```tsx
// The verdict, in the shape slice C established: a finding stated as a
// sentence, naming its population, and capable of coming out the other way.
function verdictSentence(comparison: Extract<Comparison, { kind: 'ready' }>): string {
  const atFoundation = formatTenure(comparison.foundation.medianDays)
  const above = formatTenure(comparison.above.medianDays)
  const basis = `from ${comparison.foundation.measured} and ${comparison.above.measured} ended relationships`
  const opening = 'Of the relationships that have ended with a package recorded, those who joined'

  if (comparison.longer === 'tie') {
    return `${opening} at Foundation and those who joined above it stayed the same: a median of ${atFoundation} each — ${basis}.`
  }
  if (comparison.longer === 'foundation') {
    return `${opening} at Foundation stayed longer: a median of ${atFoundation}, against ${above} for those who joined above it — ${basis}.`
  }
  return `${opening} above Foundation stayed longer: a median of ${above}, against ${atFoundation} for those who joined at Foundation — ${basis}.`
}
```

Inside the component, after the existing `attention` list and before the closing `</section>`:

```tsx
{maySeePackages && (
  <>
    <h3 className="t-subhead">Moving up the ladder</h3>

    {packages.status === 'loading' && <p className="t-body">Loading…</p>}

    {/* A failure here says so and stops there. It does NOT join the page's
        status: a secondary section must never be able to hide the clients who
        need attention, which is what this page is for. */}
    {packages.status === 'error' && (
      <p className="alert prose" role="alert">
        {packages.loadError}
      </p>
    )}

    {packages.status === 'ready' && (
      <>
        <ul aria-label="Clients by package" className={styles.rungs} role="list">
          {standing.rungs.map((rung) => (
            <li className={styles.rung} key={rung.code}>
              <span className="t-body">{packageLabel(rung.code)}</span>
              <span className="t-body" data-testid={`rung-${rung.code}`}>
                {rung.count}
              </span>
            </li>
          ))}
          <li className={styles.rung} key="unrecorded">
            <span className="t-body">{packageLabel(null)}</span>
            <span className="t-body" data-testid="rung-unrecorded">
              {standing.unrecorded}
            </span>
          </li>
        </ul>

        {moved.climbed.length === 0 && moved.descended.length === 0 && (
          <p className="t-body prose">No client has changed package yet.</p>
        )}

        {moved.climbed.length > 0 && (
          <>
            <p className={`t-caption ${styles.basis}`}>Moved up</p>
            <ul aria-label="Moved up" className={styles.list} role="list">
              {moved.climbed.map((move) => (
                <li aria-label={move.name} className={styles.row} key={move.clientId}>
                  <span className="t-body">{move.name}</span>
                  <span className={`t-caption ${styles.why}`}>
                    {packageLabel(move.from)} → {packageLabel(move.to)}
                    {move.now !== null && `, now ${packageLabel(move.now)}`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {moved.descended.length > 0 && (
          <>
            <p className={`t-caption ${styles.basis}`}>Moved down</p>
            <ul aria-label="Moved down" className={styles.list} role="list">
              {moved.descended.map((move) => (
                <li aria-label={move.name} className={styles.row} key={move.clientId}>
                  <span className="t-body">{move.name}</span>
                  <span className={`t-caption ${styles.why}`}>
                    {packageLabel(move.from)} → {packageLabel(move.to)}
                    {move.now !== null && `, now ${packageLabel(move.now)}`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {comparison.kind === 'waiting' ? (
          <p className="t-body prose" data-testid="onramp-verdict">
            Whether clients who join at Foundation stay longer is not answerable yet. It needs{' '}
            {MIN_GROUP} ended relationships on each side with a package recorded, and there are{' '}
            {comparison.foundation} and {comparison.above}. Recording the package history of
            clients who have already left is what answers it.
          </p>
        ) : (
          <>
            <p className="t-body prose" data-testid="onramp-verdict">
              {verdictSentence(comparison)}
            </p>
            <p className={`t-caption ${styles.basis}`} data-testid="onramp-basis">
              Clients brought in by the 2026 import have a start date of their first invoice
              month rather than the day they signed, so tenure understates — unevenly, and not
              necessarily equally between the two groups.
              {unmeasured > 0 &&
                ` ${unmeasured} ended relationships have no start date and are counted but not measured.`}
            </p>
          </>
        )}
      </>
    )}
  </>
)}
```

And the values it reads, computed beside `attention`:

```tsx
const asOf = todayISO()
const standing = ladderStanding(revenue.clients, packages.byClient, asOf)
const moved = movements(revenue.clients, packages.byClient, asOf)
const comparison = onRampComparison(revenue.clients, packages.byClient)
const unmeasured =
  comparison.kind === 'ready'
    ? comparison.foundation.count -
      comparison.foundation.measured +
      (comparison.above.count - comparison.above.measured)
    : 0
```

- [ ] **Step 3: Add the CSS**

Append to `src/shell/Overview.module.css`:

```css
/* The rungs, as a row of labelled counts. Wraps rather than scrolls: this page
   is a reading measure, and a horizontal scrollbar on four short pairs would be
   a control nobody needs. */
.rungs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.rung {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--rule-hairline);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}
```

- [ ] **Step 4: Write the DOM tests**

In `src/shell/Overview.dom.test.tsx`, add the mock and extend `given`. `within` joins the existing
`@testing-library/react` import, because two lists on this page now carry rows with the same
accessible names:

```tsx
import { render, screen, within } from '@testing-library/react'

vi.mock('../clients/usePackages', () => ({ usePackages: vi.fn() }))
import { usePackages } from '../clients/usePackages'
```

Change `given` to take a role and package state, and to render `<Overview role={role} />`:

```tsx
function stint(client_id: number, package_code: string, started_on: string) {
  return { id: client_id * 100 + Number(started_on.slice(2, 4)), client_id, package_code, started_on, note: null }
}

function given(
  over: {
    board?: unknown
    revenue?: unknown
    packages?: unknown
    role?: string
  } = {},
) {
  // ...existing useRetention and useBoard mocks, unchanged...
  vi.mocked(usePackages).mockReturnValue({
    status: 'ready',
    loadError: null,
    byClient: new Map(),
    ...(over.packages as object),
  } as ReturnType<typeof usePackages>)
  return render(<Overview role={over.role ?? 'admin'} />)
}
```

Add to the existing `beforeEach`: `vi.mocked(usePackages).mockReset()`.

Then the tests:

```tsx
describe('the ladder', () => {
  it('counts the roster by rung, and says how many are unrecorded', () => {
    given({
      packages: {
        byClient: new Map([[1, [stint(1, 'grow', '2025-01-01')]]]),
      },
    })

    expect(screen.getByTestId('rung-grow').textContent).toBe('1')
    expect(screen.getByTestId('rung-foundation').textContent).toBe('0')
    // Beta has no stint, and is counted as unrecorded rather than dropped.
    expect(screen.getByTestId('rung-unrecorded').textContent).toBe('1')
  })

  it('names a client who has climbed, and the move', () => {
    given({
      packages: {
        byClient: new Map([
          [1, [stint(1, 'foundation', '2025-01-01'), stint(1, 'grow', '2026-01-01')]],
        ]),
      },
    })

    // SCOPED to the climbers list on purpose. Acme is also 70% of revenue, so
    // it has a row in the attention list above with the same accessible name,
    // and an unscoped query matches both and throws.
    const climbers = within(screen.getByRole('list', { name: 'Moved up' }))
    const row = climbers.getByRole('listitem', { name: 'Acme' })
    expect(row.textContent).toContain('Foundation')
    expect(row.textContent).toContain('Grow')
  })

  it('says when nobody has moved', () => {
    given()

    expect(screen.getByText(/no client has changed package yet/i)).toBeTruthy()
  })

  it('refuses the verdict until both sides have enough ended relationships', () => {
    given()

    expect(screen.getByTestId('onramp-verdict').textContent).toMatch(/not answerable yet/i)
    expect(screen.getByTestId('onramp-verdict').textContent).toContain('3')
  })

  it('states the verdict when it can, naming both medians and the sample', () => {
    const departed = (id: number, name: string, ended_on: string) => ({
      id,
      name,
      status: 'former',
      started_on: '2025-01-01',
      ended_on,
      end_reason_code: null,
    })

    given({
      revenue: {
        clients: [
          departed(1, 'Acme', '2026-01-01'),
          departed(2, 'Beta', '2026-01-01'),
          departed(3, 'Gamma', '2026-01-01'),
          departed(4, 'Delta', '2025-03-01'),
          departed(5, 'Epsilon', '2025-03-01'),
          departed(6, 'Zeta', '2025-03-01'),
        ],
        rows: [],
      },
      packages: {
        byClient: new Map([
          [1, [stint(1, 'foundation', '2025-01-01')]],
          [2, [stint(2, 'foundation', '2025-01-01')]],
          [3, [stint(3, 'foundation', '2025-01-01')]],
          [4, [stint(4, 'grow', '2025-01-01')]],
          [5, [stint(5, 'grow', '2025-01-01')]],
          [6, [stint(6, 'grow', '2025-01-01')]],
        ]),
      },
    })

    const verdict = screen.getByTestId('onramp-verdict').textContent ?? ''
    expect(verdict).toMatch(/joined at Foundation stayed longer/i)
    expect(verdict).toContain('from 3 and 3 ended relationships')
  })

  // BOTH GATES. Deleting either must fail.
  it('is absent entirely for somebody who cannot read packages', () => {
    given({ role: 'viewer' })

    expect(screen.queryByText(/moving up the ladder/i)).toBeNull()
    expect(screen.queryByTestId('rung-unrecorded')).toBeNull()
  })

  it('does not ask for packages it may not read', () => {
    given({ role: 'viewer' })

    expect(vi.mocked(usePackages)).toHaveBeenCalledWith(false)
  })

  // The degradation rule: a failed secondary read must not blank the page.
  it('reports a failed package read and still shows what needs attention', () => {
    given({
      packages: { status: 'error', loadError: 'permission denied for table client_packages' },
    })

    expect(screen.getByRole('alert').textContent).toContain('permission denied')
    // Acme is 70% of revenue and must still be listed.
    expect(screen.getByRole('listitem', { name: 'Acme' })).toBeTruthy()
  })

  it('does not make the attention list wait for the packages', () => {
    given({ packages: { status: 'loading' } })

    expect(screen.getByRole('listitem', { name: 'Acme' })).toBeTruthy()
  })
})
```

- [ ] **Step 5: Run the Overview and Shell suites**

Run: `npx vitest run src/shell/`
Expected: PASS. `Shell.dom.test.tsx` may fail on an unmocked `usePackages` — if it does, add `vi.mock('../clients/usePackages', () => ({ usePackages: () => ({ status: 'ready', loadError: null, byClient: new Map() }) }))` to it, the same way it already mocks the other reads.

- [ ] **Step 6: Update the provenance test deliberately**

In `tests/overviewProvenance.test.ts`, replace the final `it` block:

```ts
  // Slice D, 2026-09-24. The assertion that used to stand here forbade any
  // mention of Foundation, with a note that progression "needs a schema change.
  // When it arrives it belongs here, and this assertion should be the thing
  // that gets updated." The schema arrived on 2026-09-12 and this is that
  // update -- not a weakening, but the same pinning applied to the contents
  // that are now sourced.
  it('shows the ladder the owner\'s boss asked for', () => {
    expect(CODE).toContain('ladderStanding')
    expect(CODE).toContain('onRampComparison')
  })

  // The climbers list came from the call. The DESCENTS list did not: it is the
  // spec's own proposal, approved by the owner on 2026-09-24, and recorded here
  // so that the trail stays honest about which contents were asked for.
  it('records that the descents list was proposed, not requested', () => {
    expect(SOURCE).toMatch(/proposal|proposed/i)
    expect(CODE).toContain('descended')
  })

  it('has still not grown contents nobody asked for', () => {
    expect(CODE).not.toMatch(/lead ?source/i)
  })
```

The second assertion needs the comment it is checking for. Add above the descents list in `Overview.tsx`:

```tsx
{/* The descents list is this section's one proposal rather than a request.
    The owner's boss asked to see who climbs; showing only promotions makes
    this page flatter the roster, and a client stepping DOWN the ladder is
    closer to what this page is for. Approved by the owner, 2026-09-24. */}
```

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run --exclude '**/rls.test.ts'`
Expected: PASS, and the count should have risen by roughly 38 from 1693.

- [ ] **Step 8: Mutate**

| # | Mutation | Test that must fail |
|---|---|---|
| 1 | Render the section without the `maySeePackages &&` guard | `is absent entirely for somebody who cannot read packages` |
| 2 | Call `usePackages(true)` unconditionally | `does not ask for packages it may not read` |
| 3 | Fold `packages.status` into the page's `status` composition | `reports a failed package read and still shows what needs attention` |
| 4 | Drop the `packages.status === 'error'` branch | `reports a failed package read and still shows what needs attention` |
| 5 | Hard-code `verdictSentence` to the `'foundation'` wording | Nothing here — **add a DOM case where `above` wins** if the Task 2 unit test is the only thing covering it |
| 6 | Remove the `rung-unrecorded` list item | `counts the roster by rung, and says how many are unrecorded` |

- [ ] **Step 9: Commit**

```bash
git add src/shell/Overview.tsx src/shell/Overview.module.css src/shell/Overview.dom.test.tsx src/shell/Shell.tsx tests/overviewProvenance.test.ts
git commit -F - <<'MSG'
feat(overview): the package ladder, and who is climbing it

Where the roster sits by rung with the unrecorded count beside it, who
has moved in each direction, and one sentence on whether joining at
Foundation goes with staying longer -- or, until both sides have three
ended relationships recorded, what it is waiting for.

Two gates, because client_packages is select-gated on manage_clients:
the section is not drawn, and the query is not issued.

A failed package read no longer joins the page's status. A secondary
section must never be able to hide the clients who need attention, which
is the only reason this page exists.

The provenance test's Foundation assertion is deleted on purpose -- its
own comment said this is the change that should delete it -- and replaced
with one pinning the contents that are now sourced, including that the
descents list was proposed here rather than asked for.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 5: The landing moves to Overview

**Files:**
- Modify: `src/shell/destination.ts:93`
- Modify: `src/shell/Shell.dom.test.tsx:140`

**Interfaces:** Consumes nothing new. Changes the value of `LANDING`.

- [ ] **Step 1: Change the failing test first**

In `src/shell/Shell.dom.test.tsx`, replace the `lands on Clients` test:

```tsx
  // Slice 6a section 3.1 made this conditional: Clients "until Overview has
  // content, and moves to Overview in the slice that gives it content."
  // Overview was filled on 2026-09-11 and the landing did not move with it.
  it('lands on Overview', () => {
    renderShell()
    expect(screen.getByRole('heading', { name: /needs attention/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('lands somewhere every role can actually use', () => {
    // A viewer reads neither revenue nor packages and still has a page: the
    // at-risk list is drawn from scores, which is the one thing they can read.
    renderShell('viewer')
    expect(screen.getByRole('heading', { name: /needs attention/i })).toBeTruthy()
  })
```

Check `renderShell`'s signature at the top of that file and pass the role the way it already expects.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/shell/Shell.dom.test.tsx`
Expected: FAIL — the board renders, not Overview.

- [ ] **Step 3: Move the landing**

In `src/shell/destination.ts`, replace `LANDING` and the comment above it:

```ts
// Spec 6a section 3.1 said Overview "is the homepage and WILL be the landing
// destination", but not while it was still empty -- making an empty page the
// first thing every person sees was the reason this pointed at Clients. It was
// filled on 2026-09-11 and this did not move with it.
//
// Moved in slice D, 2026-09-24. Recorded against the fold into the company's
// other tool, which will bring its own home screen and probably discard this
// line: five lines and a test against a cost paid every time the page's primary
// reader signs in and has to navigate away from where he landed.
export const LANDING: Destination = { kind: 'overview' }
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/shell/Shell.dom.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run --exclude '**/rls.test.ts'`
Expected: PASS. Any other test that assumed the board renders first will fail here — fix those by navigating explicitly rather than by reverting the landing.

- [ ] **Step 6: Mutate**

Revert `LANDING` to `{ kind: 'clients' }`. `lands on Overview` must fail. Restore.

- [ ] **Step 7: Commit**

```bash
git add src/shell/destination.ts src/shell/Shell.dom.test.tsx
git commit -F - <<'MSG'
feat(shell): sign in and land on Overview

Slice 6a made this conditional -- Clients "until Overview has content, and
moves to Overview in the slice that gives it content." Overview was filled
on 2026-09-11 and the landing did not move with it, so the page built for
its primary reader is a page he has had to navigate to every time.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 6: Verify the branch, then show the owner

**Files:** none.

- [ ] **Step 1: Lint, types and build**

```bash
npm run lint && npx tsc -b && npm run build
```
Expected: three clean exit codes. **Tests and lint passing is not a clean build** — this project has claimed that in a commit message while `tsc` was failing.

- [ ] **Step 2: Run CI's own command, with the local env moved aside**

```bash
mv .env.local .env.local.off && npx vitest run --exclude '**/rls.test.ts'; mv .env.local.off .env.local
```
Expected: PASS. CI has no `VITE_` variables at all, and `src/lib/supabase.ts` throws at module scope without them — a suite that is green only because `.env.local` exists is not green.

- [ ] **Step 3: Review the whole branch, not the tasks**

Run a review over the complete diff against `main`. Task-scoped reviews cannot see the class of bug that matters here: on slice 6f-3 the whole-branch review found an axis built from entered months only, which three task reviews had passed.

- [ ] **Step 4: Show the owner, in staging, before proposing a merge**

```bash
npm run dev
```
Then `http://localhost:5173/tgc-client-health/` — it opens on Overview now.

**Tell him what the screen should show before he opens it**, because a correct blank reads as a bug otherwise. With `client_packages` empty, which it is as of 2026-09-24:

- the ladder reads Foundation 0, Grow 0, Scale 0, and **No package recorded** equal to the number of active clients
- both movement lists are absent, replaced by "No client has changed package yet."
- the verdict is in its waiting state, reading 0 and 0

**That is the whole section correct and empty.** The data is entered by hand and nobody has used the editor since it shipped. What needs his eyes is layout, which no test in this repository can see: that the rung counts sit on one line and wrap rather than scroll, that a movement row's name and its move do not end up a screen apart, and that the section reads as part of the page rather than pasted below it.

---

## Self-Review

**Spec coverage.** §1's redefinition of the question → Task 2 Step 5 (`onRampComparison`) and its module comment. §2.1's rungs and unrecorded count → Task 1 (`ladderStanding`), Task 4 Step 2. §2.2's two lists, the entry→extreme rule and the "now" clause → Task 1 (`movements`), Task 4 Step 2; the provenance note that descents were proposed → Task 4 Step 6. §2.3's verdict, its printed sample, its waiting state and its caveat → Task 2, Task 4 Step 2 (`verdictSentence`, `onramp-basis`). §3.1–§3.4's four rules → Tasks 1 and 2, each with its own mutation table. §4's file layout → the File Structure table. §4.1's two gates → Task 3 Step 3, Task 4 Steps 1 and 8. §4.2's degradation rule → Task 4 Steps 2 and 8. §5's landing → Task 5. §7's mutation list → the four tables, which cover every entry in it. §8's out-of-scope items are absent, as intended.

**Placeholders.** None: every code step carries its code, every test step its test, every run step its command and expected result. The one deliberate open instruction is Task 4 Step 8 mutation 5, which tells the implementer to add a DOM case if the existing one does not fail — that is a judgement the mutation result decides, not a gap.

**Type consistency.** `ProgressClient` is defined in Task 1 and consumed under that name in Task 2. `LifecycleBasics` is introduced in Task 2 Step 1 and is what `ProgressClient` structurally matches. `byClient: ReadonlyMap<number, PackageStint[]>` is the parameter name and type in all four rules, and `usePackages` returns `byClient` as a `Map`, which satisfies it. `Comparison`'s two arms are destructured in Task 4 exactly as Task 2 declares them — `comparison.foundation` is a number in the `waiting` arm and a `Group` in the `ready` arm, and the JSX reads each only inside its own branch. `MIN_GROUP` is declared once in Task 2 and read by Task 4's waiting sentence.

**One thing left deliberately open.** Task 4 Step 5 does not promise `Shell.dom.test.tsx` passes untouched; it says to look, and what to add if it does not. A plan that asserted an existing suite is unaffected by a new mounted hook would be asserting something it cannot know.
