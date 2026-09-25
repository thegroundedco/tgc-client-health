// The package-history backfill, as rules rather than as a script.
//
// `client_packages` HAS NO DELETE POLICY. That is deliberate -- the same
// arrangement `client_month_revenue` has -- so a stint entered in error is
// corrected by editing it and can never be removed through the app. Which makes
// "get it right before writing" the entire design, and is why the decisions live
// in a module with tests instead of inside a one-off script.
//
// TWO QUESTIONS PER CLIENT: what rung did they sign at, and if it was Foundation,
// when did they graduate into Grow?
//
// The first draft of this module asked ONE question -- their current rung -- on
// the reasoning that `ladderStanding` reads only active clients' current rung and
// `onRampComparison` reads only departed clients' entry rung, so the halves are
// disjoint. That reasoning was right about the two functions and wrong about the
// clients: a client who signed at Foundation and has since graduated would have
// been recorded as a Grow signing, which is precisely the population the verdict
// contrasts them against. The error would have landed inside the one figure this
// backfill exists to produce, and nothing downstream could have detected it.
//
// The signing stint needs no date of its own: the rung a client signed at is by
// definition the rung they held on their first day, so it takes the relationship
// start. Only the graduation needs a date from the owner.
//
// Pure, and takes its clock as an argument, so every rule below is provable. The
// I/O lives in the builder outside this repo -- this repository is public and the
// roster names real clients.

/**
 * The two rungs, in ladder order.
 *
 * Scale was a third until 2026-09-25 and is not a rung: it is a class of
 * post-foundation project -- a website rebuild, a rebrand, a roadshow -- that
 * runs ALONGSIDE Grow. src/clients/clientPackages.ts carries the full reasoning.
 * Duplicated from there because that is TypeScript and this is a plain .mjs
 * script node runs directly; tests/packageImport.test.ts guards the drift, the
 * same mitigation tests/capabilities.test.ts uses for the role presets.
 */
export const PACKAGE_CODES = ['foundation', 'grow']

/**
 * A real calendar day, written the way Postgres renders a `date`.
 *
 * EVERY OTHER RULE HERE IS A LEXICAL STRING COMPARISON, which is safe only once
 * the shape is known. A cell reading `2025-06-01', null), (999, 'grow', '2020-01-01`
 * sorts above the relationship start and below today, so it passed every
 * comparison and was interpolated straight into the SQL literal -- writing an
 * extra stint against an arbitrary client_id into a table with no delete policy.
 * A bare apostrophe broke the statement instead.
 */
function isDay(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const [year, month, day] = text.split('-').map(Number)
  const at = new Date(Date.UTC(year, month - 1, day))
  return (
    at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day
  )
}

/** A client name is only ever written into a comment; a newline would end it. */
function oneLine(text) {
  return String(text ?? '').replace(/[\r\n]+/g, ' ')
}

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
 * @param {{ name: string, signed_at: string, graduated_on: string }[]} args.rows
 * @param {{ id: number, name: string, status: string, started_on: string|null, ended_on: string|null }[]} args.roster
 * @param {string} args.today  YYYY-MM-DD, passed in rather than read from a clock
 */
