import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Final review I4: the rollout order in the plan is a safety property (the
// frontend before the migration breaks every check-in; links before the
// routine knows about hours leaves their answers wrong). Pinned here because
// nothing else would notice the steps being reordered.
const PLAN = readFileSync('docs/superpowers/plans/2026-11-04-productive-budget-hours.md', 'utf8')
const STEP7 = PLAN.slice(PLAN.indexOf('**Step 7: [OWNER] Rollout**'))

describe('Task 8 Step 7, the rollout', () => {
  it('lists the six steps in the ruled order', () => {
    const steps = [...STEP7.matchAll(/^(\d)\. \*\*([^*]+)\*\*/gm)].map((m) => [Number(m[1]), m[2]] as const)
    expect(steps.map(([n]) => n)).toEqual([1, 2, 3, 4, 5, 6])
    const [migrations, fn, push, routine, links, fetch] = steps.map(([, title]) => title)
    expect(migrations).toMatch(/^Migrations, then the verifiers/)
    expect(fn).toMatch(/function and its secrets/)
    expect(push).toMatch(/Push `productive-hours` to `main`/)
    expect(routine).toMatch(/routine prompt/)
    expect(links).toMatch(/Insert the confirmed links, last/)
    expect(fetch).toMatch(/October fetch in user mode/)
  })

  it('says why: PostgREST 400 before the migration, and to check the anon key format', () => {
    expect(STEP7).toMatch(/never deploy before the migration[^.]*:[^.]*PostgREST answers 400/)
    expect(STEP7).toContain('sb_publishable_')
    expect(STEP7).toMatch(/JWT/)
    expect(STEP7).toMatch(/live bundle's hash changed/)
    expect(STEP7).toMatch(/Not near a routine run[^.]*14:00 UTC/)
  })
})
