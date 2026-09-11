import { describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain .mjs script with JSDoc types, not part of the
// app's TypeScript program. The same arrangement its sibling
// revenue-import-plan.mjs uses, and for the same reason: the decisions live in
// a module that can be tested, and the script around it only does I/O.
import { parseCsv, planCells } from '../scripts/revenue-import-read.mjs'

// Turning an exported invoice ledger into the cells planImport judges. Kept
// apart from that module for the reason its own header gives: the DECISIONS
// are the safety contract, and they are tested separately from the file
// reading. This IS the file reading, and it carries a contract of its own -- a
// misparse writes a year of revenue against the wrong months into a table with
// no delete policy.
//
// NO REAL CLIENT NAMES ANYWHERE IN THIS FILE. The repository is public. The
// classification overrides that DO name real clients are supplied at call time
// from a file kept outside the repository; this module implements only the
// mechanism.

const HEADER =
  'Month,Month #,Entity,Client (as entered),Client,Invoice #,Invoice Amount,Amount Paid,Outstanding'

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n')
}

const YEAR = 2026

// planCells lives in a .mjs with JSDoc rather than TypeScript types, so what it
// returns arrives untyped. Naming the shape here keeps the assertions below
// readable AND typechecked -- `tsc` under strict mode rejects an implicitly
// typed callback parameter, which is how this file failed `npm run build`
// while passing both the tests and the linter.
type Cell = { clientName: string; period: string; retainer: string; project: string }

