// Decides what a spreadsheet of past revenue becomes, and refuses when it
// cannot tell. Separated from the script that reads the file and talks to the
// database for the same reason db-which-decide.mjs is separated from
// db-which.mjs: these decisions are the whole safety contract, and an untested
// contract is not a contract.
//
// WHY THIS IS CAREFUL OUT OF PROPORTION TO ITS SIZE. public.client_month_revenue
// has NO DELETE POLICY, deliberately -- financial history refuses to vanish. A
// row written in error can be edited through the app but never removed, so
// every judgement here is one-way. The plan is therefore ALL OR NOTHING: if any
// cell is wrong, nothing is written, because a half-applied import into a table
// you cannot delete from is the worst outcome available -- afterwards the good
// rows cannot be told from the bad without the sheet in hand.
//
// parseMoney is IMPORTED, not reimplemented. It already solves the trap this
// would otherwise walk into a second time: 19.99 * 100 is 1998.9999999999998 in
// IEEE 754, and truncating it bills $19.98. src/revenue/money.ts is a leaf
// module (no relative imports), which is what lets plain Node reach it --
// tests/leafModules.test.ts holds it that way.
import { parseMoney } from '../src/revenue/money.ts'

/**
 * @typedef {{ clientName: string, period: string, retainer: string, project: string }} Cell
 * @typedef {{ id: number, name: string, started_on: string | null, ended_on: string | null }} Client
 * @typedef {{ clientName: string, clientId: number | null, period: string,
 *             retainerCents: number, projectCents: number }} Write
 */

// Names are matched on shape, not bytes: a sheet says "  east bay " and the
// roster says "East Bay". Case and internal spacing are normalised; nothing
// else is. No fuzzy matching, no edit distance -- a near-miss becomes a client
// to create, which the owner reviews, rather than a silent attachment of a
// year's revenue to the wrong company.
function normalise(name) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

// The first of the month containing a date. The lifecycle boundaries are
// months, not days: a client who started on the 15th billed a real, partial
// month, and a client who left on the 25th billed most of one.
function monthOf(day) {
  return `${day.slice(0, 7)}-01`
}

/**
 * @param {{ cells: Cell[], roster: Client[] }} input
 */
export function planImport({ cells, roster }) {
  /** @type {string[]} */
  const problems = []
  /** @type {Write[]} */
  const planned = []
  /** @type {{ clientName: string, period: string }[]} */
  const skippedBlank = []
  /** @type {{ clientName: string, period: string, reason: string }[]} */
  const outsideLifecycle = []
  /** @type {Map<string, string>} */
  const newClients = new Map()

  const byName = new Map()
  const ambiguous = new Set()
  for (const client of roster) {
    const key = normalise(client.name)
    if (byName.has(key)) ambiguous.add(key)
    else byName.set(key, client)
  }

  const seen = new Set()

  for (const cell of cells) {
    const key = normalise(cell.clientName)
    const { period } = cell

    // Checked here rather than left to the check constraint, and the same goes
    // for the amounts below. A constraint fires mid-transaction, after earlier
    // rows have already landed; the plan judges the whole sheet before any of
    // it runs.
    if (!/^\d{4}-\d{2}-01$/.test(period)) {
      problems.push(
        `${cell.clientName}: "${period}" is not the first of a month. ` +
          `The period column stores YYYY-MM-01 and the database enforces it.`,
      )
      continue
    }

    if (ambiguous.has(key)) {
      problems.push(
        `"${cell.clientName}" matches more than one client in the roster. ` +
          `Rename one of them, or tell me which id this sheet means — ` +
          `guessing would attach a year of revenue to the wrong company.`,
      )
      continue
    }

    const dupKey = `${key}|${period}`
    if (seen.has(dupKey)) {
      problems.push(
        `${cell.clientName} appears twice for ${period}. The table holds one row ` +
          `per client per month, and a duplicate might mean two project invoices ` +
          `to add up or a repeated row — those want opposite handling, so this ` +
          `refuses rather than choosing.`,
      )
      continue
    }
    seen.add(dupKey)

    const client = byName.get(key) ?? null

    // Only for clients already on file. A client being created has no dates to
    // judge against, and inventing a start date from the first month with
    // revenue would put a tenure on the board that reads exactly like a real
    // one.
    if (client) {
      if (client.started_on && period < monthOf(client.started_on)) {
        outsideLifecycle.push({
          clientName: client.name,
          period,
          reason: `before ${client.started_on}`,
        })
        continue
      }
      if (client.ended_on && period > monthOf(client.ended_on)) {
        outsideLifecycle.push({
          clientName: client.name,
          period,
          reason: `after ${client.ended_on}`,
        })
        continue
      }
    }

    // BOTH blank means nobody has said, and that is not a zero. One blank
    // beside a figure IS a zero -- exactly RevenueAdmin.handleSave's rule, so
    // the same sheet typed by hand produces the same rows. parseMoney('')
    // returns 0 by contract, which is why blankness is detected here and not
    // inferred from its result.
    const retainerBlank = cell.retainer.trim() === ''
    const projectBlank = cell.project.trim() === ''
    if (retainerBlank && projectBlank) {
      skippedBlank.push({ clientName: client ? client.name : cell.clientName.trim(), period })
      continue
    }

    const retainerCents = parseMoney(cell.retainer)
    if (retainerCents === null) {
      problems.push(
        `${cell.clientName} ${period}: retainer "${cell.retainer}" is not an amount ` +
          `I will accept. Negatives are refused (the column is >= 0) and so is ` +
          `anything past two decimal places.`,
      )
      continue
    }

    const projectCents = parseMoney(cell.project)
    if (projectCents === null) {
      problems.push(
        `${cell.clientName} ${period}: project work "${cell.project}" is not an ` +
          `amount I will accept.`,
      )
      continue
    }

    const canonical = client ? client.name : cell.clientName.trim().replace(/\s+/g, ' ')
    // Only clients that actually gain a row are created. A name whose every
    // month is blank has said nothing, and creating a client on the strength of
    // an empty row would put a company on the board that this sheet never
    // reported any revenue for.
    if (!client) newClients.set(key, canonical)

    planned.push({
      clientName: canonical,
      clientId: client ? client.id : null,
      period,
      retainerCents,
      projectCents,
    })
  }

  // Totalled from the cells that PASSED, before the all-or-nothing gate below,
  // so a sheet with problems still shows its shape. The owner checks these
  // against what they already believe the year looked like -- the cheapest way
  // to catch a misread column before anything is written.
  const totals = new Map()
  for (const write of planned) {
    totals.set(write.period, (totals.get(write.period) ?? 0) + write.retainerCents + write.projectCents)
  }
  const totalsByPeriod = [...totals.entries()]
    .map(([period, cents]) => ({ period, cents }))
    .sort((left, right) => left.period.localeCompare(right.period))

  return {
    writes: problems.length > 0 ? [] : planned,
    newClients: [...newClients.values()].sort((left, right) => left.localeCompare(right)),
    skippedBlank,
    outsideLifecycle,
    problems,
    totalsByPeriod,
  }
}
