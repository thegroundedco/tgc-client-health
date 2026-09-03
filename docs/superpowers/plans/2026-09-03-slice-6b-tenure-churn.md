# Slice 6b — Tenure and Churn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only report on the Revenue destination: how long each current client has been with the firm, and a ledger of who has left, when and why.

**Architecture:** A pure arithmetic module does the tenure maths and the sorting with zone-safe dates; a read-only hook fetches every client's lifecycle columns in one query; two presentation components render the halves. Nothing writes, nothing migrates.

**Tech Stack:** React 19, TypeScript, Vite, plain CSS with custom properties, CSS Modules, Vitest + Testing Library, jsdom, Supabase JS.

**Spec:** `docs/superpowers/specs/2026-09-03-slice-6b-tenure-churn-design.md`

## Global Constraints

- **Branch:** `slice-6b-tenure-churn`, already created; spec committed at `35a3527`. Do not commit to `main`. **Check `git rev-parse --abbrev-ref HEAD` before every commit** — this repository has had commits land on `main` unnoticed.
- **`src/styles/tokens.css` is the only file allowed to contain a colour literal or a typeface name.** Enforced by `tests/tokens.test.ts` and `tests/brandLayering.test.ts`, which additionally bans `var(--brand-…)` outside it.
- **No database change, no migration, no write.** This slice is a read-only report.
- **No churn rate and no cohorts, and no percentage anywhere on the page.** Spec §6. One churn event cannot support either, and a rate computed on it reads as a fact while meaning nothing.
- **An unknown value must never render as zero, a dash, or an empty cell.** Spec §3. It reads `unknown`. This is the same rule Slice 5 established for the matrix, where `'None yet'` and `'—'` had to stay distinguishable.
- **Do not reuse `useClients`.** Spec §8: it carries add, edit, invite and reset machinery for a screen that writes.
- **Do not backfill `started_on` or propose it.** The owner ruled it out 2026-08-27 and the ruling stands.
- `npm test`, `npm run lint` and `npm run build` must be green at the end of every task. Baseline before starting: **920 tests across 64 files.**
- Comments in this repository are discursive and explain WHY, naming the defect they prevent. Match that voice.

---

### Task 1: The tenure arithmetic

**Files:**
- Create: `src/revenue/tenure.ts`
- Test: `src/revenue/tenure.test.ts`

**Interfaces:**
- Consumes: `isChurned(status: string): boolean` from `src/clients/clientForm.ts`.
- Produces:
  - `type LifecycleClient = { id: number; name: string; status: string; started_on: string | null; ended_on: string | null; end_reason_code: string | null; end_reason_note: string | null }`
  - `type CurrentRow = { client: LifecycleClient; days: number | null; paused: boolean }`
  - `type DepartedRow = { client: LifecycleClient; days: number | null }`
  - `type TenureSummary = { total: number; measured: number; medianDays: number | null; longestDays: number | null }`
  - `todayISO(now?: Date): string`
  - `daysBetween(from: string, to: string): number`
  - `tenureDays(startedOn: string | null, asOf: string): number | null`
  - `formatTenure(days: number | null): string`
  - `formatDay(day: string): string`
  - `currentRows(rows: readonly LifecycleClient[], asOf: string): CurrentRow[]`
  - `departedRows(rows: readonly LifecycleClient[], asOf: string): DepartedRow[]`
  - `summarise(rows: readonly CurrentRow[]): TenureSummary`

- [ ] **Step 1: Write the failing test**