describe('parseCsv', () => {
  it('splits rows and cells and trims them', () => {
    expect(parseCsv('a, b \nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('keeps a quoted comma inside its cell', () => {
    // "$4,000" is how a spreadsheet exports money, and a naive split turns one
    // invoice into two cells and shifts every later column by one.
    expect(parseCsv('Client,Amount\n"Smith, Jones","$4,000"')).toEqual([
      ['Client', 'Amount'],
      ['Smith, Jones', '$4,000'],
    ])
  })

  it('understands a doubled quote as one quote', () => {
    expect(parseCsv('a\n"The ""Big"" Co"')).toEqual([['a'], ['The "Big" Co']])
  })

  it('survives Windows line endings and a trailing newline', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
})

describe('planCells — reading the ledger', () => {
  it('turns an invoice into a cell in the right month', () => {
    const out = planCells({ csv: csv('Mar,3,TGC,Acme,Acme,QP-1,"$4,500",$0,$0'), year: YEAR })

    expect(out.problems).toEqual([])
    expect(out.cells).toEqual([
      { clientName: 'Acme', period: '2026-03-01', retainer: '4500', project: '0' },
    ])
  })

  // The year is NOT in the ledger -- rows say "Mar" and the year lives in the
  // tab's title. Inferring it from today's date is how an import silently
  // lands twelve months out.
  it('refuses to guess the year', () => {
    const out = planCells({ csv: csv('Mar,3,TGC,Acme,Acme,QP-1,$100,$0,$0') })

    expect(out.cells).toEqual([])
    expect(out.problems.join(' ')).toMatch(/year/i)
  })

  it('sums several invoices for one client in one month', () => {
    const out = planCells({
      csv: csv('Jun,6,TGC,Acme,Acme,QP-1,"$5,000",$0,$0', 'Jun,6,TGC,Acme,Acme,QP-2,"$2,500",$0,$0'),
      year: YEAR,
    })

    expect(out.cells).toEqual([
      { clientName: 'Acme', period: '2026-06-01', retainer: '7500', project: '0' },
    ])
  })

  it('files a line item under the MERGED client name, not as entered', () => {
    // The ledger records "Acme Website" against client "Acme". Filing by the
    // as-entered name would create a second client for every project.
    const out = planCells({
      csv: csv('Jun,6,TGC,Acme Website,Acme,QP-1,"$9,000",$0,$0'),
      year: YEAR,
      overrides: { 'Acme Website': 'project' },
    })

    expect(out.cells[0].clientName).toBe('Acme')
    expect(out.cells[0].project).toBe('9000')
  })

  it('keeps retainer and project apart within one month', () => {
    const out = planCells({
      csv: csv(
        'Jun,6,TGC,Acme,Acme,QP-1,"$5,000",$0,$0',
        'Jun,6,TGC,Acme Website,Acme,QP-2,"$9,000",$0,$0',
      ),
      year: YEAR,
      overrides: { 'Acme Website': 'project' },
    })

    expect(out.cells).toEqual([
      { clientName: 'Acme', period: '2026-06-01', retainer: '5000', project: '9000' },
    ])
  })

  it('reads the invoiced amount, never the amount paid', () => {
    // The owner's ruling: revenue is what was billed that month. Reading the
    // paid column would attribute money to the month it arrived instead.
    const out = planCells({
      csv: csv('Jun,6,TGC,Acme,Acme,QP-1,"$5,000","$1,000","$4,000"'),
      year: YEAR,
    })

    expect(out.cells[0].retainer).toBe('5000')
  })
})

describe('planCells — what it leaves out', () => {
  it('drops every entity but the one asked for, and totals what it dropped', () => {
    const out = planCells({
      csv: csv('Jun,6,TGC,Acme,Acme,QP-1,"$5,000",$0,$0', 'Jun,6,Other,Acme,Acme,QP-2,"$9,000",$0,$0'),
      year: YEAR,
      entity: 'TGC',
    })

    expect(out.cells).toEqual([
      { clientName: 'Acme', period: '2026-06-01', retainer: '5000', project: '0' },
    ])
    expect(out.excludedEntity).toBe(900000)
  })

  // One client's work is invoiced through a second entity while the client
  // itself belongs in this tool. Naming them is an explicit, reviewed
  // exception -- the alternative is either losing a real retainer or importing
  // a whole second business.
  it('keeps a NAMED client from another entity, and does not count them as dropped', () => {
    const out = planCells({
      csv: csv(
        'Jun,6,TGC,Acme,Acme,QP-1,"$5,000",$0,$0',
        'Jun,6,Other,Beta,Beta,QP-2,"$7,000",$0,$0',
        'Jun,6,Other,Gamma,Gamma,QP-3,"$9,000",$0,$0',
      ),
      year: YEAR,
      entity: 'TGC',
      alsoInclude: ['Beta'],
    })

    expect(out.cells.map((c: Cell) => c.clientName).sort()).toEqual(['Acme', 'Beta'])
    // Gamma alone was dropped for its entity; Beta was kept, so Beta's money
    // must not also be reported as excluded or the reconciliation counts it
    // on both sides.
    expect(out.excludedEntity).toBe(900000)
  })

  it('drops an excluded line item and REPORTS what it removed', () => {
    // A silent exclusion is an unexplained gap against the source sheet. What
    // it removed has to come back so the reconciliation still ties.
    const out = planCells({
      csv: csv(
        'Feb,2,TGC,Acme,Acme,QP-1,"$5,000",$0,$0',
        'Feb,2,TGC,Acme Expenses,Acme,QP-2,"$1,446",$0,$0',
      ),
      year: YEAR,
      overrides: { 'Acme Expenses': 'exclude' },
    })

    expect(out.cells).toEqual([
      { clientName: 'Acme', period: '2026-02-01', retainer: '5000', project: '0' },
    ])
    expect(out.excluded).toEqual([{ asEntered: 'Acme Expenses', period: '2026-02-01', cents: 144600 }])
  })

  it('ignores an invoice line with no amount rather than writing a zero', () => {
    // A blank amount is a record-keeping artefact, not a statement that
    // nothing was billed. The zero fill below is what says that.
    const out = planCells({ csv: csv('Jan,1,TGC,Acme,Acme,N/A,,,'), year: YEAR })

    expect(out.cells).toEqual([])
  })

  it('skips a subtotal or spacer row rather than making a client of it', () => {
    const out = planCells({
      csv: csv('Jun,6,TGC,Acme,Acme,QP-1,"$5,000",$0,$0', ',,,,,,,,', 'Grand Total,,,,,,"$5,000",,'),
      year: YEAR,
    })

    expect(out.cells).toHaveLength(1)
    expect(out.problems).toEqual([])
  })
})

describe('planCells — the zero fill', () => {
  // The owner's ruling: a month with no invoice, for a client who was active,
  // means BILLED NOTHING. Without it a quiet month is indistinguishable from
  // an unrecorded one, retention excludes the client entirely, and contraction
  // and churn become undetectable -- which is most of what this tool is for.
  it('fills a quiet month between two invoices with an explicit zero', () => {
    const out = planCells({
      csv: csv('Jan,1,TGC,Acme,Acme,QP-1,"$5,000",$0,$0', 'Mar,3,TGC,Acme,Acme,QP-2,"$5,000",$0,$0'),
      year: YEAR,
    })

    expect(out.cells).toEqual([
      { clientName: 'Acme', period: '2026-01-01', retainer: '5000', project: '0' },
      { clientName: 'Acme', period: '2026-02-01', retainer: '0', project: '0' },
      { clientName: 'Acme', period: '2026-03-01', retainer: '5000', project: '0' },
    ])
  })

  // Bounded by the client's OWN first and last invoice, never the ledger's.
  it('does not fill before a client’s first invoice', () => {
    const out = planCells({
      csv: csv('Jan,1,TGC,Acme,Acme,QP-1,"$5,000",$0,$0', 'Mar,3,TGC,Beta,Beta,QP-2,"$5,000",$0,$0'),
      year: YEAR,
    })

    expect(out.cells.filter((c: Cell) => c.clientName === 'Beta').map((c: Cell) => c.period)).toEqual([
      '2026-03-01',
    ])
  })

  it('does not fill after a client’s last invoice', () => {
    const out = planCells({
      csv: csv(
        'Jan,1,TGC,Acme,Acme,QP-1,"$5,000",$0,$0',
        'Mar,3,TGC,Acme,Acme,QP-2,"$5,000",$0,$0',
        'Jun,6,TGC,Beta,Beta,QP-3,"$5,000",$0,$0',
      ),
      year: YEAR,
    })

    expect(out.cells.filter((c: Cell) => c.clientName === 'Acme').map((c: Cell) => c.period)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ])
  })

  it('reports the clients whose invoices stop early, so departures can be set', () => {
    // The fill stops at the last invoice, which is honest but silent: a client
    // who LEFT needs an end date or retention reads their absence as unentered
    // rather than as churn. The report names them; it does not guess.
    const out = planCells({
      csv: csv(
        'Jan,1,TGC,Acme,Acme,QP-1,"$5,000",$0,$0',
        'Mar,3,TGC,Acme,Acme,QP-2,"$5,000",$0,$0',
        'Jun,6,TGC,Beta,Beta,QP-3,"$5,000",$0,$0',
      ),
      year: YEAR,
    })

    expect(out.stoppedEarly).toEqual([{ clientName: 'Acme', lastPeriod: '2026-03-01' }])
  })
})

describe('planCells — what it refuses', () => {
  it('refuses a month name it does not recognise, naming it', () => {
    const out = planCells({ csv: csv('Smarch,13,TGC,Acme,Acme,QP-1,$100,$0,$0'), year: YEAR })

    expect(out.cells).toEqual([])
    expect(out.problems.join(' ')).toMatch(/Smarch/)
  })

  it('refuses an amount it cannot read rather than treating it as zero', () => {
    const out = planCells({ csv: csv('Jan,1,TGC,Acme,Acme,QP-1,about $5k,$0,$0'), year: YEAR })

    expect(out.cells).toEqual([])
    expect(out.problems.join(' ')).toMatch(/about \$5k/)
  })

  it('refuses a header it does not recognise', () => {
    const out = planCells({ csv: 'Month,Entity,Client\nJan,TGC,Acme', year: YEAR })

    expect(out.cells).toEqual([])
    expect(out.problems.join(' ')).toMatch(/column/i)
  })

  it('finds its columns by NAME, not by position', () => {
    // A reordered export still reads correctly, and a renamed one fails loudly
    // instead of reading the wrong column as money.
    const out = planCells({
      csv: [
        'Invoice Amount,Client,Month,Entity,Client (as entered),Month #,Invoice #,Amount Paid,Outstanding',
        '"$5,000",Acme,Jan,TGC,Acme,1,QP-1,$0,$0',
      ].join('\n'),
      year: YEAR,
    })

    expect(out.cells).toEqual([
      { clientName: 'Acme', period: '2026-01-01', retainer: '5000', project: '0' },
    ])
  })

  it('refuses an empty ledger rather than reporting nothing to do', () => {
    const out = planCells({ csv: HEADER, year: YEAR })

    expect(out.problems.length).toBeGreaterThan(0)
  })
})

describe('planCells — renaming a client', () => {
  // Two names for one client, on purpose: the ledger recorded the same
  // relationship under a different name per entity. Renaming must happen
  // BEFORE the months are summed, or the two names produce two cells for the
  // same client-month and planImport refuses the lot as a duplicate.
  it('sums two ledger names into one client', () => {
    const out = planCells({
      csv: csv(
        'Jun,6,TGC,Alpha,Alpha,QP-1,"$5,000",$0,$0',
        'Jun,6,Other,Beta,Beta,QP-2,"$7,000",$0,$0',
      ),
      year: YEAR,
      alsoInclude: ['Beta'],
      rename: { Beta: 'Alpha' },
    })

    expect(out.cells).toEqual([
      { clientName: 'Alpha', period: '2026-06-01', retainer: '12000', project: '0' },
    ])
  })

  it('carries the renamed client’s own months through', () => {
    const out = planCells({
      csv: csv(
        'Jan,1,TGC,Alpha,Alpha,QP-1,"$5,000",$0,$0',
        'Jun,6,TGC,Beta,Beta,QP-2,"$7,000",$0,$0',
      ),
      year: YEAR,
      rename: { Beta: 'Alpha' },
    })

    expect(out.cells.map((cell: Cell) => cell.period)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
    ])
  })

  it('leaves a client nobody renamed alone', () => {
    const out = planCells({
      csv: csv('Jun,6,TGC,Alpha,Alpha,QP-1,"$5,000",$0,$0'),
      year: YEAR,
      rename: { Beta: 'Alpha' },
    })

    expect(out.cells[0].clientName).toBe('Alpha')
  })
})
