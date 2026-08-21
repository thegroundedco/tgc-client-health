import { describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain .mjs script with JSDoc types, not part of the app's
// TypeScript program. Imported here because the exit codes below are the whole
// safety contract, and an untested contract is how the previous version of this
// guard came to warn about production and then exit 0 anyway.
import { OVERRIDE_ENV, PRODUCTION, STAGING, UNKNOWN, decide } from '../scripts/db-which-decide.mjs'

const STAGING_PROJECT = { name: 'tgc-client-health-staging', region: 'us-west-1' }
const PROD_PROJECT = { name: 'tgc-client-health', region: 'us-west-1' }

describe('db:which — the exit code is the guard', () => {
  // Every case below exists because `npm run db:push` is literally
  // `npm run db:which && npx supabase db push --linked`. A zero exit here is
  // permission to write to whatever is linked, so each assertion is about
  // whether a real database command would have run.

  it('lets staging through', () => {
    const result = decide({ ref: 'abc123', project: STAGING_PROJECT })
    expect(result.verdict).toBe(STAGING)
    expect(result.exitCode).toBe(0)
    expect(result.lines.join('\n')).toContain('tgc-client-health-staging')
  })

  it('REFUSES production, rather than warning and proceeding', () => {
    // This is the regression under test. The previous implementation printed
    // "*** THIS IS PRODUCTION ***" and then fell off the end of the file,
    // which is an exit code of 0 — so the migration ran. The warning text was
    // never the problem; the exit code was.
    const result = decide({ ref: 'abc123', project: PROD_PROJECT })
    expect(result.verdict).toBe(PRODUCTION)
    expect(result.exitCode).toBe(1)
    expect(result.lines.join('\n')).toContain('THIS IS PRODUCTION')
  })

  it('refuses when the project name could not be resolved', () => {
    // "I could not tell" must fail closed. The old script printed
    // "(name could not be resolved)" and exited 0, so an expired login or a
    // CLI authenticated to the wrong account read as permission to proceed.
    const result = decide({ ref: 'abc123', project: null, lookupFailed: true })
    expect(result.verdict).toBe(UNKNOWN)
    expect(result.exitCode).toBe(1)
  })

  it('refuses when the ref is not visible to the logged-in account', () => {
    const result = decide({ ref: 'abc123', project: null })
    expect(result.verdict).toBe(UNKNOWN)
    expect(result.exitCode).toBe(1)
  })

  it('names the override in every refusal, so the way forward is on screen', () => {
    // A guard that blocks without saying how to proceed deliberately gets
    // worked around by copying the underlying command out of package.json and
    // running it bare — which removes the guard entirely instead of overriding
    // it once.
    for (const args of [
      { ref: 'r', project: PROD_PROJECT },
      { ref: 'r', project: null },
      { ref: 'r', project: null, lookupFailed: true },
    ]) {
      const result = decide(args)
      expect(result.exitCode).toBe(1)
      expect(result.lines.join('\n')).toContain(`${OVERRIDE_ENV}=1`)
    }
  })

  it('lets a deliberate override through, and says that it did', () => {
    // Without this, failing closed would make a production migration
    // impossible rather than deliberate — a different bug, not a stricter
    // version of this one.
    const result = decide({ ref: 'r', project: PROD_PROJECT, allowProduction: true })
    expect(result.exitCode).toBe(0)
    expect(result.overridden).toBe(true)
    expect(result.lines.join('\n')).toContain('going ahead')
    // Still says which project, and still says it is production. An override
    // that hides what it overrode is how the wrong one gets set once and
    // forgotten.
    expect(result.lines.join('\n')).toContain('THIS IS PRODUCTION')
  })

  it('does not treat an override as a reason to skip identifying the project', () => {
    const result = decide({ ref: 'r', project: null, lookupFailed: true, allowProduction: true })
    expect(result.exitCode).toBe(0)
    expect(result.overridden).toBe(true)
    expect(result.verdict).toBe(UNKNOWN)
  })

  it('matches staging case-insensitively, but nothing looser than that', () => {
    // The name test is the only signal available without committing a list of
    // project refs to a public repo, so its edges are worth pinning: anything
    // not naming staging is production, including an empty name.
    expect(decide({ ref: 'r', project: { name: 'TGC-STAGING' } }).exitCode).toBe(0)
    expect(decide({ ref: 'r', project: { name: 'staging' } }).exitCode).toBe(0)
    expect(decide({ ref: 'r', project: { name: 'tgc-stage' } }).exitCode).toBe(1)
    expect(decide({ ref: 'r', project: { name: '' } }).exitCode).toBe(1)
  })

  it('survives a project with no region, rather than printing undefined', () => {
    const result = decide({ ref: 'abc123', project: { name: 'x-staging' } })
    expect(result.lines.join('\n')).not.toContain('undefined')
  })
})
