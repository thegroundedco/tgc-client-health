import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain .mjs script with JSDoc types, not part of the app's
// TypeScript program. Same arrangement as revenue-import-plan.mjs: the decisions
// live in a module that can be tested, and the script around it only does I/O.
import { PACKAGE_CODES, emitSql, planPackages, reportOf } from '../scripts/package-import-plan.mjs'

// The package-history backfill. client_packages has NO DELETE POLICY -- the same
// deliberate arrangement client_month_revenue has, so a wrong row can be edited
// through the app but never removed. That makes "get it right before writing"
// the whole design, and is why this is a tested module rather than a script.
//
// TWO QUESTIONS PER CLIENT, not one, and the second is what the first version of
// this module got wrong. A client signs at Foundation or at Grow; one who signed
// at Foundation may since have graduated into Grow. Recording only where they
// are TODAY would make a graduate look like somebody who signed at Grow -- which
// is exactly the population onRampComparison contrasts them against, so the
// error would land inside the one figure this backfill exists to produce.

const ROSTER = [
  { id: 1, name: 'Acme', status: 'active', started_on: '2025-01-01', ended_on: null },
  { id: 2, name: 'Beta', status: 'paused', started_on: '2025-06-01', ended_on: null },
  { id: 3, name: 'Gamma', status: 'former', started_on: '2024-03-01', ended_on: '2026-02-01' },
  { id: 4, name: 'Delta', status: 'active', started_on: null, ended_on: null },
]

const TODAY = '2026-09-25'

function row(name: string, signedAt: string, graduatedOn = '') {
  return { name, signed_at: signedAt, graduated_on: graduatedOn }
}

function plan(rows: ReturnType<typeof row>[], roster = ROSTER, today = TODAY) {
  return planPackages({ rows, roster, today })
}

describe('planPackages — what becomes a stint', () => {
  it('dates the signing stint to the day the relationship began', () => {
    // No assumption here, unlike the first draft of this module: the rung they
    // signed at is by definition the rung they held on their first day.
    const result = plan([row('Acme', 'grow')])

    expect(result.problems).toEqual([])
    expect(result.stints).toEqual([
      { clientId: 1, name: 'Acme', packageCode: 'grow', startedOn: '2025-01-01' },
    ])
  })

  it('writes a second stint for a client who graduated out of Foundation', () => {
    const result = plan([row('Acme', 'foundation', '2025-09-01')])

    expect(result.problems).toEqual([])
    expect(result.stints).toEqual([
      { clientId: 1, name: 'Acme', packageCode: 'foundation', startedOn: '2025-01-01' },
      { clientId: 1, name: 'Acme', packageCode: 'grow', startedOn: '2025-09-01' },
    ])
  })

  it('leaves a client who signed at Foundation and never got out of it on one stint', () => {
    // They exist, and they matter most: a client who left during Foundation is
    // exactly the short tenure that must count against Foundation, or the
    // verdict flatters it.
    const result = plan([row('Gamma', 'foundation')])

    expect(result.stints).toEqual([
      { clientId: 3, name: 'Gamma', packageCode: 'foundation', startedOn: '2024-03-01' },
    ])
  })

  it('matches a name regardless of case and stray whitespace', () => {
    const result = plan([row('  acme  ', 'grow')])

    expect(result.problems).toEqual([])
    expect(result.stints[0].clientId).toBe(1)
  })

  it('skips a row with no signing rung, and does not treat it as a problem', () => {
    // The owner is allowed not to know. An unrecorded client is a state this app
    // renders honestly; a guessed rung is not.
    const result = plan([row('Acme', ''), row('Beta', 'grow')])

    expect(result.problems).toEqual([])
    expect(result.stints.map((s: { name: string }) => s.name)).toEqual(['Beta'])
    expect(result.skipped).toEqual(['Acme'])
  })

  it('covers a paused client, who is still a client', () => {
    const result = plan([row('Beta', 'foundation')])

    expect(result.stints[0]).toMatchObject({ clientId: 2, packageCode: 'foundation' })
  })
})

describe('planPackages — what it refuses', () => {
  it('refuses a name that matches no client', () => {
    const result = plan([row('Nobody', 'grow')])

    expect(result.stints).toEqual([])
    expect(result.problems.join(' ')).toMatch(/Nobody/)
  })

  it('refuses Scale, which is a project type rather than a rung', () => {
    // It was the third rung until 2026-09-25. A sheet filled in from the old
    // model must be refused rather than quietly written.
    const result = plan([row('Acme', 'scale')])

    expect(result.stints).toEqual([])
    expect(result.problems.join(' ')).toMatch(/scale/i)
  })

  it('refuses a graduation for a client who signed at Grow', () => {
    // There is nowhere to graduate from. Accepting it would write a Grow stint
    // on top of a Grow stint and invent a move that did not happen.
    const result = plan([row('Acme', 'grow', '2026-01-01')])

    expect(result.stints).toEqual([])
    expect(result.problems.join(' ')).toMatch(/grow/i)
  })

  it('refuses two rows for one client', () => {
    const result = plan([row('Acme', 'grow'), row('Acme', 'foundation')])

    expect(result.stints).toEqual([])
    expect(result.problems.join(' ')).toMatch(/Acme/)
  })

  it('refuses a graduation dated before the relationship began', () => {
    const result = plan([row('Acme', 'foundation', '2024-01-01')])

    expect(result.stints).toEqual([])
    expect(result.problems.join(' ')).toMatch(/before/i)
  })

  it('refuses a graduation dated the very day the relationship began', () => {
    // The table is unique on (client_id, started_on), so this pair would be
    // refused by Postgres after the transaction had already started -- and a
    // same-day graduation is not a graduation anyway.
    const result = plan([row('Acme', 'foundation', '2025-01-01')])

    expect(result.stints).toEqual([])
    expect(result.problems.join(' ')).toMatch(/same day|before/i)
  })

  it('refuses a graduation dated after the client left', () => {
    const result = plan([row('Gamma', 'foundation', '2026-06-01')])

    expect(result.stints).toEqual([])
    expect(result.problems.join(' ')).toMatch(/after/i)
  })

  it('refuses a graduation dated in the future', () => {
    // currentStint reads a future date as a plan rather than the present, so the
    // ladder would decline to count a row this import had written.
    const result = plan([row('Acme', 'foundation', '2027-01-01')])

    expect(result.stints).toEqual([])
    expect(result.problems.join(' ')).toMatch(/future/i)
  })

  it('refuses a client with no start date, having nothing to date the signing from', () => {
    const result = plan([row('Delta', 'grow')])

    expect(result.stints).toEqual([])
    expect(result.problems.join(' ')).toMatch(/Delta/)
  })

  it('emits nothing at all when any row is a problem', () => {
    // One bad row stops the whole import. A partial write into a table with no
    // delete policy is the expensive kind of mistake.
    const result = plan([row('Acme', 'grow'), row('Nobody', 'foundation')])

    expect(result.stints).toEqual([])
    expect(result.problems.length).toBe(1)
  })
})

