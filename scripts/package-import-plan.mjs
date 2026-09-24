// The package-history backfill, as rules rather than as a script.
//
// `client_packages` HAS NO DELETE POLICY. That is deliberate -- the same
// arrangement `client_month_revenue` has -- so a stint entered in error is
// corrected by editing it and can never be removed through the app. Which makes
// "get it right before writing" the entire design, and is why the decisions live
// in a module with tests instead of inside a one-off script.
//
// ONE ROW PER CLIENT, and the reason is worth stating because it looks like a
// shortcut and is not. `ladderStanding` reads only ACTIVE clients' CURRENT rung;
// `onRampComparison` reads only DEPARTED clients' ENTRY rung. Those halves are
// disjoint, so a single row each -- what they are on now, or what they joined at
// -- answers both the ladder and the verdict without reconstructing any history.
// The movement lists stay empty until somebody actually moves, which is honest:
// a reconstructed climb is a guess about a date, and the date is what decides
// who counts as a climber.
//
// Pure, and takes its clock as an argument, so every rule below is provable.
// The I/O lives in the builder outside this repo -- this repository is public
// and the roster names real clients.

/**
 * The three rungs, in ladder order.
 *
 * Duplicated from src/clients/clientPackages.ts because that is TypeScript and
 * this is a plain .mjs script node can run directly. tests/packageImport.test.ts
 * carries a drift guard that reads both and asserts they are the same set --
 * the same mitigation tests/capabilities.test.ts uses for the role presets.
 */
export const PACKAGE_CODES = ['foundation', 'grow', 'scale']

