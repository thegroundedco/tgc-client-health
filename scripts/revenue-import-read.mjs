// Reads an exported invoice ledger and turns it into the cells planImport
// judges. The counterpart to revenue-import-plan.mjs, and separated from it
// for the reason that module's header gives: the decisions are the safety
// contract, and they are tested apart from the file reading.
//
// This IS the file reading, and it carries a contract of its own. A misparse
// does not fail loudly -- it writes a year of revenue against the wrong months
// into a table with NO DELETE POLICY. Every refusal below is deliberate: this
// module would rather return a problem than a plausible number.
//
// NO CLIENT NAMES LIVE HERE. The repository is public. The classification
// overrides that name real clients are supplied at call time from a file kept
// outside the repository; this implements only the mechanism.
//
// parseMoney is IMPORTED rather than reimplemented, for the trap it already
// solves: 19.99 * 100 is 1998.9999999999998 in IEEE 754, and truncating bills
// $19.98. src/revenue/money.ts is a leaf module, which is what lets plain Node
// reach it -- tests/leafModules.test.ts holds it that way.
import { parseMoney } from '../src/revenue/money.ts'

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const REQUIRED = ['Month', 'Entity', 'Client (as entered)', 'Client', 'Invoice Amount']

/**
 * A CSV reader that understands quotes, because a spreadsheet exports money as
 * "$4,000" and a naive split turns one invoice into two cells and shifts every
 * later column by one -- silently, and by exactly one month.
 */
export function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted cell is one literal quote.
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += char
      continue
    }

    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(cell.trim())
      cell = ''
    } else if (char === '\n') {
      row.push(cell.trim())
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') cell += char
  }
  row.push(cell.trim())
  if (row.some((value) => value !== '')) rows.push(row)

  return rows
}

function periodOf(year, monthName) {
  const month = MONTHS[monthName.slice(0, 3).toLowerCase()]
  if (month === undefined) return null
  return `${year}-${String(month).padStart(2, '0')}-01`
}

// String arithmetic on the year and month numbers, never a parsed Date: a bare
// YYYY-MM-DD parses as UTC midnight, whose local calendar day -- and in
// January its local MONTH -- is the one before in any western zone.
function addMonth(period) {
  const total = Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7))
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

function empty(problems, excluded = [], excludedEntity = 0) {
  return { cells: [], problems, excluded, excludedEntity, stoppedEarly: [] }
}

/**
 * The ledger, as cells.
 *
 * `overrides` maps a line item's AS-ENTERED name to 'retainer', 'project' or
 * 'exclude'; anything unnamed falls to `defaultKind`. That is the owner's rule
 * -- a bare client name is the retainer, a named line item is project work --
 * expressed as data supplied from outside, rather than as a table of real
 * client names in a public repository.
 *
 * The YEAR must be given. The ledger's rows say "Mar" and nothing more; the
 * year lives in the tab's title. Inferring it from today's date is how an
 * import silently lands twelve months out.
 */