Create `src/revenue/tenure.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  currentRows,
  daysBetween,
  departedRows,
  formatDay,
  formatTenure,
  summarise,
  tenureDays,
  todayISO,
  type LifecycleClient,
} from './tenure'

function client(over: Partial<LifecycleClient> = {}): LifecycleClient {
  return {
    id: 1,
    name: 'Acme',
    status: 'active',
    started_on: '2026-01-01',
    ended_on: null,
    end_reason_code: null,
    end_reason_note: null,
    ...over,
  }
}

describe('todayISO', () => {
  // THE bug this module exists to not have. `new Date().toISOString()` reports
  // the UTC calendar day: at 18:00 in a UTC-7 zone it is already tomorrow in
  // UTC, so every tenure would read a day long for part of every evening --
  // and every test written at a UTC-safe hour would pass. Reading the LOCAL
  // fields is what makes "today" mean the day the person is having.
  it('is the local calendar day, not the UTC one', () => {
    // 2026-09-03 18:30 local, whatever the runner's zone.
    const evening = new Date(2026, 8, 3, 18, 30)
    expect(todayISO(evening)).toBe('2026-09-03')
  })

  it('is the local calendar day early in the morning too', () => {
    const morning = new Date(2026, 8, 3, 0, 30)
    expect(todayISO(morning)).toBe('2026-09-03')
  })

  it('pads a single-digit month and day', () => {
    expect(todayISO(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05')
  })
})

describe('daysBetween', () => {
  // Both ends go through Date.UTC, so no zone enters the subtraction. gate.ts
  // documents the same technique for the 90-day Advocacy gate.
  it('counts plain spans', () => {
    expect(daysBetween('2026-01-01', '2026-01-08')).toBe(7)
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0)
  })

  it('counts across a month boundary', () => {
    expect(daysBetween('2026-01-25', '2026-02-02')).toBe(8)
  })

  // A leap year, because February is where date arithmetic goes wrong.
  it('counts across a leap day', () => {
    expect(daysBetween('2028-02-27', '2028-03-01')).toBe(3)
  })

  it('counts across a year boundary', () => {
    expect(daysBetween('2025-12-30', '2026-01-02')).toBe(3)
  })

  // A DST transition. In a zone that springs forward, one calendar day is 23
  // hours long -- so a naive millisecond division would return 0.958 days and
  // round to the wrong answer for the spans that cross it.
  it('counts a calendar day across a daylight-saving change as one day', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
  })
})

describe('tenureDays', () => {
  it('measures from the start date to the day asked about', () => {
    expect(tenureDays('2026-01-01', '2026-03-02')).toBe(60)
  })

  // Not zero. An absent measurement and a measurement of zero are different
  // facts, and this is the boundary where they get confused.
  it('is null when there is no start date, never zero', () => {
    expect(tenureDays(null, '2026-03-02')).toBe(null)
  })
})

describe('formatTenure', () => {
  it('says unknown when there is nothing to measure', () => {
    expect(formatTenure(null)).toBe('unknown')
  })

  it('does not claim a precision nobody has', () => {
    expect(formatTenure(3)).toBe('under a week')
    expect(formatTenure(14)).toBe('2 wk')
    expect(formatTenure(59)).toBe('8 wk')
    expect(formatTenure(90)).toBe('3 mo')
    expect(formatTenure(364)).toBe('12 mo')
  })

  it('reads years and months once past a year', () => {
    expect(formatTenure(365)).toBe('1 yr')
    expect(formatTenure(429)).toBe('1 yr 2 mo')
    expect(formatTenure(760)).toBe('2 yr 1 mo')
  })
})

describe('formatDay', () => {
  // The trap that nearly shipped in this plan's own first draft, which reached
  // for lib/month.ts's formatSavedAt. That function takes an ISO TIMESTAMP:
  // handed a date-only string it parses UTC midnight and renders it in local
  // time, so `2026-08-25` prints as "Aug 24, 2026, 6:00 PM" in a UTC-6 zone --
  // the wrong DAY, plus a time for a date that has none. A client left on a
  // day, not at six in the evening.
  it('renders the day it was given, not the day before it', () => {
    expect(formatDay('2026-08-25')).toBe('Aug 25, 2026')
    expect(formatDay('2026-01-01')).toBe('Jan 1, 2026')
    expect(formatDay('2026-12-31')).toBe('Dec 31, 2026')
  })

  it('carries no time, because a date has none', () => {
    expect(formatDay('2026-08-25')).not.toMatch(/\d\s*(AM|PM|:)/)
  })
})

describe('currentRows', () => {
  const ACTIVE = client({ id: 1, name: 'Acme', started_on: '2026-01-01' })
  const OLDER = client({ id: 2, name: 'Ballast', started_on: '2025-06-01' })
  const PAUSED = client({ id: 3, name: 'Cove', status: 'paused', started_on: '2026-02-01' })
  const GONE = client({
    id: 4,
    name: 'Delta',
    status: 'former',
    started_on: '2025-01-01',
    ended_on: '2026-08-25',
    end_reason_code: 'other',
  })
  const UNKNOWN = client({ id: 5, name: 'Ember', started_on: null })

  it('keeps everyone who has not left, and drops everyone who has', () => {
    const rows = currentRows([ACTIVE, PAUSED, GONE], '2026-09-03')

    expect(rows.map((row) => row.client.name)).toEqual(['Acme', 'Cove'])
  })

  // Spec §4. The database refuses a paused client an end date, so by the
  // schema's own rules they have not left -- but they are not ordinary either,
  // and the marker is what stops the roster count hiding somebody who is not
  // currently being served.
  it('marks a paused client rather than hiding or flattening it', () => {
    const rows = currentRows([ACTIVE, PAUSED], '2026-09-03')

    expect(rows.find((row) => row.client.name === 'Cove')?.paused).toBe(true)
    expect(rows.find((row) => row.client.name === 'Acme')?.paused).toBe(false)
  })

  it('sorts longest-standing first', () => {
    const rows = currentRows([ACTIVE, OLDER, PAUSED], '2026-09-03')

    expect(rows.map((row) => row.client.name)).toEqual(['Ballast', 'Acme', 'Cove'])
  })

  // Spec §3. They are not the newest -- they are unmeasured, and ranking them
  // where "two weeks" belongs would assert something the data does not say.
  it('sorts an unknown start date to the END, not to the front as the shortest', () => {
    const rows = currentRows([UNKNOWN, ACTIVE, OLDER], '2026-09-03')

    expect(rows.map((row) => row.client.name)).toEqual(['Ballast', 'Acme', 'Ember'])
    expect(rows[2].days).toBe(null)
  })
})

describe('departedRows', () => {
  const RECENT = client({
    id: 1,
    name: 'Recent',
    status: 'former',
    started_on: null,
    ended_on: '2026-08-25',
    end_reason_code: 'other',
  })
  const OLDER = client({
    id: 2,
    name: 'Older',
    status: 'cancelled',
    started_on: '2025-01-01',
    ended_on: '2026-02-01',
    end_reason_code: 'price',
  })
  const STILL_HERE = client({ id: 3, name: 'Here' })

  // The parent spec: cancelled and former are "the same event at different
  // ages", one recent and still under review, one settled. Both are churn.
  it('takes both cancelled and former, and nobody else', () => {
    const rows = departedRows([RECENT, OLDER, STILL_HERE], '2026-09-03')

    expect(rows.map((row) => row.client.name).sort()).toEqual(['Older', 'Recent'])
  })

  it('puts the most recent departure first', () => {
    const rows = departedRows([OLDER, RECENT], '2026-09-03')

    expect(rows.map((row) => row.client.name)).toEqual(['Recent', 'Older'])
  })

  // Measured to the day they LEFT, not to today -- their tenure stopped when
  // the relationship did, and counting it to today would grow the tenure of
  // somebody who is gone.
  it('measures a departed tenure to the end date, not to today', () => {
    const rows = departedRows([OLDER], '2026-09-03')

    expect(rows[0].days).toBe(396)
  })

  // The only churn event in production has no start date.
  it('reports an unmeasurable departed tenure as null', () => {
    const rows = departedRows([RECENT], '2026-09-03')

    expect(rows[0].days).toBe(null)
  })
})

describe('summarise', () => {
  const asOf = '2026-09-03'
  const rowsFor = (...starts: (string | null)[]) =>
    currentRows(
      starts.map((started_on, index) => client({ id: index + 1, name: `C${index}`, started_on })),
      asOf,
    )

  // Spec §3: count everybody, measure only what is measured, and say when the
  // two differ. A client with no recorded start date is still a client.
  it('counts everybody but measures only the known', () => {
    const summary = summarise(rowsFor('2026-01-01', '2026-06-01', null))

    expect(summary.total).toBe(3)
    expect(summary.measured).toBe(2)
  })

  // Treating an unknown as zero would drag the median down and report a
  // shorter typical relationship than the firm actually has.
  it('does not let an unknown drag the median down', () => {
    const withUnknown = summarise(rowsFor('2026-01-01', '2026-06-01', null))
    const without = summarise(rowsFor('2026-01-01', '2026-06-01'))

    expect(withUnknown.medianDays).toBe(without.medianDays)
  })

  it('takes the middle value when the count is odd', () => {
    const summary = summarise(rowsFor('2026-08-01', '2026-06-01', '2026-01-01'))

    expect(summary.medianDays).toBe(daysBetween('2026-06-01', asOf))
  })

  it('averages the middle pair when the count is even', () => {
    const summary = summarise(rowsFor('2026-08-04', '2026-08-24'))

    expect(summary.medianDays).toBe(20)
  })

  it('reports the longest', () => {
    const summary = summarise(rowsFor('2026-08-01', '2025-01-01'))

    expect(summary.longestDays).toBe(daysBetween('2025-01-01', asOf))
  })

  // An empty roster, and a roster where nobody has a start date, are both
  // "nothing to measure" -- and must not report 0, which would be a claim.
  it('measures nothing rather than zero when there is nothing to measure', () => {
    expect(summarise([]).medianDays).toBe(null)
    expect(summarise([]).longestDays).toBe(null)
    expect(summarise(rowsFor(null, null)).medianDays).toBe(null)
    expect(summarise(rowsFor(null, null)).total).toBe(2)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/revenue/tenure.test.ts`
