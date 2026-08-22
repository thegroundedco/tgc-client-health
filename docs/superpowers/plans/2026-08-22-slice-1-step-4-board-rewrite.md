# Slice 1 Step 4 — The Board Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `Score all 3s` and make each client card carry the answer to "did my save
work?" — a total, a band, five pillar bars, and a footer that names when and by whom.

**Architecture:** Board's inline read moves behind `useBoard`, mirroring `useCheckin`. The card
becomes its own component. All text decisions — the footer, the progress line — move into pure
functions in `cardSummary.ts` so they are testable in the node environment. After this step the
board performs **no writes at all**: every write goes through the check-in screen.

**Tech Stack:** React 19 + Vite + TypeScript, Supabase JS 2, Vitest 4 (node by default, jsdom
per-file via `// @vitest-environment jsdom`), `@testing-library/react` + `user-event`.

**Spec:** `docs/superpowers/specs/2026-08-21-phase-1-slice-1-design.md`, §6 primarily, with
§5.1 (navigation, already built in step 3) and §10 item 7 (the profiles policy blocker).

## Global Constraints

- **`npm test` does not typecheck.** Run `npm run build` separately before believing anything is
  green. Vitest can be fully green while `tsc` fails.
- **Do not write a sentence you have not verified.** If this plan asks you to write a comment or
  a document claiming something you cannot check, stop and report it instead of writing it. Three
  brief errors were caught this way in step 3; seventeen false claims were not caught in time.
  **A comment that defines what a state or value MEANS is the highest-risk comment in a file.**
- **No literal colours anywhere under `src/`**, comments included. `tests/tokens.test.ts` fails
  the build on any hex, any `rgb()`/`hsl()`, any CSS named colour, the `font:` shorthand, JSX
  camelCase inline styles, or a `font-family` that is not a lone `var()`. Only `tokens.css` is
  exempt. Reference semantic tokens; add one to `tokens.css` if a needed meaning is missing.
- **No database writes, and no running database commands.** This step removes the board's only
  write. Do not run `npm run db:push`, `verify:privileges`, or `verify:score`.
- **Every new guard must be proved able to fail.** Delete the thing it guards, watch it go red,
  restore. A test that still passes when its subject is deleted is worth nothing.
- **When a symptom will not reproduce in the harness, test the mechanism that must be true for
  the symptom to occur** — and say so in the test file rather than letting a passing
  symptom-level test imply it caught something.
- **Read the number off the run.** Never write a test count, a passing count or a file count you
  have not just read from the terminal.

---

## Decisions taken before this plan, with what they cost if wrong

**1. `owner` is cut from the card. This is a deviation from spec §6.**

§6 lists "owner" among the things the card carries. It cannot work, for two independent reasons,
both verified:

- `clients.owner_id` is `NULL` on all eleven seeded rows — `scripts/seed-clients.mjs` inserts
  `(name, status)` only.
- `profiles_select_own` restricts `profiles` SELECT to `(select auth.uid()) = id`, so even once
  `owner_id` is set, an owner who is not you is unreadable. This is the same blocker already
  recorded as §10 item 7 for the footer.

With one account manager, every client is Josh's, so the field would render blank on all eleven
today and "you" on all eleven after a backfill. **Cut, alongside the sort chips and the archived
toggle, and recorded in §10 as part of the same policy widening.** Cost if wrong: one line of
JSX and one query column, added in Slice 2 when the policy widens and a second person exists.

**2. The footer names a person only as "you" or "another account manager".**

Same policy. Identical to the degradation step 3 already shipped in the check-in screen, so the
two screens stay consistent with each other. Cost if wrong: the footer is less useful than §6
promises until Slice 2.

**3. The card is not made a link, and navigation is not touched.**

Step 3's task 7 already made the whole card the click target, and it works — the owner confirmed
items 01–05. This step keeps that markup and that overlay. Cost if wrong: nothing; it is the
status quo.

**4. A `.t-score` type role is added to `base.css`, and `.scoreValue` stops overriding
`.t-display`. This step must not just move that rule.**

Measured 2026-08-22, and it is the parked finding from step 2:

- `base.css` `.t-display` sets `font-size: var(--step-4)`.
- `Board.module.css` `.scoreValue` sets `font-size: var(--step-3)` — one step smaller.
- Both are **single-class selectors, so specificity is equal**, and the score is the size it is
  only because `Board.module.css` happens to load after `base.css`.

Moving `.scoreValue` into a brand-new CSS module is precisely the edit that reshuffles that
order, and the failure is silent: the score renders a step too large, every test green. So the
override is removed rather than relocated. Add a seventh `.t-*` role to `base.css`:

```css
/* The card's total. Its own role rather than .t-display plus a local
   font-size override: those two selectors have equal specificity, so the
   override only ever won on stylesheet order, and moving the rule to another
   file would have silently resized the number with no test failing. */
.t-score {
  font-family: var(--face-display);
  font-stretch: var(--wdth-display);
  font-weight: var(--wght-display);
  font-size: var(--step-3);
  line-height: var(--leading-numeric);
  letter-spacing: var(--tracking-display);
}
```