export function planPackages({ rows, roster, today }) {
  const problems = []
  const stints = []
  const skipped = []
  const graduated = []

  // Built with a collision check rather than from entries. `clients_name_unique`
  // is on `lower(name)` only, while `normalise` also trims and collapses internal
  // whitespace -- so two rows that are distinct in the database can collide here,
  // and a Map built from entries would silently keep the last one and write the
  // sheet's row against the wrong client_id.
  const byName = new Map()
  for (const client of roster) {
    const key = normalise(client.name)
    const already = byName.get(key)
    if (already !== undefined) {
      problems.push(
        `More than one client is named "${client.name}" once case and spacing are ignored ` +
          `(ids ${already.id} and ${client.id}); this import cannot tell them apart.`,
      )
      continue
    }
    byName.set(key, client)
  }

  const seen = new Set()

  for (const raw of rows) {
    const name = String(raw.name ?? '').trim()
    const signedAt = String(raw.signed_at ?? '')
      .trim()
      .toLowerCase()
    const graduatedOn = String(raw.graduated_on ?? '').trim()

    // THE NAME IS RESOLVED FIRST, before the blank-rung short-circuit. The other
    // way round, a typo'd name with a blank rung was reported as a client who
    // "will read as No package recorded" -- so the owner never learned the row
    // matched nothing at all -- and a client listed twice, once blank and once
    // filled, was reported as skipped AND written with no problem raised.
    const client = byName.get(normalise(name))
    if (client === undefined) {
      problems.push(`No client matches "${name}".`)
      continue
    }

    if (seen.has(client.id)) {
      problems.push(`"${name}" appears more than once; this import writes one client per row.`)
      continue
    }
    seen.add(client.id)

    // An empty rung is "I do not know", which this app renders honestly as
    // "No package recorded". A guessed rung is the thing it must never do.
    if (signedAt === '') {
      skipped.push(name)
      continue
    }

    if (!PACKAGE_CODES.includes(signedAt)) {
      problems.push(
        `"${name}": "${signedAt}" is not a rung a client can sign at. Use foundation or grow.` +
          (signedAt === 'scale'
            ? ' Scale is a project type that runs alongside Grow, not a rung.'
            : ''),
      )
      continue
    }

    if (client.started_on === null || client.started_on === undefined) {
      problems.push(`"${name}" has no start date, so there is nothing to date their signing from.`)
      continue
    }

    if (graduatedOn !== '' && signedAt !== 'foundation') {
      problems.push(
        `"${name}" signed at Grow, so there is nowhere to graduate from; leave graduated_on empty.`,
      )
      continue
    }

    if (graduatedOn !== '') {
      if (!isDay(graduatedOn)) {
        problems.push(
          `"${name}": "${graduatedOn}" is not a date. Write a real day as YYYY-MM-DD.`,
        )
        continue
      }
      if (graduatedOn < client.started_on) {
        problems.push(
          `"${name}": graduating on ${graduatedOn} is before the relationship began on ${client.started_on}.`,
        )
        continue
      }
      if (graduatedOn === client.started_on) {
        // The table is unique on (client_id, started_on), so this pair would be
        // refused by Postgres mid-transaction -- and a graduation on the first
        // day is not a graduation.
        problems.push(
          `"${name}": graduating on ${graduatedOn} is the same day the relationship began.`,
        )
        continue
      }
      if (client.ended_on !== null && client.ended_on !== undefined && graduatedOn > client.ended_on) {
        problems.push(`"${name}": graduating on ${graduatedOn} is after they left on ${client.ended_on}.`)
        continue
      }
      if (graduatedOn > today) {
        // currentStint reads a future date as a plan rather than the present, so
        // the ladder would decline to count a row this import had written.
        problems.push(
          `"${name}": graduating on ${graduatedOn} is in the future; a stint dated ahead is a plan, not history.`,
        )
        continue
      }
    }

    stints.push({
      clientId: client.id,
      name: client.name,
      packageCode: signedAt,
      startedOn: client.started_on,
    })

    if (graduatedOn !== '') {
      stints.push({
        clientId: client.id,
        name: client.name,
        packageCode: 'grow',
        startedOn: graduatedOn,
      })
      graduated.push(client.name)
    }
  }

  // ONE BAD ROW STOPS EVERYTHING. A partial write into a table with no delete
  // policy is the expensive kind of mistake, and the cheap fix is to make the
  // whole import refuse until the sheet is right.
  return { stints: problems.length > 0 ? [] : stints, problems, skipped, graduated }
}

/**
 * The transaction, which ends in `rollback;` on purpose.
 *
 * Run it once: the selects print what was written and what the invariants say,
 * and then nothing is kept. Read them, change the last line to a commit, run it
 * again. The same two-pass shape the 2025 revenue import used.
 */