export function planCells({
  csv,
  year,
  entity = 'TGC',
  alsoInclude = [],
  // Ledger name -> the name the client should be filed under. Applied BEFORE
  // the months are summed, which is the whole point: the ledger recorded one
  // relationship under a different name per entity, and renaming afterwards
  // would leave two cells for the same client-month for planImport to refuse
  // as a duplicate.
  rename = {},
  overrides = {},
  defaultKind = 'retainer',
}) {
  const problems = []
  const excluded = []
  let excludedEntity = 0

  if (year === undefined || year === null) {
    return empty([
      'No year given. The ledger names months but not years, and guessing one would move every row twelve months.',
    ])
  }

  const rows = parseCsv(csv)
  if (rows.length === 0) return empty(['The file is empty.'])

  // Columns are found by NAME. A reordered export still reads correctly, and a
  // renamed one fails loudly instead of reading the wrong column as money.
  const header = rows[0]
  const at = {}
  for (const name of REQUIRED) {
    const index = header.indexOf(name)
    if (index === -1) {
      problems.push(`No column named "${name}". Found: ${header.join(', ')}`)
    }
    at[name] = index
  }
  if (problems.length > 0) return empty(problems)

  // Clients whose work is invoiced through a different entity but who belong
  // in this tool anyway. An explicit, reviewed list of names -- never a
  // heuristic: the entity column is the only thing separating two businesses,
  // and guessing which exceptions are intended would quietly import the wrong
  // company's revenue.
  const kept = new Set(alsoInclude)

  const byClient = new Map()

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const monthName = row[at['Month']] ?? ''
    const ledgerName = row[at['Client']] ?? ''
    const client = rename[ledgerName] ?? ledgerName
    const asEntered = row[at['Client (as entered)']] ?? ''
    const amount = row[at['Invoice Amount']] ?? ''

    // A subtotal or spacer row: no client, or no month. Skipped rather than
    // refused -- an exported pivot carries them and they are not errors.
    if (client === '' || monthName === '') continue

    if ((row[at['Entity']] ?? '') !== entity && !kept.has(ledgerName) && !kept.has(client)) {
      const cents = parseMoney(amount)
      if (cents !== null) excludedEntity += cents
      continue
    }

    const period = periodOf(year, monthName)
    if (period === null) {
      problems.push(`Row ${i + 1}: "${monthName}" is not a month I recognise.`)
      continue
    }

    // A blank amount is a record-keeping artefact -- an invoice line with no
    // figure -- not a statement that nothing was billed. The zero fill below
    // is what says that, and only for months a client was active.
    if (amount === '') continue

    const cents = parseMoney(amount)
    if (cents === null) {
      problems.push(`Row ${i + 1}: cannot read "${amount}" as an amount.`)
      continue
    }

    const kind = overrides[asEntered] ?? defaultKind
    if (kind === 'exclude') {
      excluded.push({ asEntered, period, cents })
      continue
    }
    if (kind !== 'retainer' && kind !== 'project') {
      problems.push(
        `Row ${i + 1}: "${asEntered}" is classified "${kind}", which is not retainer, project or exclude.`,
      )
      continue
    }

    if (!byClient.has(client)) byClient.set(client, new Map())
    const months = byClient.get(client)
    const found = months.get(period) ?? { retainer: 0, project: 0 }
    found[kind] += cents
    months.set(period, found)
  }

  if (problems.length > 0) return empty(problems, excluded, excludedEntity)
  if (byClient.size === 0) {
    return empty(
      [
        'No invoices found. A silent success on an empty ledger is how an import reports "done" having written nothing.',
      ],
      excluded,
      excludedEntity,
    )
  }

  // The owner's ruling: a month with no invoice, for a client who was active,
  // means BILLED NOTHING. Without it a quiet month is indistinguishable from
  // an unrecorded one, retention excludes the client from both sides, and
  // contraction and churn become undetectable -- which is most of what this
  // tool exists to measure.
  //
  // Bounded by each client's OWN first and last invoice, never the ledger's.
  // Filling before the first would assert the agency billed a client nothing
  // in months it had never heard of them; filling after the last would assert
  // it about months that may simply not have happened yet.
  const cells = []
  const stoppedEarly = []
  const ledgerLast = [...byClient.values()]
    .flatMap((months) => [...months.keys()])
    .reduce((latest, period) => (period > latest ? period : latest), '')

  for (const [clientName, months] of [...byClient].sort((a, b) => a[0].localeCompare(b[0]))) {
    const periods = [...months.keys()].sort()
    const last = periods[periods.length - 1]

    for (let period = periods[0]; period <= last; period = addMonth(period)) {
      const found = months.get(period) ?? { retainer: 0, project: 0 }
      cells.push({
        clientName,
        period,
        retainer: String(found.retainer / 100),
        project: String(found.project / 100),
      })
    }

    // Named, never guessed at. A client who LEFT needs an end date, or
    // retention reads their absence as unentered rather than as churn -- and
    // only the owner knows which of these stopped invoicing and which left.
    if (last < ledgerLast) stoppedEarly.push({ clientName, lastPeriod: last })
  }

  return { cells, problems, excluded, excludedEntity, stoppedEarly }
}