Then `.scoreValue` in `ClientCard.module.css` keeps only what is genuinely local to a card, and
**declares no `font-size`**. Verify by grepping: `grep -n 'font-size' src/board/ClientCard.module.css`
must not show `.scoreValue`. Cost if wrong: the global type vocabulary grows from six roles to
seven, which is a real cost — the alternative was a specificity hack that a future file move
would break again.

---

## File structure

| File | Responsibility |
|---|---|
| `src/board/cardSummary.ts` | **Create.** Pure text decisions: the card footer line, the progress line. No React, no Supabase — testable in the node environment. |
| `src/board/cardSummary.test.ts` | **Create.** Node. Exhaustive over the footer's cases. |
| `src/board/useBoard.ts` | **Create.** The read, behind a hook, mirroring `useCheckin`: one call per table, a cancellation flag, `describeError`. This is the seam that makes `Board` testable. |
| `src/board/ClientCard.tsx` | **Create.** One card: name, total or em dash, band chip, five pillar bars, footer. Presentation only — receives everything as props. |
| `src/board/ClientCard.module.css` | **Create.** The card's own styles, including the pillar bars. |
| `src/board/ClientCard.dom.test.tsx` | **Create.** jsdom. What the card renders in each state. |
| `src/board/Board.tsx` | **Modify.** Delete `Score all 3s` and the whole write path. Consume `useBoard`, render `ClientCard`, render the progress line. |
| `src/board/Board.module.css` | **Modify.** Remove the `Score all 3s` rules; move card rules out to `ClientCard.module.css`. |
| `src/board/Board.test.tsx` | **Modify.** The four `it.skip` entries become real tests. |

---

### Task 1: The footer and progress lines, as pure functions

**Files:**
- Create: `src/board/cardSummary.ts`
- Create: `src/board/cardSummary.test.ts`

**Interfaces:**
- Consumes: `PILLARS`, `scoredCount` from `../lib/score`; `formatSavedAt` from `../lib/month`.
- Produces:
  - `type CardCheckin = { total_score: number | null; submitted_at: string | null; submitted_by: string | null } & Partial<Record<Pillar, number | null>>`
  - `cardFooter(checkin: CardCheckin | null, viewerId: string): string`
  - `progressLine(submitted: number, total: number): string`

This task exists so that every sentence the board puts on screen is decided by a pure function
with a test, rather than by a ternary buried in JSX. Step 3's whole finding was a screen that
said nothing; the countermeasure is that the words are the unit under test.

- [x] **Step 1: Write the failing test**

Create `src/board/cardSummary.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cardFooter, progressLine } from './cardSummary'
import type { CardCheckin } from './cardSummary'

const ME = '11111111-1111-1111-1111-111111111111'
const SOMEBODY_ELSE = '22222222-2222-2222-2222-222222222222'

// A submitted check-in always has all five pillars, because submitted_at is
// only ever set on a complete five -- useCheckin's submit() enforces that.
// Building a fixture that violates it would manufacture a bug that cannot
// happen, which is a mistake this project has already made once.
const COMPLETE = {
  relationship: 3,
  delivery: 3,
  financial: 3,
  sentiment: 3,
  growth: 3,
} as const

describe('cardFooter', () => {
  it('says not started when there is no check-in at all', () => {
    expect(cardFooter(null, ME)).toBe('Not started')
  })

  it('names you and the time for your own submission', () => {
    const checkin: CardCheckin = {
      total_score: 15,
      submitted_at: '2026-08-21T17:04:00.000Z',
      submitted_by: ME,
      ...COMPLETE,
    }
    expect(cardFooter(checkin, ME)).toMatch(/^Submitted /)
    expect(cardFooter(checkin, ME)).toContain('by you')
  })

  // §10 item 7: profiles_select_own means another person's name is unreadable,
  // so the footer says the role instead of inventing a name.
  it('says another account manager when somebody else submitted it', () => {
    const checkin: CardCheckin = {
      total_score: 15,
      submitted_at: '2026-08-21T17:04:00.000Z',
      submitted_by: SOMEBODY_ELSE,
      ...COMPLETE,
    }
    expect(cardFooter(checkin, ME)).toContain('by another account manager')
    expect(cardFooter(checkin, ME)).not.toContain('by you')
  })

  it('counts the scored pillars for a draft', () => {
    const checkin: CardCheckin = {
      total_score: null,
      submitted_at: null,
      submitted_by: null,
      relationship: 4,
      delivery: 2,
      financial: null,
      sentiment: 3,
      growth: null,
    }
    expect(cardFooter(checkin, ME)).toBe('Draft, 3 of 5 scored')
  })

  it('treats a row with nothing scored as not started', () => {
    // The upsert can leave a row with only notes on it. A card saying
    // "Draft, 0 of 5" invites the reader to look for scores that were never
    // entered; "Not started" is what actually happened.
    const checkin: CardCheckin = {
      total_score: null,
      submitted_at: null,
      submitted_by: null,
    }
    expect(cardFooter(checkin, ME)).toBe('Not started')
  })

  it('never returns an empty string, in any combination', () => {
    // The defect this whole slice exists to fix is a screen that says nothing.
    for (const submitted_at of [null, '2026-08-21T17:04:00.000Z']) {
      for (const submitted_by of [null, ME, SOMEBODY_ELSE]) {
        for (const scored of [0, 1, 5]) {
          const pillars = Object.fromEntries(
            (['relationship', 'delivery', 'financial', 'sentiment', 'growth'] as const)
              .map((p, i) => [p, i < scored ? 3 : null]),
          )
          const text = cardFooter(
            { total_score: null, submitted_at, submitted_by, ...pillars },
            ME,
          )
          expect(text.trim(), JSON.stringify({ submitted_at, submitted_by, scored })).not.toBe('')
        }
      }
    }
  })
})

describe('progressLine', () => {
  it('counts submissions against active clients', () => {
    expect(progressLine(4, 11)).toBe('4 of 11 check-ins submitted this month')
  })

  it('reads correctly at both ends', () => {
    expect(progressLine(0, 11)).toBe('0 of 11 check-ins submitted this month')
    expect(progressLine(11, 11)).toBe('All 11 check-ins submitted this month')
  })

  it('says something even with no clients', () => {
    expect(progressLine(0, 0)).toBe('No active clients')
  })
})
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/board/cardSummary.test.ts`
Expected: FAIL — `Failed to resolve import "./cardSummary"`.

