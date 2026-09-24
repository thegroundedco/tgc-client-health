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
// One row per client: the current rung for a client still here, the rung they
// joined at for a client who has left. Those are disjoint halves --
// ladderStanding reads only active clients' CURRENT rung and onRampComparison
// reads only departed clients' ENTRY rung -- so one row each answers both
// without reconstructing any history.

const ROSTER = [
  { id: 1, name: 'Acme', status: 'active', started_on: '2025-01-01', ended_on: null },
  { id: 2, name: 'Beta', status: 'paused', started_on: '2025-06-01', ended_on: null },
  { id: 3, name: 'Gamma', status: 'former', started_on: '2024-03-01', ended_on: '2026-02-01' },
  { id: 4, name: 'Delta', status: 'active', started_on: null, ended_on: null },
]

const TODAY = '2026-09-24'

function row(name: string, pkg: string, since = '') {
  return { name, package: pkg, since }
}

function plan(rows: ReturnType<typeof row>[], roster = ROSTER, today = TODAY) {
  return planPackages({ rows, roster, today })
}

describe('planPackages — what becomes a stint', () => {
  it('dates a blank `since` to the day the relationship began, and says it assumed that', () => {
    const result = plan([row('Acme', 'grow')])

    expect(result.problems).toEqual([])
    expect(result.stints).toEqual([
      { clientId: 1, name: 'Acme', packageCode: 'grow', startedOn: '2025-01-01', assumed: true },
    ])
  })

  it('takes a given `since` over the relationship start, and does not call it assumed', () => {
    const result = plan([row('Acme', 'scale', '2026-04-01')])

    expect(result.stints).toEqual([
      { clientId: 1, name: 'Acme', packageCode: 'scale', startedOn: '2026-04-01', assumed: false },
    ])
  })

  it('matches a name regardless of case and stray whitespace', () => {
    // build-sql.mjs normalises the same way; a roster typed by hand into a
    // spreadsheet will not match byte-for-byte.
    const result = plan([row('  acme  ', 'grow')])

    expect(result.problems).toEqual([])
    expect(result.stints[0].clientId).toBe(1)
  })

  it('skips a row with no package, and does not treat it as a problem', () => {
    // The owner is allowed not to know. An unrecorded client is a state this
    // app renders honestly; a guessed rung is not.
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

  it('refuses a package that is not on the ladder', () => {
    const result = plan([row('Acme', 'platinum')])

    expect(result.stints).toEqual([])
    expect(result.problems.join(' ')).toMatch(/platinum/)
  })

  it('refuses two rows for one client', () => {
    // The table's unique (client_id, started_on) would catch a same-day pair
    // and nothing would catch a different-day one -- which would silently make
    // this a history import rather than the one-row-per-client pass it is.
    const result = plan([row('Acme', 'grow'), row('Acme', 'scale', '2026-01-01')])

    expect(result.stints).toEqual([])
    expect(result.problems.join(' ')).toMatch(/Acme/)
  })

  it('refuses a stint dated before the relationship began', () => {
    const result = plan([row('Acme', 'grow', '2024-01-01')])

    expect(result.stints).toEqual([])
    expect(result.problems.join(' ')).toMatch(/before/i)
  })

  it('refuses a stint dated after the client left', () => {
    const result = plan([row('Gamma', 'grow', '2026-06-01')])

    expect(result.stints).toEqual([])
    expect(result.problems.join(' ')).toMatch(/after/i)
  })

  it('refuses a stint dated in the future', () => {
    // currentStint reads a future date as a plan rather than the present, so a
    // backfill that emitted one would write a row the ladder refuses to count.
    const result = plan([row('Acme', 'grow', '2027-01-01')])

    expect(result.stints).toEqual([])
    expect(result.problems.join(' ')).toMatch(/future/i)
  })

  it('refuses to assume a date for a client with no start date', () => {
    const result = plan([row('Delta', 'grow')])

    expect(result.stints).toEqual([])
    expect(result.problems.join(' ')).toMatch(/Delta/)
  })

  it('accepts that same client when given an explicit date', () => {
    const result = plan([row('Delta', 'grow', '2026-05-01')])

    expect(result.problems).toEqual([])
    expect(result.stints[0]).toMatchObject({ clientId: 4, startedOn: '2026-05-01' })
  })

  it('emits nothing at all when any row is a problem', () => {
    // One bad row stops the whole import. A partial write into a table with no
    // delete policy is the expensive kind of mistake.
    const result = plan([row('Acme', 'grow'), row('Nobody', 'scale')])

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
    const sql = emitSql(plan([row('Acme', 'grow'), row('Gamma', 'foundation')]))

    expect(sql).toMatch(/insert into public\.client_packages/)
    expect(sql).toMatch(/\(1, 'grow', '2025-01-01'/)
    expect(sql).toMatch(/\(3, 'foundation', '2024-03-01'/)
  })

  // THE COMMA HAS TO SURVIVE THE COMMENT. Each value tuple carries a trailing
  // `-- client name`, and the first version of this emitter put the separating
  // comma AFTER that comment -- so Postgres read it as part of the comment, the
  // tuples lost their separator, and the whole statement was a syntax error.
  // Every other assertion in this file passed: they checked that a tuple
  // appeared, not that the statement was well formed.
  it('separates the value tuples with a comma that is not inside a comment', () => {
    const sql = emitSql(plan([row('Acme', 'grow'), row('Gamma', 'foundation')]))
    const withoutComments = sql.replace(/--[^\n]*/g, '')

    expect(withoutComments).toMatch(/\),\s*\(/)
  })

  // AND THE SEMICOLON TOO. The same emitter put the statement terminator after
  // the last tuple's trailing comment, so it was commented out as well -- and
  // the first version of this very test could not see it, because stripping the
  // comments removed the semicolon along with them and "no comma before the
  // semicolon" is trivially true when there is no semicolon. Assert the
  // terminator is PRESENT, not merely that nothing bad precedes it.
  it('terminates the insert with a semicolon that is not inside a comment', () => {
    const sql = emitSql(plan([row('Acme', 'grow'), row('Gamma', 'foundation')]))
    const withoutComments = sql.replace(/--[^\n]*/g, '')

    // Cut at the FIRST semicolon, not to the end of the file. The first draft
    // of this test sliced to the end and passed while the terminator was
    // commented out, because the verification SELECTs further down carry
    // semicolons of their own -- it was a vacuous test for a vacuous-test bug,
    // and only mutation found it. If the insert's own terminator disappears,
    // this segment runs on into the first SELECT, which is the tell.
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
  it('says how many dates were assumed rather than given', () => {
    // The number the owner reads before deciding whether to commit: every
    // assumed date asserts the client has never moved rung.
    const report = reportOf(plan([row('Acme', 'grow'), row('Gamma', 'scale', '2025-01-01')]))

    expect(report).toMatch(/1 .*assum/i)
  })

  it('names the clients left out for want of a package', () => {
    const report = reportOf(plan([row('Acme', ''), row('Beta', 'grow')]))

    expect(report).toMatch(/Acme/)
  })
})

describe('the ladder vocabulary', () => {
  // PACKAGE_CODES exists twice: in src/clients/clientPackages.ts, which the app
  // reads, and in the script, which node runs directly and cannot import a .ts
  // module. Two copies drift, so this is the mitigation -- the same one
  // tests/capabilities.test.ts uses for the role presets, and the same reason:
  // the duplication is forced, so the guard is the whole answer to it.
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
