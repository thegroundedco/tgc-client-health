// Prints which Supabase project the CLI is currently linked to, and says
// loudly when it is production.
//
// This exists because the linked project lives in ONE gitignored file,
// supabase/.temp/project-ref, and no CLI command prints it before acting. A
// silent mislink means running migrations — and `verify:privileges`, which
// probes the write path for real and advances clients_id_seq — against
// production while believing it is staging.
//
// Deliberately resolves the NAME over the API rather than keeping a map of
// refs in the repo. A ref is not a secret (production's is inlined into the
// deployed bundle), but a committed list of them is a maintenance burden that
// silently goes stale, which is the failure mode this script exists to prevent.

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

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

let projects = []
try {
  const raw = execFileSync(
    'npx',
    ['--yes', 'supabase@latest', 'projects', 'list', '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  )
  const parsed = JSON.parse(raw)
  projects = Array.isArray(parsed) ? parsed : (parsed.projects ?? [])
} catch {
  // A lookup failure must not block the caller — but it must not silently
  // read as "this is fine" either, so the ref is still reported and the
  // unknown name is stated as unknown.
  console.log(`linked project: ${ref} (name could not be resolved)`)
  process.exit(0)
}

const project = projects.find((p) => p.ref === ref || p.id === ref)

if (!project) {
  console.log(
    `linked project: ${ref}\n` +
      `WARNING: this ref is not visible to the logged-in account. Either the\n` +
      `CLI is authenticated as the wrong account, or the project was deleted.`,
  )
  process.exit(0)
}

// "staging" in the name is the only signal available without committing refs.
// A project that is not named staging is treated as production, because the
// safe default when the answer is unclear is to warn.
const isStaging = /staging/i.test(project.name)

console.log(`linked project: ${project.name}  (${ref}, ${project.region})`)
if (!isStaging) {
  console.log(
    `\n*** THIS IS PRODUCTION ***\n` +
      `Real client data. Writes here are not rehearsals.\n`,
  )
}