- [x] **Step 3: Implement it**

Create `src/board/cardSummary.ts`:

```ts
import { PILLARS, scoredCount } from '../lib/score'
import type { Pillar } from '../lib/score'
import { formatSavedAt } from '../lib/month'

// Only the columns the card actually reads. Narrower than the table row on
// purpose: useBoard selects exactly these, and a type that admitted the whole
// row would let a future edit read a column nothing fetched.
export type CardCheckin = {
  total_score: number | null
  submitted_at: string | null
  submitted_by: string | null
} & Partial<Record<Pillar, number | null>>

// The footer IS the save confirmation -- §6. Better than a toast because it
// survives a reload, which is the check the owner ran on v1 and got no answer
// from. Every branch returns a non-empty sentence; the whole slice exists
// because a screen said nothing.
export function cardFooter(checkin: CardCheckin | null, viewerId: string): string {
  if (!checkin) return 'Not started'

  if (checkin.submitted_at !== null) {
    // "you" or the role, never a name: profiles_select_own makes another
    // person's profile unreadable, so a name here would have to be invented.
    // Recorded in spec §10 item 7.
    const who = checkin.submitted_by === viewerId ? 'you' : 'another account manager'
    return `Submitted ${formatSavedAt(checkin.submitted_at)} by ${who}`
  }

  const scored = scoredCount(checkin)
  // A row can exist with notes and no scores. "Draft, 0 of 5" would send the
  // reader looking for scores that were never entered.
  if (scored === 0) return 'Not started'
  return `Draft, ${scored} of ${PILLARS.length} scored`
}

export function progressLine(submitted: number, total: number): string {
  if (total === 0) return 'No active clients'
  if (submitted === total) return `All ${total} check-ins submitted this month`
  return `${submitted} of ${total} check-ins submitted this month`
}
```

- [x] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/board/cardSummary.test.ts`
Expected: PASS, 9 tests.

- [x] **Step 5: Prove the tests can fail**

Make each of these changes one at a time, run the file, confirm red, then restore:

1. In `cardFooter`, return `'Not started'` unconditionally. Expect several red.
2. Change `'another account manager'` to `'you'`. Expect the third test red.
3. Change `if (scored === 0) return 'Not started'` to fall through. Expect the fifth test red.
4. In `progressLine`, delete the `total === 0` branch. Expect the last test red.

Report the counts. If any change leaves the file green, that test is worthless — say so.

- [x] **Step 6: Commit**

```bash
npm run build && npm test && npm run lint
git add src/board/cardSummary.ts src/board/cardSummary.test.ts
git commit -m "feat(board): the card footer and progress line as pure functions"
```

---

### Task 2: The read, behind a hook

**Files:**
- Create: `src/board/useBoard.ts`

**Interfaces:**
- Consumes: `supabase`, `describeError`, `currentPeriod`, `CardCheckin` from Task 1.
- Produces:
  - `type BoardClient = { id: number; name: string }`
  - `type UseBoard = { status: 'loading' | 'ready' | 'error'; loadError: string | null; clients: BoardClient[]; checkins: Map<number, CardCheckin>; submitted: number; reload: () => void }`
  - `useBoard(period: string): UseBoard`

**Why this task exists at all.** Ruling 13: four `Board` tests are permanently skipped because
`Board` holds its data in an inline `useState`/`useEffect` pair, and effects do not run under
server rendering. With jsdom that specific reason is gone, but the hook is still the right shape —
it is what `useCheckin` does, it makes the loading and error states injectable, and it keeps
`Board` a component about layout. **Do not skip this task and wire the queries inline.**

- [ ] **Step 1: Write the hook**

There is no unit test for this task. It is a hook over the network, and this repo has no
Supabase test double; the live-credential suite uses the anonymous key and is refused before any
policy is consulted. It is covered instead by Task 4, which mocks this module wholesale — which
is the seam this task exists to create. **Say this in the report; do not claim it is unit tested.**

Create `src/board/useBoard.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import { PILLARS } from '../lib/score'
import type { CardCheckin } from './cardSummary'

