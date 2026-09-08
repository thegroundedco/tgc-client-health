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
 * @param {{ cells: Cell[], roster: Client[],
 *            existing?: { client_id: number, period: string }[] }} input
 */
export function planImport({ cells, roster, existing = [] }) {
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

  // Client-months that ALREADY have a row and would be rewritten. The import
  // upserts on purpose -- it has to survive being re-run after the sheet is
  // corrected -- so the protection is not refusal, it is that the owner sees
  // this count before running it. Silently overwriting a month somebody typed
  // into the entry screen is the failure this exists to make visible.
  const already = new Set(existing.map((row) => `${row.client_id}|${row.period}`))
  const overwrites = planned
    .filter((write) => write.clientId !== null && already.has(`${write.clientId}|${write.period}`))
    .map((write) => ({ clientName: write.clientName, period: write.period }))

  return {
    overwrites,
    writes: problems.length > 0 ? [] : planned,
    newClients: [...newClients.values()].sort((left, right) => left.localeCompare(right)),
    skippedBlank,
    outsideLifecycle,
    problems,
    totalsByPeriod,
  }
}

// A single quoted SQL literal. Doubling the quote is not a nicety: "O'Brien
// Media" is an ordinary client name, and unescaped it ends the literal early --
// at best the statement fails, at worst it means something else entirely.
function q(text) {
  return `'${String(text).replace(/'/g, "''")}'`
}

/**
 * Turns a clean plan into one transaction. Throws rather than emitting anything
 * questionable: this is the last thing that runs before rows land in a table
 * with no delete policy.
 *
 * @param {ReturnType<typeof planImport>} plan
 */
export function emitSql(plan) {
  if (plan.problems.length > 0) {
    throw new Error(
      `refusing to emit SQL: the plan has ${plan.problems.length} problem(s). ` +
        `Fix the sheet and re-plan; a half-right import cannot be undone.`,
    )
  }
  if (plan.writes.length === 0) {
    throw new Error(
      'refusing to emit SQL: the plan writes nothing. An empty begin/commit ' +
        'reads as a successful import and is a silent no-op -- the failure mode ' +
        'where somebody believes the year loaded.',
    )
  }

  const parts = ['begin;', '']

  if (plan.newClients.length > 0) {
    // `where not exists` rather than `on conflict`: clients.name carries no
    // unique constraint, so there is no conflict target to name. This makes a
    // re-run idempotent all the same.
    parts.push(
      '-- Clients in the sheet that were not on file. Name only: status defaults',
      "-- to 'active', and started_on is deliberately NOT guessed from the first",
      '-- month with revenue -- they may predate the sheet, and a wrong tenure',
      '-- reads exactly like a right one.',
      'insert into public.clients (name)',
      `select v.name from (values ${plan.newClients.map((name) => `(${q(name)})`).join(', ')}) as v(name)`,
      'where not exists (',
      '  select 1 from public.clients c where lower(btrim(c.name)) = lower(btrim(v.name))',
      ');',
      '',
    )
  }

  // entered_by stays null throughout, and that is honest: nobody entered these
  // through the app. The column is nullable for exactly this case.
  const upsert = [
    'on conflict (client_id, period) do update',
    '  set retainer_cents = excluded.retainer_cents,',
    '      project_cents  = excluded.project_cents,',
    '      updated_at     = now();',
  ]

  const known = plan.writes.filter((write) => write.clientId !== null)
  if (known.length > 0) {
    parts.push(
      `-- ${known.length} client-month row(s) for clients already on file.`,
      'insert into public.client_month_revenue (client_id, period, retainer_cents, project_cents)',
      'values',
      known
        .map(
          (write) =>
            `  (${write.clientId}, ${q(write.period)}::date, ${write.retainerCents}, ${write.projectCents})`,
        )
        .join(',\n'),
      ...upsert,
      '',
    )
  }

  const fresh = plan.writes.filter((write) => write.clientId === null)
  if (fresh.length > 0) {
    // Joined on the name inside the same transaction, because these clients do
    // not have ids until the insert above runs. One pass, not two.
    parts.push(
      `-- ${fresh.length} row(s) for clients created above, matched back by name.`,
      'insert into public.client_month_revenue (client_id, period, retainer_cents, project_cents)',
      'select c.id, v.period::date, v.retainer_cents, v.project_cents',
      'from (values',
      fresh
        .map(
          (write) =>
            `  (${q(write.clientName)}, ${q(write.period)}, ${write.retainerCents}, ${write.projectCents})`,
        )
        .join(',\n'),
      ') as v(name, period, retainer_cents, project_cents)',
      'join public.clients c on lower(btrim(c.name)) = lower(btrim(v.name))',
      ...upsert,
      '',
    )
  }

  parts.push('commit;')
  return parts.join('\n')
}
