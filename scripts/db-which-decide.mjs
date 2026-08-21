// The decision half of `npm run db:which`, kept apart from the I/O half so it
// can be tested.
//
// Why this file exists at all: db-which.mjs used to detect production, print
// "*** THIS IS PRODUCTION ***", and then exit 0 -- so
// `npm run db:which && npx supabase db push --linked` printed the warning and
// pushed to production anyway. The `&&` was decorative. It sat in front of
// `db:push` (migrations) and `verify:privileges` (which advances
// clients_id_seq for real), which means neither was ever actually protected;
// what held was the habit of leaving staging linked, not the guard.
//
// A guard that reads as protection and is not is worse than no guard, because
// it is trusted. The exit code is the whole contract, so it is the thing under
// test here.

export const OVERRIDE_ENV = 'ALLOW_PRODUCTION'

// Every outcome this guard can reach. `staging` is the only one that lets a
// database command run without an explicit override.
export const STAGING = 'staging'
export const PRODUCTION = 'production'
export const UNKNOWN = 'unknown'

/**
 * Decide whether a database command may proceed.
 *
 * Pure: no file reads, no network, no process.exit. The caller owns all of
 * that, which is what makes the exit codes assertable in a unit test.
 *
 * @param {object} args
 * @param {string} args.ref            the linked project ref
 * @param {{name: string, region?: string} | null} args.project
 *        the resolved project, or null when the ref is not visible to the
 *        logged-in account
 * @param {boolean} [args.lookupFailed] true when the projects-list call itself
 *        failed, so the name could not be resolved either way
 * @param {boolean} [args.allowProduction] the operator set ALLOW_PRODUCTION
 * @returns {{verdict: string, exitCode: number, overridden: boolean, lines: string[]}}
 */
export function decide({ ref, project, lookupFailed = false, allowProduction = false }) {
  // Both branches below are "I could not tell which project this is", and both
  // fail closed. This is the half of the old script that looked most harmless:
  // it printed the ref, said the name was unknown, and exited 0 -- so a CLI
  // authenticated to the wrong account, or an expired login, read as
  // permission to proceed. An unanswered question is not a yes.
  if (lookupFailed) {
    return withOverride({
      verdict: UNKNOWN,
      allowProduction,
      lines: [
        `linked project: ${ref} (name could not be resolved)`,
        '',
        'Refusing to continue: this guard could not confirm the linked project',
        'is staging. That is not the same as confirming it is production -- it',
        'means the check did not run, so it cannot be relied on.',
      ],
    })
  }

  if (!project) {
    return withOverride({
      verdict: UNKNOWN,
      allowProduction,
      lines: [
        `linked project: ${ref}`,
        '',
        'Refusing to continue: this ref is not visible to the logged-in',
        'account. Either the CLI is authenticated as the wrong account, or the',
        'project was deleted. Both mean the linked project is unverified.',
      ],
    })
  }

  const where = `linked project: ${project.name}  (${ref}${
    project.region ? `, ${project.region}` : ''
  })`

  // Matching on the name is the only signal available without committing a
  // list of refs to a public repo. It is a deliberately conservative test:
  // anything not named staging is treated as production, so a new project
  // nobody thought about fails closed rather than open.
  if (/staging/i.test(project.name)) {
    return { verdict: STAGING, exitCode: 0, overridden: false, lines: [where] }
  }

  return withOverride({
    verdict: PRODUCTION,
    allowProduction,
    lines: [
      where,
      '',
      '*** THIS IS PRODUCTION ***',
      'Real client data. Writes here are not rehearsals.',
    ],
  })
}

// The override exists so that a deliberate production migration stays
// possible. Without one, failing closed would make production unreachable,
// which is a different bug rather than a stricter version of this one. It has
// to be set per command and it says so in the output, so an override can never
// be the thing nobody noticed.
function withOverride({ verdict, allowProduction, lines }) {
  if (!allowProduction) {
    return {
      verdict,
      exitCode: 1,
      overridden: false,
      lines: [...lines, '', `To proceed anyway: ${OVERRIDE_ENV}=1 <your command>`],
    }
  }
  return {
    verdict,
    exitCode: 0,
    overridden: true,
    lines: [...lines, '', `${OVERRIDE_ENV}=1 was set, so this is going ahead.`],
  }
}