describe('emitSql', () => {
  it('ends in rollback, never commit', () => {
    const sql = emitSql(plan([row('Acme', 'grow')]))

    expect(sql.trimEnd().endsWith('rollback;')).toBe(true)
    expect(sql).not.toMatch(/^\s*commit;/m)
  })

  it('writes one insert per stint, with the client id rather than the name', () => {
    const sql = emitSql(plan([row('Acme', 'foundation', '2025-09-01')]))

    expect(sql).toMatch(/insert into public\.client_packages/)
    expect(sql).toMatch(/\(1, 'foundation', '2025-01-01'/)
    expect(sql).toMatch(/\(1, 'grow', '2025-09-01'/)
  })

  // THE COMMA HAS TO SURVIVE THE COMMENT. Each tuple carries a client name, and
  // the first version of this emitter put the separating comma AFTER an inline
  // comment -- so Postgres read it as comment text, the tuples lost their
  // separator, and the statement was a syntax error. Every other assertion here
  // passed: they checked that a tuple appeared, not that the statement parsed.
  it('separates the value tuples with a comma that is not inside a comment', () => {
    const sql = emitSql(plan([row('Acme', 'grow'), row('Gamma', 'foundation')]))
    const withoutComments = sql.replace(/--[^\n]*/g, '')

    expect(withoutComments).toMatch(/\),\s*\(/)
  })

  it('terminates the insert with a semicolon that is not inside a comment', () => {
    const sql = emitSql(plan([row('Acme', 'grow'), row('Gamma', 'foundation')]))
    const withoutComments = sql.replace(/--[^\n]*/g, '')

    // Cut at the FIRST semicolon, not to the end of the file. The first draft of
    // this test sliced to the end and passed while the terminator was commented
    // out, because the verification SELECTs further down carry semicolons of
    // their own -- a vacuous test for a vacuous-test bug, found only by mutation.
    const afterInsert = withoutComments.slice(withoutComments.indexOf('insert into'))
    const statement = afterInsert.slice(0, afterInsert.indexOf(';') + 1)

    expect(statement).not.toMatch(/select/i)
    expect(statement.trimEnd()).toMatch(/\);$/)
  })

  it('refuses to emit anything when the plan has problems', () => {
    const sql = emitSql(plan([row('Nobody', 'grow')]))

    expect(sql).not.toMatch(/insert into/)
    expect(sql).toMatch(/Nobody/)
  })

  it('counts the rows back out, so the transaction proves what it wrote', () => {
    const sql = emitSql(plan([row('Acme', 'grow')]))

    expect(sql).toMatch(/select count\(\*\)/i)
  })
})

describe('reportOf', () => {
  it('says how many clients signed at each rung, and how many graduated', () => {
    const report = reportOf(
      plan([
        row('Acme', 'foundation', '2025-09-01'),
        row('Beta', 'grow'),
        row('Gamma', 'foundation'),
      ]),
    )

    expect(report).toMatch(/foundation: 2/i)
    expect(report).toMatch(/grow: 1/i)
    expect(report).toMatch(/1 .*graduat/i)
  })

  it('names the clients left out for want of a signing rung', () => {
    const report = reportOf(plan([row('Acme', ''), row('Beta', 'grow')]))

    expect(report).toMatch(/Acme/)
  })
})

describe('the ladder vocabulary', () => {
  // PACKAGE_CODES exists twice: in src/clients/clientPackages.ts, which the app
  // reads, and in the script, which node runs directly and cannot import a .ts
  // module. Two copies drift, so this is the mitigation -- the same one
  // tests/capabilities.test.ts uses for the role presets.
  it('is the same set in the script as in the app', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'clients', 'clientPackages.ts'),
      'utf8',
    )
    const match = source.match(/PACKAGE_CODES: readonly string\[\] = \[([^\]]*)\]/)
    expect(match).not.toBeNull()

    const fromApp = (match as RegExpMatchArray)[1]
      .split(',')
      .map((entry) => entry.trim().replace(/^'|'$/g, ''))
      .filter((entry) => entry !== '')

    expect(fromApp.length).toBeGreaterThan(0)
    expect([...PACKAGE_CODES].sort()).toEqual([...fromApp].sort())
  })
})
