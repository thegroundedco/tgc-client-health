// Prints which Supabase project the CLI is currently linked to, and REFUSES —
// with a non-zero exit — when that project is not staging.
//
// This exists because the linked project lives in ONE gitignored file,
// supabase/.temp/project-ref, and no CLI command prints it before acting. A
// silent mislink means running migrations — and `verify:privileges`, which
// probes the write path for real and advances clients_id_seq — against
// production while believing it is staging.
//
// It is used as a gate, not a report: `npm run db:push` and friends are
// `npm run db:which && <the database command>`, so this script's exit code is
// what decides whether the command runs. An earlier version printed the
// production warning and then exited 0, which made every one of those `&&`
// guards decorative — the warning appeared and the command proceeded. The
// decision now lives in db-which-decide.mjs with a test on its exit codes,
// because a guard whose contract is untested is a guard that can quietly go
// back to being advisory.
//
// Deliberately resolves the NAME over the API rather than keeping a map of
// refs in the repo. A ref is not a secret (production's is inlined into the
// deployed bundle), but a committed list of them is a maintenance burden that
// silently goes stale, which is the failure mode this script exists to prevent.

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { OVERRIDE_ENV, decide } from './db-which-decide.mjs'

const REF_FILE = 'supabase/.temp/project-ref'

let ref
try {
  ref = readFileSync(REF_FILE, 'utf8').trim()
} catch {
  console.error(
    `No linked project. ${REF_FILE} is missing.\n` +
      `Run: npx supabase link --project-ref <ref>`,
  )
  process.exit(1)
}

let projects = null
let lookupFailed = false
try {
  const raw = execFileSync(
    'npx',
    ['--yes', 'supabase@latest', 'projects', 'list', '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  )
  const parsed = JSON.parse(raw)
  projects = Array.isArray(parsed) ? parsed : (parsed.projects ?? [])
} catch {
  // Reported to decide() rather than handled here: "the lookup failed" and
  // "the ref is not in the list" are different facts, and which of them may
  // proceed is the decision module's call, not this one's.
  lookupFailed = true
}

const project = lookupFailed
  ? null
  : (projects.find((p) => p.ref === ref || p.id === ref) ?? null)

const result = decide({
  ref,
  project,
  lookupFailed,
  // Any non-empty value counts. The variable's presence is the signal; making
  // people match an exact string would only add a way to think they had set it.
  allowProduction: Boolean(process.env[OVERRIDE_ENV]),
})

const out = result.exitCode === 0 ? console.log : console.error
out(result.lines.join('\n'))
process.exit(result.exitCode)