/** A roster typed into a spreadsheet will not match the database byte for byte. */
function normalise(name) {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * Turn the owner's decisions into stints, or into the reasons they cannot be.
 *
 * @param {object} args
 * @param {{ name: string, package: string, since: string }[]} args.rows  one per CSV line
 * @param {{ id: number, name: string, status: string, started_on: string|null, ended_on: string|null }[]} args.roster
 * @param {string} args.today  YYYY-MM-DD, passed in rather than read from a clock
 */
export function planPackages({ rows, roster, today }) {
  const problems = []
  const stints = []
  const skipped = []

  const byName = new Map(roster.map((client) => [normalise(client.name), client]))
  const seen = new Set()

  for (const raw of rows) {
    const name = String(raw.name ?? '').trim()
    const code = String(raw.package ?? '')
      .trim()
      .toLowerCase()
    const since = String(raw.since ?? '').trim()

    // An empty package is "I do not know", which this app renders honestly as
    // "No package recorded". A guessed rung is the thing it must never do.
    if (code === '') {
      skipped.push(name)
      continue
    }

    const client = byName.get(normalise(name))
    if (client === undefined) {
      problems.push(`No client matches "${name}".`)
      continue
    }

    if (!PACKAGE_CODES.includes(code)) {
      problems.push(`"${name}": "${code}" is not a package on the ladder.`)
      continue
    }

    if (seen.has(client.id)) {
      // The table's unique (client_id, started_on) would catch a same-day pair
      // and nothing would catch a different-day one -- which would quietly turn
      // this into a history import rather than the one-row-per-client pass it is.
      problems.push(`"${name}" appears more than once; this import writes one stint per client.`)
      continue
    }
    seen.add(client.id)

    let startedOn = since
    let assumed = false

    if (startedOn === '') {
      if (client.started_on === null || client.started_on === undefined) {
        problems.push(
          `"${name}" has no start date, so a blank "since" has nothing to date the stint from.`,
        )
        continue
      }
      startedOn = client.started_on
      assumed = true
    }

    if (client.started_on !== null && client.started_on !== undefined && startedOn < client.started_on) {
      problems.push(`"${name}": ${startedOn} is before the relationship began on ${client.started_on}.`)
      continue
    }

    if (client.ended_on !== null && client.ended_on !== undefined && startedOn > client.ended_on) {
      problems.push(`"${name}": ${startedOn} is after they left on ${client.ended_on}.`)
      continue
    }

    if (startedOn > today) {
      // currentStint reads a future date as a plan rather than the present, so
      // a row dated ahead is one the ladder would decline to count.
      problems.push(`"${name}": ${startedOn} is in the future; a stint dated ahead is a plan, not history.`)
      continue
    }

    stints.push({ clientId: client.id, name: client.name, packageCode: code, startedOn, assumed })
  }

  // ONE BAD ROW STOPS EVERYTHING. A partial write into a table with no delete
  // policy is the expensive kind of mistake, and the cheap fix is to make the
  // whole import refuse until the sheet is right.
  return { stints: problems.length > 0 ? [] : stints, problems, skipped }
}

/**
 * The transaction, which ends in `rollback;` on purpose.
 *
 * Run it once: the selects print what was written and what the invariants say,
 * and then nothing is kept. Read them, change the last line to `commit;`, run it
 * again. The same two-pass shape the 2025 revenue import used.
 */
export function emitSql(plan) {
  if (plan.problems.length > 0) {
    return [
      '-- REFUSED. Nothing is emitted while the plan has problems:',
      ...plan.problems.map((problem) => `--   ${problem}`),
      '',
    ].join('\n')
  }

  // NO SYNTAX EVER FOLLOWS A COMMENT ON THE SAME LINE. Each client's name goes
  // on its own line ABOVE its tuple, so the separating comma and the statement
  // terminator can never end up inside a `--`.
  //
  // Both of those shipped once, in one emitter: the comma joined after the
  // trailing comment and Postgres lost the separator; the semicolon landed
  // after the last comment and vanished with it. Neither was caught by an
  // assertion that a tuple appeared, and the first test written for the comma
  // could not see the semicolon at all -- stripping comments to look for the
  // defect also stripped the terminator. Putting comments on their own lines
  // removes the whole class rather than the two instances.
  const values = plan.stints
    .map((stint, index) => {
      const why = stint.assumed ? ', date assumed from the relationship start' : ''
      const separator = index === plan.stints.length - 1 ? '' : ','
      return (
        `  -- ${stint.name}${why}\n` +
        `  (${stint.clientId}, '${stint.packageCode}', '${stint.startedOn}', null)${separator}`
      )
    })
    .join('\n')

  return `-- Package history backfill. ${plan.stints.length} stints, one per client.
-- Generated; do not hand-edit. Change the sheet and rebuild.
begin;

insert into public.client_packages (client_id, package_code, started_on, note)
values
${values};

-- What landed, by rung.
select package_code, count(*) as clients
from public.client_packages
group by package_code
order by package_code;

-- The total, against what this script believed it was writing.
select count(*) as rows_written, ${plan.stints.length} as rows_expected
from public.client_packages;

-- Every stint must sit inside its client's relationship. Zero rows is the pass.
select c.name, p.started_on, c.started_on as relationship_began, c.ended_on
from public.client_packages p
join public.clients c on c.id = p.client_id
where (c.started_on is not null and p.started_on < c.started_on)
   or (c.ended_on is not null and p.started_on > c.ended_on);

-- No client may end up with two stints from this pass.
select client_id, count(*) as stints
from public.client_packages
group by client_id
having count(*) > 1;

-- ROLLBACK, deliberately. Run this whole script once: the selects above print
-- the totals and the invariant breaches, and then nothing is kept. Check them,
-- then change this last line to a commit and run it again.
rollback;
`
}

/** What the owner reads before deciding whether to commit. */
export function reportOf(plan) {
  if (plan.problems.length > 0) {
    return [`${plan.problems.length} problem(s); nothing will be written.`, ...plan.problems].join(
      '\n',
    )
  }

  const assumed = plan.stints.filter((stint) => stint.assumed)
  const byRung = PACKAGE_CODES.map(
    (code) => `  ${code}: ${plan.stints.filter((stint) => stint.packageCode === code).length}`,
  ).join('\n')

  const lines = [
    `${plan.stints.length} stints, one per client.`,
    byRung,
    // The number that decides whether this is safe to commit: an assumed date
    // asserts the client has been on that rung since the relationship began,
    // and therefore that they have never moved. Wrong for anyone who has.
    `${assumed.length} of ${plan.stints.length} dated by assumption from the relationship start:`,
    ...assumed.map((stint) => `  ${stint.name} (${stint.startedOn})`),
  ]

  if (plan.skipped.length > 0) {
    lines.push(
      `${plan.skipped.length} left out for want of a package, and they will read as "No package recorded":`,
      ...plan.skipped.map((name) => `  ${name}`),
    )
  }

  return lines.join('\n')
}