export function emitSql(plan) {
  if (plan.problems.length > 0) {
    return [
      '-- REFUSED. Nothing is emitted while the plan has problems:',
      ...plan.problems.map((problem) => `--   ${oneLine(problem)}`),
      '',
    ].join('\n')
  }

  // A sheet with every rung left blank is VALID and has nothing to write. The
  // insert was emitted anyway, as `values` followed by a bare semicolon, which
  // aborts the transaction at its first statement -- so the operator's
  // run-it-once-and-read-the-counts pass showed them a syntax error instead of
  // the counts, on a file that had done nothing wrong.
  if (plan.stints.length === 0) {
    return [
      '-- Nothing to write: no row in the sheet carries a signing rung.',
      `-- ${plan.skipped.length} client(s) were left out, and will read as "No package recorded".`,
      '',
    ].join('\n')
  }

  // NO SYNTAX EVER FOLLOWS A COMMENT ON THE SAME LINE. Each client's name goes on
  // its own line ABOVE its tuple, so the separating comma and the statement
  // terminator can never end up inside a `--`.
  //
  // Both of those shipped once, in one emitter: the comma joined after a trailing
  // comment and Postgres lost the separator; the semicolon landed after the last
  // comment and vanished with it. Neither was caught by an assertion that a tuple
  // appeared, and the first test written for the comma could not see the
  // semicolon at all -- stripping comments to look for the defect also stripped
  // the terminator. Comments on their own lines remove the class.
  const pairs = plan.stints
    .map((stint) => `  (${stint.clientId}, '${stint.startedOn}')`)
    .join(',\n')

  const values = plan.stints
    .map((stint, index) => {
      const separator = index === plan.stints.length - 1 ? '' : ','
      const what = stint.packageCode === 'foundation' ? 'signed' : 'signed or graduated'
      return (
        `  -- ${oneLine(stint.name)}, ${what}\n` +
        `  (${stint.clientId}, '${stint.packageCode}', '${stint.startedOn}', null)${separator}`
      )
    })
    .join('\n')

  return `-- Package history backfill. ${plan.stints.length} stints across ${plan.stints.length - plan.graduated.length} clients.
-- Generated; do not hand-edit. Change the sheet and rebuild.
begin;

insert into public.client_packages (client_id, package_code, started_on, note)
values
${values};

-- What landed, by rung.
select package_code, count(*) as stints
from public.client_packages
group by package_code
order by package_code;

-- The total, against what this script believed it was writing -- SCOPED to the
-- rows this pass wrote. An unscoped count over the whole table reports a false
-- mismatch the moment anybody has used the package editor, which shipped on
-- 2026-09-12.
select count(*) as rows_written, ${plan.stints.length} as rows_expected
from public.client_packages
where (client_id, started_on) in (
${pairs}
);

-- Anything in this table that this pass did NOT write. Zero rows means the
-- table was empty before; any row here is history entered through the editor,
-- and this import has just added a second one alongside it.
select c.name, p.package_code, p.started_on
from public.client_packages p
join public.clients c on c.id = p.client_id
where (p.client_id, p.started_on) not in (
${pairs}
)
order by c.name;

-- Every stint must sit inside its client's relationship. Zero rows is the pass.
select c.name, p.started_on, c.started_on as relationship_began, c.ended_on
from public.client_packages p
join public.clients c on c.id = p.client_id
where (c.started_on is not null and p.started_on < c.started_on)
   or (c.ended_on is not null and p.started_on > c.ended_on);

-- A client may hold at most two stints FROM THIS PASS, and a second one is
-- always Grow. Zero rows is the pass.
select client_id, count(*) as stints
from public.client_packages
where (client_id, started_on) in (
${pairs}
)
group by client_id
having count(*) > 2;

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

  // Counted by where each client SIGNED, which is one row per client -- not by
  // stint, which would count a graduate twice and make the two numbers add up to
  // something that is not the roster.
  const signings = plan.stints.filter(
    (stint, index) =>
      index === 0 || plan.stints[index - 1].clientId !== stint.clientId,
  )
  const byRung = PACKAGE_CODES.map(
    (code) => `  ${code}: ${signings.filter((stint) => stint.packageCode === code).length}`,
  ).join('\n')

  const lines = [
    `${signings.length} clients, ${plan.stints.length} stints.`,
    'Signed at:',
    byRung,
    `${plan.graduated.length} graduated from Foundation into Grow:`,
    ...plan.graduated.map((name) => `  ${name}`),
  ]

  if (plan.skipped.length > 0) {
    lines.push(
      `${plan.skipped.length} left out for want of a signing rung, and they will read as "No package recorded":`,
      ...plan.skipped.map((name) => `  ${name}`),
    )
  }

  return lines.join('\n')
}