export type BoardClient = { id: number; name: string }

export type UseBoard = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  clients: BoardClient[]
  checkins: Map<number, CardCheckin>
  submitted: number
  reload: () => void
}

// The columns the card reads, spelled once. The five pillars are here because
// the card draws a bar per pillar, not because it recomputes the total -- the
// total comes from the generated column, which `npm run verify:score` proves
// agrees with totalScore().
const CHECKIN_COLUMNS = ['client_id', 'total_score', 'submitted_at', 'submitted_by', ...PILLARS].join(
  ', ',
)

export function useBoard(period: string): UseBoard {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clients, setClients] = useState<BoardClient[]>([])
  const [checkins, setCheckins] = useState<Map<number, CardCheckin>>(new Map())

  const load = useCallback(async () => {
    // Guards every write below, like useProfile and useCheckin: a period change
    // or an unmount mid-flight must not let a stale response overwrite a newer
    // one. Verified in step 3 to be a real ordering, not a theoretical one.
    let cancelled = false

    setStatus('loading')
    setLoadError(null)

    try {
      const clientResult = await supabase
        .from('clients')
        .select('id, name')
        .eq('status', 'active')
        .order('name')

      if (cancelled) return
      if (clientResult.error) {
        setLoadError(describeError(clientResult.error))
        setStatus('error')
        return
      }

      const checkinResult = await supabase
        .from('checkins')
        .select(CHECKIN_COLUMNS)
        .eq('period', period)

      if (cancelled) return
      if (checkinResult.error) {
        setLoadError(describeError(checkinResult.error))
        setStatus('error')
        return
      }

      const byClient = new Map<number, CardCheckin>()
      for (const row of checkinResult.data ?? []) {
        byClient.set((row as { client_id: number }).client_id, row as unknown as CardCheckin)
      }

      setClients((clientResult.data ?? []) as BoardClient[])
      setCheckins(byClient)
      setStatus('ready')
    } catch (thrown) {
      if (cancelled) return
      setLoadError(describeError(thrown))
      setStatus('error')
    }

    return () => {
      cancelled = true
    }
  }, [period])

  useEffect(() => {
    void load()
  }, [load])

  // Counted here rather than in the component so the progress line and the
  // footers cannot disagree: both read submitted_at, from the same rows.
  let submitted = 0
  for (const client of clients) {
    if (checkins.get(client.id)?.submitted_at != null) submitted += 1
  }

  return { status, loadError, clients, checkins, submitted, reload: () => void load() }
}
```

- [ ] **Step 2: Typecheck it**

Run: `npm run build`
Expected: no `error TS`. `npm test` will not catch a type error here — the constraint at the top
of this plan applies.

- [ ] **Step 3: Commit**

```bash
npm run build && npm test && npm run lint
git add src/board/useBoard.ts
git commit -m "feat(board): the board's read, behind a hook like useCheckin"
```

---

### Task 3: The card

**Files:**
- Create: `src/board/ClientCard.tsx`
- Create: `src/board/ClientCard.module.css`
- Create: `src/board/ClientCard.dom.test.tsx`

**Interfaces:**
- Consumes: `cardFooter`, `CardCheckin` (Task 1); `BAND_LABELS`, `MAX_TOTAL`, `MAX_PILLAR_SCORE`, `PILLARS`, `bandFor` from `../lib/score`; `bandClassName` from `../styles/bandClass`; `PILLAR_DEFINITIONS` from `../lib/pillars`.
- Produces: `ClientCard(props: { client: BoardClient; checkin: CardCheckin | null; viewerId: string; onOpen: () => void })`

The click target, the overlay and the focus ring are **already correct** — step 3 task 7 built
them and the owner confirmed checklist items 01–05. Move that markup across unchanged. This task
adds the bars and the footer to it.

**The overlay is `.cardOpen::after`, not a separate element.** Do not add a `<span>` for it; the
pseudo-element on the button is what covers the card, and that is what a browser has confirmed.
An earlier draft of this plan had an extra overlay span — it would have been a second stacking
context over the confirmed one.

- [ ] **Step 1: Write the failing test**

Create `src/board/ClientCard.dom.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientCard } from './ClientCard'
import { PILLARS } from '../lib/score'

afterEach(() => {
  document.body.innerHTML = ''
})

const CLIENT = { id: 7, name: 'Polar Divide' }
const ME = '11111111-1111-1111-1111-111111111111'

