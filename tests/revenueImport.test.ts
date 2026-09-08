import { describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain .mjs script with JSDoc types, not part of the app's
// TypeScript program. Same arrangement as db-which-decide.mjs: the decisions live
// in a module that can be tested, and the script around it only does I/O.
import { emitSql, planImport, reportOf } from '../scripts/revenue-import-plan.mjs'

// The 13-month backfill of past revenue. Every rule below was agreed with the
// owner before a row was written, and the reason this is a tested module rather
// than a one-off script is that the table has NO DELETE POLICY -- deliberately,
// so financial history refuses to vanish. A wrong row can be edited but not
// removed through the app, which makes "get it right before writing" the whole
// design.

const ROSTER = [
  { id: 1, name: 'Acme', started_on: '2025-01-01', ended_on: null },
  { id: 2, name: 'Delta', started_on: '2026-06-15', ended_on: null },
  { id: 3, name: 'East Bay', started_on: '2025-03-01', ended_on: '2026-08-25' },
]

function cell(clientName: string, period: string, retainer: string, project: string) {
  return { clientName, period, retainer, project }
}

describe('planImport — what becomes a row', () => {
  it('turns a filled cell into a write, in integer cents', () => {
    const plan = planImport({
      cells: [cell('Acme', '2026-07-01', '4,000.50', '$1,200')],
      roster: ROSTER,
    })

    expect(plan.problems).toEqual([])
    expect(plan.writes).toEqual([
      {
        clientName: 'Acme',
        clientId: 1,
        period: '2026-07-01',
        retainerCents: 400050,
        projectCents: 120000,
      },
    ])
  })

  it('writes an explicit zero, because a zero is a fact about the month', () => {
    // The owner's rule: 0 means billed nothing, and that is data. It must reach
    // the table as a row, or "we billed them nothing in July" is indistinguishable
    // from "nobody has said yet".
    const plan = planImport({
      cells: [cell('Acme', '2026-07-01', '0', '0')],
      roster: ROSTER,
    })

    expect(plan.writes).toHaveLength(1)
    expect(plan.writes[0].retainerCents).toBe(0)
    expect(plan.writes[0].projectCents).toBe(0)
  })

  it('writes NO row when both figures are blank', () => {
    // The other half of the owner's rule, and the spine of the data model: a
    // missing row is not a zero. Writing 0/0 here would assert the agency billed
    // this client nothing that month, which on a page measuring churn reads as
    // churn.
    const plan = planImport({
      cells: [cell('Acme', '2026-07-01', '', '   ')],
      roster: ROSTER,
    })

    expect(plan.writes).toEqual([])
    expect(plan.skippedBlank).toEqual([{ clientName: 'Acme', period: '2026-07-01' }])
  })

  it('treats one blank figure beside a filled one as a zero, matching the entry screen', () => {
    // NOT skipped -- only BOTH blank means unentered. This is exactly
    // RevenueAdmin.handleSave's rule, and the importer has to agree with the
    // screen or the same sheet typed by hand would produce different rows.
    // parseMoney('') is 0 by contract, so the blank half converts rather than
    // refusing.
    const plan = planImport({
      cells: [cell('Acme', '2026-07-01', '4000', '')],
      roster: ROSTER,
    })

    expect(plan.writes).toHaveLength(1)
    expect(plan.writes[0].retainerCents).toBe(400000)
    expect(plan.writes[0].projectCents).toBe(0)
  })
})

describe('planImport — matching a name to a client', () => {
  it('matches regardless of case and surrounding whitespace', () => {
    const plan = planImport({
      cells: [cell('  east bay ', '2026-07-01', '100', '0')],
      roster: ROSTER,
    })

    expect(plan.problems).toEqual([])
    expect(plan.writes[0].clientId).toBe(3)
  })

  it('reports a name it does not recognise as a client to create, and still plans the row', () => {
    // The owner asked for these to be created rather than skipped. The write is
    // planned with a null id, which the loader fills in after the insert -- so a
    // new client's history arrives with them rather than needing a second pass.
    const plan = planImport({
      cells: [cell('Northgate', '2026-07-01', '5000', '0')],
      roster: ROSTER,
    })

    expect(plan.newClients).toEqual(['Northgate'])
    expect(plan.writes).toHaveLength(1)
    expect(plan.writes[0].clientId).toBe(null)
    expect(plan.writes[0].clientName).toBe('Northgate')
  })

  it('names a new client once however many months it appears in', () => {
    const plan = planImport({
      cells: [
        cell('Northgate', '2026-06-01', '5000', '0'),
        cell('Northgate', '2026-07-01', '5000', '0'),
      ],
      roster: ROSTER,
    })

    expect(plan.newClients).toEqual(['Northgate'])
    expect(plan.writes).toHaveLength(2)
  })

  it('REFUSES a name that matches two clients rather than picking one', () => {
    // Two clients whose names differ only by case or spacing is a real state --
    // nothing in the schema forbids it -- and guessing which one a month of
    // revenue belongs to is exactly the kind of silent wrong answer this whole
    // project keeps guarding against.
    const ambiguous = [
      { id: 7, name: 'Harbor Row', started_on: '2025-01-01', ended_on: null },
      { id: 8, name: 'harbor row', started_on: '2025-01-01', ended_on: null },
    ]

    const plan = planImport({
      cells: [cell('Harbor Row', '2026-07-01', '100', '0')],
      roster: ambiguous,
    })

    expect(plan.writes).toEqual([])
    expect(plan.problems.join(' ')).toMatch(/harbor row/i)
    expect(plan.problems.join(' ')).toMatch(/two|ambiguous|more than one/i)
  })
})

describe('planImport — what it refuses', () => {
  it('refuses a figure it cannot read, and writes nothing for that cell', () => {
    const plan = planImport({
      cells: [cell('Acme', '2026-07-01', 'about 4k', '0')],
      roster: ROSTER,
    })

    expect(plan.writes).toEqual([])
    expect(plan.problems.join(' ')).toMatch(/about 4k/)
  })

  it('refuses a negative figure rather than letting the check constraint catch it', () => {
    // retainer_cents >= 0 is enforced in the database, so this would fail the
    // insert anyway -- halfway through, after other rows had landed. Refusing in
    // the plan means the whole import is judged before any of it runs.
    const plan = planImport({
      cells: [cell('Acme', '2026-07-01', '-500', '0')],
      roster: ROSTER,
    })

    expect(plan.writes).toEqual([])
    expect(plan.problems.join(' ')).toMatch(/-500/)
  })

  it('refuses a period that is not the first of a month', () => {
    // `period = date_trunc('month', period)` is a check constraint. Same
    // argument: fail the plan, not the transaction.
    const plan = planImport({
      cells: [cell('Acme', '2026-07-15', '4000', '0')],
      roster: ROSTER,
    })

    expect(plan.writes).toEqual([])
    expect(plan.problems.join(' ')).toMatch(/2026-07-15/)
  })

  it('refuses the same client-month twice rather than silently summing', () => {
    // The table is one row per client per month. Two lines for one client-month
    // might mean two project invoices to add up, or it might mean the sheet has
    // a duplicate row -- and those want opposite handling. The importer does not
    // get to decide which; it says so and stops.
    const plan = planImport({
      cells: [
        cell('Acme', '2026-07-01', '4000', '0'),
        cell('Acme', '2026-07-01', '0', '1500'),
      ],
      roster: ROSTER,
    })

    expect(plan.writes).toEqual([])
    expect(plan.problems.join(' ')).toMatch(/Acme/)
    expect(plan.problems.join(' ')).toMatch(/2026-07-01/)
    expect(plan.problems.join(' ')).toMatch(/twice|duplicate/i)
  })
})

describe('planImport — months outside a client relationship', () => {
  it('holds back a month before the client started', () => {
    // Delta started 2026-06-15. A 0 for May asserts they billed nothing AS A
    // CLIENT in a month they were not one -- and rate() returns null when the
    // first period is 0, so invented leading zeroes make retention refuse to
    // compute for exactly the client the backfill was meant to enable.
    const plan = planImport({
      cells: [cell('Delta', '2026-05-01', '0', '0')],
      roster: ROSTER,
    })

    expect(plan.writes).toEqual([])
    expect(plan.outsideLifecycle).toEqual([
      { clientName: 'Delta', period: '2026-05-01', reason: 'before 2026-06-15' },
    ])
  })

  it('keeps the month the client started in, part-month or not', () => {
    // Started on the 15th, so June is a partial month -- and real revenue. The
    // boundary is the MONTH containing started_on, not the day.
    const plan = planImport({
      cells: [cell('Delta', '2026-06-01', '2000', '0')],
      roster: ROSTER,
    })

    expect(plan.outsideLifecycle).toEqual([])
    expect(plan.writes).toHaveLength(1)
  })

  it('holds back a month after the client left, and keeps the month they left in', () => {
    // East Bay ended 2026-08-25 and billed part of August. Same inclusive
    // boundary useRevenue's eligibility filter uses, so the importer and the
    // screen agree about which months a departed client has.
    const plan = planImport({
      cells: [
        cell('East Bay', '2026-08-01', '3000', '0'),
        cell('East Bay', '2026-09-01', '0', '0'),
      ],
      roster: ROSTER,
    })

    expect(plan.writes).toHaveLength(1)
    expect(plan.writes[0].period).toBe('2026-08-01')
    expect(plan.outsideLifecycle).toEqual([
      { clientName: 'East Bay', period: '2026-09-01', reason: 'after 2026-08-25' },
    ])
  })

  it('does not hold back anything for a client with no start date on file', () => {
    // Nothing is known, so nothing is claimed. Holding months back here would
    // silently drop real revenue on the strength of a missing field.
    const plan = planImport({
      cells: [cell('Ivy Lane', '2020-01-01', '100', '0')],
      roster: [{ id: 9, name: 'Ivy Lane', started_on: null, ended_on: null }],
    })

    expect(plan.outsideLifecycle).toEqual([])
    expect(plan.writes).toHaveLength(1)
  })
})

describe('planImport — the reconciliation numbers', () => {
  it('totals each month so the owner can check them against the sheet', () => {
    // The report exists to be disagreed with. A total that does not match what
    // the owner already believes is the cheapest possible way to catch a
    // misread column before anything is written.
    const plan = planImport({
      cells: [
        cell('Acme', '2026-06-01', '4000', '500'),
        cell('Delta', '2026-07-01', '2000', '0'),
        cell('Acme', '2026-07-01', '4000', '0'),
      ],
      roster: ROSTER,
    })

    expect(plan.totalsByPeriod).toEqual([
      { period: '2026-06-01', cents: 450000 },
      { period: '2026-07-01', cents: 600000 },
    ])
  })

  it('produces no writes at all when anything is wrong', () => {
    // All or nothing. A partially-applied import into a table with no delete
    // policy is the worst outcome available: the good rows cannot be told from
    // the bad ones afterwards without the sheet in hand.
    const plan = planImport({
      cells: [
        cell('Acme', '2026-06-01', '4000', '0'),
        cell('Acme', '2026-07-01', 'oops', '0'),
      ],
      roster: ROSTER,
    })

    expect(plan.problems).toHaveLength(1)
    expect(plan.writes).toEqual([])
  })
})


describe('planImport — what it would overwrite', () => {
  it('counts client-months that already have a row', () => {
    // A backfill can silently clobber a month somebody typed into the entry
    // screen. The import overwrites on purpose -- it has to be re-runnable
    // after the sheet is corrected -- so the protection is that the owner is
    // told the number BEFORE it runs, not that it refuses.
    const plan = planImport({
      cells: [
        cell('Acme', '2026-06-01', '4000', '0'),
        cell('Acme', '2026-07-01', '4000', '0'),
      ],
      roster: ROSTER,
      existing: [{ client_id: 1, period: '2026-06-01' }],
    })

    expect(plan.overwrites).toEqual([{ clientName: 'Acme', period: '2026-06-01' }])
  })

  it('reports nothing to overwrite when the table is empty', () => {
    const plan = planImport({
      cells: [cell('Acme', '2026-06-01', '4000', '0')],
      roster: ROSTER,
    })

    expect(plan.overwrites).toEqual([])
  })
})

describe('emitSql', () => {
  function planOf(cells: ReturnType<typeof cell>[], roster = ROSTER) {
    return planImport({ cells, roster })
  }

  it('wraps everything in one transaction', () => {
    // All or nothing at the database too, not just in the plan. A backfill that
    // half-applies into a table with no delete policy is the outcome this whole
    // module exists to avoid.
    const sql = emitSql(planOf([cell('Acme', '2026-07-01', '4000', '0')]))

    expect(sql.trimStart().startsWith('begin;')).toBe(true)
    expect(sql.trimEnd().endsWith('commit;')).toBe(true)
  })

  it('upserts, so a corrected sheet can be re-run', () => {
    const sql = emitSql(planOf([cell('Acme', '2026-07-01', '4000', '0')]))

    expect(sql).toMatch(/on conflict \(client_id, period\) do update/)
    expect(sql).toContain('400000')
  })

  it('ESCAPES a quote in a client name', () => {
    // "O'Brien Media" is an ordinary agency client name and an unescaped
    // apostrophe ends the string literal early. At best the statement fails; at
    // worst it means something else entirely.
    const sql = emitSql(
      planImport({
        cells: [cell("O'Brien Media", '2026-07-01', '4000', '0')],
        roster: ROSTER,
      }),
    )

    expect(sql).toContain("'O''Brien Media'")
    expect(sql).not.toContain("'O'Brien Media'")
  })

  it('creates an unknown client and attaches its revenue by name', () => {
    // The new client has no id yet, so its rows join on the name inside the
    // same transaction rather than needing a second pass.
    const sql = emitSql(planOf([cell('Northgate', '2026-07-01', '5000', '0')]))

    expect(sql).toMatch(/insert into public\.clients/)
    expect(sql).toContain('Northgate')
    expect(sql).toMatch(/join public\.clients/)
  })

  it('writes no client insert when every name is already on file', () => {
    const sql = emitSql(planOf([cell('Acme', '2026-07-01', '4000', '0')]))

    expect(sql).not.toMatch(/insert into public\.clients/)
  })

  it('REFUSES to emit anything for a plan with problems', () => {
    const plan = planOf([cell('Acme', '2026-07-15', '4000', '0')])

    expect(plan.problems).toHaveLength(1)
    expect(() => emitSql(plan)).toThrow(/problem/i)
  })

  it('refuses an empty plan rather than emitting an empty transaction', () => {
    // A begin/commit with nothing between them reads as a successful import and
    // is a silent no-op -- the failure mode where somebody believes the year
    // loaded.
    expect(() => emitSql(planOf([cell('Acme', '2026-07-01', '', '')]))).toThrow(/nothing/i)
  })
})


describe('reportOf — what the owner reads before approving', () => {
  it('leads with the problems and says nothing will be written', () => {
    // The report is read to be disagreed with. When the plan refuses, that has
    // to be the first thing on the page, not a footnote under a table of
    // totals that will never be inserted.
    const report = reportOf(
      planImport({ cells: [cell('Acme', '2026-07-15', '4000', '0')], roster: ROSTER }),
    )

    expect(report.split('\n')[0]).toMatch(/problem/i)
    expect(report).toMatch(/nothing will be written/i)
  })

  it('shows monthly totals in readable money, not cents', () => {
    // Checked against what the owner already believes the year looked like, so
    // it has to be in the units they think in. 450000 cents is not a number
    // anybody can compare to a bank statement at a glance.
    const report = reportOf(
      planImport({ cells: [cell('Acme', '2026-06-01', '4000', '500')], roster: ROSTER }),
    )

    expect(report).toContain('$4,500')
    expect(report).not.toContain('450000')
  })

  it('names the clients it would create rather than only counting them', () => {
    // Creating a client is the one irreversible-ish side effect besides the
    // rows. A count is not reviewable; a list is.
    const report = reportOf(
      planImport({ cells: [cell('Northgate', '2026-06-01', '5000', '0')], roster: ROSTER }),
    )

    expect(report).toMatch(/Northgate/)
  })

  it('calls out rows that would be overwritten', () => {
    const report = reportOf(
      planImport({
        cells: [cell('Acme', '2026-06-01', '4000', '0')],
        roster: ROSTER,
        existing: [{ client_id: 1, period: '2026-06-01' }],
      }),
    )

    expect(report).toMatch(/overwrit/i)
    expect(report).toMatch(/Acme/)
  })

  it('reports months held back outside a client relationship, with the reason', () => {
    const report = reportOf(
      planImport({ cells: [cell('Delta', '2026-05-01', '0', '0')], roster: ROSTER }),
    )

    expect(report).toMatch(/2026-05-01/)
    expect(report).toMatch(/before 2026-06-15/)
  })

  it('says how many blank cells it skipped, so silence is not mistaken for coverage', () => {
    const report = reportOf(
      planImport({ cells: [cell('Acme', '2026-06-01', '', '')], roster: ROSTER }),
    )

    expect(report).toMatch(/1 .*blank|blank.*: 1/i)
  })
})
