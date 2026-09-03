import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

// todayISO and formatDay each exist to fix a UTC-vs-local bug, but under UTC
// itself the correct and naive forms of BOTH render the same calendar day --
// so a suite that runs in UTC cannot tell a regression apart from the fix,
// and this project's CI (ubuntu-latest) runs in UTC by default. Pinning a
// non-UTC zone here is what lets these tests actually fail when either bug
// comes back, instead of only failing on a developer's own non-UTC machine.
//
// `process` is a real Node global at runtime, but this file compiles under
// tsconfig.app.json (types: ["vite/client"], no node types -- that's
// tsconfig.node.json, which does not cover src), so it is cast through
// globalThis the same way src/lib/supabase.ts and src/lib/rls.test.ts cast
// import.meta.env: a runtime value this bundler target does not type for
// source files.
const nodeProcess = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process
const ORIGINAL_TZ = nodeProcess.env.TZ

beforeAll(() => {
  nodeProcess.env.TZ = 'America/Denver'
})

afterAll(() => {
  // Vitest reuses workers across files: a leaked TZ here would silently
  // change the meaning of every date-touching test that runs after this one.
  // A plain assignment is not enough when TZ was unset before this file ran
  // (true on this machine and on ubuntu-latest CI): process.env stringifies
  // an undefined assignment to the literal text "undefined", which is a
  // zone identifier that resolves to no zone at all -- worse than merely the
  // wrong one. Only delete actually restores "unset".
  if (ORIGINAL_TZ === undefined) delete nodeProcess.env.TZ
  else nodeProcess.env.TZ = ORIGINAL_TZ
})

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
    const rows = departedRows([RECENT, OLDER, STILL_HERE])

    expect(rows.map((row) => row.client.name).sort()).toEqual(['Older', 'Recent'])
  })

  it('puts the most recent departure first', () => {
    const rows = departedRows([OLDER, RECENT])

    expect(rows.map((row) => row.client.name)).toEqual(['Recent', 'Older'])
  })

  // Measured to the day they LEFT, not to today -- their tenure stopped when
  // the relationship did, and counting it to today would grow the tenure of
  // somebody who is gone.
  it('measures a departed tenure to the end date, not to today', () => {
    const rows = departedRows([OLDER])

    expect(rows[0].days).toBe(396)
  })

  // The only churn event in production has no start date.
  it('reports an unmeasurable departed tenure as null', () => {
    const rows = departedRows([RECENT])

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