Expected: FAIL — cannot resolve `./tenure`

- [ ] **Step 3: Write the module**

Create `src/revenue/tenure.ts`:

```ts
import { isChurned } from '../clients/clientForm'

// The tenure report's arithmetic, sorting and summary. Pure: no React, no
// network, no clock of its own except the one you hand it. That is what makes
// the date handling below testable, and the date handling is the reason this is
// a module rather than a few subtractions in a component.
//
// Every date here is a YYYY-MM-DD string, which is what a Postgres `date`
// renders as. Two traps live in that, and this file exists to avoid both:
//
// 1. `new Date().toISOString()` reports the UTC calendar day. At 18:00 in a
//    UTC-7 zone it is already tomorrow in UTC, so "today" would be a day ahead
//    for part of every evening -- and every test written at a UTC-safe hour
//    would pass. todayISO reads the LOCAL fields instead.
//
// 2. Mixing a UTC-parsed date with a local one puts a whole timezone offset
//    inside a subtraction. daysBetween sends BOTH ends through Date.UTC, so no
//    zone enters it at all. src/lib/gate.ts documents the same technique for
//    the 90-day Advocacy gate; this is that lesson, one report over.

export type LifecycleClient = {
  id: number
  name: string
  status: string
  started_on: string | null
  ended_on: string | null
  end_reason_code: string | null
  end_reason_note: string | null
}

export type CurrentRow = {
  client: LifecycleClient
  /** Null means unmeasurable, NEVER zero. See the module note above. */
  days: number | null
  paused: boolean
}

export type DepartedRow = { client: LifecycleClient; days: number | null }

export type TenureSummary = {
  /** Everybody, including those with no start date: they are still clients. */
  total: number
  /** How many of them could actually be measured. */
  measured: number
  medianDays: number | null
  longestDays: number | null
}

const DAY_MS = 86_400_000

export function todayISO(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toUTC(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return Date.UTC(year, month - 1, date)
}

export function daysBetween(from: string, to: string): number {
  // Both ends are UTC midnight, so the difference is a whole number of days and
  // a daylight-saving transition -- which makes one local day 23 or 25 hours --
  // cannot round it to the wrong answer.
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS)
}

export function tenureDays(startedOn: string | null, asOf: string): number | null {
  if (startedOn === null) return null
  return daysBetween(startedOn, asOf)
}

// Whole units, because a client relationship is not a precise quantity and
// "0.53 months" would claim a precision nobody has. The month is 30 days and
// the year 365: an approximation, stated here so nobody later mistakes it for
// calendar arithmetic and "fixes" it into something that disagrees with itself
// across a leap year.
export function formatTenure(days: number | null): string {
  if (days === null) return 'unknown'
  if (days < 7) return 'under a week'
  if (days < 60) return `${Math.floor(days / 7)} wk`
  if (days < 365) return `${Math.floor(days / 30)} mo`
  const years = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)
  return months === 0 ? `${years} yr` : `${years} yr ${months} mo`
}

// A date, rendered as a date. NOT lib/month.ts's formatSavedAt, which takes an
// ISO timestamp: handed a date-only string it parses UTC midnight and renders it
// in LOCAL time, so `2026-08-25` prints as "Aug 24, 2026, 6:00 PM" west of
// Greenwich -- the wrong day, and a time for a date that has none.
//
// `timeZone: 'UTC'` is load-bearing, not decoration. Without it toLocaleDateString
// converts the UTC midnight back into local time and lands on the previous day
// again, which is the very bug this function exists to avoid.
export function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString('en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  })
}

// Everyone who has not left. Spec §4: `paused` counts, because the database's
// own check constraint refuses a paused client an end date -- by the schema's
// rules they have not ended.
export function currentRows(
  rows: readonly LifecycleClient[],
  asOf: string,
): CurrentRow[] {
  return rows
    .filter((client) => !isChurned(client.status))
    .map((client) => ({
      client,
      days: tenureDays(client.started_on, asOf),
      paused: client.status === 'paused',
    }))
    .sort((a, b) => {
      // Unknowns go last, not first. They are unmeasured, not new, and ranking
      // them where "two weeks" belongs would assert something the data does not
      // say. Spec §3.
      if (a.days === null && b.days === null) return a.client.name.localeCompare(b.client.name)
      if (a.days === null) return 1
      if (b.days === null) return -1
      return b.days - a.days
    })
}

export function departedRows(
  rows: readonly LifecycleClient[],
  asOf: string,
): DepartedRow[] {
  return rows
    .filter((client) => isChurned(client.status))
    .map((client) => ({
      client,
      // To the day they LEFT, not to today: their tenure stopped when the
      // relationship did, and measuring it to now would keep growing the
      // tenure of somebody who is gone.
      days:
        client.started_on === null || client.ended_on === null
          ? null
          : daysBetween(client.started_on, client.ended_on),
    }))
    .sort((a, b) => {
      const left = a.client.ended_on ?? ''
      const right = b.client.ended_on ?? ''
      // Most recent departure first. Two YYYY-MM-DD strings compare correctly
      // as strings, which is why nothing here parses one to order it.
      return right.localeCompare(left) || a.client.name.localeCompare(b.client.name)
    })
}

// Count everybody, measure only what is measured, and let the caller say when
// the two differ. Spec §3: treating an unknown as zero would drag the median
// down and report a shorter typical relationship than the firm actually has,
// while dropping those clients from the count would answer a different question
// from the one the line appears to answer.
export function summarise(rows: readonly CurrentRow[]): TenureSummary {
  const measured = rows
    .map((row) => row.days)
    .filter((days): days is number => days !== null)
    .sort((a, b) => a - b)

  if (measured.length === 0) {
    return { total: rows.length, measured: 0, medianDays: null, longestDays: null }
  }

  const middle = Math.floor(measured.length / 2)
  const medianDays =
    measured.length % 2 === 1
      ? measured[middle]
      : Math.round((measured[middle - 1] + measured[middle]) / 2)

  return {
    total: rows.length,
    measured: measured.length,
    medianDays,
    longestDays: measured[measured.length - 1],
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/revenue/tenure.test.ts && npm run lint && npm run build`
Expected: PASS, lint and build clean.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print slice-6b-tenure-churn
git add src/revenue/tenure.ts src/revenue/tenure.test.ts
git commit -m "tenure: the arithmetic, with both date traps closed"
```

---

### Task 2: The read

**Files:**
- Create: `src/revenue/useTenure.ts`
- Test: `src/revenue/useTenure.dom.test.ts`

**Interfaces:**
- Consumes: `LifecycleClient` from Task 1; `supabase` from `src/lib/supabase.ts`; `describeError(thrown: unknown): string` from `src/lib/errorText.ts`.
- Produces: `type UseTenure = { status: 'loading' | 'ready' | 'error'; loadError: string | null; clients: LifecycleClient[]; reload: () => void }` and `useTenure(): UseTenure`.

- [ ] **Step 1: Write the failing test**

Create `src/revenue/useTenure.dom.test.ts`:

```ts
// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const order = vi.fn()
vi.mock('../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ order: order }) }) },
}))