describe('a client card', () => {
  it('shows an em dash for the total when there is no check-in', () => {
    render(<ClientCard client={CLIENT} checkin={null} viewerId={ME} onOpen={() => {}} />)
    expect(screen.getByText('Polar Divide')).toBeTruthy()
    // Not a 0: an unscored client is not a client scoring zero.
    expect(screen.getByTestId('total').textContent).toBe('—')
    expect(screen.getByText('Not started')).toBeTruthy()
  })

  it('shows the total from the row, and the band with its text label', () => {
    render(
      <ClientCard
        client={CLIENT}
        checkin={{
          total_score: 21,
          submitted_at: '2026-08-21T17:04:00.000Z',
          submitted_by: ME,
          relationship: 5, delivery: 4, financial: 4, sentiment: 4, growth: 4,
        }}
        viewerId={ME}
        onOpen={() => {}}
      />,
    )
    expect(screen.getByTestId('total').textContent).toBe('21')
    // The band must never be colour alone -- the label is mandatory, §4.
    expect(screen.getByText('Healthy')).toBeTruthy()
    expect(screen.getByText(/Submitted .* by you/)).toBeTruthy()
  })

  it('draws one bar per pillar, labelled, with the unscored ones marked', () => {
    render(
      <ClientCard
        client={CLIENT}
        checkin={{
          total_score: null, submitted_at: null, submitted_by: null,
          relationship: 5, delivery: 1, financial: null, sentiment: null, growth: null,
        }}
        viewerId={ME}
        onOpen={() => {}}
      />,
    )
    const bars = screen.getAllByTestId('pillar-bar')
    expect(bars).toHaveLength(PILLARS.length)
    expect(bars[0].getAttribute('aria-label')).toMatch(/Relationship: 5 of 5/)
    expect(bars[2].getAttribute('aria-label')).toMatch(/Financial: not scored/)
    expect(screen.getByText('Draft, 2 of 5 scored')).toBeTruthy()
  })

  it('opens the check-in when the card is clicked', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(<ClientCard client={CLIENT} checkin={null} viewerId={ME} onOpen={onOpen} />)

    await user.click(screen.getByRole('button', { name: /Polar Divide/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('is one tab stop, and opens on Enter', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(<ClientCard client={CLIENT} checkin={null} viewerId={ME} onOpen={onOpen} />)

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Polar Divide/ }))
    await user.tab()
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: /Polar Divide/ }))

    await user.click(screen.getByRole('button', { name: /Polar Divide/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('has no button labelled Score all 3s', () => {
    // The control this whole slice exists to remove. It wrote a constant, so it
    // was a guaranteed no-op whenever the data already matched.
    render(<ClientCard client={CLIENT} checkin={null} viewerId={ME} onOpen={() => {}} />)
    expect(screen.queryByRole('button', { name: /Score all 3s/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/board/ClientCard.dom.test.tsx`
Expected: FAIL — `Failed to resolve import "./ClientCard"`.

- [ ] **Step 3: Add the `.t-score` role, and prove the old override was order-dependent**

Before writing the card, do the groundwork from Decision 4. First demonstrate the hazard is real
rather than taking this plan's word for it:

```bash
grep -n 'font-size' src/styles/base.css | grep -A0 't-display' ; grep -n -A3 '^\.t-display' src/styles/base.css
grep -n -A3 '^\.scoreValue' src/board/Board.module.css
```

Confirm with your own eyes that both are single-class selectors setting `font-size`, and that
they disagree. **If they do not, stop and report it — this plan's Decision 4 is then wrong and
must not be acted on.**

Then add `.t-score` to `src/styles/base.css` exactly as Decision 4 spells it, beside the other
`.t-*` roles. Run `npm test` — `tests/tokens.test.ts` polices this file, and a `font-family`
that is not a lone `var()` fails the build.

- [ ] **Step 4: Write the card**

Create `src/board/ClientCard.tsx`. Copy the click-target markup out of the current
`src/board/Board.tsx` (the `<button>` plus the absolutely-positioned overlay) rather than
inventing new markup — it is already confirmed working in a browser.

```tsx
import { BAND_LABELS, MAX_PILLAR_SCORE, MAX_TOTAL, PILLARS, bandFor } from '../lib/score'
import { PILLAR_DEFINITIONS } from '../lib/pillars'
import { bandClassName } from '../styles/bandClass'
import { cardFooter } from './cardSummary'
import type { CardCheckin } from './cardSummary'
import type { BoardClient } from './useBoard'
import styles from './ClientCard.module.css'

type Props = {
  client: BoardClient
  checkin: CardCheckin | null
  viewerId: string
  onOpen: () => void
}

export function ClientCard({ client, checkin, viewerId, onOpen }: Props) {
  const total = checkin?.total_score ?? null
  const band = bandFor(total)

  return (
    <li className={styles.card}>
      {/* This head block is moved unchanged from Board.tsx: the h3 wrapping the
          button, and the band span beside it. A browser has confirmed the click
          target, the hover and the focus ring on exactly this markup. */}
      <div className={styles.cardHead}>
        <h3 className="t-body">
          <button className={styles.cardOpen} type="button" onClick={onOpen}>
            {client.name}
          </button>
        </h3>
        {/* The band always carries its text label. Colour is never the only
            signal: teal against warm red measures 1.76:1, so any two bands are
            indistinguishable to a colour-blind viewer. Parent spec §9.3. */}
        <span className={bandClassName(band)}>{BAND_LABELS[band]}</span>
      </div>

      <p className={styles.score}>
        {/* An em dash, never a 0: an incomplete check-in has no score, and a
            false "at risk" is as harmful as a false "healthy". */}
        <span className={`t-score ${styles.scoreValue} numeric`} data-testid="total">
          {total === null ? '—' : total}
        </span>
        <span className="t-caption numeric"> / {MAX_TOTAL}</span>
      </p>

      {/* One bar per pillar. The bar is decoration; the aria-label is the
          content, because a bar's height cannot be read aloud. */}
      <ul className={styles.bars}>
        {PILLARS.map((pillar) => {
          const value = checkin?.[pillar] ?? null
          return (
            <li
              className={styles.bar}
              key={pillar}
              data-testid="pillar-bar"
              aria-label={
                value === null
                  ? `${PILLAR_DEFINITIONS[pillar].label}: not scored`
                  : `${PILLAR_DEFINITIONS[pillar].label}: ${value} of ${MAX_PILLAR_SCORE}`
              }
            >
              <span
                className={styles.fill}
                data-scored={value !== null}
                style={{ blockSize: `${((value ?? 0) / MAX_PILLAR_SCORE) * 100}%` }}
              />
            </li>
          )
        })}
      </ul>

      <p className={`t-caption ${styles.footerLine}`}>{cardFooter(checkin ?? null, viewerId)}</p>
    </li>
  )
}
```

`src/board/ClientCard.module.css`: move these rules over from `Board.module.css`, keeping their
comments — **these are the real class names, verified against the file 2026-08-22; an earlier
draft of this plan invented `.open`, `.overlay`, `.total` and `.denominator`, none of which
exist:**

`.card`, `.cardHead`, `.cardOpen`, `.cardOpen::after` (this is the click overlay),
`.card:hover`, `.cardOpen:focus-visible`, `.cardOpen:focus-visible::after`, `.score`,
`.scoreValue`. Then add `.bars`, `.bar`, `.fill` and `.footerLine`.

**`.cardFoot` is DELETED, not moved.** Its own comment says so: "Score all 3s has to stay
clickable through the overlay… Deleted with the button in step 4." It exists to give that button
a stacking context, and the button is gone. It does also carry `border-top: 1px solid
var(--rule-hairline)` and a `padding-top`, which is the only thing separating the card's foot
from its body — so if the card reads better with a rule above the footer line, put that on
`.footerLine` as a deliberate choice rather than inheriting it by leaving dead CSS in place.
Either way it is item 1 of the visual pass, since only a person can say whether the card needs
the separator.

`.state` stays in `Board.module.css`: it styles the loading and error branches, which remain in
`Board`.

Every colour must be a `var(--...)` semantic token — the token gate fails the build on a literal,
comments included. The bar needs a track and a fill that are distinguishable **without colour**,
so give the unscored fill zero height and the track a visible border rather than relying on hue.

**Delete the comment above the `Score all 3s` overlay rule that explains why `.cardFoot` comes
after `.cardHead`** — it justifies a stacking order that existed for a button this step removes.
Leaving it would be a comment that explains a mechanism no longer present, which is the exact
defect class this project has logged eighteen times.

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run src/board/ClientCard.dom.test.tsx`
Expected: PASS, 6 tests.

Then: `npm run build` — the inline `style` here uses a CSS property name in a string template,
which is allowed; a camelCase JSX inline style object would fail `tests/tokens.test.ts`. If it
fails, read the rule in `src/styles/tokenRules.ts` and satisfy it rather than weakening it.

- [ ] **Step 6: Prove the tests can fail**

One at a time, revert, and report the counts:

1. Render `{total ?? 0}` instead of the em dash. Expect the first test red.
2. Delete the `BAND_LABELS[band]` text, leaving the class. Expect the second red — this is the
   guard against a colour-only band, which is what §4 forbids.
3. Drop the `aria-label` from the bars. Expect the third red.
4. Map over `PILLARS.slice(0, 4)`. Expect the third red.

- [ ] **Step 7: Commit**

```bash
npm run build && npm test && npm run lint
grep -n 'font-size' src/board/ClientCard.module.css   # .scoreValue must NOT appear
git add src/styles/base.css src/board/ClientCard.tsx src/board/ClientCard.module.css src/board/ClientCard.dom.test.tsx
git commit -m "feat(board): the client card, with per-pillar bars and a footer that names the save"
```

---

### Task 4: Board itself — delete the writer, un-skip the tests

**Files:**
- Modify: `src/board/Board.tsx`
- Modify: `src/board/Board.module.css`
- Modify: `src/board/Board.test.tsx`

**Interfaces:**
- Consumes: `useBoard` (Task 2), `ClientCard` (Task 3), `progressLine` (Task 1).
- Produces: nothing later tasks rely on. This is the last task in the step.

- [ ] **Step 1: Rewrite the test file first**

Replace `src/board/Board.test.tsx` entirely. The four `it.skip` entries from Ruling 13 become
real tests: `useBoard` is mockable, so the loaded grid is now reachable.

```tsx
// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mocking the hook, which is the whole reason Task 2 exists. Ruling 13 left
// four tests permanently skipped because Board held its read in an inline
// useState/useEffect pair with no seam to mock.
vi.mock('./useBoard', () => ({ useBoard: vi.fn() }))

import { Board } from './Board'
import { useBoard } from './useBoard'

const ME = '11111111-1111-1111-1111-111111111111'
const PROFILE = { id: ME, email: 'me@example.com', full_name: null, role: 'admin', is_active: true }

const CLIENTS = [
  { id: 1, name: 'Babaloo' },
  { id: 2, name: 'Colorfil' },
  { id: 3, name: 'Sno-Go' },
]

function ready(overrides = {}) {
  return {
    status: 'ready' as const,
    loadError: null,
    clients: CLIENTS,
    checkins: new Map(),
    submitted: 0,
    reload: () => {},
    ...overrides,
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.mocked(useBoard).mockReset()
})

describe('the board', () => {
  it('renders a list, with one card per client', () => {
    vi.mocked(useBoard).mockReturnValue(ready())
    render(<Board profile={PROFILE as never} />)

    expect(screen.getByRole('list', { name: /clients/i })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(CLIENTS.length)
  })

  it('puts each client name in a button, one per card', () => {
    vi.mocked(useBoard).mockReturnValue(ready())
    render(<Board profile={PROFILE as never} />)

    for (const client of CLIENTS) {
      expect(screen.getByRole('button', { name: new RegExp(client.name) })).toBeTruthy()
    }
  })

  it('has deleted Score all 3s', () => {
    // §6: it wrote a constant, so it was a guaranteed no-op whenever the data
    // already matched -- the second half of the owner's original finding.
    vi.mocked(useBoard).mockReturnValue(ready())
    render(<Board profile={PROFILE as never} />)
    expect(screen.queryByRole('button', { name: /Score all 3s/i })).toBeNull()
  })

  it('counts submissions in the progress line', () => {
    vi.mocked(useBoard).mockReturnValue(ready({ submitted: 2 }))
    render(<Board profile={PROFILE as never} />)
    expect(screen.getByText('2 of 3 check-ins submitted this month')).toBeTruthy()
  })

  it('says so while loading, and does not show an empty board', () => {
    vi.mocked(useBoard).mockReturnValue(ready({ status: 'loading', clients: [] }))
    render(<Board profile={PROFILE as never} />)
    expect(screen.queryByRole('list', { name: /clients/i })).toBeNull()
    expect(document.body.textContent?.trim()).not.toBe('')
  })

  it('shows the read error instead of an empty board', () => {
    vi.mocked(useBoard).mockReturnValue(
      ready({ status: 'error', loadError: 'the connection failed', clients: [] }),
    )
    render(<Board profile={PROFILE as never} />)
    expect(screen.getByText(/the connection failed/)).toBeTruthy()
    expect(screen.queryByRole('list', { name: /clients/i })).toBeNull()
  })

  it('says the roster is empty rather than rendering nothing', () => {
    vi.mocked(useBoard).mockReturnValue(ready({ clients: [] }))
    render(<Board profile={PROFILE as never} />)
    expect(screen.getByText('No active clients')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/board/Board.test.tsx`
Expected: FAIL on most tests — `Score all 3s` still renders, there is no progress line, and
`useBoard` is not consumed yet.

- [ ] **Step 3: Rewrite Board.tsx**

Delete, in `src/board/Board.tsx`:
- `scoreAllThrees` entirely, and the `Score all 3s` button.
- `saveError`, `setSaveError`, `saving`, `setSaving` and every branch that reads them.
- the inline `clients`/`checkins`/`loadError` state and the `load` callback — `useBoard` owns them.
- the now-unused imports (`supabase`, `describeError`, `PILLARS`, `bandFor`, `BAND_LABELS`,
  `MAX_TOTAL`, `bandClassName`, `Pillar`). `noUnusedLocals` is on, so `npm run build` will name
  any you miss.

Keep: the `selected` state and the `CheckIn` branch (§5.1 navigation, built in step 3 and
confirmed working), and `currentPeriod()`/`formatPeriod`.

The loaded branch becomes:

```tsx
const board = useBoard(period)

// ... the CheckIn branch stays exactly as it is ...

if (board.status === 'error') {
  return (
    <p className="alert" role="alert">
      Could not load the board: {board.loadError}
    </p>
  )
}

if (board.status === 'loading') {
  return <p role="status">Loading the board…</p>
}

return (
  <>
    <p className="t-caption" role="status">
      {progressLine(board.submitted, board.clients.length)}
    </p>

    {board.clients.length > 0 && (
      // role="list" is kept from the current markup, and is not redundant:
      // base.css removes list markers globally, and WebKit drops list
      // semantics from a list with no markers. The aria-label is new, and is
      // what lets a test address this list by name.
      <ul aria-label="Clients" className={styles.grid} role="list">
        {board.clients.map((client) => (
          <ClientCard
            checkin={board.checkins.get(client.id) ?? null}
            client={client}
            key={client.id}
            onOpen={() => setSelected(client)}
            viewerId={profile.id}
          />
        ))}
      </ul>
    )}
  </>
)
```

Note the empty-roster case needs no separate branch: `progressLine(0, 0)` already returns
`'No active clients'`, and the grid is not rendered. **Check that against the test in Step 1
before believing this sentence** — if the test expects a different element, fix the code, not
the test.

In `Board.module.css`, delete the `Score all 3s` rules, delete `.cardFoot` (see Task 3 — its
comment already says it goes with the button), and delete the card rules that moved to
`ClientCard.module.css`. Leave `.grid` and `.state`.

Then check nothing dead is left behind:

```bash
grep -nE '^\.[a-zA-Z]' src/board/Board.module.css      # every class still declared
grep -oE 'styles\.[a-zA-Z]+' src/board/Board.tsx | sort -u   # every class still used
```

Every declared class must appear in the used list. A CSS module that declares a class nothing
references is dead code the build will not complain about.

- [ ] **Step 4: Run everything**

```bash
npx vitest run src/board/Board.test.tsx    # expect PASS, 7 tests
npm run build                              # expect no error TS -- catches every dead import
npm test                                   # expect the whole suite green, and 0 skipped
npm run lint
```

**The skipped count must now be 0.** Ruling 13's four are gone — replaced, not deleted-and-
forgotten. If any still says `it.skip`, that is a failure of this task.

- [ ] **Step 5: Prove the board no longer writes**

```bash
grep -rn 'upsert\|\.insert(\|\.update(\|\.delete(' src/board/
```

Expected: **no matches.** Every write now goes through the check-in screen. Report the command
and its output; a grep that finds nothing must be shown to be capable of finding something —
run it against `src/checkin/` as a positive control and report that count too.

- [ ] **Step 6: Answer the question this slice exists for, out loud**

Write in the report, in your own words: **would a person know their check-in worked?** Name the
element on the board that tells them, and what it says in each of the three states — not
started, draft, submitted. If the honest answer is "only if they remember what it said before",
say that.

- [ ] **Step 7: Commit**

```bash
git add src/board/Board.tsx src/board/Board.module.css src/board/Board.test.tsx
git commit -m "feat(board): delete Score all 3s, and let each card report its own save"
```

---

## The owner's visual pass

Nothing in this plan can see a screen, and eleven real cards is the first time the grid has been
seen at a realistic count — which is exactly the condition under which step 2's band chip turned
out to be stretching across its card like a banner while every automated gate was green. Ordered
cheapest-falsification-first.

1. **Eleven cards, and they read as a grid.** Not a single column on a wide screen, not eleven
   banners. Is the spacing between cards enough to separate them?
2. **The band chip is still a chip.** It was fixed once already; a new stylesheet is a new chance
   to break it.
3. **Every card says something in its footer.** Not one blank. Most should say "Not started".
4. **The five bars read as five bars,** and you can tell a 5 from a 1 at a glance without
   counting. On a card with no check-in, do they read as empty rather than as broken?
5. **The progress line is true.** Count the cards saying "Submitted" and check it matches.
6. **`Score all 3s` is gone** from every card.
7. **Open a card, score five, submit, come back.** Does the card now show the total, the band,
   five full bars, and "Submitted … by you"?
8. **Reload the board.** Does the footer still say it? This is the check v1 failed.
9. **Open a card, score two, go back without submitting.** Does the card say "Draft, 2 of 5
   scored"?
10. **Tab across the board.** One stop per card, a visible ring, Enter opens it.
11. **On your phone.** Any sideways scroll? Do eleven cards stack sensibly?

## Self-review

**Spec coverage.** §6 `Score all 3s` deleted → Task 4. Card carries name → Task 3; total or em
dash → Task 3; band with mandatory text label → Task 3; five per-pillar bars → Task 3; footer
naming who and when, or "not started", or "draft, N of 5" → Tasks 1 and 3. Footer survives a
reload → it is derived from the row on every read, tested in Task 1 and item 8 of the visual
pass. Progress line counting `submitted_at is not null` over active clients → Tasks 1, 2 and 4.
Sort chips and archived toggle → explicitly cut by §6. **Owner → cut, with reasons, in Decision
1 above; this is the one deviation from §6 and it needs recording in spec §10.**

**Placeholder scan.** No TBDs. Every code step carries the code. Task 2 has no unit test and
says so, with the reason and the thing that does cover it, rather than implying coverage.

**Type consistency.** `CardCheckin` is declared once in Task 1 and imported by Tasks 2 and 3.
`BoardClient` is declared once in Task 2 and imported by Task 3. `cardFooter(checkin, viewerId)`
takes the same two arguments in Task 1's tests, Task 1's implementation and Task 3's call.
`progressLine(submitted, total)` likewise in Tasks 1 and 4. `useBoard`'s returned shape is
spelled identically in Task 2's type, Task 4's mock factory and Task 4's assertions.

**A risk this plan removes rather than carries.** `.scoreValue`'s font-size beat `.t-display`'s
on stylesheet order alone — parked since step 2, and this step's file move would have triggered
it silently. Decision 4 and Task 3 step 3 replace the override with a role, so there is nothing
left to break. If Task 3 step 3's own verification shows the two rules do not actually conflict,
Decision 4 is wrong and the implementer is told to stop rather than proceed.

**One risk this plan does not remove.** The bar heights are set with an inline `blockSize`
percentage, which the token gate permits as a string template but which no test asserts the
appearance of — a bar could render at the wrong height with every test green. That is item 4 of
the visual pass, and it is the reason that item names a specific comparison (a 5 against a 1)
rather than asking whether the bars "look right".