import { useTenure } from './useTenure'

const ROW = {
  id: 1,
  name: 'Acme',
  status: 'active',
  started_on: '2026-01-01',
  ended_on: null,
  end_reason_code: null,
  end_reason_note: null,
}

beforeEach(() => {
  order.mockReset()
})

describe('useTenure', () => {
  it('starts out loading', () => {
    order.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useTenure())

    expect(result.current.status).toBe('loading')
    expect(result.current.clients).toEqual([])
  })

  it('reports the rows once they arrive', async () => {
    order.mockResolvedValue({ data: [ROW], error: null })
    const { result } = renderHook(() => useTenure())

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.clients).toEqual([ROW])
    expect(result.current.loadError).toBe(null)
  })

  // v1's signature defect, and the reason this hook reports a status at all
  // rather than just a list: a failed read that fell through to an empty array
  // would render as "no clients yet", making a broken tool look like an empty
  // one. useBoard carries the same shape for the same reason.
  it('reports a failed read as an error, never as an empty roster', async () => {
    order.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    const { result } = renderHook(() => useTenure())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.loadError).toContain('permission denied')
    expect(result.current.clients).toEqual([])
  })

  it('reports a thrown failure the same way', async () => {
    order.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useTenure())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.loadError).toContain('offline')
  })

  it('reads again on demand', async () => {
    order.mockResolvedValue({ data: [ROW], error: null })
    const { result } = renderHook(() => useTenure())

    await waitFor(() => expect(result.current.status).toBe('ready'))
    const before = order.mock.calls.length
    result.current.reload()
    await waitFor(() => expect(order.mock.calls.length).toBe(before + 1))
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/revenue/useTenure.dom.test.ts`
Expected: FAIL — cannot resolve `./useTenure`

- [ ] **Step 3: Write the hook**

Create `src/revenue/useTenure.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import type { LifecycleClient } from './tenure'

// One read of every client's lifecycle columns. A seam, in the same shape as
// useBoard: the screen's fetch has to be mockable, which is the whole reason
// that hook exists rather than an inline useEffect.
//
// NOT useClients, though it already selects these columns. That hook carries
// add, edit, invite and reset machinery for a screen that writes; a read-only
// report inheriting all of it would be coupled to every future change made for
// the admin screen's benefit. Spec §8.
//
// Its own column list rather than clients.ts's CLIENT_COLUMNS, for the same
// reason: that constant is shaped by what the admin screen needs, and this
// report should not silently start fetching a column because that screen did.
const TENURE_COLUMNS =
  'id, name, status, started_on, ended_on, end_reason_code, end_reason_note'

export type UseTenure = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  clients: LifecycleClient[]
  reload: () => void
}

export function useTenure(): UseTenure {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clients, setClients] = useState<LifecycleClient[]>([])

  const load = useCallback(async (isCancelled: () => boolean) => {
    try {
      const { data, error } = await supabase
        .from('clients')
        .select(TENURE_COLUMNS)
        .order('name')

      if (isCancelled()) return

      if (error) {
        // Reported as an error and the list left alone, never fallen through to
        // an empty array: a failed read that renders as "no clients" is v1's
        // "a broken tool looks like an empty one", which is the defect this
        // whole project keeps guarding against.
        setLoadError(describeError(error))
        setStatus('error')
        return
      }

      setClients((data ?? []) as LifecycleClient[])
      setLoadError(null)
      setStatus('ready')
    } catch (thrown: unknown) {
      if (isCancelled()) return
      setLoadError(describeError(thrown))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    // A fresh flag per run, marked cancelled on unmount, so a slow response
    // cannot resolve into a torn-down tree. useBoard explains the same guard.
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load])

  return {
    status,
    loadError,
    clients,
    reload: () => void load(() => false),
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/revenue/useTenure.dom.test.ts && npm run lint && npm run build`
Expected: PASS, lint and build clean.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print slice-6b-tenure-churn
git add src/revenue/useTenure.ts src/revenue/useTenure.dom.test.ts
git commit -m "tenure: one read of the lifecycle columns, reporting a status"
```

---

### Task 3: The tenure list

**Files:**
- Create: `src/revenue/Tenure.tsx`, `src/revenue/Revenue.module.css`
- Test: `src/revenue/Tenure.dom.test.tsx`

**Interfaces:**
- Consumes: `CurrentRow`, `TenureSummary`, `formatTenure`, `summarise` from Task 1.
- Produces: `<Tenure rows={CurrentRow[]} />`

- [ ] **Step 1: Write the failing test**

Create `src/revenue/Tenure.dom.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Tenure } from './Tenure'
import type { CurrentRow, LifecycleClient } from './tenure'

afterEach(() => {
  document.body.innerHTML = ''
})

function row(name: string, days: number | null, paused = false): CurrentRow {
  const client: LifecycleClient = {
    id: name.length,
    name,
    status: paused ? 'paused' : 'active',
    started_on: days === null ? null : '2026-01-01',
    ended_on: null,
    end_reason_code: null,
    end_reason_note: null,
  }
  return { client, days, paused }
}

describe('Tenure', () => {
  it('lists the clients in the order it is given', () => {
    render(<Tenure rows={[row('Ballast', 400), row('Acme', 90), row('Cove', 10)]} />)

    const names = [...screen.getByRole('list', { name: 'Tenure' }).querySelectorAll('li')].map(
      (item) => item.textContent,
    )
    expect(names[0]).toContain('Ballast')
    expect(names[2]).toContain('Cove')
  })

  it('states the count, the median and the longest', () => {
    render(<Tenure rows={[row('Ballast', 400), row('Acme', 90), row('Cove', 10)]} />)

    const summary = screen.getByTestId('tenure-summary').textContent ?? ''
    expect(summary).toContain('3 clients')
    expect(summary).toContain('3 mo')
    expect(summary).toContain('1 yr 1 mo')
  })

  // Spec §3: count everybody, measure only what is measured, and SAY when the
  // two differ. A summary that quietly measured two of three would be a true
  // sentence about a group the reader thinks is bigger than it is.
  it('says how many could not be measured, when any could not', () => {
    render(<Tenure rows={[row('Acme', 90), row('Ember', null)]} />)

    expect(screen.getByTestId('tenure-summary').textContent).toContain('1 without a start date')
  })

  it('says nothing about unmeasured clients when every one is measured', () => {
    render(<Tenure rows={[row('Acme', 90)]} />)

    expect(screen.getByTestId('tenure-summary').textContent).not.toContain('without a start date')
  })

  // Never zero, never a bare dash. Spec §3 and the matrix's own rule that an
  // absent measurement and a measurement of zero must not converge.
  it('reads unknown for a client with no start date', () => {
    render(<Tenure rows={[row('Ember', null)]} />)

    const item = screen.getByRole('list', { name: 'Tenure' }).querySelector('li')
    expect(item?.textContent).toContain('unknown')
    expect(item?.textContent).not.toContain('0')
  })

  it('marks a paused client', () => {
    render(<Tenure rows={[row('Acme', 90), row('Cove', 30, true)]} />)

    const items = [...screen.getByRole('list', { name: 'Tenure' }).querySelectorAll('li')]
    expect(items.find((item) => item.textContent?.includes('Cove'))?.textContent).toContain(
      'Paused',
    )
    expect(items.find((item) => item.textContent?.includes('Acme'))?.textContent).not.toContain(
      'Paused',
    )
  })

  // A blank region reads as a failed load, which is this project's signature
  // defect wearing a new mask.
  it('says so when there are no clients at all', () => {
    render(<Tenure rows={[]} />)

    expect(screen.getByText(/no clients yet/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/revenue/Tenure.dom.test.tsx`
Expected: FAIL — cannot resolve `./Tenure`

- [ ] **Step 3: Write the stylesheet**

Create `src/revenue/Revenue.module.css`:

```css
/* The tenure and churn sections. Shared by both, because they are two lists of
   the same shape on one page -- a name on the inline start, a measurement on
   the inline end -- and giving them separate stylesheets would let two halves
   of one screen drift apart.

   The row shape is deliberately the one src/users/UsersAdmin.module.css and
   src/clients/ClientsAdmin.module.css already use: a bordered card on a raised
   surface. Three screens now read as one place. Every colour comes from the
   semantic layer; this file is not allowed to name one. */

.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.summary {
  margin: 0;
  color: var(--text-secondary);
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--rule-hairline);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

/* Name and any marker beside it. min-inline-size: 0 so a long client name
   wraps instead of pushing the measurement off the card -- a flex item's
   default minimum is its content width, which is what would otherwise happen. */
.who {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  min-inline-size: 0;
}

/* The measurement, at the row's inline end so the column of them lines up and
   can be read down rather than hunted for. Tabular figures for the same reason
   the board's scores use them: a column of numbers with different digit widths
   wobbles. */
.measure {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* A quiet marker, not a health band. Paused is a lifecycle fact, and dressing
   it in a band fill would put it in the vocabulary that means "how this client
   is doing" -- which it is not. */
.marker {
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
}

/* The reason and note under a departed client, on their own line so a long
   note never squeezes the date and the tenure into wrapping. */
.detail {
  flex-basis: 100%;
  margin: 0;
  color: var(--text-secondary);
}
```

- [ ] **Step 4: Write the component**

Create `src/revenue/Tenure.tsx`:

```tsx
import { formatTenure, summarise } from './tenure'
import type { CurrentRow } from './tenure'
import styles from './Revenue.module.css'

// How long each current client has been with the firm, longest-standing first.
// The order and the arithmetic are the caller's -- this renders what it is
// given, which is what keeps the sort rule (unknowns last, spec §3) testable
// without a DOM.
export function Tenure({ rows }: { rows: readonly CurrentRow[] }) {
  const summary = summarise(rows)

  if (rows.length === 0) {
    // An explicit empty state. A blank region reads as a failed load, which is
    // this project's signature defect wearing a new mask.
    return (
      <section className={styles.section}>
        <h3 className="t-subhead">How long clients stay</h3>
        <p className="t-body prose">
          No clients yet. Add one on the Admin screen and their tenure starts counting from the
          start date you give them.
        </p>
      </section>
    )
  }

  return (
    <section className={styles.section}>
      <h3 className="t-subhead">How long clients stay</h3>

      {/* Median rather than mean: with a roster this size one long relationship
          drags a mean somewhere no client actually sits. And the unmeasured are
          counted but not measured -- said out loud, because a summary that
          quietly measured two of three would be a true sentence about a group
          the reader thinks is bigger than it is. Spec §3. */}
      <p className={`t-small ${styles.summary}`} data-testid="tenure-summary">
        {summary.total} {summary.total === 1 ? 'client' : 'clients'}
        {summary.medianDays !== null && ` · median ${formatTenure(summary.medianDays)}`}
        {summary.longestDays !== null && ` · longest ${formatTenure(summary.longestDays)}`}
        {summary.measured < summary.total &&
          ` · ${summary.total - summary.measured} without a start date`}
      </p>

      {/* role="list" because base.css removes markers globally, and WebKit drops
          a list's semantics when its markers are removed -- so in Safari with
          VoiceOver this would otherwise announce as a group of paragraphs with
          no count and no position. The admin screens do the same. */}
      <ul aria-label="Tenure" className={styles.list} role="list">
        {rows.map((row) => (
          <li className={styles.row} key={row.client.id}>
            <span className={styles.who}>
              <span className="t-body">{row.client.name}</span>
              {row.paused && <span className={`t-small ${styles.marker}`}>Paused</span>}
            </span>
            <span className={`t-body ${styles.measure}`}>{formatTenure(row.days)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/revenue/Tenure.dom.test.tsx && npm run lint && npm run build`
Expected: PASS, lint and build clean.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print slice-6b-tenure-churn
git add src/revenue/Tenure.tsx src/revenue/Revenue.module.css src/revenue/Tenure.dom.test.tsx
git commit -m "tenure: the list, saying what it could not measure"
```

---

### Task 4: The churn ledger

**Files:**
- Create: `src/revenue/Churn.tsx`
- Test: `src/revenue/Churn.dom.test.tsx`

**Interfaces:**
- Consumes: `DepartedRow`, `formatTenure`, `formatDay` from Task 1; `Revenue.module.css` from Task 3; `reasonLabel(code: string | null): string` from `src/clients/clientForm.ts`. **Do NOT use `formatSavedAt` from `src/lib/month.ts`** — it takes an ISO timestamp and renders a date-only string as the previous day with a spurious time.
- Produces: `<Churn rows={DepartedRow[]} />`

- [ ] **Step 1: Write the failing test**

Create `src/revenue/Churn.dom.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Churn } from './Churn'
import type { DepartedRow, LifecycleClient } from './tenure'

afterEach(() => {
  document.body.innerHTML = ''
})

function row(
  name: string,
  days: number | null,
  over: Partial<LifecycleClient> = {},
): DepartedRow {
  const client: LifecycleClient = {
    id: name.length,
    name,
    status: 'former',
    started_on: days === null ? null : '2025-01-01',
    ended_on: '2026-08-25',
    end_reason_code: 'price',
    end_reason_note: null,
    ...over,
  }
  return { client, days }
}

describe('Churn', () => {
  it('shows who left, when, why and for how long they had been with you', () => {
    render(<Churn rows={[row('Delta', 396)]} />)

    const item = screen.getByRole('list', { name: 'Departures' }).querySelector('li')
    const text = item?.textContent ?? ''
    expect(text).toContain('Delta')
    expect(text).toContain('Price')
    expect(text).toContain('1 yr 1 mo')
  })

  // The parent spec: the code makes reasons countable across clients, the note
  // carries the story, and "a coded reason alone loses the story, and free text
  // alone cannot be counted -- hence both". A ledger showing only the code
  // would be the countable half of a thing whose point is the story.
  it('shows the note beside the coded reason', () => {
    render(
      <Churn
        rows={[row('Delta', 396, { end_reason_note: 'Budget moved to paid media.' })]}
      />,
    )

    expect(screen.getByText(/Budget moved to paid media/)).toBeTruthy()
  })

  it('says nothing where no note was written', () => {
    render(<Churn rows={[row('Delta', 396, { end_reason_note: null })]} />)

    expect(screen.queryByTestId('churn-note')).toBe(null)
  })

  // The only churn event in production is exactly this: no start date, so its
  // tenure-at-churn cannot be known. Never zero, never blank.
  it('reads unknown when the departed client had no start date', () => {
    render(<Churn rows={[row('Delta', null)]} />)

    const item = screen.getByRole('list', { name: 'Departures' }).querySelector('li')
    expect(item?.textContent).toContain('unknown')
  })

  // THE tripwire, and the reason it is worth more than it looks. A churn rate
  // is the obvious thing to add to a churn report, and spec §6 is the reason it
  // must not be added while one event is all there is: a rate computed on one
  // departure is 9.1%, a number that reads as a fact and means nothing.
  it('renders no percentage anywhere', () => {
    render(<Churn rows={[row('Delta', 396), row('Echo', 200)]} />)

    expect(document.body.textContent).not.toMatch(/\d\s*%/)
  })

  it('explains what it is not showing, and what that would take', () => {
    render(<Churn rows={[row('Delta', null)]} />)

    const text = document.body.textContent ?? ''
    expect(text).toContain('rate')
    expect(text).toContain('start date')
  })

  it('says so when nobody has left', () => {
    render(<Churn rows={[]} />)

    expect(screen.getByText(/nobody has left/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/revenue/Churn.dom.test.tsx`
Expected: FAIL — cannot resolve `./Churn`

- [ ] **Step 3: Write the component**

Create `src/revenue/Churn.tsx`:

```tsx
import { reasonLabel } from '../clients/clientForm'
import { formatDay, formatTenure } from './tenure'
import type { DepartedRow } from './tenure'
import styles from './Revenue.module.css'

// Who left, when, why, and how long they had been with you.
//
// A LEDGER, not an analysis, and spec §6 is the reason. A churn rate computed
// on one departure is 9.1% -- a number that reads as a fact, carries a decimal
// place, and means nothing -- and tenure-at-churn cohorts would render empty
// bands, because the only departure on record has no start date to sort into
// one. Both would be machinery that looks like analysis while having nothing to
// analyse. The sentence below says so, and stops being true on its own the day
// the data supports the real thing.
export function Churn({ rows }: { rows: readonly DepartedRow[] }) {
  return (
    <section className={styles.section}>
      <h3 className="t-subhead">Who has left</h3>

      {rows.length === 0 ? (
        // An explicit empty state rather than a blank region, which reads as a
        // failed load.
        <p className="t-body prose">
          Nobody has left yet. When a client is marked cancelled or former on the Admin screen,
          they appear here with the reason recorded at the time.
        </p>
      ) : (
        <>
          <ul aria-label="Departures" className={styles.list} role="list">
            {rows.map((row) => (
              <li className={styles.row} key={row.client.id}>
                <span className={styles.who}>
                  <span className="t-body">{row.client.name}</span>
                  <span className={`t-small ${styles.marker}`}>
                    {reasonLabel(row.client.end_reason_code)}
                  </span>
                </span>
                <span className={`t-body ${styles.measure}`}>
                  {row.client.ended_on === null ? 'unknown' : formatDay(row.client.ended_on)}{' '}
                  · {formatTenure(row.days)}
                </span>
                {/* Both halves of the reason, because the parent spec says a
                    coded reason alone loses the story and free text alone
                    cannot be counted. */}
                {row.client.end_reason_note !== null && (
                  <p className={`t-small ${styles.detail}`} data-testid="churn-note">
                    {row.client.end_reason_note}
                  </p>
                )}
              </li>
            ))}
          </ul>

          <p className="t-small prose">
            No churn rate and no tenure-at-churn breakdown yet: a rate needs more than one
            departure to mean anything, and the breakdown needs the clients who left to have a
            recorded start date.
          </p>
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/revenue/Churn.dom.test.tsx && npm run lint && npm run build`
Expected: PASS, lint and build clean.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print slice-6b-tenure-churn
git add src/revenue/Churn.tsx src/revenue/Churn.dom.test.tsx
git commit -m "churn: a ledger, and a sentence saying why it is not a rate"
```

---

### Task 5: Onto the Revenue destination

**Files:**
- Modify: `src/shell/Revenue.tsx`
- Test: `src/shell/Revenue.dom.test.tsx` (create)

**Interfaces:**
- Consumes: `useTenure` (Task 2), `currentRows`, `departedRows`, `todayISO` (Task 1), `Tenure` (Task 3), `Churn` (Task 4).
- Produces: the finished report. Nothing depends on this task.

- [ ] **Step 1: Write the failing test**

Create `src/shell/Revenue.dom.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../revenue/useTenure', () => ({ useTenure: vi.fn() }))

import { Revenue } from './Revenue'
import { useTenure } from '../revenue/useTenure'

afterEach(() => {
  document.body.innerHTML = ''
  vi.mocked(useTenure).mockReset()
})

const ACTIVE = {
  id: 1,
  name: 'Acme',
  status: 'active',
  started_on: '2026-01-01',
  ended_on: null,
  end_reason_code: null,
  end_reason_note: null,
}

const GONE = {
  id: 2,
  name: 'Delta',
  status: 'former',
  started_on: null,
  ended_on: '2026-08-25',
  end_reason_code: 'other',
  end_reason_note: null,
}

function given(over: Partial<ReturnType<typeof useTenure>> = {}) {
  vi.mocked(useTenure).mockReturnValue({
    status: 'ready',
    loadError: null,
    clients: [ACTIVE, GONE],
    reload: vi.fn(),
    ...over,
  })
  return render(<Revenue />)
}

describe('the Revenue destination', () => {
  it('shows both halves once the read lands', async () => {
    given()

    await waitFor(() => expect(screen.getByRole('list', { name: 'Tenure' })).toBeTruthy())
    expect(screen.getByRole('list', { name: 'Departures' })).toBeTruthy()
  })

  it('puts the current clients in tenure and the departed in the ledger', () => {
    given()

    expect(screen.getByRole('list', { name: 'Tenure' }).textContent).toContain('Acme')
    expect(screen.getByRole('list', { name: 'Tenure' }).textContent).not.toContain('Delta')
    expect(screen.getByRole('list', { name: 'Departures' }).textContent).toContain('Delta')
  })

  // The paragraph that was on this page before the report existed. It is still
  // true -- revenue retention needs a history of monthly amounts, which one
  // editable retainer field cannot produce -- and it is the reminder the owner
  // asked to keep in front of him. Spec §7.
  it('keeps saying what is still missing and why', () => {
    given()

    expect(document.body.textContent).toContain('data model')
  })

  it('says it is loading rather than showing an empty report', () => {
    given({ status: 'loading', clients: [] })

    expect(screen.getByText(/loading/i)).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Tenure' })).toBe(null)
  })

  // A failed read must never fall through to a screen that looks merely empty.
  it('shows a failed read as an error, not as an empty roster', () => {
    given({ status: 'error', loadError: 'permission denied', clients: [] })

    expect(screen.getByRole('alert').textContent).toContain('permission denied')
    expect(screen.queryByRole('list', { name: 'Tenure' })).toBe(null)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/shell/Revenue.dom.test.tsx`
Expected: FAIL — `useTenure` is not imported by `Revenue.tsx`, so the mocked module is unused and no list renders.

- [ ] **Step 3: Wire the report onto the page**

Replace the body of `src/shell/Revenue.tsx` with:

```tsx
import { Churn } from '../revenue/Churn'
import { Tenure } from '../revenue/Tenure'
import { currentRows, departedRows, todayISO } from '../revenue/tenure'
import { useTenure } from '../revenue/useTenure'
import styles from './Page.module.css'

// Spec §7. The report sits above the note about what is still missing, so the
// page reads: what we can tell you, then what we cannot and why. It stopped
// being a page that only apologises on 2026-09-03.
export function Revenue() {
  const report = useTenure()

  // Read once per render rather than per row, so every tenure on the screen is
  // measured against the same day. Two rows computed either side of midnight
  // would otherwise disagree by one day for no reason a reader could see.
  const asOf = todayISO()

  return (
    <section className={styles.page}>
      <h2 className="t-header">Revenue</h2>

      {report.status === 'loading' && <p className="t-body">Loading…</p>}

      {report.status === 'error' && (
        <p className="alert prose" role="alert">
          {report.loadError}
        </p>
      )}

      {report.status === 'ready' && (
        <>
          <Tenure rows={currentRows(report.clients, asOf)} />
          <Churn rows={departedRows(report.clients, asOf)} />
        </>
      )}

      {/* Still true, and still the reminder the owner asked for. */}
      <p className="t-body prose">
        Revenue retention is not here yet: it needs a data model that does not exist, and the hard
        part is that retention needs a history of monthly amounts — which a single editable
        retainer field cannot produce.
      </p>
    </section>
  )
}
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test && npm run lint && npm run build`
Expected: PASS. From a 920 baseline: Task 1's 30, Task 2's 5, Task 3's 7, Task 4's 7 and this task's 5 — **974 tests across 69 files**.

Note `src/shell/pages.dom.test.tsx` has an existing test asserting Revenue mentions `churn` and `data model`. Both sentences survive, so it must still pass unchanged. If it fails, the wording was changed rather than added to — put it back.

- [ ] **Step 5: See it**

Run `npm run dev`, sign in, open **Revenue**. Confirm: ten current clients longest-first, the paused one marked, the summary naming the count and median, one departure with its reason and an unknown tenure, and the sentence about why there is no rate.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print slice-6b-tenure-churn
git add src/shell/Revenue.tsx src/shell/Revenue.dom.test.tsx
git commit -m "revenue: the page says what it knows before what it does not"
```

---

## After the plan

Do not push. Report the branch and head commit; the owner merges and pushes, and Pages deploys on push.

Carried forward from spec §11: `started_on` is optional and this report is the first thing to make that consequence visible; the one churn event has no start date, which is why that half will look thin for a while; Overview's contents still need the owner; the revenue data model is still owed as a proposal.
